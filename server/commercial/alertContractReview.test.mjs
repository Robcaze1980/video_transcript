// Static review counterexamples. Sequential, synthetic memory only. Never call a service.
import assert from 'node:assert/strict';
import {test} from 'vitest';
import {createHash} from 'node:crypto';
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

test('an unknown kind with a matching hash must not pass the shared operator identity check',()=>{
  const s=stub(),a=persisted(s,'future-kind','synthetic','needs_review','needs_review');
  assert.equal(a.identity(),null);
});
test('an unknown kind is marked corrupt; new disposition rejects and writes nothing',async()=>{
  const s=stub(),a=persisted(s,'future-kind','synthetic','needs_review','needs_review');
  const cleared=await clearResolvedAlerts(s.db,s.root,empty,30);
  assert.equal(cleared.kept,0);assert.equal(cleared.corrupt,1);
  await assert.rejects(()=>recordDisposition(s.db,s.root,a.key,'resolve',{authorizedBy:actor,evidenceRef:'fixture-proof'},30),{code:'corrupt'});
  assert.deepEqual(s.writes,[]);
});
test('a closed source must not clear an alert with an unknown reason',async()=>{
  const s=stub({billingOutbox:{synthetic:{state:'settled'}}}),a=persisted(s,'outbox','synthetic','needs_review','future-reason');
  const result=await clearResolvedAlerts(s.db,s.root,empty,30);
  assert.deepEqual([result.corrupt,result.cleared,s.store.get(a.path).status],[1,0,'open']);
});
test('a human resolve must not certify an unknown reason for an otherwise known kind',async()=>{
  const s=stub(),a=persisted(s,'hold','synthetic','needs_review','future-reason');
  await assert.rejects(()=>recordDisposition(s.db,s.root,a.key,'resolve',{authorizedBy:actor,evidenceRef:'fixture-proof'},30),{code:'corrupt'});
});
test('normal report marks non-UUID guard malformed and creates an ownerless alert',async()=>{
  const id='synthetic-non-uuid',s=stub({billingGuards:{[id]:{accountId:id,blocked:true,epoch:1,createdAtMs:5,lastIncidentId:incident}}});
  const report=await readPendingReport(s.root,25);
  assert.equal(report.rows.length,1); const row=report.rows[0];
  assert.deepEqual([row.kind,row.malformed,row.accountId,row.attention],['guard',true,null,'malformed']);
  await raisePendingAlerts(s.db,s.root,report,25);
  const key=alertKey('guard',id,row.state,'malformed'),doc=s.store.get(ALERT_COLLECTION+'/'+key);
  assert.equal(doc.accountId,null);assert.equal(doc.status,'open');
});
test('a pre-existing guard alert with matching non-UUID row and non-null hint must not present an owner',()=>{
  const s=stub(),id='synthetic-non-uuid',a=persisted(s,'guard',id,'blocked:1:5:'+incident,'needs_review',id);
  assert.equal(a.identity(),null);
});

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
  // Add transaction queries and the final phase's set/delete to the point-read double.
  const db={async runTransaction(fn) {
    const edits=[];
    const result=await s.db.runTransaction(tx=>fn({...tx,
      get:async ref=>ref.path?{...await tx.get(ref),ref}:ref.get(),
      getAll:async(...refs)=>Promise.all(refs.map(async ref=>({...await tx.get(ref),ref}))),
      set:(ref,value)=>edits.push(()=>s.store.set(ref.path,structuredClone(value))),
      delete:ref=>edits.push(()=>s.store.delete(ref.path)),
    }));
    for(const edit of edits)edit();
    return result;
  }};
  const deps={db,root:s.root,accountBilling:{unblock:async(...args)=>{calls.push(args);throw Error('synthetic stop at Account port');},
      unblockReceipt:async()=>{throw Error('unexpected receipt consultation');}}};
  const request={incidentId:incident,alertKey:key,epoch:1,createdAtMs:5,updatedAtMs:6,accountEpoch:1,accountCreatedAtMs:5,evidenceRef:'fixture-proof'};
  return {s,row,calls,request,deps,unblock:()=>unblockBillingAccount(deps,accountId,request,actor,30)};
}

test('identical incident references look normal to the report but block the transaction before Account',async()=>{
  const f=await unblockFixture({lastOutboxIncidentId:incident}); assert.equal(f.row.attention,'needs_review');
  await assert.rejects(f.unblock,error=>error.code==='conflict'&&error.stage.startsWith('incident:'));
  assert.equal(f.calls.length,0);assert.equal(f.s.writes.some(x=>x.includes(UNBLOCK_AUDIT_COLLECTION+'/')),false);
});
test('damaged companions in either incident field stop before request audit or Account',async()=>{
  for (const guard of [{lastOutboxIncidentId:42},{lastIncidentId:'',lastOutboxIncidentId:incident}]) {
    const f=await unblockFixture(guard);
    assert.deepEqual([f.row.attention,f.row.accountId],['malformed',null]);
    await assert.rejects(f.unblock,error=>error.code==='corrupt');
    assert.equal(f.calls.length,0);assert.equal(f.s.writes.some(x=>x.includes(UNBLOCK_AUDIT_COLLECTION+'/')),false);
    assert.equal(f.s.store.get('billingGuards/'+accountId).blocked,true);
  }
});
test('a normal guard with equivalent evidence reaches the same Account precondition',async()=>{
  const f=await unblockFixture({});assert.equal(f.row.attention,'needs_review');
  await assert.rejects(f.unblock,error=>error.code==='conflict'&&error.stage==='account');
  assert.equal(f.calls.length,1);
});
test('a stale reported sighting can reopen a confirmed terminal alert; the next fresh clear closes it',async()=>{
  const s=stub({billingHoldOutbox:{synthetic:{state:'needs_review',createdAtMs:1}}});
  const old=await readPendingReport(s.root,25);const path=ALERT_COLLECTION+'/'+alertKey('hold','synthetic','needs_review','needs_review');
  s.store.set('billingHoldOutbox/synthetic',{state:'applied',createdAtMs:1});
  await raisePendingAlerts(s.db,s.root,old,26);assert.equal(s.store.get(path).status,'open');
  const fresh=await readPendingReport(s.root,27);assert.equal((await clearResolvedAlerts(s.db,s.root,fresh,27)).cleared,1);
  await raisePendingAlerts(s.db,s.root,old,28);assert.equal(s.store.get(path).status,'open');
  assert.equal((await clearResolvedAlerts(s.db,s.root,old,29)).kept,1);
  assert.equal((await clearResolvedAlerts(s.db,s.root,fresh,30)).cleared,1);
});
test('a currently pending healthy row without a successor supplies no terminal proof',async()=>{
  const s=stub({billingHoldOutbox:{synthetic:{state:'needs_review',createdAtMs:1}}});
  const old=await readPendingReport(s.root,25);
  s.store.set('billingHoldOutbox/synthetic',{state:'pending',createdAtMs:1});
  await raisePendingAlerts(s.db,s.root,old,26);
  const fresh=await readPendingReport(s.root,27);
  assert.equal((await clearResolvedAlerts(s.db,s.root,fresh,27)).kept,1);
});

for(const [name,fields] of [
  ['outbox first',{lastOutboxIncidentId:incident,lastIncidentId:'legacy-intent-id'}],
  ['intent first',{lastIncidentId:'legacy-intent-id',lastOutboxIncidentId:incident}],
]){
  test('valid distinct merged references in '+name+' order preserve the outbox alert and reach Account',async()=>{
    const f=await unblockFixture(fields);
    assert.equal(f.row.attention,'needs_review');
    await assert.rejects(f.unblock,error=>error.code==='conflict'&&error.stage==='account');
    assert.equal(f.calls.length,1);assert.equal(f.calls[0][1].incidentId,videoHoldId('outbox',incident,1,5));
  });
}
test('damage after the request was recorded stops resume before consulting or mutating Account',async()=>{
  const f=await unblockFixture({});await assert.rejects(f.unblock,error=>error.stage==='account');
  const path='billingGuards/'+accountId;
  f.s.store.set(path,{...f.s.store.get(path),lastOutboxIncidentId:null});
  let receipts=0;f.deps.accountBilling.unblockReceipt=async()=>{receipts++;throw Error('unexpected');};
  await assert.rejects(f.unblock,error=>error.code==='corrupt');
  assert.equal(receipts,0);assert.equal(f.calls.length,1);assert.equal(f.s.store.get(path).blocked,true);
});
test('damage during the Account call keeps the Video guard and request receipt for reconciliation',async()=>{
  const f=await unblockFixture({}),path='billingGuards/'+accountId;
  let accepted=0;
  f.deps.accountBilling.unblock=async()=>{
    accepted++;f.s.store.set(path,{...f.s.store.get(path),lastOutboxIncidentId:''});
    return {replayed:false,blocked:false};
  };
  await assert.rejects(f.unblock,error=>error.code==='corrupt');
  assert.equal(accepted,1);assert.equal(f.s.store.get(path).blocked,true);
  const actions=[...f.s.store].filter(([k])=>k.startsWith(UNBLOCK_AUDIT_COLLECTION+'/')).map(([,v])=>v.action);
  assert.deepEqual(actions,['unblock_requested']);
  // The remote decision already took effect in this model. Repairing the Video
  // guard allows a read of the original receipt, without a second mutation.
  let observations=0;
  f.deps.accountBilling.unblockReceipt=async(identityKey,holdId,evidenceRef)=>{
    observations++;
    assert.equal(holdId,videoHoldId('intent',incident,1,5));
    assert.equal(evidenceRef,f.request.evidenceRef);
    return {state:'confirmed',incidentId:holdId,reviewRef:evidenceRef,epoch:1,createdAtMs:5,blocked:false};
  };
  await assert.rejects(f.unblock,error=>error.code==='corrupt');
  assert.equal(observations,0);
  const repaired={...f.s.store.get(path)};delete repaired.lastOutboxIncidentId;
  f.s.store.set(path,repaired);
  assert.equal((await f.unblock()).videoBlocked,false);
  assert.equal(observations,1);assert.equal(accepted,1);assert.equal(f.s.store.has(path),false);
});
test('a repaired source allows the still-open historical warning and an exactly completed replay',async()=>{
  const f=await unblockFixture({lastOutboxIncidentId:42}),path='billingGuards/'+accountId;
  assert.equal(f.row.attention,'malformed');
  const repaired={...f.s.store.get(path)};delete repaired.lastOutboxIncidentId;
  f.s.store.set(path,repaired);
  let accepted=0;
  f.deps.accountBilling.unblock=async()=>{accepted++;return {replayed:false,blocked:false};};
  const first=await f.unblock();
  assert.equal(first.videoBlocked,false);assert.equal(f.s.store.has(path),false);
  const closed=structuredClone(f.s.store);
  const again=await f.unblock();
  assert.equal(again.replayed,true);assert.equal(again.auditId,first.auditId);
  assert.deepEqual(f.s.store,closed);assert.equal(accepted,1);
});
test('valid legacy named generation with missing epoch remains addressable as epoch one',async()=>{
  const f=await unblockFixture({epoch:undefined});
  const path='billingGuards/'+accountId,legacy={...f.s.store.get(path)};
  delete legacy.epoch;f.s.store.set(path,legacy);
  await assert.rejects(f.unblock,error=>error.code==='conflict'&&error.stage==='account');
  assert.equal(f.calls.length,1);
});
test('a fabricated report with an unknown kind or reason cannot create an alert',async()=>{
  const s=stub(),r=buildPendingReport([],25);
  for(const [kind,attention] of [['future','needs_review'],['hold','future'],['outbox','sweep_review']]){
    await assert.rejects(raisePendingAlerts(s.db,s.root,{...r,rows:[{kind,id:'synthetic',state:'needs_review',attention,accountId:null}]},25),AggregateError);
  }
  assert.deepEqual(s.writes,[]);
});
