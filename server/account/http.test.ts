import {describe,it,expect} from 'vitest';
import {createServer} from 'node:http';
import {accountHttp} from './http';
import {validateAccountEnvironment,verifyDatabaseBoundary,validateAccountOidcAudience,trustedServiceClaims} from './runtime';
import {AccountFault,type AccountStore} from './backend';
async function api(test:(origin:string,calls:string[],details:Array<{method:string;args:unknown[]}>)=>Promise<void>){const calls:string[]=[],details:Array<{method:string;args:unknown[]}>=[],reserveCalls={value:0},store=new Proxy({}, {get:(_t,key)=>async(...args:unknown[])=>{calls.push(String(key));details.push({method:String(key),args});if(key==='reserveVideo')return {created:++reserveCalls.value===1,state:'reserved',seconds:60,account:{}};if(key==='unblockVideoBilling')return {unblocked:true,replayed:false,blocked:false};return {created:true,account:{},project:{}};}}) as AccountStore;const apiEmail='vistavo-files-api@vistavo-prod.iam.gserviceaccount.com',workerEmail='vistavo-runtime@vistavo-prod.iam.gserviceaccount.com',server=createServer((req,res)=>{void accountHttp(store,{verifyIdToken:async token=>{if(token==='revoked'||token==='disabled'||token==='expired'||token==='foreign')throw Error('denied');return {uid:token,email_verified:token!=='unverified'};}},'https://vistavo.app',{audience:'https://vistavo-account-api-test-1234567890-uc.a.run.app',allowedEmails:[apiEmail,workerEmail],reservationCaller:apiEmail,settlementCaller:workerEmail,verifier:{verifyIdToken:async(token,audience)=>{if(!['service','worker'].includes(token)||audience!=='https://vistavo-account-api-test-1234567890-uc.a.run.app')throw Error('denied');return {email:token==='service'?apiEmail:workerEmail,email_verified:true};}}})(req,res);});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();if(!address||typeof address==='string')throw Error();try{await test('http://127.0.0.1:'+address.port,calls,details);}finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}}
describe('account transport trust boundary',()=>{
 it('keeps attempt enrollment closed for both configured legacy services and the public user',async()=>api(async(origin,calls)=>{
  const path='/api/internal/video/billing-holds/unblock-attempts/enroll';
  const body={protocol:'fenced_v1',purpose:'unblock-enroll',scopeId:'demo-scope',cutId:'demo-cut',
   sourceOccurrenceId:'a'.repeat(64),videoAuditId:'b'.repeat(64),holdId:'c'.repeat(64),identityKey:'d'.repeat(64),
   linkGeneration:1,operatorRef:'e'.repeat(64),attemptId:'00000000-0000-4000-8000-000000000001',
   enrollmentId:'00000000-0000-4000-8000-000000000002',reviewRef:'synthetic review',authorizationSha256:'f'.repeat(64),
   accountEpoch:1,accountCreatedAtMs:10};
  const post=(token?:string)=>fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',
   ...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
  // The fixture verifier accepts these two legacy service tokens. The router must still reject the new action.
  for(const service of ['service','worker']){
   const response=await post(service);
   expect(response.status).toBe(404);
   expect(await response.json()).toEqual({error:'not_found'});
  }
  for(const token of [undefined,'good'])expect((await post(token)).status).toBe(401);
  expect(calls).toEqual([]);
 }));

 it('reads an unblock receipt only for the settlement caller and exact decision',async()=>api(async(origin,calls,details)=>{
  const identityKey='a'.repeat(64),incidentId='b'.repeat(64),reviewRef='synthetic review';
  const body={identityKey,incidentId,reviewRef},path='/api/internal/video/billing-holds/unblock-receipt';
  const post=(token:string,value:unknown,url=path,headers:Record<string,string>={})=>fetch(origin+url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...headers},body:JSON.stringify(value)});
  expect((await post('good',body)).status).toBe(401);
  expect((await post('service',body)).status).toBe(403);
  expect((await post('worker',body,path,{Origin:'https://example.invalid'})).status).toBe(404);
  expect((await post('worker',body,path+'?extra=1')).status).toBe(400);
  expect((await post('worker',{...body,epoch:1})).status).toBe(400);
  expect((await post('worker',{...body,reviewRef:'wrong\nformat'})).status).toBe(400);
  expect(calls).toEqual([]);
  expect((await post('worker',body)).status).toBe(200);
  expect(details).toEqual([{method:'videoBillingUnblockReceipt',args:[identityKey,incidentId,reviewRef]}]);
 }));
 it('permits the read-only resolution receipt only to the settlement identity',async()=>api(async(origin,calls,details)=>{
  const identityKey='a'.repeat(64),reservationId='00000000-0000-4000-8000-000000000001',path='/api/internal/video/reservations/'+reservationId+'/resolution',body={identityKey,seconds:7};
  const post=(token:string,value:unknown,url=path,headers:Record<string,string>={})=>fetch(origin+url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...headers},body:JSON.stringify(value)});
  expect((await post('good',body)).status).toBe(401);
  expect((await post('service',body)).status).toBe(403);
  expect((await post('worker',body,path,{Origin:'https://evil.invalid'})).status).toBe(404);
  expect((await post('worker',body,path+'?extra=1')).status).toBe(400);
  expect((await post('worker',{...body,accountId:'untrusted'})).status).toBe(400);
  expect((await post('worker',{...body,seconds:0})).status).toBe(400);
  expect((await post('worker',{...body,identityKey:identityKey+'\n'})).status).toBe(400);
  expect(calls).toEqual([]);
  expect((await post('worker',body)).status).toBe(200);
  expect(details).toEqual([{method:'videoReservationResolution',args:[identityKey,reservationId,7]}]);
 }));
 it('rejects missing, revoked, disabled, expired and foreign identity before any storecall',async()=>api(async(origin,calls)=>{for(const token of [null,'revoked','disabled','expired','foreign']){const r=await fetch(origin+'/api/account/me',{headers:token?{Authorization:'Bearer '+token}:{}});expect(r.status).toBe(401);}expect(calls).toEqual([]);}));
 it('rejects unverified, foreign origin, unknown query/body authority without provisioning',async()=>api(async(origin,calls)=>{const base={Authorization:'Bearer good','Content-Type':'application/json'};expect((await fetch(origin+'/api/account/me',{headers:{Authorization:'Bearer unverified'}})).status).toBe(403);expect((await fetch(origin+'/api/account/bootstrap',{method:'POST',headers:{...base,Origin:'https://evil.invalid'},body:'{}'})).status).toBe(403);expect((await fetch(origin+'/api/account/bootstrap',{method:'POST',headers:base,body:'{"uid":"other"}'})).status).toBe(400);expect((await fetch(origin+'/api/account/me?accountId=other',{headers:base})).status).toBe(400);expect(calls).toEqual([]);}));
 it('verified read stays readonly, POST provisions explicitly, no CORS and private cache',async()=>api(async(origin,calls)=>{const headers={Authorization:'Bearer good','Content-Type':'application/json'},r=await fetch(origin+'/api/account/me',{headers});expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('private, no-store');expect(r.headers.get('vary')).toBe('Authorization');expect(r.headers.get('access-control-allow-origin')).toBe(null);expect(calls).toEqual(['me']);expect((await fetch(origin+'/api/account/bootstrap',{method:'POST',headers,body:'{}'})).status).toBe(201);expect(calls).toEqual(['me','bootstrap']);}));
 it('financial/provider/upload paths and wrong methods cannot call account or private code',async()=>api(async(origin,calls)=>{for(const path of ['credit','purchase','reconcile','jobs','uploads','ai','projects/not-a-uuid'])expect((await fetch(origin+'/api/account/'+path,{method:'POST',headers:{Authorization:'Bearer good'}})).status).toBe(404);expect((await fetch(origin+'/api/account/bootstrap',{headers:{Authorization:'Bearer good'}})).status).toBe(404);expect(calls).toEqual([]);}));
 it('oversize body and duplicate cursor rejected before writes',async()=>api(async(origin,calls)=>{const headers={Authorization:'Bearer good','Content-Type':'application/json'};expect((await fetch(origin+'/api/account/bootstrap',{method:'POST',headers,body:JSON.stringify({x:'a'.repeat(400000)})})).status).toBe(413);expect((await fetch(origin+'/api/account/projects?cursor=a&cursor=b',{headers})).status).toBe(400);expect(calls).toEqual([]);}));
 it('rejects malformed UTF8 before corrupting a stored draft',async()=>api(async(origin,calls)=>{const body=Buffer.concat([Buffer.from('{"title":"bad'),Buffer.from([255]),Buffer.from('","kind":"text","content":"private"}')]);expect((await fetch(origin+'/api/account/projects',{method:'POST',headers:{Authorization:'Bearer good','Content-Type':'application/json','Idempotency-Key':'00000000-0000-4000-8000-000000000001'},body})).status).toBe(400);expect(calls).toEqual([]);}));
 it('internal balance writes require exact Google service identity and accept only reserve/capture/release shapes',async()=>api(async(origin,calls)=>{
  const body={identityKey:'a'.repeat(64),reservationId:'00000000-0000-4000-8000-000000000001',seconds:60};
  expect((await fetch(origin+'/api/internal/video/reservations',{method:'POST',headers:{Authorization:'Bearer bad','Content-Type':'application/json'},body:JSON.stringify(body)})).status).toBe(401);
  expect((await fetch(origin+'/api/internal/video/reservations',{method:'POST',headers:{Authorization:'Bearer service','Content-Type':'application/json',Origin:'https://evil.invalid'},body:JSON.stringify(body)})).status).toBe(404);
  expect((await fetch(origin+'/api/internal/video/reservations',{method:'POST',headers:{Authorization:'Bearer worker','Content-Type':'application/json'},body:JSON.stringify(body)})).status).toBe(403);
  const reserve=await fetch(origin+'/api/internal/video/reservations',{method:'POST',headers:{Authorization:'Bearer service','Content-Type':'application/json'},body:JSON.stringify(body)});expect(reserve.status).toBe(201);
  const replay=await fetch(origin+'/api/internal/video/reservations',{method:'POST',headers:{Authorization:'Bearer service','Content-Type':'application/json'},body:JSON.stringify(body)});expect(replay.status).toBe(200);expect((await replay.json()).created).toBe(false);
  expect((await fetch(origin+'/api/internal/video/balance',{method:'POST',headers:{Authorization:'Bearer worker','Content-Type':'application/json'},body:JSON.stringify({identityKey:body.identityKey})})).status).toBe(403);
  expect((await fetch(origin+'/api/internal/video/balance',{method:'POST',headers:{Authorization:'Bearer service','Content-Type':'application/json'},body:JSON.stringify({identityKey:body.identityKey})})).status).toBe(200);
  expect((await fetch(origin+'/api/internal/video/reservations/'+body.reservationId+'/status',{method:'POST',headers:{Authorization:'Bearer service','Content-Type':'application/json'},body:JSON.stringify({identityKey:body.identityKey})})).status).toBe(200);
  expect((await fetch(origin+'/api/internal/video/reservations/'+body.reservationId+'/capture',{method:'POST',headers:{Authorization:'Bearer service','Content-Type':'application/json'},body:JSON.stringify({identityKey:body.identityKey})})).status).toBe(403);
  expect((await fetch(origin+'/api/internal/video/reservations/'+body.reservationId+'/capture',{method:'POST',headers:{Authorization:'Bearer worker','Content-Type':'application/json'},body:JSON.stringify({identityKey:body.identityKey,accountId:'attacker'})})).status).toBe(400);
  expect((await fetch(origin+'/api/internal/video/reservations/'+body.reservationId+'/release',{method:'POST',headers:{Authorization:'Bearer worker','Content-Type':'application/json'},body:JSON.stringify({identityKey:body.identityKey})})).status).toBe(400);
  const release=await fetch(origin+'/api/internal/video/reservations/'+body.reservationId+'/release',{method:'POST',headers:{Authorization:'Bearer worker','Content-Type':'application/json'},body:JSON.stringify({identityKey:body.identityKey,seconds:60})});expect(release.status).toBe(200);
  expect(calls).toEqual(['reserveVideo','reserveVideo','videoBalance','videoReservation','settleVideo']);
 }));
 it('limits holds, admission and sealing to trusted services and requires the exact capture tuple',async()=>api(async(origin,calls,details)=>{
  const identityKey='a'.repeat(64),reservationId='00000000-0000-4000-8000-000000000001',jobId='00000000-0000-4000-8000-000000000002',attemptId='00000000-0000-4000-8000-000000000003',incidentId='b'.repeat(64);
  const post=(path:string,token:string,body:unknown,headers:Record<string,string>={})=>fetch(origin+'/api/internal/video/'+path,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  const hold={identityKey,incidentId},base={identityKey,seconds:60},full={...base,jobId,attemptId},call={...full,callKey:'text-window:0000',model:'gemini-3.8-flash',requestSha256:'c'.repeat(64)},path='reservations/'+reservationId+'/';
  expect((await post('billing-holds','good',hold)).status).toBe(401);
  expect((await post('billing-holds','service',hold,{Origin:'https://evil.invalid'})).status).toBe(404);
  expect((await post('billing-holds','service',hold)).status).toBe(403);
  expect((await post('billing-holds','worker',{...hold,blocked:false})).status).toBe(400);
  expect((await post('billing-holds','worker',{...hold,incidentId:'bad'})).status).toBe(400);
  expect((await post('billing-holds','worker',{...hold,identityKey:identityKey+'\n'})).status).toBe(400);
  expect((await fetch(origin+'/api/internal/video/billing-holds',{headers:{Authorization:'Bearer worker'}})).status).toBe(404);
  expect((await post(path+'admit','service',call)).status).toBe(403);
  expect((await post(path+'seal','service',base)).status).toBe(403);
  expect((await post(path+'capture','worker',base)).status).toBe(400);
  expect((await post(path+'admit','worker',{...call,attemptId:'bad'})).status).toBe(400);
  expect((await post(path+'admit','worker',full)).status).toBe(400);
  expect((await post(path+'admit','worker',{...call,callKey:call.callKey+'\n'})).status).toBe(400);
  expect((await post(path+'admit','worker',{...call,model:'gemini-3.8-flash-tts'})).status).toBe(400);
  expect((await post(path+'admit','worker',{...call,requestSha256:'bad'})).status).toBe(400);
  expect((await post(path+'admit','worker',{...call,requestSha256:call.requestSha256+'\n'})).status).toBe(400);
  expect((await post(path+'release','worker',{...base,jobId})).status).toBe(400);
  expect((await post(path+'seal?other=1','worker',base)).status).toBe(400);
  expect(calls).toEqual([]);
  expect((await post('billing-holds','worker',hold)).status).toBe(201);
  expect((await post('billing-holds/status','service',hold)).status).toBe(200);
  expect((await post(path+'seal','worker',base)).status).toBe(201);
  expect((await post(path+'admit','worker',call)).status).toBe(201);
  expect((await post(path+'capture','worker',full)).status).toBe(200);
  expect(calls).toEqual(['blockVideoBilling','videoBillingHold','sealVideoReservation','admitVideoCall','settleVideo']);
  expect(details[3].args).toEqual([identityKey,reservationId,60,jobId,attemptId,call.callKey,call.model,call.requestSha256]);
  expect(details[4].args).toEqual([identityKey,reservationId,'capture',60,{jobId,attemptId}]);
 }));
 it('opens the audited unblock only to the settlement caller with an exact body (LV-019.B 1.4b)',async()=>api(async(origin,calls,details)=>{
  const identityKey='a'.repeat(64),incidentId='b'.repeat(64),reviewRef='review-ref-1',body={identityKey,incidentId,epoch:2,createdAtMs:1_800_000_000_000,reviewRef};
  const post=(token:string,value:unknown,headers:Record<string,string>={})=>fetch(origin+'/api/internal/video/billing-holds/unblock',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...headers},body:JSON.stringify(value)});
  expect((await post('good',body)).status).toBe(401);
  expect((await post('service',body,{Origin:'https://evil.invalid'})).status).toBe(404);
  // 4(b): the reservation caller is refused even with a perfectly valid body, and the store is never reached.
  expect((await post('service',body)).status).toBe(403);
  expect((await fetch(origin+'/api/internal/video/billing-holds/unblock',{headers:{Authorization:'Bearer worker'}})).status).toBe(404);
  expect((await post('worker',{...body,extra:'x'})).status).toBe(400);
  expect((await post('worker',{...body,identityKey:identityKey+'\n'})).status).toBe(400);
  expect((await post('worker',{...body,incidentId:'bad'})).status).toBe(400);
  for(const bad of [0,-1,1.5,'2',null])expect((await post('worker',{...body,epoch:bad})).status).toBe(400);
  for(const bad of [-1,1.5,'0',null])expect((await post('worker',{...body,createdAtMs:bad})).status).toBe(400);
  for(const bad of [undefined,'',null,'x'.repeat(201),'bad\nchar','bad\u0000char','bad\u001fchar','bad\u007fchar'])expect((await post('worker',{...body,reviewRef:bad})).status).toBe(400);
  expect((await post('worker',body,{'Content-Type':'text/plain'})).status).toBe(415);
  expect((await fetch(origin+'/api/internal/video/billing-holds/unblock?extra=1',{method:'POST',headers:{Authorization:'Bearer worker','Content-Type':'application/json'},body:JSON.stringify(body)})).status).toBe(400);
  expect(calls).toEqual([]);
  const ok=await post('worker',body);
  expect(ok.status).toBe(200);
  // 4(a): the response body is exactly the store receipt, not a reshaped one.
  expect(await ok.json()).toEqual({unblocked:true,replayed:false,blocked:false});
  expect(calls).toEqual(['unblockVideoBilling']);
  expect(details[0].args).toEqual([identityKey,{incidentId,epoch:2,createdAtMs:1_800_000_000_000,reviewRef}]);
 }));
 it('accepts a partial capture and a release after admission only with exact fields and complete pairs (LV-019.B C2a)',async()=>api(async(origin,calls,details)=>{
  const identityKey='a'.repeat(64),reservationId='00000000-0000-4000-8000-000000000001',jobId='00000000-0000-4000-8000-000000000002',attemptId='00000000-0000-4000-8000-000000000003',path='/api/internal/video/reservations/'+reservationId+'/';
  const post=(action:string,token:string,body:unknown)=>fetch(origin+path+action,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const full={identityKey,seconds:60,jobId,attemptId},proof={resolutionKind:'no_speech',evidenceSha256:'d'.repeat(64)},release={identityKey,seconds:60,jobId,attemptId,...proof};
  expect((await post('capture','service',{...full,capturedSeconds:25})).status).toBe(403);
  expect((await post('release','service',release)).status).toBe(403);
  for(const bad of [0,60,61,-1,1.5,'5',null,true,[]])expect((await post('capture','worker',{...full,capturedSeconds:bad})).status).toBe(400);
  expect((await post('capture','worker',{...full,resolutionKind:'no_speech'})).status).toBe(400);
  expect((await post('capture','worker',{...full,evidenceSha256:proof.evidenceSha256})).status).toBe(400);
  for(const missing of ['jobId','attemptId','resolutionKind','evidenceSha256']){const body:Record<string,unknown>={...release};delete body[missing];expect((await post('release','worker',body)).status).toBe(400);}
  expect((await post('release','worker',{identityKey,seconds:60,...proof})).status).toBe(400); // resolution without admission
  expect((await post('release','worker',{...release,resolutionKind:'refunded'})).status).toBe(400);
  expect((await post('release','worker',{...release,evidenceSha256:'D'.repeat(64)})).status).toBe(400);
  expect((await post('release','worker',{...release,evidenceSha256:'d'.repeat(63)})).status).toBe(400);
  expect((await post('release','worker',{...release,jobId:'bad'})).status).toBe(400);
  expect((await post('release','worker',{...release,capturedSeconds:5})).status).toBe(400);
  expect((await post('release','worker',{...release,extra:1})).status).toBe(400);
  expect((await post('resolution','worker',{identityKey,seconds:60,capturedSeconds:5})).status).toBe(400);
  expect(calls).toEqual([]);
  expect((await post('capture','worker',{...full,capturedSeconds:25})).status).toBe(200);
  expect((await post('release','worker',release)).status).toBe(200);
  expect((await post('capture','worker',full)).status).toBe(200);
  expect((await post('release','worker',{identityKey,seconds:60})).status).toBe(200);
  expect(calls).toEqual(['settleVideo','settleVideo','settleVideo','settleVideo']);
  expect(details[0].args).toEqual([identityKey,reservationId,'capture',60,{jobId,attemptId},{capturedSeconds:25}]);
  expect(details[1].args).toEqual([identityKey,reservationId,'release',60,{jobId,attemptId},{resolution:{kind:'no_speech',evidenceSha256:proof.evidenceSha256}}]);
  expect(details[2].args).toEqual([identityKey,reservationId,'capture',60,{jobId,attemptId}]);
  expect(details[3].args).toEqual([identityKey,reservationId,'release',60,undefined]);
 }));
 it('maps the too_early refusal to its own 409 error and keeps conflict distinct',async()=>{
  const apiEmail='vistavo-files-api@vistavo-prod.iam.gserviceaccount.com',workerEmail='vistavo-runtime@vistavo-prod.iam.gserviceaccount.com',code={value:'too_early' as 'too_early'|'conflict'};
  const store=new Proxy({}, {get:()=>async()=>{throw new AccountFault(code.value);}}) as AccountStore;
  const server=createServer((req,res)=>{void accountHttp(store,{verifyIdToken:async()=>({uid:'unused',email_verified:true})},'https://vistavo.app',{audience:'https://vistavo-account-api-test-1234567890-uc.a.run.app',allowedEmails:[apiEmail,workerEmail],reservationCaller:apiEmail,settlementCaller:workerEmail,verifier:{verifyIdToken:async()=>({email:workerEmail,email_verified:true})}})(req,res);});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();if(!address||typeof address==='string')throw Error();
  try{
   const body={identityKey:'a'.repeat(64),seconds:60,jobId:'00000000-0000-4000-8000-000000000002',attemptId:'00000000-0000-4000-8000-000000000003',resolutionKind:'unknown_expired',evidenceSha256:'d'.repeat(64)};
   const send=()=>fetch('http://127.0.0.1:'+address.port+'/api/internal/video/reservations/00000000-0000-4000-8000-000000000001/release',{method:'POST',headers:{Authorization:'Bearer worker','Content-Type':'application/json'},body:JSON.stringify(body)});
   const early=await send();expect(early.status).toBe(409);expect(await early.json()).toEqual({error:'too_early'});
   code.value='conflict';const conflict=await send();expect(conflict.status).toBe(409);expect(await conflict.json()).toEqual({error:'conflict'});
  }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
 });
 it('rejects a verified service identity outside the internal allowlist before reading a hold',async()=>{
  let storeCalls=0;const store=new Proxy({}, {get:()=>async()=>{storeCalls++;return {};}}) as AccountStore;
  const apiEmail='vistavo-files-api@vistavo-prod.iam.gserviceaccount.com',workerEmail='vistavo-runtime@vistavo-prod.iam.gserviceaccount.com';
  const handler=accountHttp(store,{verifyIdToken:async()=>({uid:'unused',email_verified:true})},'https://vistavo.app',{audience:'https://vistavo-account-api-test-1234567890-uc.a.run.app',allowedEmails:[apiEmail,workerEmail],reservationCaller:apiEmail,settlementCaller:workerEmail,verifier:{verifyIdToken:async()=>({email:'untrusted@vistavo-prod.iam.gserviceaccount.com',email_verified:true})}});
  const server=createServer((req,res)=>{void handler(req,res);});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();if(!address||typeof address==='string')throw Error();
  try{const response=await fetch('http://127.0.0.1:'+address.port+'/api/internal/video/billing-holds/status',{method:'POST',headers:{Authorization:'Bearer valid-service','Content-Type':'application/json'},body:JSON.stringify({identityKey:'a'.repeat(64),incidentId:'b'.repeat(64)})});expect(response.status).toBe(403);expect(storeCalls).toBe(0);}
  finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
 });
 it('fails closed for inherited emulator/credential or wrong production DB before SDK init',()=>{const good={VISTAVO_ACCOUNT_MODE:'production',VISTAVO_PROJECT_ID:'vistavo-prod',VISTAVO_ACCOUNT_DATABASE:'vistavo-live'};expect(()=>validateAccountEnvironment(good)).not.toThrow();for(const extra of [{VISTAVO_ACCOUNT_DATABASE:'(default)'},{VISTAVO_PROJECT_ID:'other'},{GOOGLE_APPLICATION_CREDENTIALS:'credential.json'},{FIRESTORE_EMULATOR_HOST:'127.0.0.1:8185'},{FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099'}])expect(()=>validateAccountEnvironment({...good,...extra})).toThrow();});
 it('pins OIDC audience to this Cloud Run service and rejects non-service token claims',()=>{const aud='https://vistavo-account-api-test-1234567890-uc.a.run.app';expect(validateAccountOidcAudience(aud)).toBe(aud);for(const bad of ['https://example.run.app','http://vistavo-account-api-test-1234567890-uc.a.run.app','https://vistavo-account-api-test-1234567890-uc.a.run.app/','not-a-url'])expect(()=>validateAccountOidcAudience(bad)).toThrow();const email='vistavo-files-api@vistavo-prod.iam.gserviceaccount.com';expect(trustedServiceClaims({sub:'123456789012345678901',email,email_verified:true},[email])).toMatchObject({email,email_verified:true});for(const payload of [{email,email_verified:true},{sub:'123456789012345678901',email,email_verified:false},{sub:'123456789012345678901',email:'user@example.com',email_verified:true}])expect(()=>trustedServiceClaims(payload,[email])).toThrow();});
 it('requires actual permission denial, never accepts candidate read or transient failure as isolation',async()=>{const named={doc:()=>({get:async()=>({data:()=>({service:'vistavo-account',environment:'production',schemaVersion:1,unit:'video_seconds'})})})} as any;const other=(code?:number)=>({doc:()=>({get:async()=>{if(code)throw {code};return {};}})}) as any;await expect(verifyDatabaseBoundary(named,other(7))).resolves.toEqual({productionDatabaseRead:true,candidateDatabaseDenied:true});await expect(verifyDatabaseBoundary(named,other())).rejects.toThrow('must not access');for(const code of [3,4,14])await expect(verifyDatabaseBoundary(named,other(code))).rejects.toThrow('inconclusive');});
});
