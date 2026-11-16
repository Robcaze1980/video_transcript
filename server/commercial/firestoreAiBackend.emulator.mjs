import assert from 'node:assert/strict';import {test,before,afterEach} from 'node:test';import {randomUUID} from 'node:crypto';import {Firestore} from 'firebase-admin/firestore';
import {FirestoreBackend} from './firestoreBackend.ts';import {AI_CATALOG_VERSION,AI_TEXT_BUDGET,AI_STORAGE_LIMIT} from './aiContracts.ts';
const contexts=[],sha='b'.repeat(64),profile=AI_CATALOG_VERSION;
before(async()=>{assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8185');assert.equal((await fetch('http://127.0.0.1:8185/')).status,200);});
afterEach(async()=>{for(const c of contexts.splice(0)){await c.db.recursiveDelete(c.root);await c.db.terminate();}});
const ref=(c,name,id)=>c.root.collection(name).doc(id);const reject=(promise,code)=>assert.rejects(promise,e=>e.code===code);
async function fixture(){
 const db=new Firestore({projectId:'demo-vistavo-ledger',host:'127.0.0.1:8185',ssl:false,preferRest:true}),root=db.collection('vistavo_ai_backend_test').doc(randomUUID()),backend=new FirestoreBackend(db,root),account=await backend.createAccount(),input=randomUUID();const c={db,root,backend,account,input};contexts.push(c);
 await ref(c,'accounts',account).update({aiPilot:true,simulationOnly:true,storageReservedBytes:0,storageCommittedBytes:100,activeUploads:0,customFlag:'preserve'});
 await backend.creditVerifiedPurchase(account,'test-'+randomUUID(),10,1,'fixture','sandbox');
 await ref(c,'inputs',input).create({accountId:account,expiresAtMs:Date.now()+3600000,sha256:sha,deleted:false,ready:true,unknownCount:0,metadata:{duration:2,audioTracks:1},storage:{bucket:'vistavo-prod-107404655346-media',key:'candidate-files-v1/'+input+'/video.mp4',generation:'9007199254740993',size:100,sha256:sha}});
 await backend.saveProject(account,input,0,'The water pump is twelve inches wide.');return c;
}
const reserve=(c,key='request')=>c.backend.reserve(c.account,c.input,key,2,'translation:en',1,profile);
// These ledger/provider fixtures explicitly simulate a completed nonzero local inspection.
async function claimAfterNonzeroInspection(c,id){const a=await c.backend.claim(c.account,id);assert.ok(a);const job=await c.backend.job(c.account,id);if(job.invocationPhase==='local_check')assert.equal(await c.backend.resumeTextAfterLocalCheck(c.account,id,a.attemptId,job.inputStorage,'nonzero'),true);return a;}
async function start(c,id){const a=await claimAfterNonzeroInspection(c,id);assert.equal(await c.backend.beginInvocation(c.account,id,a.attemptId),true);return a;}
async function providerReceipt(c,id,attempt,overrides={}){const callKey=overrides.callKey??'text-window:0000';const doc=ref(c,'providerCalls',id+'-'+callKey.replace(':','-'));await doc.create({jobId:id,accountId:c.account,attemptId:attempt.attemptId,callKey,model:'gemini-3.8-flash',state:'received',httpStatus:200,requestSha256:'a'.repeat(64),responseSha256:'b'.repeat(64),responseId:'synthetic-response',usage:{totalTokenCount:42,promptTokenCount:20,candidatesTokenCount:22},...overrides});return doc;}
async function entries(c,id){const a=(await ref(c,'artifacts',id).get()).data();return a.plan.artifacts.map((s,index)=>({name:s.name,key:s.key,mimeType:s.mimeType,generation:String(9007199254740995n+BigInt(index)),size:12+index,sha256:String(index+1).repeat(64)}));}

test('AI profile is operator-gated, price/revision validated, and rejected requests create no side effects',async()=>{
 const c=await fixture();await ref(c,'accounts',c.account).update({aiPilot:false});await reject(reserve(c),'conflict');await ref(c,'accounts',c.account).update({aiPilot:true,simulationOnly:false});await reject(reserve(c),'conflict');await ref(c,'accounts',c.account).update({simulationOnly:true});
 await reject(c.backend.reserve(c.account,c.input,'wrong-price',1,'translation:en',1,profile),'invalid');await reject(c.backend.reserve(c.account,c.input,'no-revision',2,'translation:en',undefined,profile),'invalid');
 await c.backend.saveProject(c.account,c.input,1,'');await reject(c.backend.reserve(c.account,c.input,'empty-voice',1,'narration:en:female',2,profile),'invalid');
 for(const col of ['jobs','outbox','artifacts'])assert.equal((await c.root.collection(col).get()).size,0);assert.equal((await c.backend.readBalance(c.account)).available,10);
 assert.equal((await ref(c,'accounts',c.account).get()).get('storageReservedBytes'),0);
});

test('AI reserve atomically creates one plan/outbox/reservation under concurrent replay and preserves nonfinancial account fields',async()=>{
 const c=await fixture(),ids=await Promise.all([reserve(c),reserve(c),reserve(c)]);assert.equal(new Set(ids).size,1);const id=ids[0],a=(await ref(c,'artifacts',id).get()).data();
 assert.equal(a.state,'pending');assert.equal(a.plan.artifacts.length,5);assert.equal(a.plan.jobId,id);assert.equal(a.quotaHeld,AI_TEXT_BUDGET);assert.equal(a.sourceGeneration,'9007199254740993');assert.equal(a.revision,1);
 assert.equal((await c.root.collection('outbox').get()).size,1);assert.equal((await c.root.collection('artifacts').get()).size,1);assert.equal((await c.backend.readBalance(c.account)).reserved,2);
 const account=(await ref(c,'accounts',c.account).get()).data();assert.equal(account.storageReservedBytes,AI_TEXT_BUDGET);assert.equal(account.storageCommittedBytes,100);assert.equal(account.customFlag,'preserve');assert.equal(account.activeUploads,0);assert.equal(account.aiPilot,true);
 assert.equal(await c.backend.reserve(c.account,c.input,'request',999,'translation:en',1,profile),id);await reject(c.backend.priorRequest(c.account,c.input,'request','translation:en',1),'conflict');assert.equal(await c.backend.priorRequest(c.account,c.input,'request','translation:en',1,profile),id);
});

test('AI quota failure leaves money, jobs and output reservations unchanged',async()=>{
 const c=await fixture();await ref(c,'accounts',c.account).update({storageCommittedBytes:AI_STORAGE_LIMIT-50});await reject(reserve(c),'quota');assert.equal((await c.root.collection('jobs').get()).size,0);assert.equal((await c.backend.readBalance(c.account)).available,10);assert.equal((await ref(c,'accounts',c.account).get()).get('storageReservedBytes'),0);
});

test('AI verified publication, financial capture and quota commit are atomic and single-shot across completion races',async()=>{
 const c=await fixture(),id=await reserve(c),attempt=await start(c,id),receipt=await entries(c,id);await providerReceipt(c,id,attempt);await c.backend.saveProject(c.account,c.input,1,'A newer reviewed sentence.');
 const wrong=structuredClone(receipt);wrong[0].key='candidate-files-v1/'+c.input+'/video.mp4';await reject(c.backend.stageArtifactReceipt(c.account,id,attempt.attemptId,wrong),'invalid');assert.equal((await ref(c,'artifacts',id).get()).get('state'),'pending');
 assert.equal(await c.backend.stageArtifactReceipt(c.account,id,attempt.attemptId,receipt),true);assert.equal(await c.backend.stageArtifactReceipt(c.account,id,attempt.attemptId,receipt),true);
 const done=await Promise.all([c.backend.finish(c.account,id,attempt.attemptId,true),c.backend.finish(c.account,id,attempt.attemptId,true)]);assert.equal(done.filter(Boolean).length,1);
 const a=(await ref(c,'artifacts',id).get()).data(),account=(await ref(c,'accounts',c.account).get()).data(),balance=await c.backend.readBalance(c.account);
 assert.equal(a.state,'ready');assert.equal(a.revision,1);assert.equal(a.quotaMode,'committed');assert.equal(a.quotaHeld,receipt.reduce((n,r)=>n+r.size,0));assert.equal(account.storageReservedBytes,0);assert.equal(account.storageCommittedBytes,100+a.quotaHeld);assert.equal(account.customFlag,'preserve');assert.equal(account.aiPilot,true);assert.equal(balance.consumed,2);assert.equal(balance.reserved,0);assert.equal(balance.available,8);
 assert.equal((await ref(c,'movements','terminal:'+id).get()).get('kind'),'capture');assert.equal((await c.backend.readProject(c.account,c.input)).revision,2);assert.equal(await c.backend.stageArtifactReceipt(c.account,id,attempt.attemptId,receipt),true);
});

test('AI provider success without a staged verified manifest stays UNKNOWN with both reservations held',async()=>{
 const c=await fixture(),id=await reserve(c),attempt=await start(c,id);await reject(c.backend.stageArtifactReceipt(c.account,id,attempt.attemptId,await entries(c,id)),'conflict');assert.equal(await c.backend.finish(c.account,id,attempt.attemptId,true),false);assert.equal((await c.backend.job(c.account,id)).state,'unknown');assert.equal((await ref(c,'artifacts',id).get()).get('state'),'purging');
 assert.equal((await c.backend.readBalance(c.account)).reserved,2);assert.equal((await ref(c,'accounts',c.account).get()).get('storageReservedBytes'),AI_TEXT_BUDGET);assert.equal(await c.backend.claim(c.account,id),null);assert.equal((await ref(c,'movements','terminal:'+id).get()).exists,false);
});

test('AI unknown cleanup may erase snapshot and release storage without refunding money; trusted failure reconciles once',async()=>{
 const c=await fixture(),id=await reserve(c),attempt=await start(c,id);await c.backend.quarantine(c.account,id,attempt.attemptId);
 await ref(c,'jobs',id).update({snapshot:null});await ref(c,'inputs',c.input).update({deleted:true,ready:false});await ref(c,'artifacts',id).update({state:'purged',quotaMode:'none',quotaHeld:0,entries:[]});await ref(c,'accounts',c.account).update({storageReservedBytes:0});
 assert.equal((await c.backend.readBalance(c.account)).reserved,2);assert.equal((await ref(c,'inputs',c.input).get()).get('unknownCount'),1);assert.equal(await c.backend.claim(c.account,id),null);
 assert.equal(await c.backend.reconcile(c.account,id,'failed','synthetic-no-provider-status'),true);assert.equal(await c.backend.reconcile(c.account,id,'failed','synthetic-no-provider-status'),false);assert.equal((await c.backend.readBalance(c.account)).available,10);assert.equal((await ref(c,'inputs',c.input).get()).get('unknownCount'),0);
});

test('AI failure after confirmed nonzero local inspection but before invocation releases money and preserves physical quota accounting',async()=>{
 const c=await fixture(),id=await reserve(c),attempt=await claimAfterNonzeroInspection(c,id);assert.equal(await c.backend.failBeforeInvocation(c.account,id,attempt.attemptId),true);assert.equal(await c.backend.failBeforeInvocation(c.account,id,attempt.attemptId),false);
 assert.equal((await c.backend.job(c.account,id)).state,'failed');assert.equal((await ref(c,'artifacts',id).get()).get('state'),'purging');assert.equal((await c.backend.readBalance(c.account)).available,10);assert.equal((await ref(c,'accounts',c.account).get()).get('storageReservedBytes'),AI_TEXT_BUDGET);
});

test('AI staged output loses publication permission after cancellation and cannot be captured by stale attempts',async()=>{
 const c=await fixture(),id=await reserve(c),attempt=await start(c,id),receipt=await entries(c,id);await providerReceipt(c,id,attempt);await c.backend.stageArtifactReceipt(c.account,id,attempt.attemptId,receipt);await c.backend.cancel(c.account,id);
 assert.equal(await c.backend.stageArtifactReceipt(c.account,id,attempt.attemptId,receipt),false);assert.equal(await c.backend.finish(c.account,id,attempt.attemptId,true),false);assert.equal((await ref(c,'artifacts',id).get()).get('state'),'purging');assert.equal((await c.backend.readBalance(c.account)).reserved,2);
 await reject(c.backend.reconcile(c.account,id,'succeeded','synthetic-unpublished-result'),'conflict');assert.equal((await c.backend.readBalance(c.account)).reserved,2);
});

test('AI disable after nonzero inspection but before provider admission prevents invocation and refunds with pending-plan guard',async()=>{
 const c=await fixture(),id=await reserve(c),attempt=await claimAfterNonzeroInspection(c,id);await ref(c,'accounts',c.account).update({aiPilot:false});
 assert.equal(await c.backend.beginInvocation(c.account,id,attempt.attemptId),false);assert.equal((await c.backend.job(c.account,id)).state,'failed');assert.equal((await c.backend.readBalance(c.account)).available,10);assert.equal((await ref(c,'artifacts',id).get()).get('state'),'purging');
});


test('AI ambiguous provider receipt blocks staging; mutation after stage blocks capture and retains UNKNOWN funds',async()=>{
 const c=await fixture(),id=await reserve(c),attempt=await start(c,id),receipt=await entries(c,id),call=await providerReceipt(c,id,attempt,{state:'intent'});
 await reject(c.backend.stageArtifactReceipt(c.account,id,attempt.attemptId,receipt),'conflict');assert.equal((await ref(c,'artifacts',id).get()).get('state'),'pending');
 await call.update({state:'received'});assert.equal(await c.backend.stageArtifactReceipt(c.account,id,attempt.attemptId,receipt),true);assert.equal(typeof(await ref(c,'artifacts',id).get()).get('callReceiptHash'),'string');
 await call.update({responseSha256:'c'.repeat(64)});assert.equal(await c.backend.finish(c.account,id,attempt.attemptId,true),false);assert.equal((await c.backend.job(c.account,id)).state,'unknown');assert.equal((await c.backend.readBalance(c.account)).reserved,2);assert.equal((await ref(c,'movements','terminal:'+id).get()).exists,false);
});

test('AI receipt model, attempt and complete deterministic window set must match the frozen operation',async()=>{
 const c=await fixture(),id=await reserve(c),attempt=await start(c,id),receipt=await entries(c,id),call=await providerReceipt(c,id,attempt,{model:'gemini-3.8-flash-tts'});
 await reject(c.backend.stageArtifactReceipt(c.account,id,attempt.attemptId,receipt),'conflict');await call.update({model:'gemini-3.8-flash',attemptId:randomUUID()});await reject(c.backend.stageArtifactReceipt(c.account,id,attempt.attemptId,receipt),'conflict');
 await call.update({attemptId:attempt.attemptId});await providerReceipt(c,id,attempt,{callKey:'text-window:0001'});await reject(c.backend.stageArtifactReceipt(c.account,id,attempt.attemptId,receipt),'conflict');assert.equal((await c.backend.readBalance(c.account)).reserved,2);
});

test('AI multiwindow output requires every received call; voice uses its own deterministic receipt model',async()=>{
 const c=await fixture();await c.backend.creditVerifiedPurchase(c.account,'extra-'+randomUUID(),50,1,'fixture','sandbox');await ref(c,'inputs',c.input).update({metadata:{duration:31,audioTracks:1}});
 const id=await c.backend.reserve(c.account,c.input,'two-windows',31,'translation:en',1,profile),attempt=await start(c,id),receipt=await entries(c,id);await providerReceipt(c,id,attempt);
 await reject(c.backend.stageArtifactReceipt(c.account,id,attempt.attemptId,receipt),'conflict');await providerReceipt(c,id,attempt,{callKey:'text-window:0001'});assert.equal(await c.backend.stageArtifactReceipt(c.account,id,attempt.attemptId,receipt),true);assert.equal(await c.backend.finish(c.account,id,attempt.attemptId,true),true);
 const voiceId=await c.backend.reserve(c.account,c.input,'voice',1,'narration:en:female',1,profile),voiceAttempt=await start(c,voiceId),voiceReceipt=await entries(c,voiceId);await providerReceipt(c,voiceId,voiceAttempt,{callKey:'voice-chunk:0000',model:'gemini-3.8-flash-tts'});
 assert.equal(await c.backend.stageArtifactReceipt(c.account,voiceId,voiceAttempt.attemptId,voiceReceipt),true);assert.equal(await c.backend.finish(c.account,voiceId,voiceAttempt.attemptId,true),true);assert.equal((await c.backend.readBalance(c.account)).consumed,32);
});


test('AI paid FINISH cannot refund after source deletion, expiry or generation replacement',async()=>{
 for(const cause of ['deleted','expired','generation']){
  const c=await fixture(),id=await reserve(c),attempt=await start(c,id),receipt=await entries(c,id);await providerReceipt(c,id,attempt);assert.equal(await c.backend.stageArtifactReceipt(c.account,id,attempt.attemptId,receipt),true);
  if(cause==='deleted'){await ref(c,'inputs',c.input).update({deleted:true,ready:false});await ref(c,'jobs',id).update({snapshot:null});}
  if(cause==='expired')await ref(c,'inputs',c.input).update({expiresAtMs:Date.now()-1});
  if(cause==='generation')await ref(c,'inputs',c.input).update({'storage.generation':'9007199254740994'});
  assert.equal(await c.backend.finish(c.account,id,attempt.attemptId,true),false,cause);assert.equal((await c.backend.job(c.account,id)).state,'unknown');
  const balance=await c.backend.readBalance(c.account);assert.equal(balance.available,8);assert.equal(balance.reserved,2);assert.equal(balance.consumed,0);assert.equal((await ref(c,'movements','terminal:'+id).get()).exists,false);assert.equal((await ref(c,'artifacts',id).get()).get('state'),'purging');assert.equal((await ref(c,'accounts',c.account).get()).get('storageReservedBytes'),AI_TEXT_BUDGET);
  await reject(c.backend.reconcile(c.account,id,'succeeded','synthetic-success-but-unavailable'),'conflict');assert.equal((await c.backend.readBalance(c.account)).reserved,2);
 }
});

test('AI false FINISH after provider admission is UNKNOWN, never an automatic release',async()=>{
 const c=await fixture(),id=await reserve(c),attempt=await start(c,id);await providerReceipt(c,id,attempt);
 assert.equal(await c.backend.finish(c.account,id,attempt.attemptId,false),false);assert.equal((await c.backend.job(c.account,id)).state,'unknown');assert.equal((await c.backend.readBalance(c.account)).reserved,2);assert.equal((await ref(c,'movements','terminal:'+id).get()).exists,false);
});

test('AI operator revocation fences both STAGE and FINISH while retaining paid reservations',async()=>{
 for(const phase of ['stage','finish'])for(const flag of ['aiPilot','simulationOnly']){
  const c=await fixture(),id=await reserve(c),attempt=await start(c,id),receipt=await entries(c,id);await providerReceipt(c,id,attempt);
  if(phase==='finish')assert.equal(await c.backend.stageArtifactReceipt(c.account,id,attempt.attemptId,receipt),true);
  await ref(c,'accounts',c.account).update({[flag]:false});
  if(phase==='stage')assert.equal(await c.backend.stageArtifactReceipt(c.account,id,attempt.attemptId,receipt),false);else assert.equal(await c.backend.finish(c.account,id,attempt.attemptId,true),false);
  assert.equal((await c.backend.job(c.account,id)).state,'unknown');assert.equal((await ref(c,'artifacts',id).get()).get('state'),'purging');assert.equal((await c.backend.readBalance(c.account)).reserved,2);assert.equal((await ref(c,'movements','terminal:'+id).get()).exists,false);
 }
});

test('AI expired preparation lease after confirmed nonzero inspection requeues with zero UNKNOWN and no provider intents',async()=>{
 const c=await fixture(),id=await reserve(c),attempt=await claimAfterNonzeroInspection(c,id);await ref(c,'jobs',id).update({leaseUntil:Date.now()-1});
 assert.equal(await c.backend.heartbeat(c.account,id,attempt.attemptId),false);assert.equal((await c.backend.job(c.account,id)).state,'queued');assert.equal((await ref(c,'inputs',c.input).get()).get('unknownCount'),0);assert.equal((await ref(c,'outbox',id).get()).get('state'),'pending');assert.equal((await c.root.collection('providerCalls').get()).size,0);assert.equal((await c.backend.readBalance(c.account)).reserved,2);
 assert.equal(await c.backend.beginInvocation(c.account,id,attempt.attemptId),false);const fresh=await c.backend.claim(c.account,id);assert.ok(fresh);assert.notEqual(fresh.attemptId,attempt.attemptId);
});
