import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {cloudFilesRuntime} from './cloudFilesRuntime';
import {privateUuid,privateBucket} from './privateObjectPlan';
import type {DocumentReference} from 'firebase-admin/firestore';
import {validateArtifactPlan,validateArtifactManifest,AI_CATALOG_VERSION,AI_BILLING_PROFILE,type AiArtifactReceipt} from './aiContracts';
import {validateWavRiff} from './pipelineVoiceWav';
import {narrationChunks} from './pipelineVoiceProvider';

// Synthetic fixture only. The proof never credits accounts, invokes a provider directly,
// or retries a failed/ambiguous paid job. Operator-provisioned fixtures are required.
const report:{checks:string[];startedAt:string;stage:string;inputId?:string;jobIds:string[];fixture?:unknown;artifacts:unknown[];providerCalls:unknown[];billing?:unknown;finishedAt?:string}={
 checks:[],startedAt:new Date().toISOString(),stage:'initialization',jobIds:[],artifacts:[],providerCalls:[],
};
const digest=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
function check(name:string){report.checks.push(name);console.log(JSON.stringify({event:'ai-proof-check',check:name,result:'PASS'}));}
function parseSrt(bytes:Buffer,durationMs:number){
 const blocks=bytes.toString('utf8').replace(/\r/g,'').trim().split(/\n\s*\n/);assert.ok(blocks.length>0);let priorEnd=0;
 const stamp=(h:string,m:string,s:string,ms:string)=>Number(h)*3600000+Number(m)*60000+Number(s)*1000+Number(ms);
 for(const [index,block]of blocks.entries()){
  const lines=block.split('\n');assert.equal(Number(lines[0]),index+1);assert.ok(lines.length>=3);
  const match=/^(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2}):(\d{2}):(\d{2}),(\d{3})$/.exec(lines[1]);assert.ok(match);
  const start=stamp(...match.slice(1,5) as [string,string,string,string]),end=stamp(...match.slice(5,9) as [string,string,string,string]);
  assert.ok(start>=priorEnd&&end>start&&end<=durationMs);assert.ok(lines.slice(2).join(' ').trim());priorEnd=end;
 }
 return {cueCount:blocks.length,lastEndMs:priorEnd};
}
function safeUsage(value:any){const result:Record<string,number>={};for(const key of ['promptTokenCount','candidatesTokenCount','totalTokenCount','thoughtsTokenCount','cachedContentTokenCount'])if(Number.isSafeInteger(value?.[key])&&value[key]>=0)result[key]=value[key];return result;}
async function main(){
 const runtime=await cloudFilesRuntime('proof');let control:DocumentReference|undefined;
 try{
  const origin=process.env.VISTAVO_PROOF_API,apiKey=process.env.VISTAVO_PROOF_WEB_KEY,uid=process.env.VISTAVO_PROOF_UID,
   foreignUid=process.env.VISTAVO_PROOF_FOREIGN_UID,proofId=process.env.VISTAVO_PROOF_ID;
  assert.ok(origin&&/^https:\/\/vistavo-files-api-[a-z0-9-]+(?:\.[a-z0-9-]+)*\.run\.app$/.test(origin)&&new URL(origin).origin===origin);
  assert.ok(apiKey&&uid?.startsWith('vistavo-ai-proof-')&&foreignUid?.startsWith('vistavo-ai-proof-')&&uid!==foreignUid&&proofId&&privateUuid.test(proofId));
  assert.equal(runtime.root.path,'vistavo/candidate-v1');control=runtime.root.collection('aiProofs').doc(proofId);
  await control.set({proofId,scope:'private AI provider and results technical proof',result:'RUNNING',checks:[],startedAt:report.startedAt,billing:AI_BILLING_PROFILE});
  report.stage='fixture';const fixture=await readFile('/app/fixtures/ai-es.mp4');assert.equal(fixture.length,414238);const fixtureSha=digest(fixture);
  report.fixture={bytes:fixture.length,sha256:fixtureSha,kind:'synthetic-Spanish-standard-voice-demo-no-customer-data'};
  const tokenFor=async(id:string)=>{
   const custom=await runtime.identity.createCustomToken(id),response=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key='+encodeURIComponent(apiKey),{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:custom,returnSecureToken:true}),signal:AbortSignal.timeout(20000)});
   const data=await response.json();if(!response.ok||typeof data.idToken!=='string')throw Error('Synthetic sign-in unavailable');return data.idToken as string;
  };
  report.stage='authentication';const [owner,foreign]=await Promise.all([tokenFor(uid),tokenFor(foreignUid)]);
  const metadata=await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience='+encodeURIComponent(origin)+'&format=full',{
   headers:{'Metadata-Flavor':'Google'},signal:AbortSignal.timeout(5000)});assert.equal(metadata.status,200);assert.equal(metadata.headers.get('Metadata-Flavor'),'Google');const invoker=await metadata.text();
  const call=(path:string,method='GET',body?:unknown,token:string|null=owner,headers:Record<string,string>={})=>fetch(origin+path,{
   method,headers:{...(token?{Authorization:'Bearer '+token}:{}),'X-Serverless-Authorization':'Bearer '+invoker,
    ...(body===undefined?{}:{'Content-Type':Buffer.isBuffer(body)?'application/octet-stream':'application/json'}),...headers},
   body:body===undefined?undefined:Buffer.isBuffer(body)?body as unknown as BodyInit:JSON.stringify(body),signal:AbortSignal.timeout(300000)});
  const json=async(response:Response,status:number)=>{assert.equal(response.status,status);return response.json();};
  const me=await json(await call('/api/cloud/me'),200),other=await json(await call('/api/cloud/me','GET',undefined,foreign),200);assert.notEqual(me.id,other.id);
  const account=runtime.root.collection('accounts').doc(me.id),foreignAccount=runtime.root.collection('accounts').doc(other.id);
  for(const ref of [account,foreignAccount]){const a=await ref.get();assert.equal(a.get('aiPilot'),true);assert.equal(a.get('simulationOnly'),true);}
  const before=await runtime.backend.readBalance(me.id);assert.deepEqual(before,{credited:300,available:300,reserved:0,consumed:0,active:0});assert.equal((await runtime.backend.readBalance(other.id)).credited,0);
  assert.equal((await call('/api/cloud/me','GET',undefined,null)).status,401);
  const anonymous=await fetch(origin+'/healthz',{signal:AbortSignal.timeout(15000)});assert.ok([401,403,404].includes(anonymous.status));check('twoVerifiedFirebaseFixtures-privateIAM-andAnonymousAppDenied');

  report.stage='input-upload';const input=await json(await call('/api/cloud/uploads','POST',{name:'synthetic-ai-es.mp4',size:fixture.length,sha256:fixtureSha,requestKey:'ai-input-'+proofId}),201);
  report.inputId=input.id;await control.set({inputId:input.id,fixture:report.fixture},{merge:true});
  const inputPath='/api/cloud/uploads/'+input.id;
  for(let offset=0;offset<fixture.length;offset+=8*1024*1024)await json(await call(inputPath+'/chunks?offset='+offset,'PUT',fixture.subarray(offset,offset+8*1024*1024)),200);
  await json(await call(inputPath+'/complete','POST',{}),202);
  const waitInput=async(state:string)=>{
   const until=Date.now()+12*60000;while(Date.now()<until){const current=await json(await call(inputPath),200);if(current.state===state)return current;
    if(state==='ready'&&['deleting','deleted'].includes(current.state))throw Error('Input validation failed');await delay(4000);}throw Error('Input transition timeout');
  };
  const ready=await waitInput('ready');assert.equal(ready.sha256,fixtureSha);const duration=ready.metadata.duration,durationMs=Math.floor(duration*1000);assert.ok(duration>=20&&duration<=22);
  const source=(await runtime.root.collection('uploads').doc(input.id).get()).data()!;assert.equal((await account.get()).get('storageCommittedBytes'),fixture.length);check('syntheticMP4-uploadedAndVerifiedByCloudWorker');
  report.stage='text-enqueue';const project=await json(await call('/api/cloud/projects/'+input.id,'PUT',{expectedRevision:0,draft:''}),200);assert.equal(project.revision,1);assert.equal(project.draft,'');
  const quote=await json(await call('/api/cloud/ai/quote?inputId='+input.id+'&operation=translation:en&revision=1'),200);assert.equal(quote.catalogVersion,AI_CATALOG_VERSION);assert.deepEqual(quote.billing,AI_BILLING_PROFILE);assert.equal(quote.units,Math.ceil(duration));assert.equal(quote.sourceGeneration,(await runtime.root.collection('inputs').doc(input.id).get()).get('storage').generation);
  const textRequest={inputId:input.id,operation:'translation:en',expectedRevision:1,requestKey:'ai-text-'+proofId};
  const text=await json(await call('/api/cloud/ai/jobs','POST',textRequest),202);report.jobIds.push(text.id);const replay=await json(await call('/api/cloud/ai/jobs','POST',textRequest),202);assert.equal(replay.id,text.id);
  const waitJob=async(id:string)=>{
   const until=Date.now()+12*60000;while(Date.now()<until){const current=await json(await call('/api/cloud/ai/jobs/'+id),200);if(current.state==='succeeded')return current;
    if(['unknown','failed','cancelled'].includes(current.state))throw Error('AI job stopped; no automatic rerun');await delay(4000);}throw Error('AI job timeout; no automatic rerun');
  };
  const callsFor=async(id:string,expected:number)=>{
   const docs=await runtime.root.collection('providerCalls').where('jobId','==',id).get();assert.equal(docs.size,expected);
   const rows=docs.docs.map(doc=>{const c=doc.data();assert.equal(c.accountId,me.id);assert.equal(c.jobId,id);assert.equal(c.state,'received');assert.equal(c.httpStatus,200);
    assert.match(c.requestSha256,/^[a-f0-9]{64}$/);assert.match(c.responseSha256,/^[a-f0-9]{64}$/);const usage=safeUsage(c.usage);assert.ok(Object.keys(usage).length>0);
    return {jobId:id,callKey:c.callKey,model:c.model,state:c.state,responseId:c.responseId,requestSha256:c.requestSha256,responseSha256:c.responseSha256,usage,startedAtMs:c.startedAtMs,finishedAtMs:c.finishedAtMs};});
   return rows;
  };
  const privateResults=async(id:string,status:any)=>{
   const record=(await runtime.root.collection('artifacts').doc(id).get()).data()!;assert.equal(record.accountId,me.id);assert.equal(record.state,'ready');
   const entries=validateArtifactManifest(validateArtifactPlan(record.plan),record.entries);assert.equal(entries.length,status.results.length);
   const data=new Map<string,Buffer>();
   for(const entry of entries){
    const response=await call('/api/cloud/ai/jobs/'+id+'/results/'+entry.name);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
    assert.equal(response.headers.get('content-type'),entry.mimeType);const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.length,entry.size);assert.equal(digest(bytes),entry.sha256);data.set(entry.name,bytes);
    report.artifacts.push({jobId:id,name:entry.name,bytes:entry.size,sha256:entry.sha256,generation:entry.generation,revision:record.revision});
    assert.equal((await call('/api/cloud/ai/jobs/'+id+'/results/'+entry.name,'GET',undefined,foreign)).status,404);
   }
   assert.equal((await call('/api/cloud/ai/jobs/'+id,'GET',undefined,foreign)).status,404);return {record,entries,data};
  };
  report.stage='text-worker';const textStatus=await waitJob(text.id);assert.equal(textStatus.revision,1);assert.equal(textStatus.stale,false);const textResults=await privateResults(text.id,textStatus);
  assert.equal(textResults.entries.length,5);const es=textResults.data.get('transcript-es.txt')!.toString('utf8'),en=textResults.data.get('translation-en.txt')!.toString('utf8');
  assert.match(es,/Elena/i);assert.match(es,/Robles/i);assert.match(es,/(?:cinco|5)\s*(?:cent[ií]metros?|cm)\b/i);assert.match(es,/(?:seis|6)\s*(?:pies|pie)\b/i);
  assert.match(en,/Elena/i);assert.match(en,/Robles/i);assert.match(en,/(?:five|5)\s*(?:centimeters?|centimetres?|cm)\b/i);assert.match(en,/(?:six|6)\s*(?:feet|foot|ft)\b/i);
  for(const name of ['transcript-es.srt','translation-en.srt'])parseSrt(textResults.data.get(name)!,durationMs);
  const cues=JSON.parse(textResults.data.get('cues.json')!.toString('utf8'));assert.equal(cues.durationMs,durationMs);assert.ok(cues.cues.length>0);for(const cue of cues.cues)assert.ok(Number.isInteger(cue.startMs)&&Number.isInteger(cue.endMs)&&cue.startMs>=0&&cue.endMs>cue.startMs&&cue.endMs<=durationMs);
  const textCalls=await callsFor(text.id,Math.ceil(durationMs/30000));assert.ok(textCalls.every(c=>c.model==='gemini-3.8-flash'));report.providerCalls.push(...textCalls);check('realSpanishTranscriptionEnglishTranslation-fivePrivateResults-andMeasuredUsage');
  const unchanged=await json(await call('/api/cloud/projects/'+input.id),200);assert.equal(unchanged.revision,1);assert.equal(unchanged.draft,'');
  const edited=await json(await call('/api/cloud/projects/'+input.id,'PUT',{expectedRevision:1,draft:en}),200);assert.equal(edited.revision,2);assert.equal(edited.draft,en);
  const stale=await json(await call('/api/cloud/ai/jobs/'+text.id),200);assert.equal(stale.stale,true);assert.equal((await json(await call('/api/cloud/ai/jobs','POST',textRequest),202)).id,text.id);
  assert.equal(await runtime.backend.claim(me.id,text.id),null);assert.equal((await callsFor(text.id,textCalls.length)).length,textCalls.length);check('textReplayAfterEdit-keepsOneJobProviderCalls-andFrozenRevision');

  const records=[textResults.record],expectedCalls=new Map([[text.id,textCalls.length]]);let voiceUnits=0;
  for(const sex of ['female','male'] as const){
   report.stage='voice-'+sex;const operation='narration:en:'+sex,request={inputId:input.id,operation,expectedRevision:2,requestKey:'ai-voice-'+sex+'-'+proofId};
   const voiceQuote=await json(await call('/api/cloud/ai/quote?inputId='+input.id+'&operation='+encodeURIComponent(operation)+'&revision=2'),200);assert.equal(voiceQuote.units,1);assert.deepEqual(voiceQuote.billing,AI_BILLING_PROFILE);voiceUnits+=voiceQuote.units;
   const made=await json(await call('/api/cloud/ai/jobs','POST',request),202);report.jobIds.push(made.id);const status=await waitJob(made.id);assert.equal(status.revision,2);assert.equal(status.stale,false);
   const result=await privateResults(made.id,status);records.push(result.record);assert.equal(result.entries.length,1);const wav=result.data.get('narration-en.wav')!,stats=validateWavRiff(wav);assert.ok(stats.durationMs>0&&stats.durationMs<=600000);
   const target='/api/cloud/ai/jobs/'+made.id+'/results/narration-en.wav',range=await call(target,'GET',undefined,owner,{Range:'bytes=0-63'});assert.equal(range.status,206);assert.equal(range.headers.get('content-range'),'bytes 0-63/'+wav.length);assert.deepEqual(Buffer.from(await range.arrayBuffer()),wav.subarray(0,64));
   const head=await call(target,'HEAD');assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),String(wav.length));assert.equal((await head.arrayBuffer()).byteLength,0);assert.equal((await call(target,'GET',undefined,owner,{Range:'bytes='+wav.length+'-'})).status,416);
   assert.equal((await json(await call('/api/cloud/ai/jobs','POST',request),202)).id,made.id);assert.equal(await runtime.backend.claim(me.id,made.id),null);
   const job=await runtime.backend.job(me.id,made.id);assert.equal(job.snapshot?.draft,en);const voiceCalls=await callsFor(made.id,narrationChunks(en).length);assert.ok(voiceCalls.every(c=>c.model==='gemini-3.8-flash-tts'));expectedCalls.set(made.id,voiceCalls.length);report.providerCalls.push(...voiceCalls);
   report.artifacts.push({jobId:made.id,name:'narration-en.wav',voice:sex,technicalStats:stats});
   const anonymousResult=await call(target,'GET',undefined,null);assert.equal(anonymousResult.status,401);check('realEnglishStandardVoice-'+sex+'-privateWavRangeHead-andSingleInvocation');
  }
  for(const [jobId,count]of expectedCalls)assert.equal((await callsFor(jobId,count)).length,count);
  const expectedUnits=quote.units+voiceUnits,balance=await runtime.backend.readBalance(me.id);assert.equal(balance.credited,300);assert.equal(balance.available,300-expectedUnits);assert.equal(balance.consumed,expectedUnits);assert.equal(balance.reserved,0);assert.equal(balance.active,0);
  const expectedBytes=records.reduce((total,r)=>total+r.entries.reduce((n:number,e:AiArtifactReceipt)=>n+e.size,0),fixture.length);
  const preDelete=(await account.get()).data()!;assert.equal(preDelete.storageReservedBytes,0);assert.equal(preDelete.storageCommittedBytes,expectedBytes);
  report.billing={...AI_BILLING_PROFILE,credited:balance.credited,consumed:balance.consumed,reserved:balance.reserved,available:balance.available,realPayment:false,providerInvoice:'not measured'};check('threeJobs-singleFinancialCaptureEach-noProviderReplay-andExactStorageQuota');
  const firstEntry=textResults.entries[0],direct=await fetch('https://storage.googleapis.com/'+privateBucket+'/'+firstEntry.key,{signal:AbortSignal.timeout(20000)});assert.equal(direct.status,403);assert.ok(firstEntry.generation);check('knownPrivateGcsResultAnonymousDenied');

  report.stage='source-and-results-delete';await json(await call(inputPath,'DELETE'),202);
  for(const record of records)for(const spec of validateArtifactPlan(record.plan).artifacts)assert.equal((await call('/api/cloud/ai/jobs/'+record.jobId+'/results/'+spec.name)).status,404);
  await waitInput('deleted');const allKeys=[...source.plan.chunks,...source.plan.groups,source.plan.final,...records.flatMap(r=>validateArtifactPlan(r.plan).artifacts.map(a=>a.key))];
  for(const key of allKeys){const object=await runtime.objects.metadata(key);assert.equal(object?.marker,true);assert.equal(object?.size,0);}
  for(const id of report.jobIds){const a=(await runtime.root.collection('artifacts').doc(id).get()).data()!;assert.equal(a.state,'purged');assert.equal(a.quotaHeld,0);assert.equal(a.quotaMode,'none');assert.deepEqual(a.entries,[]);assert.equal((await runtime.backend.job(me.id,id)).snapshot,null);}
  const after=(await account.get()).data()!;assert.equal(after.storageReservedBytes,0);assert.equal(after.storageCommittedBytes,0);assert.equal(after.activeUploads,0);assert.deepEqual(await runtime.backend.readBalance(me.id),balance);report.artifacts.push({purgedKnownKeys:allKeys.length,allMarkersZero:true});check('sourceDeleteRevokesEveryResult-andPurgesAllKnownKeys-quotaZero');

  report.stage='revocation';await control.set({phase:'revocationRequested',revocationDone:false,foreignTokenPreviouslyAccepted:true,checks:report.checks},{merge:true});
  const revokeUntil=Date.now()+6*60000;let revoked=false;while(Date.now()<revokeUntil){if((await control.get()).get('revocationDone')===true){revoked=true;break;}await delay(3000);}assert.equal(revoked,true);
  assert.equal((await call('/api/cloud/me','GET',undefined,foreign)).status,401);check('previouslyAcceptedForeignTokenDeniedAfterOperatorRevocation');
  report.stage='complete';report.finishedAt=new Date().toISOString();await control.set({result:'PASS',...report,billing:report.billing,customerData:false,publicRelease:false},{merge:true});
  console.log(JSON.stringify({event:'ai-proof-complete',result:'PASS',...report}));
 }catch(error){
  report.finishedAt=new Date().toISOString();const failure={type:(error as Error)?.name??'Error',code:typeof(error as any)?.code==='string'||typeof(error as any)?.code==='number'?(error as any).code:'unclassified'};
  if(control)await control.set({result:'FAIL',...report,failure,customerData:false,publicRelease:false},{merge:true}).catch(()=>undefined);
  console.error(JSON.stringify({event:'ai-proof-failed',stage:report.stage,...failure,checks:report.checks,inputId:report.inputId,jobIds:report.jobIds}));process.exitCode=1;
 }finally{await runtime.close();}
}
main().catch(error=>{console.error(JSON.stringify({event:'ai-proof-initialization-failed',type:error?.name,code:typeof error?.code==='string'||typeof error?.code==='number'?error.code:undefined}));process.exitCode=1;});
