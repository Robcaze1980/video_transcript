// Static review counterexamples. Sequential, synthetic memory only. Never call a service.
import assert from 'node:assert/strict';
import {test} from 'vitest';
import {createHash} from 'node:crypto';
import {AccountStore} from '../account/backend.ts';
import {alertIdentity,alertKey,raisePendingAlerts,clearResolvedAlerts,ALERT_COLLECTION} from './billingPendingAlerts.ts';
import {readPendingReport,buildPendingReport} from './billingPendingReport.ts';
import {recordDisposition} from './billingPendingAudit.ts';
import {unblockBillingAccount,videoHoldId,UNBLOCK_AUDIT_COLLECTION,UNBLOCK_CONTINUITY_COLLECTION,UNBLOCK_WRITER_CUT_ID} from './billingUnblock.ts';
import {stub} from './billingFirestoreStub.ts';

const accountId='10000000-0000-4000-8000-000000000001', incident='1'.repeat(64), actor='fixture-operator';
const empty=buildPendingReport([],25);
function persisted(s,kind,rowId,state,reason,owner=null) {
  const key=alertKey(kind,rowId,state,reason),path=ALERT_COLLECTION+'/'+key;
  s.store.set(path,{alertKey:key,kind,rowId,state,reason,accountId:owner,status:'open',seenCount:1,firstSeenAtMs:5,lastSeenAtMs:6});
  return {key,path,identity:()=>alertIdentity({exists:true,id:key,data:()=>s.store.get(path)})};
}

async function unblockFixture(guard,{withCut=true}={}) {
  const uid='synthetic-operator-target',idKey=createHash('sha256').update(JSON.stringify(['firebase',uid])).digest('hex');
  const base={blocked:true,accountId,epoch:1,createdAtMs:5,updatedAtMs:6,lastIncidentId:incident};
  const kind=guard.lastOutboxIncidentId===incident?'outbox':'intent';
  const incidentCollection=kind==='outbox'?'billingOutboxReviewIncidents':'billingReviewIncidents';
  const holdId=videoHoldId(kind,incident,1,5);
  const cut=withCut?{[UNBLOCK_CONTINUITY_COLLECTION]:{[UNBLOCK_WRITER_CUT_ID]:{v:1,purpose:'unblock-writer-cut'}}}:{};
  const s=stub({...cut,billingGuards:{[accountId]:{...base,...guard}},identities:{[idKey]:{uid,accountId}},
    [incidentCollection]:{[incident]:{accountId,state:'needs_review'}},
    billingHoldOutbox:{[holdId]:{accountId,epoch:1,createdAtMs:5,state:'applied'}}});
  const report=await readPendingReport(s.root,25),row=report.rows.find(x=>x.kind==='guard');
  await raisePendingAlerts(s.db,s.root,report,25);
  const key=alertKey('guard',accountId,row.state,row.attention),calls=[];
  // Model createTime independently of updateTime. A write before the first
  // read must still advance the version, even if its contents are restored.
  const times=new Map();
  let next=0,commitTime;
  const stamp=revision=>({seconds:1,nanoseconds:revision,isEqual:other=>other?.seconds===1&&other.nanoseconds===revision});
  for(const path of s.store.keys()){
    const time=stamp(++next);
    times.set(path,{createTime:time,updateTime:time});
  }
  const set=s.store.set.bind(s.store),drop=s.store.delete.bind(s.store);
  Object.defineProperties(s.store,{
    set:{value:(path,data)=>{
      const updateTime=commitTime??stamp(++next),createTime=times.get(path)?.createTime??updateTime;
      times.set(path,{createTime,updateTime});
      return set(path,data);
    }},
    delete:{value:path=>{times.delete(path);return drop(path);}},
  });
  const withVersion=(snap,ref)=>({...snap,ref,...times.get(ref.path)});
  const db={async runTransaction(fn) {
    const edits=[];
    try{
      const result=await s.db.runTransaction(async tx=>{
        const value=await fn({...tx,
          get:async ref=>ref.path?{...await tx.get(ref),ref}:ref.get(),
          getAll:async(...refs)=>Promise.all(refs.map(async ref=>withVersion(await tx.get(ref),ref))),
          set:(ref,data)=>edits.push(()=>s.store.set(ref.path,structuredClone(data))),
          delete:ref=>edits.push(()=>s.store.delete(ref.path)),
        });
        // Model one timestamp for the commit. Confirm the Firestore metadata before integration.
        commitTime=stamp(++next);
        return value;
      });
      for(const edit of edits)edit();
      return result;
    }finally{commitTime=undefined;}
  }};
  const deps={db,root:s.root,accountBilling:{unblock:async(...args)=>{calls.push(args);throw Error('synthetic stop at Account port');},
      unblockReceipt:async()=>({state:'pending'})}};
  const request={incidentId:incident,alertKey:key,epoch:1,createdAtMs:5,updatedAtMs:6,accountEpoch:1,accountCreatedAtMs:5,evidenceRef:'fixture-proof'};
  return {s,row,calls,request,deps,uid,idKey,holdId,unblock:()=>unblockBillingAccount(deps,accountId,request,actor,30)};
}

function accountForDirectAck(f) {
  const accountOwner='20000000-0000-4000-8000-000000000001';
  const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const billing={ownerAccountId:accountOwner,identityKey:f.idKey};
  const generation={epoch:f.request.accountEpoch,createdAtMs:f.request.accountCreatedAtMs};
  const accountIncident={...billing,incidentId:f.holdId,createdAtMs:6,state:'active'};
  const incidentDoc=hash([accountOwner,f.holdId]),receiptDoc=hash([accountOwner,f.holdId,'unblock']);
  const remote=stub({
    accounts:{[accountOwner]:{identityKey:f.idKey,schemaVersion:1,unit:'video_seconds',credited:20,available:17,
      reserved:3,consumed:0,active:1,activeProjectCount:0,createdAtMs:1}},
    identities:{[f.idKey]:{uid:f.uid,accountId:accountOwner}},
    videoBillingGuards:{[accountOwner]:{...billing,...generation,blocked:true,incidentCount:1,updatedAtMs:6}},
    videoBillingIncidents:{[incidentDoc]:accountIncident},
    videoReservations:{synthetic:{...billing,reservationId:'30000000-0000-4000-8000-000000000001',seconds:3,state:'reserved'}},
    ledgerEntries:{synthetic:{ownerAccountId:accountOwner,createdAtMs:2,seconds:3,kind:'video_reserve'}},
  });
  const db={async runTransaction(run){
    const deletes=[];
    const value=await remote.db.runTransaction(tx=>run({...tx,delete:ref=>deletes.push(ref.path)}));
    for(const path of deletes)remote.store.delete(path);
    return value;
  }};
  const account=new AccountStore(db,remote.root,()=>40);
  const before=structuredClone(remote.store),accepted=structuredClone(before);
  accepted.delete('videoBillingGuards/'+accountOwner);
  accepted.set('videoBillingIncidents/'+incidentDoc,{...accountIncident,state:'reviewed',reviewedAtMs:40});
  accepted.set('videoBillingUnblocks/'+receiptDoc,{...billing,...generation,incidentId:f.holdId,
    reviewRef:f.request.evidenceRef,unblockedAtMs:40});
  return {account,remote,before,accepted};
}


const cutPath=UNBLOCK_CONTINUITY_COLLECTION+'/'+UNBLOCK_WRITER_CUT_ID;
function proofPaths(f){
  return [...f.s.store.keys()].filter(key=>key.startsWith(UNBLOCK_CONTINUITY_COLLECTION+'/')&&key!==cutPath);
}

for(const history of ['unchanged','edited and restored','missing','identical recreation',
  'recreated witness','recreated dispatch','missing pair','missing all local proof']){
  test('lost direct ACK then independent retry: '+history,async()=>{
    const f=await unblockFixture({});
    const {account,remote,accepted}=accountForDirectAck(f);
    const calls=[];
    f.deps.accountBilling.unblock=async(...args)=>{
      calls.push('POST');
      const result=await account.unblockVideoBilling(...args);
      if(calls.filter(call=>call==='POST').length===1)throw Error('synthetic lost ACK after commit');
      return result;
    };
    f.deps.accountBilling.unblockReceipt=async(...args)=>{
      calls.push('receipt');
      return account.videoBillingUnblockReceipt(...args);
    };
    await assert.rejects(f.unblock,error=>error.stage==='account');
    assert.deepEqual(remote.store,accepted);
    const [path,original]=[...f.s.store].find(([key,row])=>key.startsWith(UNBLOCK_AUDIT_COLLECTION+'/')&&row.action==='unblock_requested');
    if(history==='edited and restored'){
      f.s.store.set(path,{...original,recordedAtMs:31});
      f.s.store.set(path,structuredClone(original));
    } else if(history==='missing'||history==='identical recreation'){
      f.s.store.delete(path);
      if(history==='identical recreation')f.s.store.set(path,structuredClone(original));
    } else if(history==='recreated witness'||history==='recreated dispatch'){
      const kind=history.slice('recreated '.length)==='witness'?'request':'dispatch';
      const proof=proofPaths(f).find(key=>f.s.store.get(key).kind===kind);
      const evidence=f.s.store.get(proof);
      f.s.store.delete(proof);
      f.s.store.set(proof,structuredClone(evidence));
    } else if(history==='missing pair'||history==='missing all local proof'){
      f.s.store.delete(path);
      for(const proof of proofPaths(f)){
        if(history==='missing all local proof'||f.s.store.get(proof).kind==='request')f.s.store.delete(proof);
      }
    }
    const before=structuredClone(f.s.store);
    const result=await f.unblock().then(value=>value.videoBlocked?'partial':'closed',e=>e.code);
    const summary={result,calls,guard:f.s.store.get('billingGuards/'+accountId)?.blocked===true,
      reviewed:f.s.store.get('billingReviewIncidents/'+incident).reviewedAtMs!=null,
      alert:f.s.store.get(ALERT_COLLECTION+'/'+f.request.alertKey).status};
    assert.deepEqual(remote.store,accepted,'one authoritative receipt, original reservation and ledger');
    console.log('audit synthetic',history,JSON.stringify(summary));
    if(history==='unchanged'){
      assert.deepEqual(summary,{result:'closed',calls:['receipt','POST','receipt'],guard:false,reviewed:true,alert:'dispositioned'});
      assert.equal((await f.unblock()).replayed,true);
      assert.deepEqual(calls,['receipt','POST','receipt']);
    } else {
      const localEvidenceStopsLookup=history==='missing'||history==='missing pair';
      assert.deepEqual(calls,localEvidenceStopsLookup?['receipt','POST']:['receipt','POST','receipt']);
      assert.equal(result,'conflict');
      assert.equal(summary.guard,true);
      assert.equal(summary.alert,'open');
      assert.deepEqual(f.s.store,before);
    }
  });
}

test('another coordinator legitimately closes by receipt before the first ACK arrives',async()=>{
  const f=await unblockFixture({}),{account,remote,accepted}=accountForDirectAck(f),calls=[];
  f.deps.accountBilling.unblockReceipt=async(...args)=>{
    calls.push('receipt');
    return account.videoBillingUnblockReceipt(...args);
  };
  f.deps.accountBilling.unblock=async(...args)=>{
    calls.push('POST');
    const ack=await account.unblockVideoBilling(...args);
    const peer=await f.unblock();
    assert.equal(peer.videoBlocked,false);
    return ack;
  };
  await assert.rejects(f.unblock,{code:'conflict'});
  assert.equal((await f.unblock()).replayed,true);
  assert.deepEqual(calls,['receipt','POST','receipt']);
  assert.deepEqual(remote.store,accepted);
  assert.equal(f.s.store.has('billingGuards/'+accountId),false);
});

test('a legitimate hold-outbox delivery while waiting for the direct ACK allows Video to finish',async()=>{
  const f=await unblockFixture({}),{account,remote,accepted}=accountForDirectAck(f);
  const path='billingHoldOutbox/'+f.holdId,hold=f.s.store.get(path);
  f.s.store.set(path,{...hold,state:'pending'});
  let calls=0;
  f.deps.accountBilling.unblock=async(...args)=>{
    calls++;
    const ack=await account.unblockVideoBilling(...args);
    f.s.store.set(path,{...hold,state:'applied',appliedAtMs:33});
    return ack;
  };
  const result=await f.unblock();
  assert.equal(result.videoBlocked,false);
  assert.equal((await f.unblock()).replayed,true);
  assert.equal(calls,1);
  assert.equal(f.s.store.get(path).appliedAtMs,33);
  assert.deepEqual(remote.store,accepted);
});


test('pending before the first POST reaches Account does not authorize a second coordinator',async()=>{
  const f=await unblockFixture({}),{account,remote,before,accepted}=accountForDirectAck(f);
  const entered=Promise.withResolvers(),deliver=Promise.withResolvers(),calls=[];
  f.deps.accountBilling.unblockReceipt=async(...args)=>{
    const receipt=await account.videoBillingUnblockReceipt(...args);
    calls.push(receipt.state);
    return receipt;
  };
  f.deps.accountBilling.unblock=async(...args)=>{
    calls.push('POST');
    assert.equal(calls.filter(call=>call==='POST').length,1);
    entered.resolve();
    await deliver.promise;
    await account.unblockVideoBilling(...args);
    throw Error('delivery of the first ACK is lost');
  };
  const first=f.unblock().then(()=> 'closed',error=>error.stage??error.code);
  try{
    await Promise.race([entered.promise,first.then(()=>{throw Error('first dispatch did not reach its claimed port');})]);
    assert.deepEqual(remote.store,before);
    const local=structuredClone(f.s.store);
    assert.equal(proofPaths(f).length,2);
    await assert.rejects(f.unblock,{code:'conflict'});
    assert.deepEqual(f.s.store,local);
    assert.deepEqual(remote.store,before);
    assert.deepEqual(calls,['pending','POST','pending']);
  }finally{deliver.resolve();}
  assert.equal(await first,'account');
  assert.deepEqual(remote.store,accepted);
  assert.equal((await f.unblock()).videoBlocked,false);
  assert.equal((await f.unblock()).replayed,true);
  assert.deepEqual(calls,['pending','POST','pending','confirmed']);
  assert.deepEqual(remote.store,accepted);
});

test('a real Account conflict stays in reconciliation even when a later read says pending',async()=>{
  const f=await unblockFixture({}),{account,remote,before}=accountForDirectAck(f),calls=[];
  f.deps.accountBilling.unblock=async(...args)=>{calls.push('POST');return account.unblockVideoBilling(...args);};
  f.deps.accountBilling.unblockReceipt=async(...args)=>{
    const receipt=await account.videoBillingUnblockReceipt(...args);
    calls.push(receipt.state);
    return receipt;
  };
  f.request.accountEpoch++;
  await assert.rejects(f.unblock,error=>error.stage==='account'&&error.cause?.code==='conflict');
  assert.deepEqual(remote.store,before);
  const local=structuredClone(f.s.store);
  f.request.accountEpoch--;
  await assert.rejects(f.unblock,{code:'conflict'});
  assert.deepEqual(calls,['pending','POST','pending']);
  assert.deepEqual(f.s.store,local);
  assert.deepEqual(remote.store,before);
});

for(const state of ['missing','created after guard','recreated after guard']){
  test('a guard without a prior verified writer cut can query Account but cannot start: '+state,async()=>{
    const f=await unblockFixture({},{withCut:state==='recreated after guard'});
    const {account,remote,before}=accountForDirectAck(f),calls=[];
    if(state==='recreated after guard')f.s.store.delete(cutPath);
    if(state!=='missing')f.s.store.set(cutPath,{v:1,purpose:'unblock-writer-cut'});
    f.deps.accountBilling.unblockReceipt=async(...args)=>{
      const receipt=await account.videoBillingUnblockReceipt(...args);
      calls.push(receipt.state);
      return receipt;
    };
    const local=structuredClone(f.s.store);
    await assert.rejects(f.unblock,{code:'conflict'});
    assert.deepEqual(calls,['pending']);
    assert.equal(f.calls.length,0);
    assert.deepEqual(f.s.store,local);
    assert.deepEqual(remote.store,before);
  });
}

for(const state of ['pending','confirmed']){
  test('an unfinished legacy request without a witness remains in review after a '+state+' lookup',async()=>{
    const f=await unblockFixture({}),{account,remote,before,accepted}=accountForDirectAck(f),calls=[];
    f.deps.accountBilling.unblock=async(...args)=>{
      calls.push('POST');
      if(state==='confirmed')await account.unblockVideoBilling(...args);
      throw Error('synthetic delivery failure');
    };
    f.deps.accountBilling.unblockReceipt=async(...args)=>{
      const receipt=await account.videoBillingUnblockReceipt(...args);
      calls.push(receipt.state);
      return receipt;
    };
    await assert.rejects(f.unblock,error=>error.stage==='account');
    for(const path of proofPaths(f))f.s.store.delete(path);
    f.s.store.delete(cutPath);
    const legacy=structuredClone(f.s.store);
    await assert.rejects(f.unblock,{code:'conflict'});
    assert.deepEqual(calls,['pending','POST',state]);
    assert.deepEqual(f.s.store,legacy);
    assert.deepEqual(remote.store,state==='confirmed'?accepted:before);
  });
}

test('a completed legacy audit remains a local replay after continuity records are unavailable',async()=>{
  const f=await unblockFixture({}),{account,remote,accepted}=accountForDirectAck(f),calls=[];
  f.deps.accountBilling.unblock=async(...args)=>{calls.push('POST');return account.unblockVideoBilling(...args);};
  f.deps.accountBilling.unblockReceipt=async(...args)=>{calls.push('receipt');return account.videoBillingUnblockReceipt(...args);};
  assert.equal((await f.unblock()).videoBlocked,false);
  for(const path of proofPaths(f))f.s.store.delete(path);
  f.s.store.delete(cutPath);
  const legacy=structuredClone(f.s.store);
  assert.equal((await f.unblock()).replayed,true);
  assert.deepEqual(calls,['receipt','POST']);
  assert.deepEqual(f.s.store,legacy);
  assert.deepEqual(remote.store,accepted);
});

test('retained dispatch blocks a stale pending lookup even after the request and witness are lost',async()=>{
  const f=await unblockFixture({}),{account,remote,before,accepted}=accountForDirectAck(f);
  const entered=Promise.withResolvers(),deliver=Promise.withResolvers(),calls=[];
  f.deps.accountBilling.unblockReceipt=async(...args)=>{
    calls.push('receipt');
    return account.videoBillingUnblockReceipt(...args);
  };
  f.deps.accountBilling.unblock=async(...args)=>{
    calls.push('POST');
    assert.equal(calls.filter(call=>call==='POST').length,1);
    entered.resolve();
    await deliver.promise;
    return account.unblockVideoBilling(...args);
  };
  const first=f.unblock().then(()=> 'closed',error=>error.stage??error.code);
  let local;
  try{
    await Promise.race([entered.promise,first.then(()=>{throw Error('first dispatch did not reach its claimed port');})]);
    const request=[...f.s.store.keys()].find(key=>key.startsWith(UNBLOCK_AUDIT_COLLECTION+'/'));
    const witness=proofPaths(f).find(key=>f.s.store.get(key).kind==='request');
    f.s.store.delete(request);
    f.s.store.delete(witness);
    const stale=await account.videoBillingUnblockReceipt(f.idKey,f.holdId,f.request.evidenceRef);
    assert.equal(stale.state,'pending');
    local=structuredClone(f.s.store);
    await assert.rejects(f.unblock,{code:'conflict'});
    assert.deepEqual(f.s.store,local);
    assert.deepEqual(remote.store,before);
  }finally{deliver.resolve();}
  assert.equal(await first,'conflict');
  assert.deepEqual(remote.store,accepted);
  await assert.rejects(f.unblock,{code:'conflict'});
  assert.deepEqual(calls,['receipt','POST']);
  assert.deepEqual(f.s.store,local);
});

test('only one of two fresh coordinators with pending receipts claims the dispatch',async()=>{
  const f=await unblockFixture({}),{account,remote,before,accepted}=accountForDirectAck(f);
  const probes=[Promise.withResolvers(),Promise.withResolvers()];
  const continueClaim=[Promise.withResolvers(),Promise.withResolvers()];
  const entered=Promise.withResolvers(),deliver=Promise.withResolvers();
  let queries=0,posts=0;
  f.deps.accountBilling.unblockReceipt=async(...args)=>{
    const index=queries++;
    const receipt=await account.videoBillingUnblockReceipt(...args);
    assert.equal(receipt.state,'pending');
    probes[index].resolve();
    await continueClaim[index].promise;
    return receipt;
  };
  f.deps.accountBilling.unblock=async(...args)=>{
    assert.equal(++posts,1);
    entered.resolve();
    await deliver.promise;
    return account.unblockVideoBilling(...args);
  };
  const outcome=()=>f.unblock().then(result=>result.videoBlocked?'partial':'closed',error=>error.code);
  const first=outcome();
  try{
    await Promise.race([probes[0].promise,first.then(()=>{throw Error('first coordinator did not observe pending');})]);
    const second=outcome();
    await Promise.race([probes[1].promise,second.then(()=>{throw Error('second coordinator did not observe pending');})]);
    assert.equal(proofPaths(f).length,0);
    continueClaim[0].resolve();
    await Promise.race([entered.promise,first.then(()=>{throw Error('first coordinator did not claim the dispatch');})]);
    const claimed=structuredClone(f.s.store);
    assert.equal(proofPaths(f).length,2);
    continueClaim[1].resolve();
    assert.equal(await second,'conflict');
    assert.deepEqual(f.s.store,claimed);
    assert.deepEqual(remote.store,before);
  }finally{
    for(const gate of continueClaim)gate.resolve();
    deliver.resolve();
  }
  assert.equal(await first,'closed');
  assert.equal((await f.unblock()).replayed,true);
  assert.deepEqual({queries,posts},{queries:2,posts:1});
  assert.deepEqual(remote.store,accepted);
});

test('a committed local claim with lost commit acknowledgement strands a never-sent POST for reconciliation',async()=>{
  const f=await unblockFixture({}),{account,remote,before}=accountForDirectAck(f),calls=[];
  const transact=f.deps.db.runTransaction;
  let injected=false;
  f.deps.db.runTransaction=async fn=>{
    const result=await transact(fn);
    if(!injected&&proofPaths(f).length===2){
      injected=true;
      throw Error('synthetic lost acknowledgement of the Video claim commit');
    }
    return result;
  };
  f.deps.accountBilling.unblockReceipt=async(...args)=>{
    const receipt=await account.videoBillingUnblockReceipt(...args);
    calls.push(receipt.state);
    return receipt;
  };
  f.deps.accountBilling.unblock=async(...args)=>{
    calls.push('POST');
    return account.unblockVideoBilling(...args);
  };
  await assert.rejects(f.unblock,/lost acknowledgement of the Video claim commit/);
  const claimed=structuredClone(f.s.store);
  assert.equal(injected,true);
  assert.equal(proofPaths(f).length,2);
  assert.equal(claimed.get(ALERT_COLLECTION+'/'+f.request.alertKey).status,'open');

  await assert.rejects(f.unblock,{code:'conflict'});
  assert.deepEqual(calls,['pending','pending']);
  assert.deepEqual(f.s.store,claimed);
  assert.deepEqual(remote.store,before);
});

test('a new Account incident can make the first POST refuse and leave a corrected generation unable to dispatch',async()=>{
  const f=await unblockFixture({}),{account,remote}=accountForDirectAck(f),calls=[];
  let accountWithRival;
  f.deps.accountBilling.unblockReceipt=async(...args)=>{
    const receipt=await account.videoBillingUnblockReceipt(...args);
    calls.push(receipt.state);
    return receipt;
  };
  f.deps.accountBilling.unblock=async(...args)=>{
    calls.push('POST');
    // This account-side transaction commits after the Video authorization has been claimed.
    if(!accountWithRival){
      await account.blockVideoBilling(f.idKey,'2'.repeat(64));
      accountWithRival=structuredClone(remote.store);
    }
    return account.unblockVideoBilling(...args);
  };

  await assert.rejects(f.unblock,error=>error.stage==='account'&&error.cause?.code==='conflict');
  assert.deepEqual(remote.store,accountWithRival,'the refused POST writes no receipt');
  const guard=[...remote.store].find(([key])=>key.startsWith('videoBillingGuards/'))[1];
  assert.equal(guard.incidentCount,2);
  assert.equal(guard.epoch,f.request.accountEpoch+1);
  const claimed=structuredClone(f.s.store);
  f.request.accountEpoch=guard.epoch;
  const rivalReview=await account.unblockVideoBilling(f.idKey,{incidentId:'2'.repeat(64),epoch:guard.epoch,
    createdAtMs:guard.createdAtMs,reviewRef:'fixture-other-incident'});
  assert.equal(rivalReview.blocked,true,'only the original incident still needs a decision');
  const accountWithoutRival=structuredClone(remote.store);

  await assert.rejects(f.unblock,{code:'conflict'});
  assert.deepEqual(calls,['pending','POST','pending']);
  assert.deepEqual(f.s.store,claimed);
  assert.deepEqual(remote.store,accountWithoutRival);
});

test('outside the retention guarantee, losing all three proofs while the first POST is in flight allows a second POST',async()=>{
  const f=await unblockFixture({}),{account,remote,before,accepted}=accountForDirectAck(f);
  const entered=Promise.withResolvers(),deliver=Promise.withResolvers(),calls=[],acks=[];
  f.deps.accountBilling.unblockReceipt=async(...args)=>{
    const receipt=await account.videoBillingUnblockReceipt(...args);
    calls.push(receipt.state);
    return receipt;
  };
  let posts=0;
  f.deps.accountBilling.unblock=async(...args)=>{
    const attempt=++posts;
    calls.push('POST '+attempt);
    if(attempt===1){
      entered.resolve();
      await deliver.promise;
    }
    const ack=await account.unblockVideoBilling(...args);
    acks.push([attempt,ack.replayed]);
    return ack;
  };

  const first=f.unblock().then(()=> 'closed',error=>error.code);
  try{
    await Promise.race([entered.promise,first.then(()=>{throw Error('first POST did not reach the barrier');})]);
    assert.equal(proofPaths(f).length,2);
    const request=[...f.s.store].find(([key,row])=>key.startsWith(UNBLOCK_AUDIT_COLLECTION+'/')&&row.action==='unblock_requested')[0];
    // Requires loss or a privileged writer outside the protocol, not an ordinary retry.
    for(const key of [request,...proofPaths(f)])f.s.store.delete(key);
    assert.equal(f.s.store.has(cutPath),true);
    assert.deepEqual(remote.store,before);
    assert.equal((await f.unblock()).videoBlocked,false);
    assert.deepEqual(calls,['pending','POST 1','pending','POST 2']);
    assert.deepEqual(acks,[[2,false]]);
  }finally{deliver.resolve();}
  assert.equal(await first,'conflict');
  assert.deepEqual(acks,[[2,false],[1,true]]);
  assert.deepEqual(remote.store,accepted,'Account commits one receipt and keeps the funds, reservation and ledger unchanged');
});

test('a legacy partial close with a confirmed Account receipt remains blocked without continuity proof',async()=>{
  const f=await unblockFixture({}),{account,remote}=accountForDirectAck(f),calls=[];
  const rival='3'.repeat(64);
  await account.blockVideoBilling(f.idKey,rival);
  f.request.accountEpoch++;
  f.deps.accountBilling.unblockReceipt=async(...args)=>{
    const receipt=await account.videoBillingUnblockReceipt(...args);
    calls.push(receipt.state);
    return receipt;
  };
  f.deps.accountBilling.unblock=async(...args)=>{
    calls.push('POST');
    return account.unblockVideoBilling(...args);
  };

  const partial=await f.unblock();
  assert.equal(partial.accountBlocked,true);
  assert.equal(partial.videoBlocked,true);
  for(const key of proofPaths(f))f.s.store.delete(key);
  const legacy=structuredClone(f.s.store);
  const other=await account.unblockVideoBilling(f.idKey,{incidentId:rival,epoch:f.request.accountEpoch,
    createdAtMs:f.request.accountCreatedAtMs,reviewRef:'fixture-rival-proof'});
  assert.equal(other.blocked,false);
  const unheld=structuredClone(remote.store);

  await assert.rejects(f.unblock,{code:'conflict'});
  assert.deepEqual(calls,['pending','POST','confirmed']);
  assert.deepEqual(f.s.store,legacy);
  assert.deepEqual(remote.store,unheld);
});
