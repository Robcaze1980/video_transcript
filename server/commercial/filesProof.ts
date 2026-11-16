import {cloudFilesRuntime} from './cloudFilesRuntime';
import {spawn} from 'node:child_process';import {createHash,randomUUID} from 'node:crypto';import {createReadStream} from 'node:fs';import {stat,mkdtemp,open,unlink,rmdir} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {proofLedger} from './filesProofExtras';
import {GcsObjects} from './gcsObjects';
import {privateBucket} from './privateObjectPlan';
const report:any={checks:[],startedAt:new Date().toISOString()};
function check(name:string){report.checks.push(name);console.log(JSON.stringify({check:name,result:'PASS'}));}
async function main(){
 const runtime=await cloudFilesRuntime('proof');const origin=process.env.VISTAVO_PROOF_API,apiKey=process.env.VISTAVO_PROOF_WEB_KEY,uid=process.env.VISTAVO_PROOF_UID,foreignUid=process.env.VISTAVO_PROOF_FOREIGN_UID,proofId=process.env.VISTAVO_PROOF_ID;
 if(!origin||!/^https:\/\/vistavo-files-api-/.test(origin)||!apiKey||!uid?.startsWith('vistavo-gcs-proof-')||!foreignUid?.startsWith('vistavo-gcs-proof-')||!proofId||!/^[a-f0-9-]{36}$/.test(proofId))throw Error('Proof config');
 const directory=await mkdtemp(join(tmpdir(),'vistavo-proof-')),file=join(directory,'fixture.mp4');
 try{
  await new Promise<void>((resolve,reject)=>{const child=spawn('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=320x180:rate=25','-f','lavfi','-i','sine=frequency=440:sample_rate=16000','-t','145','-c:v','libx264','-preset','ultrafast','-b:v','16M','-minrate','16M','-maxrate','16M','-bufsize','16M','-x264-params','nal-hrd=cbr','-c:a','aac','-b:a','32k','-movflags','+faststart','-y',file],{stdio:'ignore'});child.once('error',reject);child.once('exit',c=>c===0?resolve():reject(Error('Synthetic encode failed')));});
  const size=(await stat(file)).size,hash=createHash('sha256');for await(const bytes of createReadStream(file))hash.update(bytes);const sha256=hash.digest('hex');
  assert.ok(size>32*8*1024*1024&&size<500000000);report.bytes=size;report.sha256=sha256;check('synthetic145sMP4-over32chunks');
  const tokenFor=async(id:string)=>{const custom=await runtime.identity.createCustomToken(id);const r=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key='+encodeURIComponent(apiKey),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:custom,returnSecureToken:true}),signal:AbortSignal.timeout(20000)});const data=await r.json();if(!r.ok||!data.idToken)throw Error('Synthetic sign in failed');return data.idToken as string;};
  const [owner,foreign]=await Promise.all([tokenFor(uid),tokenFor(foreignUid)]);
  const meta=await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience='+encodeURIComponent(origin)+'&format=full',{headers:{'Metadata-Flavor':'Google'}});if(!meta.ok)throw Error('Invoker token unavailable');const invoker=await meta.text();
  const call=async(path:string,method='GET',body?:unknown,token=owner,extra:Record<string,string>={})=>fetch(origin+path,{method,headers:{Authorization:'Bearer '+token,'X-Serverless-Authorization':'Bearer '+invoker,...(body!==undefined?{'Content-Type':Buffer.isBuffer(body)?'application/octet-stream':'application/json'}:{}),...extra},body:body===undefined?undefined:Buffer.isBuffer(body)?body as unknown as BodyInit:JSON.stringify(body),signal:AbortSignal.timeout(280000)});
  const json=async(r:Response,status:number)=>{assert.equal(r.status,status);return r.json();};
  const denied=await fetch(origin+'/healthz');assert.ok([401,403,404].includes(denied.status));check('privateAPI-anonymousDenied');
  const me=await json(await call('/api/cloud/me'),200),other=await json(await call('/api/cloud/me','GET',undefined,foreign),200);assert.notEqual(me.id,other.id);
  const control=runtime.root.collection('proofs').doc(proofId);
  const waitControl=async(field:string)=>{for(let n=0;n<100;n++){if((await control.get()).get(field)===true)return;await new Promise(r=>setTimeout(r,3000));}throw Error('Control action timeout');};
  const base='/api/cloud/uploads',requestKey='cloud-proof-'+proofId;
  const begin=await json(await call(base,'POST',{name:'synthetic-145s.mp4',size,sha256,requestKey}),201),path=base+'/'+begin.id;report.uploadId=begin.id;
  const again=await json(await call(base,'POST',{name:'synthetic-145s.mp4',size,sha256,requestKey}),201);assert.equal(again.id,begin.id);check('beginIdempotent-accountSeparation');
  const account=runtime.root.collection('accounts').doc(me.id);assert.equal((await account.get()).get('storageReservedBytes'),3*size);check('peakQuota3x');
  for(const [suffix,method,body] of [['','GET',undefined],['/chunks?offset=0','PUT',Buffer.alloc(8*1024*1024)],['/complete','POST',{}],['','DELETE',undefined],['/content','GET',undefined]] as const){assert.equal((await call(path+suffix,method,body,foreign)).status,404);}check('foreignAllFileRoutesDenied');
  const handle=await open(file,'r');try{
   for(let offset=0;offset<size;offset+=8*1024*1024){const bytes=Buffer.alloc(Math.min(8*1024*1024,size-offset));await handle.read(bytes,0,bytes.length,offset);
    if(offset===0){await assert.rejects(async()=>{const committed=await call(path+'/chunks?offset=0','PUT',bytes);assert.equal(committed.status,200);await committed.arrayBuffer();throw Error('Injected lost PUT acknowledgement after real server commit');});check('realPUTAckLost-clientRetry');}
    const response=await call(path+'/chunks?offset='+offset,'PUT',bytes);await json(response,200);
    if(offset===0){const before=(await runtime.root.collection('uploads').doc(begin.id).get()).get('chunks')[0].generation;
     await json(await call(path+'/chunks?offset=0','PUT',bytes),200);assert.equal((await runtime.root.collection('uploads').doc(begin.id).get()).get('chunks')[0].generation,before);
     assert.equal((await call(path+'/chunks?offset=0','PUT',Buffer.alloc(bytes.length,99))).status,409);check('chunkReplaySameGeneration-conflictingBytesDenied');
     await control.set({phase:'restartRequested',uploadId:begin.id},{merge:true});await waitControl('restartDone');assert.equal((await json(await call(path),200)).offset,bytes.length);check('newAPIRevisionResumesPersistedChunk');}
   }
  }finally{await handle.close();}
  await json(await call(path+'/complete','POST',{}),202);check('durableCompletionQueued');
  const wait=async(state:string,target=path)=>{for(let n=0;n<100;n++){const data=await json(await call(target),200);if(data.state===state)return data;if(data.state==='deleted'&&state!=='deleted')throw Error('Unexpected cleanup');await new Promise(r=>setTimeout(r,5000));}throw Error('Worker proof timeout');};
  const ready=await wait('ready');assert.equal(ready.sha256,sha256);assert.ok(ready.metadata.duration>144&&ready.metadata.duration<146);check('realGCS-compose33plus-ffprobe145s');
  const input=(await runtime.root.collection('inputs').doc(begin.id).get()).data()!;assert.equal(input.storage.sha256,sha256);assert.equal((await account.get()).get('storageCommittedBytes'),size);assert.equal((await account.get()).get('storageReservedBytes'),0);check('readyGenerationAndQuota');
  const row=(await runtime.root.collection('uploads').doc(begin.id).get()).data()!;assert.ok(row.plan.groups.length>=2);
  for(const key of [...row.plan.chunks,...row.plan.groups]){const object=await runtime.objects.metadata(key);assert.equal(object?.size,0);assert.equal(object?.marker,true);}check('allIntermediateBytesFenced');
  const range=await call(path+'/content','GET',undefined,owner,{Range:'bytes=13-76'});assert.equal(range.status,206);assert.equal(range.headers.get('cache-control'),'no-store');const expected=Buffer.alloc(64),h=await open(file,'r');try{await h.read(expected,0,64,13);}finally{await h.close();}assert.deepEqual(Buffer.from(await range.arrayBuffer()),expected);
  const head=await call(path+'/content','HEAD');assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),String(size));assert.equal((await call(path+'/content','GET',undefined,owner,{Range:'bytes='+size+'-'})).status,416);check('rangeHEAD416');
  const download=await call(path+'/content'),downloadHash=createHash('sha256');assert.equal(download.status,200);assert.ok(!download.headers.has('content-length'));let downloaded=0;
  for await(const bytes of Readable.fromWeb(download.body as unknown as Parameters<typeof Readable.fromWeb>[0])){downloadHash.update(bytes);downloaded+=bytes.length;}assert.equal(downloaded,size);assert.equal(downloadHash.digest('hex'),sha256);check('fullLargeStreamingExactSHA');
  const direct=await fetch('https://storage.googleapis.com/'+input.storage.bucket+'/'+input.storage.key);assert.equal(direct.status,403);check('knownObjectAnonymousDenied');
  // A separate Admin client/process is exercised by API and validator/cleaner; proof only reads persisted receipts.
  const afterDelete=await proofLedger(runtime,me.id,begin.id,check);
  await json(await call(path,'DELETE'),202);assert.equal((await call(path+'/content')).status,404);await wait('deleted');await afterDelete();
  for(const key of [...row.plan.chunks,...row.plan.groups,row.plan.final]){const object=await runtime.objects.metadata(key);assert.equal(object?.size,0);assert.equal(object?.marker,true);}check('deleteAllPlannedKeysZeroMarkers');
  await assert.rejects(()=>runtime.objects.putOnce(row.plan.chunks[0],Buffer.from('late')));await assert.rejects(()=>runtime.objects.composeOnce(row.plan.final,[{key:row.plan.chunks[0],generation:row.chunks[0].generation}],size));check('lateCreateAndComposeBlocked');
  const quota=(await account.get()).data()!;assert.equal(quota.storageReservedBytes,0);assert.equal(quota.storageCommittedBytes,0);check('deleteQuotaReleasedOnce');
  // Delete a partial upload while a CREATE is paused after its real metadata GET.
  const partial=await json(await call(base,'POST',{name:'synthetic-partial.mp4',size:8*1024*1024+1,sha256:'a'.repeat(64),requestKey:'partial-'+proofId}),201),partialPath=base+'/'+partial.id;
  await json(await call(partialPath+'/chunks?offset=0','PUT',Buffer.alloc(8*1024*1024,7)),200);
  const planned=(await runtime.root.collection('uploads').doc(partial.id).get()).get('plan'),absent=planned.chunks[1];
  let entered!:()=>void,release!:()=>void;const paused=new Promise<void>(r=>entered=r),resume=new Promise<void>(r=>release=r);
  const delayed=new GcsObjects({bucket:privateBucket,projectId:'vistavo-prod',accessToken:runtime.accessToken,request:async(url,init)=>{if(init?.method==='POST'){entered();await resume;}return fetch(url,init);}});
  const late=delayed.putOnce(absent,Buffer.from([1])).then(()=>({unexpected:true}),()=>({unexpected:false}));await paused;
  await json(await call(partialPath,'DELETE'),202);
  for(let n=0;n<100;n++){if((await json(await call(partialPath),200)).state==='deleted')break;await new Promise(r=>setTimeout(r,3000));}
  assert.equal((await runtime.root.collection('uploads').doc(partial.id).get()).get('state'),'deleted');release();assert.equal((await late).unexpected,false);
  for(const key of [...planned.chunks,...planned.groups,planned.final]){const marker=await runtime.objects.metadata(key);assert.equal(marker?.size,0);assert.equal(marker?.marker,true);}check('pausedLateCREATE-afterDeleteAbsentPlannedKeysDenied');
  // Simulate compose committed in GCS but its acknowledgement lost before a durable receipt.
  const smallFile=join(directory,'small.mp4');await new Promise<void>((resolve,reject)=>{const p=spawn('ffmpeg',['-hide_banner','-loglevel','error','-i',file,'-t','2','-c','copy','-movflags','+faststart','-y',smallFile],{stdio:'ignore'});p.once('error',reject);p.once('exit',code=>code===0?resolve():reject(Error('Small synthetic encode')));});
  const small=await (await import('node:fs/promises')).readFile(smallFile);await unlink(smallFile);assert.ok(small.length<8*1024*1024);
  const smallSha=createHash('sha256').update(small).digest('hex'),su=await json(await call(base,'POST',{name:'synthetic-compose-ack.mp4',size:small.length,sha256:smallSha,requestKey:'compose-ack-'+proofId}),201),sp=base+'/'+su.id;
  await json(await call(sp+'/chunks?offset=0','PUT',small),200);const sr=(await runtime.root.collection('uploads').doc(su.id).get()).data()!;
  const lostCompose=new GcsObjects({bucket:privateBucket,projectId:'vistavo-prod',accessToken:runtime.accessToken,request:async(url,init)=>{const response=await fetch(url,init);if(init?.method==='POST'&&new URL(String(url)).pathname.endsWith('/compose')&&response.ok){await response.arrayBuffer();throw Error('Injected compose acknowledgement loss after real GCS commit');}return response;}});
  await assert.rejects(()=>lostCompose.composeOnce(sr.plan.final,[{key:sr.plan.chunks[0],generation:sr.chunks[0].generation}],small.length));const composed=await runtime.objects.metadata(sr.plan.final);assert.ok(composed);
  await json(await call(sp+'/complete','POST',{}),202);await wait('ready',sp);assert.equal((await runtime.root.collection('inputs').doc(su.id).get()).get('storage').generation,composed.generation);await json(await call(sp,'DELETE'),202);await wait('deleted',sp);check('realComposeAckLost-recoversSameGeneration');
  const expired=await json(await call(base,'POST',{name:'synthetic-expiry.mp4',size:1,sha256:'a'.repeat(64),requestKey:'expiry-'+proofId}),201),ep=base+'/'+expired.id;
  await runtime.root.collection('uploads').doc(expired.id).update({expiresAtMs:Date.now()-1});assert.equal((await call(ep)).status,410);
  await control.set({phase:'maintenanceRequested'},{merge:true});await waitControl('maintenanceDone');
  for(let n=0;n<100;n++){if((await runtime.root.collection('uploads').doc(expired.id).get()).get('state')==='deleted')break;await new Promise(r=>setTimeout(r,3000));}
  assert.equal((await runtime.root.collection('uploads').doc(expired.id).get()).get('state'),'deleted');assert.equal((await account.get()).get('storageReservedBytes'),0);check('logicalExpiryAndRealSchedulerMaintenancePurge');
  await control.set({phase:'revocationRequested'} ,{merge:true});await waitControl('revocationDone');assert.equal((await call('/api/cloud/me','GET',undefined,foreign)).status,401);check('revokedFirebaseUserDenied');
  report.result='PASS';report.finishedAt=new Date().toISOString();await runtime.root.collection('proofs').doc(proofId).set(report,{merge:true});console.log(JSON.stringify({event:'cloud-proof-complete',...report}));
 }finally{await unlink(file).catch(()=>undefined);await rmdir(directory);await runtime.close();}
}
main().catch(error=>{console.error(JSON.stringify({event:'cloud-proof-failed',type:error?.name,code:error?.code,checks:report.checks}));process.exitCode=1;});

