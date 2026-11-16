import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {Readable} from 'node:stream';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
process.env.VISTAVO_ISOLATED_CANDIDATE??='1';
process.env.FIRESTORE_EMULATOR_HOST??='127.0.0.1:8185';
process.env.FIREBASE_AUTH_EMULATOR_HOST??='127.0.0.1:9099';
const {createIsolatedAccountRuntime,createIsolatedCloudRuntime,createIsolatedAccountServer,createIsolatedCloudServer}=await import('./isolatedCandidateLocal.ts');
const {createIsolatedCandidateProxy}=await import('./isolatedCandidateProxy.ts');
const {createIsolatedCloudRunBridge}=await import('./isolatedCloudRunBridge.ts');
const {validateIsolatedCandidateEnvironment}=await import('./isolatedCandidateEnvironment.ts');

const origin='http://127.0.0.1:3003';
const cloudOrigin='http://127.0.0.1:3005';
const authHost='127.0.0.1:9099';
const apiKey='emulator-only-not-a-secret';

test('isolated same-origin candidate accepts a synthetic private MP4 and denies cross-account reads',async()=>{
 validateIsolatedCandidateEnvironment(process.env);
 const accountRuntime=await createIsolatedAccountRuntime(),cloudRuntime=await createIsolatedCloudRuntime();let accountServer,cloudServer,gatewayServer,frontServer,uploadId;const gatewayToken=randomBytes(32).toString('hex'),users=[],fixtureDir=await mkdtemp(join(tmpdir(),'vistavo-candidate-video-'));
 try{
  const fixture=join(fixtureDir,'synthetic.mp4');
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=black:s=160x90:r=15','-t','1','-an','-c:v','mpeg4','-q:v','8','-movflags','+faststart',fixture],{stdio:'ignore',windowsHide:true});
  const video=await readFile(fixture),videoSha=createHash('sha256').update(video).digest('hex');assert.ok(video.length>0&&video.length<8*1024*1024);
  accountServer=createIsolatedAccountServer(accountRuntime);cloudServer=createIsolatedCloudServer(cloudRuntime,gatewayToken);gatewayServer=createIsolatedCloudRunBridge({identity:cloudRuntime.identity,privateServiceUrl:'http://127.0.0.1:3005',tokenForAudience:async audience=>{assert.equal(audience,'http://127.0.0.1:3005');return gatewayToken;}});frontServer=createIsolatedCandidateProxy();
  await Promise.all([accountServer,cloudServer,gatewayServer,frontServer].map(server=>server.listening?Promise.resolve():new Promise((resolve,reject)=>{server.once('error',reject);server.once('listening',resolve);} )));
  for(const label of ['owner','other','unverified','revoked']){
   const email=`${label}-${randomUUID()}@example.test`,password=randomUUID()+'aA1!';
   const user=await accountRuntime.identity.createUser({email,password,emailVerified:label!=='unverified'});user.password=password;
   const response=await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:user.email,password:user.password,returnSecureToken:true})});
   assert.equal(response.status,200);user.token=(await response.json()).idToken;assert.ok(user.token);users.push(user);
  }
  const config=await fetch(origin+'/api/candidate/config');assert.equal(config.status,200);const flags=await config.json();assert.equal(flags.environment,'isolated-local');assert.equal(flags.features.privateBridge,true);assert.equal(flags.features.videoWorkflow,false);assert.equal(flags.features.uploads,true);assert.equal(flags.features.ai,false);assert.equal(flags.features.textFixture,true);assert.equal(flags.features.payments,false);
  const call=(path,token,method='GET',body)=>fetch(origin+path,{method,headers:{Origin:origin,Authorization:'Bearer '+token,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  const bootstrap=await call('/api/account/bootstrap',users[0].token,'POST',{});assert.equal(bootstrap.status,201);
  const account0=await call('/api/account/me',users[0].token);assert.equal(account0.status,200);const accountId=(await account0.json()).id;
  const cloud0=await call('/api/video/me',users[0].token);assert.equal(cloud0.status,200);const cloudId=(await cloud0.json()).id;assert.equal(cloud0.headers.get('cache-control'),'private, no-store');assert.equal(cloud0.headers.get('vary'),'Authorization');
  const injectedInvoker=await fetch(origin+'/api/video/me',{headers:{Origin:origin,Authorization:'Bearer '+users[0].token,'X-Serverless-Authorization':'Bearer attacker-controlled'}});assert.equal(injectedInvoker.status,200,'browser-supplied Cloud Run identity is discarded and replaced by the gateway');await injectedInvoker.arrayBuffer();
  assert.notEqual(accountId,cloudId,'independent databases must retain independent internal IDs');
  assert.equal((await call('/api/account/me','invalid-token')).status,401);
  assert.equal((await call('/api/video/me','invalid-token')).status,401);
  assert.equal((await call('/api/account/me',users[2].token)).status,403);
  assert.equal((await call('/api/video/me',users[2].token)).status,403);
  await new Promise(resolve=>setTimeout(resolve,2100));await accountRuntime.identity.revokeRefreshTokens(users[3].uid);assert.equal((await call('/api/video/me',users[3].token)).status,401,'revoked Firebase token is rejected at the gateway');
  const bootstrapOther=await call('/api/account/bootstrap',users[1].token,'POST',{});assert.equal(bootstrapOther.status,201);
  const account1=await call('/api/account/me',users[1].token);assert.equal(account1.status,200);assert.notEqual((await account1.json()).id,accountId);
  const cloud1=await call('/api/video/me',users[1].token);assert.equal(cloud1.status,200);const cloud1Value=await cloud1.json();assert.notEqual(cloud1Value.id,cloudId);
  assert.equal((await call('/api/account/me?accountId='+accountId,users[1].token)).status,400);
  const requestKey=randomUUID(),start=await call('/api/video/uploads',users[0].token,'POST',{name:'synthetic.mp4',size:video.length,sha256:videoSha,requestKey});assert.equal(start.status,201);uploadId=(await start.json()).id;assert.match(uploadId,/^[a-f0-9-]{36}$/);
  const put=await fetch(`${origin}/api/video/uploads/${uploadId}/chunks?offset=0`,{method:'PUT',headers:{Origin:origin,Authorization:'Bearer '+users[0].token,'Content-Type':'application/octet-stream'},body:video});assert.equal(put.status,200);await put.arrayBuffer();
  assert.equal((await call(`/api/video/uploads/${uploadId}/complete`,users[0].token,'POST',{})).status,202);
  const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_format','-show_streams','-of','json',fixture],{encoding:'utf8',windowsHide:true}));
  const probedVideo=probe.streams.find(stream=>stream.codec_type==='video'),probedAudio=probe.streams.filter(stream=>stream.codec_type==='audio'),probedDuration=Number(probe.format.duration);
  let stored;for(let attempt=0;attempt<50;attempt++){const status=await call(`/api/video/uploads/${uploadId}`,users[0].token);assert.equal(status.status,200);stored=await status.json();if(stored.state==='ready')break;await new Promise(resolve=>setTimeout(resolve,100));}
  assert.equal(stored.state,'ready');assert.equal(stored.sha256,videoSha);assert.equal(stored.metadata.audioTracks,probedAudio.length);assert.equal(stored.metadata.width,probedVideo.width);assert.equal(stored.metadata.height,probedVideo.height);assert.ok(Math.abs(stored.metadata.duration-probedDuration)<0.1);
  const directCloud=await fetch(`${cloudOrigin}/api/cloud/me`,{headers:{Origin:origin,Authorization:'Bearer '+users[0].token}});assert.equal(directCloud.status,403,'private API denies direct calls without gateway assertion');
  const tooLarge=await fetch(`${origin}/api/video/uploads/${uploadId}/chunks?offset=0`,{method:'PUT',headers:{Origin:origin,Authorization:'Bearer '+users[0].token,'Content-Type':'application/octet-stream'},body:Buffer.alloc(8*1024*1024+1)});assert.equal(tooLarge.status,413);await tooLarge.arrayBuffer();
  assert.equal((await fetch(`${origin}/api/video/uploads/${uploadId}/chunks?offset=bad`,{method:'PUT',headers:{Origin:origin,Authorization:'Bearer '+users[0].token,'Content-Type':'application/octet-stream'},body:Buffer.from('x')})).status,400);
  const missingLength=await fetch(origin+'/api/video/text-fixture/transcribe',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+users[0].token,'Content-Type':'application/json'},body:Readable.from([Buffer.from('{}')]),duplex:'half'});assert.equal(missingLength.status,411,'chunked JSON without a declared length is rejected');await missingLength.arrayBuffer();
  const oversizedJson=await fetch(origin+'/api/video/text-fixture/transcribe',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+users[0].token,'Content-Type':'application/json'},body:Buffer.alloc(400_001)});assert.equal(oversizedJson.status,413,'JSON over 400 kB is rejected');await oversizedJson.arrayBuffer();
  const download=await call(`/api/video/uploads/${uploadId}/content`,users[0].token);assert.equal(download.status,200);assert.equal(createHash('sha256').update(Buffer.from(await download.arrayBuffer())).digest('hex'),videoSha);
  const sample=await call('/api/video/text-fixture/transcribe',users[0].token,'POST',{inputId:uploadId});assert.equal(sample.status,200);const sampleValue=await sample.json();assert.equal(sampleValue.source,'local-deterministic-fixture');assert.match(sampleValue.transcriptEs,/bomba de agua/);
  const repeatedSample=await call('/api/video/text-fixture/transcribe',users[0].token,'POST',{inputId:uploadId});assert.deepEqual(await repeatedSample.json(),sampleValue,'fixture creation is deterministic and idempotent');
  assert.equal((await call(`/api/video/text-fixture/${uploadId}/translate`,users[0].token,'POST',{expectedRevision:sampleValue.revision})).status,409,'translation requires review first');
  const fixturePath=`/api/video/text-fixture/${uploadId}`;assert.equal((await call(fixturePath,users[0].token)).status,200);assert.equal((await call(fixturePath,users[1].token)).status,404);
  const review=await call(fixturePath+'/review',users[0].token,'PUT',{reviewedEs:sampleValue.transcriptEs+' (revisado)',expectedRevision:sampleValue.revision});assert.equal(review.status,200);const reviewed=await review.json();assert.equal(reviewed.phase,'reviewed');
  const duplicateReview=await call(fixturePath+'/review',users[0].token,'PUT',{reviewedEs:'edición concurrente obsoleta',expectedRevision:sampleValue.revision});assert.equal(duplicateReview.status,409,'stale review cannot overwrite current version');
  const repeatedAfterReview=await call('/api/video/text-fixture/transcribe',users[0].token,'POST',{inputId:uploadId});const afterReview=await repeatedAfterReview.json();assert.equal(afterReview.phase,'reviewed');assert.equal(afterReview.revision,reviewed.revision,'retry does not reset reviewed state');
  const translation=await call(fixturePath+'/translate',users[0].token,'POST',{expectedRevision:reviewed.revision});assert.equal(translation.status,200);const translated=await translation.json();assert.equal(translated.source,'local-deterministic-fixture');
  assert.equal((await call(fixturePath+'/translate',users[0].token,'POST',{expectedRevision:reviewed.revision})).status,409,'stale translate cannot replace current revision');
  for(const name of ['transcript-es.txt','transcript-es.srt','translation-en.txt','translation-en.srt']){const result=await call(fixturePath+'/results/'+name,users[0].token);assert.equal(result.status,200,name);assert.equal(result.headers.get('cache-control'),'private, no-store');assert.equal(result.headers.get('vary'),'Authorization');assert.equal(result.headers.get('x-vistavo-fixture'),'local-deterministic-fixture');const bytes=Buffer.from(await result.arrayBuffer());assert.ok(bytes.length>0,name);if(name.endsWith('.srt'))assert.match(bytes.toString('utf8'),/^1\n00:00:00,000 --> 00:00:01,\d{3}\n/m);assert.equal((await call(fixturePath+'/results/'+name,users[1].token)).status,404,name+' denied to another account');const head=await fetch(origin+fixturePath+'/results/'+name,{method:'HEAD',headers:{Origin:origin,Authorization:'Bearer '+users[0].token}});assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);}
  assert.equal((await call(fixturePath+'/results/transcript-es.txt?download=2',users[0].token)).status,404,'download query accepts only the documented value');
  assert.equal((await call('/api/video/me?unexpected=1',users[0].token)).status,404,'query is denied on routes without query support');
  assert.ok((await cloudRuntime.root.collection('textFixtures').doc(uploadId).get()).exists,'fixture document exists until input removal');
  assert.equal((await cloudRuntime.root.collection('providerCalls').get()).size,0,'local fixture must not create provider call records');
  const range=await fetch(`${origin}/api/video/uploads/${uploadId}/content`,{headers:{Origin:origin,Authorization:'Bearer '+users[0].token,Range:`bytes=${video.length+1}-`}});assert.equal(range.status,416);await range.arrayBuffer();
  assert.equal((await call(`/api/video/uploads/${uploadId}`,users[1].token)).status,404);
  assert.equal((await call(`/api/video/uploads/${uploadId}/content`,users[1].token)).status,404);
  assert.equal((await call(`/api/video/uploads/${uploadId}`,users[1].token,'DELETE')).status,404,'another account cannot delete the owner input');
  assert.ok((await cloudRuntime.root.collection('textFixtures').doc(uploadId).get()).exists,'foreign delete leaves the owner fixture intact');
  const removed=await call(`/api/video/uploads/${uploadId}`,users[0].token,'DELETE');assert.equal(removed.status,202);
  const deleted=await call(`/api/video/uploads/${uploadId}`,users[0].token);assert.equal(deleted.status,200);assert.equal((await deleted.json()).state,'deleted');
  assert.equal((await call(fixturePath,users[0].token)).status,404,'deleting the private input denies fixture access');
  assert.equal((await cloudRuntime.root.collection('textFixtures').doc(uploadId).get()).exists,false,'deleting the input purges its fixture document');
  assert.equal((await call('/api/video/ai/jobs',users[0].token,'POST',{})).status,404,'unsupported route is not forwarded');
  assert.equal((await call('/api/video/proxy?url=http://example.invalid',users[0].token)).status,404,'gateway is not an open proxy');
  assert.equal((await fetch('http://127.0.0.1:3005/api/cloud/ai/jobs',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+users[0].token,'Content-Type':'application/json'},body:'{}'})).status,403,'private backend requires gateway assertion');
  assert.equal((await call('/api/candidate/config',users[0].token)).status,200);
  assert.equal((await fetch(origin+'/api/video/me',{headers:{Origin:'https://evil.invalid',Authorization:'Bearer '+users[0].token}})).status,403);
 }finally{
  for(const user of users)await accountRuntime.identity.deleteUser(user.uid).catch(()=>{});
  await rm(fixtureDir,{recursive:true,force:true});
  for(const server of [frontServer,gatewayServer,cloudServer,accountServer])if(server){server.closeAllConnections();await new Promise(resolve=>server.close(()=>resolve()));}
  await Promise.all([accountRuntime.close(),cloudRuntime.close()]);
 }
});
