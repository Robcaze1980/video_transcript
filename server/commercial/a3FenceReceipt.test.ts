import {createHash,randomUUID} from 'node:crypto';
import {Firestore,Timestamp,type DocumentReference,type Transaction} from 'firebase-admin/firestore';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {AI_CATALOG_VERSION} from './aiContracts';
import {AccountBillingClient} from './accountBillingClient';
import {AccountStore} from '../account/backend';
import {FirestoreBackend,A3_REPLAY_WINDOW_MS,type DirectObservationSnapshot} from './firestoreBackend';

const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Data=Record<string,any>;
type Entry={row:Data;created:Timestamp;updated:Timestamp};
const NOW=2_000_000_000_000;

function fixture(enabled=true){
  const db=new Firestore({projectId:'demo-vistavo-ledger',host:'127.0.0.1:8185',ssl:false});
  const root=db.collection('vistavo_a3_exit_video_synthetic').doc(randomUUID());
  const nonce=randomUUID(),uid=randomUUID(),accountId=randomUUID(),inputId=randomUUID(),requestKey=randomUUID();
  const intentId=digest([accountId,requestKey]),identityKey=digest(['firebase',uid]),operation='translation:en';
  const billing={provider:'account_seconds' as const,reservationId:randomUUID(),seconds:2,identityKey};
  const witness={intentId,accountId,inputId,operation,revision:1,profile:AI_CATALOG_VERSION,...billing};
  const observed={reservationId:billing.reservationId,seconds:2,state:'reserved' as const};
  const entries=new Map<string,Entry>(),commits:string[][]=[];
  const time={now:NOW},createdAtMs=NOW-A3_REPLAY_WINDOW_MS;
  let generation=0;
  const ref=(collection:string,id:string)=>root.collection(collection).doc(id);
  function put(doc:DocumentReference,row:Data){
    const stamp=new Timestamp(Math.floor(NOW/1000),++generation);
    entries.set(doc.path,{row:structuredClone(row),created:entries.get(doc.path)?.created??stamp,updated:stamp});
  }
  const intent=ref('billingIntents',intentId),receipt=ref('billingA3FenceReceipts',intentId);
  const intentData={id:intentId,accountId,inputId,requestKey,operation,revision:1,...billing,
    state:'reserve_pending',createdAtMs,updatedAtMs:createdAtMs,nextAttemptAt:0,attempts:1};
  put(root,{purpose:'a3-exit-synthetic',nonce});
  put(intent,intentData);put(ref('accounts',accountId),{});put(ref('identities',identityKey),{accountId,uid});
  put(ref('inputs',inputId),{accountId,deleted:false});put(ref('projects',inputId),{accountId,inputId,revision:1});
  put(ref('billingIntentWitnesses',intentId),{...witness,historyProtocol:1,baseline:'before_reservation',createdAtMs,
    terminalRecovery:{protocol:1,releasePrepared:false,sealPrepared:false}});
  put(ref('billingIntentAdmissionGuards',intentId),{protocol:1,intentId,state:'clear',createdAtMs});
  // Only the SDK reference/metadata types are real. Buffer all writes until success; no SDK RPC executes.
  vi.spyOn(db,'runTransaction').mockImplementation(async fn=>{
    const writes:Array<{doc:DocumentReference;row:Data}>=[];
    const get=(doc:DocumentReference)=>{
      if(writes.length)throw Error('read after write');
      const item=entries.get(doc.path);
      return {ref:doc,id:doc.id,exists:!!item,get:(key:string)=>item?.row[key],data:()=>item&&structuredClone(item.row),
        createTime:item?.created,updateTime:item?.updated,readTime:Timestamp.fromMillis(time.now)};
    };
    const tx={get:async(doc:DocumentReference)=>get(doc),getAll:async(...refs:DocumentReference[])=>refs.map(get),
      create:(doc:DocumentReference,row:Data)=>{if(entries.has(doc.path))throw Error('already exists');writes.push({doc,row});},
      set:(doc:DocumentReference,patch:Data,options:{merge:true})=>{
        if(options.merge!==true)throw Error('only merge is supported in this fixture');
        writes.push({doc,row:{...entries.get(doc.path)?.row,...patch}});
      },
      update:(doc:DocumentReference,patch:Data)=>{const row=entries.get(doc.path)?.row;if(!row)throw Error('not found');writes.push({doc,row:{...row,...patch}});}};
    const result=await fn(tx as unknown as Transaction);
    for(const write of writes)put(write.doc,write.row);
    if(writes.length)commits.push(writes.map(write=>write.doc.path));
    return result;
  });
  const backend=new FirestoreBackend(db,root,enabled?{a3FenceReceiptFixtureNonce:nonce}:{});
  const start=async()=>{
    const snap=await backend.captureDirectObservation(witness,requestKey,'status',true,'before_status');
    if(!snap||'blocked' in snap)throw Error('missing start');
    return snap;
  };
  const claim=(snapshot:DirectObservationSnapshot,response:{state:'reserved';seconds:number;reservationId:string}=observed)=>
    backend.claimExternalBillingRelease(accountId,requestKey,billing,{snapshot,observed:response});
  return {db,root,nonce,witness,billing,intent,receipt,time,entries,commits,ref,put,intentData,backend,start,claim,observed,requestKey};
}

beforeEach(()=>{vi.stubEnv('FIRESTORE_EMULATOR_HOST','127.0.0.1:8185');});
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});

describe('local A3 fence writer evidence',()=>{
  it('persists request before the call and commits only the receipt and intent together; replay never wins',async()=>{
    const c=fixture(),first=await c.start(),other=await c.start();
    const start=c.ref('billingA3StatusAttempts',first.attemptId);
    expect(first.attemptId).not.toBe(other.attemptId);expect(c.entries.get(start.path)?.row.snapshot).toEqual(first);
    expect(c.entries.has(c.receipt.path)).toBe(false);
    expect(await c.claim(first)).toEqual({state:'release_pending',transitioned:true});
    expect(c.commits.at(-1)).toEqual([c.receipt.path,c.intent.path]);
    const record=c.entries.get(c.receipt.path)!.row;
    expect(record).toMatchObject({protocol:1,namespace:c.root.path,statusAttemptId:first.attemptId,returnedStatus:c.observed,
      beforeVersions:first.versions,startedRequest:{path:start.path},evaluatedAtMs:NOW,
      writes:{updateIntent:{path:c.intent.path,fields:{state:'release_pending',updatedAtMs:NOW,nextAttemptAt:0}},createReceipt:{path:c.receipt.path}}});
    expect(record.intentBeforeSha256).not.toBe(record.intendedIntentAfterSha256);
    expect(Object.keys(record.beforeVersions)).toHaveLength(14);
    expect(c.entries.get(c.intent.path)?.row).toEqual({...c.intentData,state:'release_pending',updatedAtMs:NOW});
    for(const attempt of [first,other])expect(await c.claim(attempt)).toEqual({state:'release_pending',transitioned:false});
    expect(c.commits).toHaveLength(3);
  });
  it('keeps default and generic callers on their existing winner and replay paths',async()=>{
    const ordinary=fixture(false),read=await ordinary.start();
    expect(ordinary.commits).toHaveLength(0);
    expect(await ordinary.claim(read)).toEqual({state:'release_pending',transitioned:true});
    expect(ordinary.commits).toEqual([[ordinary.intent.path]]);
    const c=fixture();expect(await c.backend.fenceExternalBillingRelease(c.witness.accountId,c.requestKey,c.billing)).toEqual({state:'release_pending'});
    expect(c.commits).toEqual([[c.intent.path]]);
  });
  it.each(['missing start','updated start','different attempt','wrong seconds','wrong reservation','additional same-content write',
    'new job marker','reassigned identity','receipt collision','changed root','policy too early','still scheduled','unknown field','origin creation mismatch'])(
    'rejects %s before appending any fence writes',async reason=>{
      const c=fixture();
      if(reason==='still scheduled')c.put(c.intent,{...c.intentData,nextAttemptAt:NOW+1});
      if(reason==='unknown field')c.put(c.intent,{...c.intentData,unclassified:true});
      const origin=c.ref('billingIntentWitnesses',c.witness.intentId);
      if(reason==='origin creation mismatch')c.put(origin,{...c.entries.get(origin.path)!.row,createdAtMs:NOW});
      const snapshot=await c.start(),attempt=c.ref('billingA3StatusAttempts',snapshot.attemptId);
      if(reason==='missing start')c.entries.delete(attempt.path);
      if(reason==='updated start')c.put(attempt,c.entries.get(attempt.path)!.row);
      if(reason==='different attempt')snapshot.attemptId=randomUUID();
      if(reason==='additional same-content write'){const p=c.ref('projects',c.witness.inputId);c.put(p,c.entries.get(p.path)!.row);}
      if(reason==='new job marker')c.put(c.ref('billingIntentJobMarkers',c.witness.intentId),{other:true});
      if(reason==='reassigned identity')c.put(c.ref('identities',c.witness.identityKey),{accountId:randomUUID(),uid:randomUUID()});
      if(reason==='receipt collision')c.put(c.receipt,{preserve:true});
      if(reason==='changed root')c.put(c.root,{purpose:'a3-exit-synthetic',nonce:randomUUID()});
      if(reason==='policy too early')c.time.now=NOW-1;
      const before=structuredClone([...c.entries].map(([key,data])=>[key,data.row]));
      const response={...c.observed,seconds:reason==='wrong seconds'?3:2,reservationId:reason==='wrong reservation'?randomUUID():c.observed.reservationId};
      await expect(c.claim(snapshot,response)).rejects.toMatchObject({code:'invariant'});
      expect([...c.entries].map(([key,data])=>[key,data.row])).toEqual(before);
      expect(c.commits).toEqual([[attempt.path]]);
  });
  it('rejects the local writer on the wrong client target, root or environment',()=>{
    const c=fixture(),opts={a3FenceReceiptFixtureNonce:c.nonce};
    expect(()=>new FirestoreBackend(c.db,c.db.collection('other').doc(randomUUID()),opts)).toThrow();
    const wrong=new Firestore({projectId:'demo-other',host:'127.0.0.1:8185',ssl:false});
    expect(()=>new FirestoreBackend(wrong,wrong.doc(c.root.path),opts)).toThrow();
    vi.stubEnv('NODE_ENV','production');
    expect(()=>new FirestoreBackend(c.db,c.root,opts)).toThrow();
  });
});

// These counterexamples ask exactly what a reader of the v1 protocol can observe after a real writer call.
// The storage is the in-memory fixture above. The synthetic mutations model missing history, not client authority.
describe('what remains visible after the A3 writer commits',()=>{
  it('an intervening creation and deletion leaves the entire visible snapshot unchanged',async()=>{
    const c=fixture(),late=await c.start(),winner=await c.start();
    expect(await c.claim(winner)).toEqual({state:'release_pending',transitioned:true});
    const currentVersions=async()=>{
      const read=await c.backend.captureDirectObservation(c.witness,c.requestKey,'status');
      expect(read).not.toBeNull();
      return read!.versions;
    };
    const cleanVersions=await currentVersions(),before=new Map(c.entries);
    expect(cleanVersions.guard).toEqual({exists:false});
    const guard=c.ref('billingGuards',c.witness.accountId);
    c.put(guard,{accountId:c.witness.accountId,blocked:true,epoch:1,createdAtMs:NOW});
    expect(c.entries.get(guard.path)?.row.blocked).toBe(true);
    expect(c.entries.delete(guard.path)).toBe(true);
    expect(await currentVersions()).toEqual(cleanVersions);
    expect(c.entries).toEqual(before); // includes both starts, the genuine receipt and metadata for the intent
    expect(await c.backend.recordReservedStatusUncertainty(c.witness,c.requestKey,late)).toBe('needs_review');
    const reviews=[...c.entries.keys()].filter(path=>path.includes('/billingIntentObservationIncidents/'));
    expect(reviews).toHaveLength(1);
    expect(await c.backend.recordReservedStatusUncertainty(c.witness,c.requestKey,late)).toBe('needs_review');
    expect([...c.entries.keys()].filter(path=>path.includes('/billingIntentObservationIncidents/'))).toEqual(reviews);
    expect([...c.entries.keys()].some(path=>path.includes('/billingIntentDispatchClaims/'))).toBe(false);
  });

  it('changing and restoring the intent advances its own version while preserving all v1 writer evidence',async()=>{
    const c=fixture(),read=await c.start();
    await c.claim(read);
    const committed=c.entries.get(c.intent.path)!,receipt=c.entries.get(c.receipt.path)!;
    const after=await c.backend.captureDirectObservation(c.witness,c.requestKey,'status');
    const versionAtFence=after!.versions.intent;
    expect(versionAtFence.exists).toBe(true);
    const intendedRow={...c.intentData,...receipt.row.writes.updateIntent.fields};
    expect(committed.row).toEqual(intendedRow);
    c.put(c.intent,{...committed.row,nextAttemptAt:15_000});
    c.put(c.intent,committed.row);
    const current=await c.backend.captureDirectObservation(c.witness,c.requestKey,'status');
    expect(c.entries.get(c.intent.path)?.row).toEqual(intendedRow);
    expect(c.entries.get(c.intent.path)?.created.isEqual(committed.created)).toBe(true);
    expect(current!.versions.intent).not.toEqual(versionAtFence);
    expect(c.entries.get(c.receipt.path)).toBe(receipt);
    expect(receipt.row.beforeVersions.intent).toEqual(read.versions.intent);
    // Only the test took the post-commit reading. The receipt's versioned input is the preimage.
    expect(Object.keys(receipt.row.writes.updateIntent).sort()).toEqual(['fields','path']);
    expect(await c.claim(read)).toEqual({state:'release_pending',transitioned:false});
  });

  it('AccountStore checks the live owner but the returned status cannot distinguish a reverted change of owner',async()=>{
    const video=fixture(),account=fixture(false); // independent transactional adapters; no network
    const remoteRoot=account.db.collection('synthetic_account_postimage').doc(randomUUID());
    const store=new AccountStore(account.db,remoteRoot);
    const {identityKey,reservationId}=video.billing,owner=randomUUID(),other=randomUUID();
    const foreignVideoOwner=randomUUID(),foreignUid=randomUUID(),foreignIdentity=digest(['firebase',foreignUid]);
    const foreignVideoAccount=video.ref('accounts',foreignVideoOwner);
    video.put(foreignVideoAccount,{active:0});
    video.put(video.ref('identities',foreignIdentity),{uid:foreignUid,accountId:foreignVideoOwner});
    account.put(remoteRoot.collection('identities').doc(foreignIdentity),{uid:foreignUid,accountId:other});
    const foreignBefore=video.entries.get(foreignVideoAccount.path);
    const uid=video.entries.get(video.ref('identities',identityKey).path)!.row.uid;
    const identity=remoteRoot.collection('identities').doc(identityKey);
    const reservation=remoteRoot.collection('videoReservations').doc(digest([owner,reservationId]));
    account.put(identity,{uid,accountId:owner});
    account.put(reservation,{ownerAccountId:owner,identityKey,reservationId,state:'reserved',seconds:2});
    const late=await video.start(),winner=await video.start();
    const readStatus=()=>store.videoReservation(identityKey,reservationId);
    const observed=await readStatus();expect(observed).toEqual(video.observed);
    const winnerReturn=await readStatus();
    if(winnerReturn.state!=='reserved')throw Error('expected an actual reserved status');
    expect(await video.claim(winner,{...winnerReturn,state:winnerReturn.state})).toEqual({state:'release_pending',transitioned:true});
    const videoBefore=new Map(video.entries),originalOwner=account.entries.get(identity.path)!;
    account.put(identity,{uid,accountId:other});
    await expect(readStatus()).rejects.toMatchObject({code:'not_found'});
    account.put(identity,originalOwner.row);
    const current=await readStatus();
    expect(current).toEqual(observed);
    expect(Object.keys(current).sort()).toEqual(['reservationId','seconds','state']);
    expect(account.entries.get(identity.path)!.updated.isEqual(originalOwner.updated)).toBe(false);
    expect(video.entries).toEqual(videoBefore);
    expect(await video.backend.recordReservedStatusUncertainty(video.witness,video.requestKey,late)).toBe('needs_review');
    expect(account.entries.get(reservation.path)?.row.state).toBe('reserved');
    expect(account.commits).toEqual([]); // both status reads and the not-found branch are read-only
    expect(video.entries.get(foreignVideoAccount.path)).toBe(foreignBefore);
    expect(video.entries.has(video.ref('billingGuards',foreignVideoOwner).path)).toBe(false);
  });

  it('a different validated status can be lost without changing any durable evidence for that attempt',async()=>{
    const c=fixture();
    const seconds=[3,2];
    const calls:string[]=[];
    const client=new AccountBillingClient(undefined,{request:async request=>{
      const path=new URL(request.url).pathname;
      expect(path).toBe('/api/internal/video/reservations/'+c.billing.reservationId+'/status');
      expect(request.data).toEqual({identityKey:c.billing.identityKey});
      calls.push(path);
      return {data:{reservationId:c.billing.reservationId,state:'reserved',seconds:seconds.shift()}};
    }});
    const late=await c.start(),beforeDelivery=new Map(c.entries);
    const returned=await client.status(c.billing.identityKey,c.billing.reservationId);
    expect(returned.seconds).toBe(3);expect(late.witness.seconds).toBe(2);
    // Model process loss after status validation, before its caller receives and journals these bytes.
    expect(c.entries).toEqual(beforeDelivery);
    const winner=await c.start(),winnerReturn=await client.status(c.billing.identityKey,c.billing.reservationId);
    if(winnerReturn.state!=='reserved')throw Error('expected a reserved response');
    await c.claim(winner,{...winnerReturn,state:winnerReturn.state});
    const receipt=c.entries.get(c.receipt.path)!.row;
    expect(receipt.statusAttemptId).toBe(winner.attemptId);
    expect(receipt.returnedStatus.seconds).toBe(2);
    const issued=c.entries.get(c.ref('billingA3StatusAttempts',late.attemptId).path)!.row;
    expect(issued.expectedSeconds).toBe(2);expect(issued).not.toHaveProperty('returnedStatus');
    expect(calls).toHaveLength(2);expect(seconds).toEqual([]);
  });

  it('the winner persists its return but a lost late return remains unobserved across restart',async()=>{
    const c=fixture(),late=await c.start(),winner=await c.start();
    expect(late.versions).toEqual(winner.versions);expect(late.attemptId).not.toBe(winner.attemptId);
    await c.claim(winner);
    const oldAttempt=c.entries.get(c.ref('billingA3StatusAttempts',late.attemptId).path)!.row;
    expect(Object.keys(oldAttempt).sort()).toEqual(['expectedReservationId','expectedSeconds','fixtureNonce','kind','namespace','protocol','snapshot']);
    expect(oldAttempt.snapshot).toEqual(late);
    const evidence=c.entries.get(c.receipt.path)!.row;
    expect(evidence.statusAttemptId).toBe(winner.attemptId);expect(evidence.returnedStatus).toEqual(c.observed);
    const restart=new FirestoreBackend(c.db,c.root,{a3FenceReceiptFixtureNonce:c.nonce});
    const retry=await restart.claimExternalBillingRelease(c.witness.accountId,c.requestKey,c.billing);
    expect(retry).toEqual({state:'release_pending',transitioned:false});
    expect(c.entries.get(c.ref('billingA3StatusAttempts',late.attemptId).path)!.row).toEqual(oldAttempt);
    expect(c.commits).toHaveLength(3); // two request records and the one winning transaction
  });
});
