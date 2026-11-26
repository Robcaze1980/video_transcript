// Static review counterexamples. Sequential, synthetic memory only. Never call a service.
import assert from 'node:assert/strict';
import {test} from 'vitest';
import {createHash} from 'node:crypto';
import {AccountStore} from '../account/backend.ts';
import {alertIdentity,alertKey,raisePendingAlerts,clearResolvedAlerts,ALERT_COLLECTION} from './billingPendingAlerts.ts';
import {readPendingReport,buildPendingReport} from './billingPendingReport.ts';
import {recordDisposition} from './billingPendingAudit.ts';
import {unblockBillingAccount,videoHoldId,UNBLOCK_AUDIT_COLLECTION} from './billingUnblock.ts';
import {stub} from './billingFirestoreStub.ts';

const accountId='10000000-0000-4000-8000-000000000001', incident='1'.repeat(64), actor='fixture-operator';
const empty=buildPendingReport([],25);
function persisted(s,kind,rowId,state,reason,owner=null) {
  const key=alertKey(kind,rowId,state,reason),path=ALERT_COLLECTION+'/'+key;
  s.store.set(path,{alertKey:key,kind,rowId,state,reason,accountId:owner,status:'open',seenCount:1,firstSeenAtMs:5,lastSeenAtMs:6});
  return {key,path,identity:()=>alertIdentity({exists:true,id:key,data:()=>s.store.get(path)})};
}

async function unblockFixture(guard) {
  const uid='synthetic-operator-target',idKey=createHash('sha256').update(JSON.stringify(['firebase',uid])).digest('hex');
  const base={blocked:true,accountId,epoch:1,createdAtMs:5,updatedAtMs:6,lastIncidentId:incident};
  const kind=guard.lastOutboxIncidentId===incident?'outbox':'intent';
  const incidentCollection=kind==='outbox'?'billingOutboxReviewIncidents':'billingReviewIncidents';
  const holdId=videoHoldId(kind,incident,1,5);
  const s=stub({billingGuards:{[accountId]:{...base,...guard}},identities:{[idKey]:{uid,accountId}},
    [incidentCollection]:{[incident]:{accountId,state:'needs_review'}},
    billingHoldOutbox:{[holdId]:{accountId,epoch:1,createdAtMs:5,state:'applied'}}});
  const report=await readPendingReport(s.root,25),row=report.rows.find(x=>x.kind==='guard');
  await raisePendingAlerts(s.db,s.root,report,25);
  const key=alertKey('guard',accountId,row.state,row.attention),calls=[];
  // Model createTime independently of updateTime. A write before the first
  // read must still advance the version, even if its contents are restored.
  const times=new Map();
  let next=0;
  const stamp=revision=>({revision,isEqual:other=>other?.revision===revision});
  for(const path of s.store.keys()){
    const time=stamp(++next);
    times.set(path,{createTime:time,updateTime:time});
  }
  const set=s.store.set.bind(s.store),drop=s.store.delete.bind(s.store);
  Object.defineProperties(s.store,{
    set:{value:(path,data)=>{
      const updateTime=stamp(++next),createTime=times.get(path)?.createTime??updateTime;
      times.set(path,{createTime,updateTime});
      return set(path,data);
    }},
    delete:{value:path=>{times.delete(path);return drop(path);}},
  });
  const withVersion=(snap,ref)=>({...snap,ref,...times.get(ref.path)});
  const db={async runTransaction(fn) {
    const edits=[];
    const result=await s.db.runTransaction(tx=>fn({...tx,
      get:async ref=>ref.path?{...await tx.get(ref),ref}:ref.get(),
      getAll:async(...refs)=>Promise.all(refs.map(async ref=>withVersion(await tx.get(ref),ref))),
      set:(ref,value)=>edits.push(()=>s.store.set(ref.path,structuredClone(value))),
      delete:ref=>edits.push(()=>s.store.delete(ref.path)),
    }));
    for(const edit of edits)edit();
    return result;
  }};
  const deps={db,root:s.root,accountBilling:{unblock:async(...args)=>{calls.push(args);throw Error('synthetic stop at Account port');},
      unblockReceipt:async()=>{throw Error('unexpected receipt consultation');}}};
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


for(const history of ['unchanged','edited and restored','missing','identical recreation']){
  test('lost direct ACK then independent retry: '+history,async()=>{
    const f=await unblockFixture({});
    const {account,remote,accepted}=accountForDirectAck(f);
    const calls=[];
    f.deps.accountBilling.unblock=async(...args)=>{
      calls.push('POST');
      const result=await account.unblockVideoBilling(...args);
      if(calls.length===1)throw Error('synthetic lost ACK after commit');
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
    } else if(history!=='unchanged'){
      f.s.store.delete(path);
      if(history==='identical recreation')f.s.store.set(path,structuredClone(original));
    }
    const before=structuredClone(f.s.store);
    const result=await f.unblock().then(value=>value.videoBlocked?'partial':'closed',e=>e.code);
    const summary={result,calls,guard:f.s.store.get('billingGuards/'+accountId)?.blocked===true,
      reviewed:f.s.store.get('billingReviewIncidents/'+incident).reviewedAtMs!=null,
      alert:f.s.store.get(ALERT_COLLECTION+'/'+f.request.alertKey).status};
    assert.deepEqual(remote.store,accepted,'one authoritative receipt, original reservation and ledger');
    console.log('audit synthetic',history,JSON.stringify(summary));
    if(history==='unchanged'){
      assert.deepEqual(summary,{result:'closed',calls:['POST','receipt'],guard:false,reviewed:true,alert:'dispositioned'});
      assert.equal((await f.unblock()).replayed,true);
      assert.deepEqual(calls,['POST','receipt']);
    } else {
      assert.equal(calls.filter(x=>x==='POST').length,1);
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
  assert.deepEqual(calls,['POST','receipt']);
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
