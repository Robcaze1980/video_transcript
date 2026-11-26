import {createHash,randomUUID} from 'node:crypto';
import {Firestore,Timestamp,type DocumentReference,type Transaction} from 'firebase-admin/firestore';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {AI_CATALOG_VERSION} from './aiContracts';
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
