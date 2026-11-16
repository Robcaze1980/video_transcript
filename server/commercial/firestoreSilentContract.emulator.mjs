import assert from 'node:assert/strict';
import {test,before,afterEach} from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,readFile,unlink,rmdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {Firestore} from 'firebase-admin/firestore';
import {FirestoreBackend} from './firestoreBackend.ts';
import {FirestoreAi} from './firestoreAi.ts';
import {AI_CATALOG_VERSION,AI_TEXT_BUDGET,AI_TEXT_MAX_WINDOWS} from './aiContracts.ts';
import {createDigitalSilenceAccumulator,digitalSilenceProof,digitalSilenceProofHash} from './digitalSilence.ts';
import {processCloudAi} from './cloudAiWorker.ts';
const contexts=[],sha='a'.repeat(64),ref=(c,name,id)=>c.root.collection(name).doc(id);
test('a failed durable provider query is never interpreted as an empty receipt set',async()=>{
 const c=await fixture(31,true),run=c.db.runTransaction.bind(c.db);
 c.db.runTransaction=(callback,...options)=>run(tx=>{const get=tx.get.bind(tx);tx.get=()=>{throw Error('synthetic receipt query unavailable');};return callback(tx).finally(()=>{tx.get=get;});},...options);
 try{await assert.rejects(c.backend.completeDigitalSilence(c.account,c.job,c.attempt.attemptId,c.zeroProof),/receipt query unavailable/);}finally{c.db.runTransaction=run;}
 await held(c);assert.equal((await c.backend.job(c.account,c.job)).invocationPhase,'local_check');
});
for(const racer of ['reset','invoke','cancel','heartbeat'])test('digital completion race with '+racer+' preserves one money outcome and no provider intent',async()=>{
 const c=await fixture(31,true),compete=()=>racer==='reset'?c.backend.resumeTextAfterLocalCheck(c.account,c.job,c.attempt.attemptId,c.storage,'nonzero'):racer==='invoke'?c.backend.beginInvocation(c.account,c.job,c.attempt.attemptId):racer==='cancel'?c.backend.cancel(c.account,c.job):c.backend.heartbeat(c.account,c.job,c.attempt.attemptId);
 await Promise.all([c.backend.completeDigitalSilence(c.account,c.job,c.attempt.attemptId,c.zeroProof),compete()]);const job=await c.backend.job(c.account,c.job),money=await c.backend.readBalance(c.account),terminals=await c.root.collection('movements').where('reference','==',c.job).where('kind','==','release').get();
 assert.ok(terminals.size<=1);assert.equal((await c.root.collection('providerCalls').get()).size,0);assert.equal(money.consumed,0);assert.equal(money.available+money.reserved,100);
 if(job.state==='failed'){assert.equal(terminals.size,1);assert.equal(money.reserved,0);assert.equal(money.active,0);}else{assert.equal(terminals.size,0);assert.equal(money.reserved,31);assert.equal(money.active,1);assert.ok(job.state==='unknown'||job.state==='running'&&job.invocationPhase==='not_started');}
});

for(const outcome of ['complete','lost-ack','prior-intent','readback-outage','sdk-outage','total-sdk-outage'])test('real decoder worker+ledger composition '+outcome+' never bypasses local settlement fences',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'vistavo-digital-ledger-')),path=join(directory,'zero.mp4');
 try{
  const generated=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s=64x64:r=1:d=2','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-y',path],{windowsHide:true,timeout:20000});assert.equal(generated.status,0,'local synthetic fixture generation must succeed');
  const source=await readFile(path),c=await fixture(2,true,source);await ref(c,'jobs',c.job).update({state:'queued',attemptId:null,leaseUntil:null,invocationPhase:null});
  let paid=0,refunds=0,completions=0;const originalComplete=c.backend.completeDigitalSilence.bind(c.backend),originalConfirmed=c.backend.confirmedDigitalSilence.bind(c.backend),originalFail=c.backend.failBeforeInvocation.bind(c.backend);
  c.backend.failBeforeInvocation=async(...args)=>{refunds++;return originalFail(...args);};
  c.backend.completeDigitalSilence=async(...args)=>{completions++;if(outcome==='prior-intent')await ref(c,'providerCalls',randomUUID()).create({jobId:c.job,attemptId:randomUUID(),state:'intent'});if(outcome.endsWith('sdk-outage'))throw Error('SDK unavailable');const result=await originalComplete(...args);if(outcome==='lost-ack')throw Error('committed ACK lost');return result;};
  if(outcome==='readback-outage'||outcome.endsWith('sdk-outage'))c.backend.confirmedDigitalSilence=async()=>{throw Error('authoritative read unavailable');};
  if(outcome==='total-sdk-outage')c.backend.quarantine=async()=>{throw Error('all SDK writes unavailable');};
  const ai={backend:c.backend,root:c.root,enabled:async()=>{},objects:{read:async()=>Readable.from([source])},invoke:()=>async()=>{paid++;throw Error('digital zero must never invoke');},uploadResults:async()=>{throw Error('no output expected');}};
  const result=await processCloudAi(ai,c.account,c.job,'not-used');assert.equal(result,outcome==='complete'||outcome==='lost-ack'?'failed':'unknown');assert.equal(completions,1);assert.equal(paid,0);assert.equal(refunds,0);
  const money=await c.backend.readBalance(c.account),released=outcome==='complete'||outcome==='lost-ack'||outcome==='readback-outage';assert.equal(money.reserved,released?0:2);assert.equal(money.consumed,0);assert.equal((await c.root.collection('movements').where('reference','==',c.job).where('kind','==','release').get()).size,released?1:0);
  c.backend.confirmedDigitalSilence=originalConfirmed;assert.equal(await processCloudAi(ai,c.account,c.job,'not-used'),'not_claimed');assert.equal(completions,1);assert.equal(paid,0);
  if(outcome==='total-sdk-outage'){assert.equal((await c.backend.job(c.account,c.job)).state,'running');assert.equal((await c.backend.job(c.account,c.job)).invocationPhase,'local_check');await ref(c,'jobs',c.job).update({leaseUntil:Date.now()-1});await c.backend.recover(c.account,c.job);assert.equal((await c.backend.job(c.account,c.job)).state,'unknown');assert.equal((await c.backend.readBalance(c.account)).reserved,2);assert.equal((await ref(c,'movements','terminal:'+c.job).get()).exists,false);}
 }finally{await unlink(path).catch(error=>{if(error.code!=='ENOENT')throw error;});await rmdir(directory);}
});

test('digital silence is terminal exactly once and full proof readback rejects altered evidence',async()=>{
 const c=await fixture(31,true);assert.equal((await c.backend.job(c.account,c.job)).invocationPhase,'local_check');
 assert.deepEqual(await Promise.all([c.backend.completeDigitalSilence(c.account,c.job,c.attempt.attemptId,c.zeroProof),c.backend.completeDigitalSilence(c.account,c.job,c.attempt.attemptId,c.zeroProof)]).then(rows=>rows.sort()),[false,true]);
 assert.equal(await c.backend.confirmedDigitalSilence(c.account,c.job,c.attempt.attemptId,c.zeroProof),true);
 assert.equal(await c.backend.confirmedDigitalSilence(c.account,c.job,randomUUID(),c.zeroProof),false);
 const job=await c.backend.job(c.account,c.job);assert.equal(job.digitalSilenceProofHash,digitalSilenceProofHash(c.zeroProof));assert.equal(job.noSpeechReceiptHash,undefined);
 assert.equal((await c.backend.readBalance(c.account)).available,100);assert.equal((await c.backend.readBalance(c.account)).active,0);
 assert.equal((await ref(c,'artifacts',c.job).get()).get('state'),'purging');assert.equal((await c.root.collection('providerCalls').get()).size,0);
 assert.equal((await c.root.collection('movements').where('reference','==',c.job).where('kind','==','release').get()).size,1);
 const before=(await ref(c,'accounts',c.account).get()).get('storageReservedBytes');assert.equal(before,AI_TEXT_BUDGET);
 const ai=new FirestoreAi(c.db,c.root,c.backend,{barrier:async key=>({key,generation:'9007199254741000',size:0,marker:true})});assert.ok((await Promise.all([ai.purgeResult(c.job),ai.purgeResult(c.job)])).every(Boolean));assert.equal((await ref(c,'accounts',c.account).get()).get('storageReservedBytes'),0);assert.equal((await c.backend.readBalance(c.account)).available,100);
 await ref(c,'movements','terminal:'+c.job).update({credits:30});assert.equal(await c.backend.confirmedDigitalSilence(c.account,c.job,c.attempt.attemptId,c.zeroProof),false);
 await ref(c,'movements','terminal:'+c.job).update({credits:31});await ref(c,'jobs',c.job).update({'digitalSilenceProof.pcmSha256':'f'.repeat(64)});assert.equal(await c.backend.confirmedDigitalSilence(c.account,c.job,c.attempt.attemptId,c.zeroProof),false);
});
for(const kind of ['prior-intent','prior-received','staged','entries','call-hash','call-keys','artifact-attempt','lease','flags','generation','size','sha','deleted','unknown-sibling'])test('digital certificate cannot release through '+kind,async()=>{
 const c=await fixture(31,true);
 if(kind.startsWith('prior-'))await ref(c,'providerCalls',randomUUID()).create({jobId:c.job,attemptId:randomUUID(),state:kind==='prior-intent'?'intent':'received'});
 if(kind==='staged')await ref(c,'artifacts',c.job).update({state:'staged'});if(kind==='entries')await ref(c,'artifacts',c.job).update({entries:[{key:'unexpected'}]});if(kind==='call-hash')await ref(c,'artifacts',c.job).update({callReceiptHash:null});if(kind==='call-keys')await ref(c,'artifacts',c.job).update({callKeys:[]});if(kind==='artifact-attempt')await ref(c,'artifacts',c.job).update({attemptId:randomUUID()});
 if(kind==='lease')await ref(c,'jobs',c.job).update({leaseUntil:Date.now()-1});if(kind==='flags')await ref(c,'accounts',c.account).update({aiPilot:false});if(kind==='generation')await ref(c,'inputs',c.input).update({'storage.generation':'9007199254740994'});if(kind==='size')await ref(c,'inputs',c.input).update({'storage.size':99});if(kind==='sha')await ref(c,'inputs',c.input).update({sha256:'f'.repeat(64),'storage.sha256':'f'.repeat(64)});if(kind==='deleted')await ref(c,'inputs',c.input).update({deleted:true});if(kind==='unknown-sibling')await ref(c,'inputs',c.input).update({unknownCount:1});
 assert.equal(await c.backend.completeDigitalSilence(c.account,c.job,c.attempt.attemptId,c.zeroProof),false);await held(c);assert.equal((await c.backend.job(c.account,c.job)).state,'unknown');assert.equal(await c.backend.claim(c.account,c.job),null);
});
for(const action of ['claim','begin','fail','heartbeat','recover','cancel'])for(const contradiction of ['intent','received','staged'])test('legacy '+action+' quarantines '+contradiction+' before any release or replay',async()=>{
 const c=await fixture(31,true);await ref(c,'jobs',c.job).update({state:action==='claim'?'queued':'running',invocationPhase:'not_started',...(action==='recover'?{leaseUntil:Date.now()-1}:{})});
 if(action==='claim')await ref(c,'accounts',c.account).update({aiPilot:false}); // Contradiction must win before the legacy pre-usable refund.
 if(contradiction==='staged')await ref(c,'artifacts',c.job).update({state:'staged'});else await ref(c,'providerCalls',randomUUID()).create({jobId:c.job,attemptId:randomUUID(),state:contradiction});
 if(action==='claim')await c.backend.claim(c.account,c.job);if(action==='begin')await c.backend.beginInvocation(c.account,c.job,c.attempt.attemptId);if(action==='fail')await c.backend.failBeforeInvocation(c.account,c.job,c.attempt.attemptId);if(action==='heartbeat')await c.backend.heartbeat(c.account,c.job,c.attempt.attemptId);if(action==='recover')await c.backend.recover(c.account,c.job);if(action==='cancel')await c.backend.cancel(c.account,c.job);
 await held(c);assert.equal((await c.backend.job(c.account,c.job)).state,'unknown');assert.equal((await ref(c,'outbox',c.job).get()).get('state'),'sent');
});
test('local fence survives process death, lease recovery and generic refund routes',async()=>{
 const c=await fixture(31,true);assert.equal(await c.backend.beginInvocation(c.account,c.job,c.attempt.attemptId),false);assert.equal(await c.backend.failBeforeInvocation(c.account,c.job,c.attempt.attemptId),false);
 await ref(c,'jobs',c.job).update({leaseUntil:Date.now()-1});assert.equal(await c.backend.recover(c.account,c.job),true);await held(c);assert.equal((await c.backend.job(c.account,c.job)).state,'unknown');
 assert.equal(await c.backend.reconcile(c.account,c.job,'failed','operator-local-inspection-abandoned'),true);assert.equal((await c.backend.readBalance(c.account)).available,100);
});
for(const kind of ['intent','received','staged','call-hash'])test('noninvoking operator reconciliation rejects '+kind,async()=>{
 const c=await fixture(31,true);await c.backend.quarantine(c.account,c.job,c.attempt.attemptId);
 if(kind==='staged')await ref(c,'artifacts',c.job).update({state:'staged'});else if(kind==='call-hash')await ref(c,'artifacts',c.job).update({callReceiptHash:'f'.repeat(64)});else await ref(c,'providerCalls',randomUUID()).create({jobId:c.job,attemptId:randomUUID(),state:kind});
 await assert.rejects(c.backend.reconcile(c.account,c.job,'failed','operator-evidence'),e=>e.code==='conflict');await held(c);
});
before(async()=>{assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8185');assert.equal((await fetch('http://127.0.0.1:8185/')).status,200);});
afterEach(async()=>{for(const c of contexts.splice(0)){await c.db.recursiveDelete(c.root);await c.db.terminate();}});
async function fixture(duration=31,local=false,source){
 const sha=source?createHash('sha256').update(source).digest('hex'):'a'.repeat(64),size=source?.length??100;
 const db=new Firestore({projectId:'demo-vistavo-ledger',host:'127.0.0.1:8185',ssl:false,preferRest:true}),root=db.collection('vistavo_silent_contract_test').doc(randomUUID()),backend=new FirestoreBackend(db,root),account=await backend.createAccount(),input=randomUUID(),c={db,root,backend,account,input};contexts.push(c);
 await ref(c,'accounts',account).update({aiPilot:true,simulationOnly:true,storageReservedBytes:0,storageCommittedBytes:100,activeUploads:0});
 await backend.creditVerifiedPurchase(account,'synthetic-'+randomUUID(),100,1,'fixture','sandbox');
 await ref(c,'inputs',input).create({accountId:account,expiresAtMs:Date.now()+3600000,sha256:sha,deleted:false,ready:true,unknownCount:0,metadata:{duration,audioTracks:1},storage:{bucket:'vistavo-prod-107404655346-media',key:'candidate-files-v1/'+input+'/video.mp4',generation:'9007199254740993',size,sha256:sha}});
 await backend.saveProject(account,input,0,'Synthetic draft.');
 const job=await backend.reserve(account,input,'one-request',duration,'translation:en',1,AI_CATALOG_VERSION),attempt=await backend.claim(account,job);assert.ok(attempt);
 if(local){const storage=(await ref(c,'inputs',input).get()).get('storage'),accumulator=createDigitalSilenceAccumulator(storage,{audioTracks:1,channels:2,sampleRate:48000});accumulator.write(Buffer.alloc(32));return Object.assign(c,{job,attempt,storage,zeroProof:digitalSilenceProof(accumulator.sealComplete())});}
 assert.equal(await backend.resumeTextAfterLocalCheck(account,job,attempt.attemptId,(await ref(c,'inputs',input).get()).get('storage'),'nonzero'),true);assert.equal(await backend.beginInvocation(account,job,attempt.attemptId),true);
 const proof=[];for(let index=0;index<Math.ceil(duration/30);index++){const callKey='text-window:'+String(index).padStart(4,'0'),responseSha256=String(index+1).repeat(64);proof.push({callKey,responseSha256});await ref(c,'providerCalls',job+'-'+callKey.replace(':','-')).create({jobId:job,accountId:account,attemptId:attempt.attemptId,callKey,model:'gemini-3.8-flash',state:'received',httpStatus:200,requestSha256:'b'.repeat(64),responseSha256,responseId:'synthetic-'+index,usage:{totalTokenCount:42}});}
 return Object.assign(c,{job,attempt,proof});
}
async function held(c){assert.equal((await c.backend.readBalance(c.account)).reserved,31);assert.equal((await c.backend.readBalance(c.account)).available,69);assert.equal((await ref(c,'movements','terminal:'+c.job).get()).exists,false);}
test('complete proven silence releases exactly once under concurrent completion and repeated terminal entry; existing purge frees output quota',async()=>{
 const c=await fixture(),done=await Promise.all(Array.from({length:3},()=>c.backend.completeNoSpeech(c.account,c.job,c.attempt.attemptId,c.proof)));assert.equal(done.filter(Boolean).length,1);
 const job=await c.backend.job(c.account,c.job),balance=await c.backend.readBalance(c.account);assert.equal(job.state,'failed');assert.equal(job.failureCode,'no_speech');assert.match(job.reconciliationRef,/^no-speech:[a-f0-9]{64}$/);assert.equal(balance.available,100);assert.equal(balance.reserved,0);assert.equal(balance.active,0);assert.equal(balance.consumed,0);
 assert.equal((await ref(c,'movements','terminal:'+c.job).get()).get('kind'),'release');assert.equal((await ref(c,'inputs',c.input).get()).get('unknownCount'),0);assert.equal((await ref(c,'artifacts',c.job).get()).get('state'),'purging');assert.equal((await ref(c,'accounts',c.account).get()).get('storageReservedBytes'),AI_TEXT_BUDGET);
 assert.equal(await c.backend.completeNoSpeech(c.account,c.job,c.attempt.attemptId,c.proof),false);assert.equal(await c.backend.claim(c.account,c.job),null);assert.equal((await c.root.collection('providerCalls').get()).size,2);
 const barriers=[];let bothPurgesEntered;const entered=new Promise(resolve=>{bothPurgesEntered=resolve;});
 const objects={barrier:async key=>{barriers.push(key);if(barriers.length===10)bothPurgesEntered();await entered;return {key,generation:'9007199254741000',size:0,marker:true};}},ai=new FirestoreAi(c.db,c.root,c.backend,objects);
 const purges=await Promise.all([ai.purgeResult(c.job),ai.purgeResult(c.job)]);assert.ok(purges.every(Boolean));assert.equal(await ai.purgeResult(c.job),true);assert.equal(barriers.length,10);assert.equal((await ref(c,'accounts',c.account).get()).get('storageReservedBytes'),0);assert.equal((await ref(c,'accounts',c.account).get()).get('storageCommittedBytes'),100);assert.equal((await c.backend.readBalance(c.account)).available,100);
});
test('SDK callback retry and lost finalization acknowledgement preserve one release and no provider replay',async()=>{
 const c=await fixture(),run=c.db.runTransaction.bind(c.db);let callbacks=0;
 c.db.runTransaction=(fn,...args)=>run(async tx=>{const v=await fn(tx);callbacks++;if(callbacks===1)throw Object.assign(Error('synthetic retry'),{code:10});return v;},...args);
 try{assert.equal(await c.backend.completeNoSpeech(c.account,c.job,c.attempt.attemptId,c.proof),true);}finally{c.db.runTransaction=run;}
 assert.ok(callbacks>=2); // Simulate the caller losing the terminal commit ACK and re-entering with the same evidence.
 assert.equal((await c.backend.job(c.account,c.job)).state,'failed');assert.equal(await c.backend.completeNoSpeech(c.account,c.job,c.attempt.attemptId,c.proof),false);
 assert.equal((await c.backend.readBalance(c.account)).available,100);assert.equal((await c.root.collection('providerCalls').get()).size,2);assert.equal((await c.root.collection('movements').where('reference','==',c.job).where('kind','==','release').get()).size,1);
});
for(const kind of ['missing','wrong-hash','wrong-order','duplicate','foreign-attempt','ambiguous','extra-call','staged'])test('rejects '+kind+' evidence without releasing money',async()=>{
 const c=await fixture(),proof=structuredClone(c.proof),call=ref(c,'providerCalls',c.job+'-text-window-0000');
 if(kind==='missing')await call.delete();if(kind==='wrong-hash')proof[0].responseSha256='f'.repeat(64);if(kind==='wrong-order')proof.reverse();if(kind==='duplicate')proof[1]=proof[0];
 if(kind==='foreign-attempt')await call.update({attemptId:randomUUID()});if(kind==='ambiguous')await call.update({state:'ambiguous'});
 if(kind==='extra-call')await ref(c,'providerCalls',c.job+'-text-window-0002').create({...((await call.get()).data()),callKey:'text-window:0002'});
 if(kind==='staged')await ref(c,'artifacts',c.job).update({state:'staged'});
 await assert.rejects(c.backend.completeNoSpeech(c.account,c.job,c.attempt.attemptId,proof),e=>e.code==='conflict');await held(c);assert.equal((await c.backend.job(c.account,c.job)).state,'running');
});
for(const kind of ['lease','revoked','deleted','generation','unknown-sibling'])test('keeps reservation fenced after '+kind+' changes',async()=>{
 const c=await fixture();if(kind==='lease')await ref(c,'jobs',c.job).update({leaseUntil:Date.now()-1});if(kind==='revoked')await ref(c,'accounts',c.account).update({aiPilot:false});if(kind==='deleted')await ref(c,'inputs',c.input).update({deleted:true});if(kind==='generation')await ref(c,'inputs',c.input).update({'storage.generation':'9007199254740994'});if(kind==='unknown-sibling')await ref(c,'inputs',c.input).update({unknownCount:1});
 assert.equal(await c.backend.completeNoSpeech(c.account,c.job,c.attempt.attemptId,c.proof),false);await held(c);assert.equal((await c.backend.job(c.account,c.job)).state,'running');
});
test('an already ambiguous UNKNOWN job cannot be refunded by no-speech completion or claimed again',async()=>{
 const c=await fixture();await c.backend.quarantine(c.account,c.job,c.attempt.attemptId);assert.equal(await c.backend.completeNoSpeech(c.account,c.job,c.attempt.attemptId,c.proof),false);await held(c);assert.equal((await c.backend.job(c.account,c.job)).state,'unknown');assert.equal(await c.backend.claim(c.account,c.job),null);
});
test('invalid proof bounds, a stale worker and a foreign account cannot use the terminal release',async()=>{
 const c=await fixture();
 for(const proof of [[],Array.from({length:AI_TEXT_MAX_WINDOWS+1},()=>c.proof[0]),[{...c.proof[0],unexpected:true}]])await assert.rejects(c.backend.completeNoSpeech(c.account,c.job,c.attempt.attemptId,proof),e=>e.code==='invalid');
 assert.equal(await c.backend.completeNoSpeech(c.account,c.job,randomUUID(),c.proof),false);await assert.rejects(c.backend.completeNoSpeech(randomUUID(),c.job,c.attempt.attemptId,c.proof),e=>e.code==='not_found');await held(c);
 assert.equal(await c.backend.completeNoSpeech(c.account,c.job,c.attempt.attemptId,c.proof),true);assert.equal((await c.backend.readBalance(c.account)).available,100);
});
test('sparse receipt proof cannot release a job whose omitted second response contains speech',async()=>{
 const c=await fixture(),speechPayload={candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({detectedLanguage:'es',hasSpeech:true,cues:[{startMs:0,endMs:500,es:'Prueba.',en:'Test.'}]})}]}}]};
 const {createHash}=await import('node:crypto');await ref(c,'providerCalls',c.job+'-text-window-0001').update({responseSha256:createHash('sha256').update(JSON.stringify(speechPayload)).digest('hex')});
 const proof=new Array(2);proof[0]=c.proof[0];
 await assert.rejects(async()=>{const released=await c.backend.completeNoSpeech(c.account,c.job,c.attempt.attemptId,proof);const balance=await c.backend.readBalance(c.account);console.log(JSON.stringify({event:'unexpected-sparse-proof-acceptance',released,available:balance.available,reserved:balance.reserved,syntheticEmulatorOnly:true}));},e=>e.code==='invalid');await held(c);assert.equal((await c.backend.job(c.account,c.job)).state,'running');
});
for(const kind of ['first','middle','last','all','undefined','inherited'])test('rejects '+kind+' missing proof slots before releasing any units',async()=>{
 const c=await fixture(61);let proof=structuredClone(c.proof);
 if(kind==='first')delete proof[0];if(kind==='middle')delete proof[1];if(kind==='last')delete proof[2];if(kind==='all')proof=new Array(3);if(kind==='undefined')proof[1]=undefined;
 if(kind==='inherited'){const inherited=Object.create(Array.prototype);inherited[1]=proof[1];delete proof[1];Object.setPrototypeOf(proof,inherited);}
 await assert.rejects(c.backend.completeNoSpeech(c.account,c.job,c.attempt.attemptId,proof),e=>e.code==='invalid');const balance=await c.backend.readBalance(c.account);assert.equal(balance.available,39);assert.equal(balance.reserved,61);assert.equal((await ref(c,'movements','terminal:'+c.job).get()).exists,false);
});
