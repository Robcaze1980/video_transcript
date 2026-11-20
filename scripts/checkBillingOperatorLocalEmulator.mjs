// Diagnostic only: the operator endpoint (piece D) mounted on its LOCAL-ONLY server, started through the real start path
// (`startBillingOperatorLocal`) with the real firebase-admin Auth verifier (revocation check included) against LOCAL Auth and
// Firestore emulators. Synthetic users only, no credentials; refuses anything but loopback emulators and a demo-* project;
// touches only its own random root under `operator-local/` and its own Auth users; prints no env values, tokens or identities.
// Usage: FIRESTORE_EMULATOR_HOST=127.0.0.1:<port> FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:<port> GCLOUD_PROJECT=demo-... VISTAVO_OPERATOR_LOCAL=1 node --import tsx scripts/checkBillingOperatorLocalEmulator.mjs
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer,request} from 'node:http';
import {connect} from 'node:net';
import {initializeApp,deleteApp,getApps} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {Firestore} from 'firebase-admin/firestore';
import {readPendingReport} from '../server/commercial/billingPendingReport.ts';
import {alertKey,raisePendingAlerts} from '../server/commercial/billingPendingAlerts.ts';
import {AUDIT_COLLECTION} from '../server/commercial/billingPendingAudit.ts';
import {operatorPseudonym} from '../server/commercial/billingOperatorHttp.ts';
import {startBillingOperatorLocal} from '../server/commercial/billingOperatorLocal.ts';

const fsHost=process.env.FIRESTORE_EMULATOR_HOST,authHost=process.env.FIREBASE_AUTH_EMULATOR_HOST,project=process.env.GCLOUD_PROJECT;
assert.match(fsHost??'',/^127\.0\.0\.1:\d{2,5}$/,'Loopback Firestore emulator required');assert.match(authHost??'',/^127\.0\.0\.1:\d{2,5}$/,'Loopback Auth emulator required');
assert.match(project??'',/^demo-[a-z0-9-]+$/,'demo-* project required');
for(const key of ['GOOGLE_APPLICATION_CREDENTIALS','GEMINI_API_KEY','OPENROUTER_API_KEY','K_SERVICE'])assert.ok(process.env[key]===undefined,'Unexpected variable set: '+key);

const run=randomUUID().slice(0,8),rootPath='operator-local/chk-'+run,SECRET='local-check-secret-not-real-'+randomUUID().replace(/-/g,'');
const password=randomUUID(),sleep=ms=>new Promise(r=>setTimeout(r,ms));
Object.assign(process.env,{VISTAVO_OPERATOR_ROOT:rootPath,VISTAVO_OPERATOR_PORT:'0',VISTAVO_OPERATOR_SECRET:SECRET,VISTAVO_OPERATOR_REAUTH_SEC:'4',VISTAVO_OPERATOR_RATE_MAX:'3',VISTAVO_OPERATOR_RATE_WINDOW_SEC:'60'});
const users={owner:{uid:'chk-owner-'+run,verified:true},unverified:{uid:'chk-unverified-'+run,verified:false},stranger:{uid:'chk-stranger-'+run,verified:true},revoked:{uid:'chk-revoked-'+run,verified:true},disabled:{uid:'chk-disabled-'+run,verified:true}};
process.env.VISTAVO_OPERATOR_UIDS=['owner','unverified','revoked','disabled'].map(k=>users[k].uid).join(',');

const adminApp=initializeApp({projectId:project},'check-admin-'+run),auth=getAuth(adminApp),db=new Firestore({projectId:project}),root=db.doc(rootPath);
const emailOf=k=>`${k}.${run}@example.test`;
const logs=[],realLog=console.log;let started,second;
const tokens={};const results={};
const signIn=async k=>{
  const r=await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-key`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:emailOf(k),password,returnSecureToken:true})});
  const j=await r.json();assert.equal(r.status,200,'sign-in against the Auth emulator');return j.idToken;
};
const call=async(port,method,path,token,body)=>{
  const headers={};if(token)headers.authorization='Bearer '+token;if(body!==undefined)headers['content-type']='application/json';
  const r=await fetch(`http://127.0.0.1:${port}${path}`,{method,headers,body:body!==undefined?JSON.stringify(body):undefined});const text=await r.text();let json={};try{json=JSON.parse(text);}catch{}return {status:r.status,json,text};
};
const withHost=(port,host)=>new Promise((resolve,reject)=>{const req=request({host:'127.0.0.1',port,path:'/api/operator/billing-alerts',method:'GET',headers:{host}},res=>{let t='';res.on('data',c=>t+=c);res.on('end',()=>resolve({status:res.statusCode,text:t}));});req.on('error',reject);req.end();});
const LIST='/api/operator/billing-alerts';
try{
  for(const [k,u] of Object.entries(users))await auth.createUser({uid:u.uid,email:emailOf(k),emailVerified:u.verified,password});
  const NOW=Date.now(),account='22222222-2222-4222-8222-222222222222';
  await root.collection('accounts').doc(account).set({available:100,reserved:5});
  for(const id of ['h1','h2'])await root.collection('billingHoldOutbox').doc(id).set({state:'needs_review',createdAtMs:NOW-5000,accountId:account});
  await raisePendingAlerts(db,root,await readPendingReport(root,NOW,{audit:true}),NOW);
  const k1=alertKey('hold','h1','needs_review','needs_review'),k2=alertKey('hold','h2','needs_review','needs_review');
  for(const k of Object.keys(users))tokens[k]=await signIn(k);

  console.log=(...a)=>{logs.push(a.join(' '));};
  started=await startBillingOperatorLocal(); // console.log stays captured: it is the server's access log (restored in `finally`)
  assert.equal(started.enabled,true);assert.equal(started.writesEnabled,true);assert.deepEqual(started.missing,[]);
  assert.equal(started.server.address().address,'127.0.0.1','listens on loopback only');
  const port=started.port;

  // 1. Identity with the real verifier.
  assert.equal((await call(port,'GET',LIST)).status,401);
  assert.equal((await call(port,'GET',LIST,'not.a.token')).status,401);
  assert.equal((await call(port,'GET',LIST,tokens.unverified)).status,401,'unverified e-mail');
  assert.equal((await call(port,'GET',LIST,tokens.stranger)).status,404,'verified user outside the operator list');
  const list=await call(port,'GET',LIST,tokens.owner);assert.equal(list.status,200);assert.equal(list.json.alerts.length,2);assert.equal(list.json.truncated,false);
  // 2. Writes: one resolve, an idempotent replay, one acknowledge, then the per-operator limit from the environment.
  const first=await call(port,'POST',`${LIST}/${k1}/resolve`,tokens.owner,{evidenceRef:'ev-chk-1'});assert.equal(first.status,201);
  const replay=await call(port,'POST',`${LIST}/${k1}/resolve`,tokens.owner,{evidenceRef:'ev-chk-1'});assert.equal(replay.status,200);assert.equal(replay.json.replayed,true);
  const ack=await call(port,'POST',`${LIST}/${k2}/acknowledge`,tokens.owner,{});assert.equal(ack.status,201);
  const limited=await call(port,'POST',`${LIST}/${k2}/acknowledge`,tokens.owner,{});assert.equal(limited.status,429,'fourth write inside the window');
  const records=(await root.collection(AUDIT_COLLECTION).get()).docs.map(d=>d.data());
  assert.equal(records.length,2,'exactly the resolve and the acknowledge');
  assert.ok(records.every(r=>r.authorizedBy===operatorPseudonym(SECRET,users.owner.uid)),'author derived by the server from the verified uid');
  // 3. Real revocation and disabling are caught by the revocation check.
  await sleep(1300);await auth.revokeRefreshTokens(users.revoked.uid);
  assert.equal((await call(port,'GET',LIST,tokens.revoked)).status,401,'revoked refresh tokens');
  await auth.updateUser(users.disabled.uid,{disabled:true});
  assert.equal((await call(port,'GET',LIST,tokens.disabled)).status,401,'disabled user');
  // 4. Freshness: the same token reads but no longer writes once the reauthentication window has passed.
  await sleep(4000);
  const stale=await call(port,'POST',`${LIST}/${k2}/acknowledge`,tokens.owner,{});assert.equal(stale.status,401);assert.equal(stale.json.code,'reauth_required');
  assert.equal((await call(port,'GET',LIST,tokens.owner)).status,200,'reads do not need fresh authentication');
  // 5. The server refuses what is not the loopback address, and everything else is 404.
  for(const host of ['evil.example.com','localhost','127.0.0.1']){const r=await withHost(port,host);assert.equal(r.status,403);}
  for(const p of ['/','/api/cloud/config','/healthz','/api/operator/other']){const r=await call(port,'GET',p,tokens.owner);assert.equal(r.status,404);}
  // 6. Nothing but alerts and audit records changed; no identities, tokens or secrets in responses or in the access log.
  assert.deepEqual((await root.collection('accounts').doc(account).get()).data(),{available:100,reserved:5});
  for(const id of ['h1','h2'])assert.equal((await root.collection('billingHoldOutbox').doc(id).get()).data().state,'needs_review');
  assert.equal((await root.collection(AUDIT_COLLECTION).get()).size,2,'the refused and stale writes added nothing');
  const everything=JSON.stringify([list.text,first.text,replay.text,ack.text,limited.text,stale.text,logs]);
  for(const secret of [SECRET,password,...Object.values(tokens),...Object.values(users).map(u=>u.uid),...Object.keys(users).map(emailOf),'ev-chk-1','Bearer'])assert.ok(!everything.includes(secret),'no secret, token, identity or evidence in responses or logs');
  assert.ok(logs.length>=10,'the access log recorded the attempts');
  results.logged=logs.length;
  // 7. The same start path with an incomplete configuration: the owner's valid token gets 404 on every route.
  await started.close();started=undefined;
  const keep=process.env.VISTAVO_OPERATOR_UIDS;delete process.env.VISTAVO_OPERATOR_UIDS;
  second=await startBillingOperatorLocal();process.env.VISTAVO_OPERATOR_UIDS=keep;
  assert.equal(second.enabled,false);assert.ok(second.missing.includes('VISTAVO_OPERATOR_UIDS'));
  assert.equal((await call(second.port,'GET',LIST,await signIn('owner'))).status,404);
  assert.equal((await call(second.port,'POST',`${LIST}/${k1}/resolve`,await signIn('owner'),{evidenceRef:'x'})).status,404);
  assert.equal((await root.collection(AUDIT_COLLECTION).get()).size,2,'a disabled server wrote nothing');
  results.disabledMissing=second.missing;
  await second.close();second=undefined;
  // 8. A start that fails (port already taken) rejects with the real error, releases its Firebase resources, and the process can start again.
  const taken=createServer();await new Promise(r=>taken.listen(0,'127.0.0.1',r));
  process.env.VISTAVO_OPERATOR_PORT=String(taken.address().port);
  await assert.rejects(startBillingOperatorLocal(),e=>e?.code==='EADDRINUSE');
  await new Promise(r=>taken.close(r));process.env.VISTAVO_OPERATOR_PORT='0';
  const again=await startBillingOperatorLocal();assert.equal((await call(again.port,'GET','/',undefined)).status,404);await again.close();
  results.failedStart='EADDRINUSE';
  // 9. close() is idempotent, and a request stuck in flight (body never finished) cannot keep the server, Firestore or the app from being released.
  const stuck=await startBillingOperatorLocal(),stuckToken=await signIn('owner');
  const socket=connect(stuck.port,'127.0.0.1');await new Promise(r=>socket.once('connect',r));socket.on('error',()=>undefined);
  socket.write([`POST ${LIST}/${k2}/acknowledge HTTP/1.1`,`Host: 127.0.0.1:${stuck.port}`,`Authorization: Bearer ${stuckToken}`,'Content-Type: application/json','Content-Length: 50','','{"ev'].join('\r\n'));
  await sleep(500); // identity is verified and the handler is now waiting for the rest of the body
  const closeOnce=stuck.close(),closeTwice=stuck.close();assert.strictEqual(closeOnce,closeTwice,'close is idempotent');
  await Promise.race([closeOnce,new Promise((_,fail)=>setTimeout(()=>fail(new Error('close() hung on a request in flight')),4000))]);
  socket.destroy();results.closeWithStuckClient='ok';
  // 10. A failing release is reported, not swallowed: the app is deleted out from under a running server, then closed.
  const broken=await startBillingOperatorLocal();
  const orphan=getApps().find(a=>a.name.startsWith('operator-local-'));assert.ok(orphan,'the server app exists');
  await deleteApp(orphan);
  await assert.rejects(broken.close(),e=>e instanceof AggregateError&&e.message==='Release failed');
  results.releaseFailureReported=true;
  // 11. Closing the underlying server directly first does not stop close() from releasing everything (Node answers a stopped
  // server through the callback, it does not throw), and no server app is left registered anywhere in this run.
  const third=await startBillingOperatorLocal();
  await new Promise(r=>third.server.close(()=>r()));
  await third.close();
  assert.equal(getApps().filter(a=>a.name.startsWith('operator-local-')).length,0,'every server app was released');
  results.directServerCloseThenClose='ok';
}finally{
  console.log=realLog;
  for(const s of [started,second])if(s)await s.close().catch(()=>undefined);
  for(const col of await root.listCollections()){const refs=await col.listDocuments();for(let i=0;i<refs.length;i+=100){const b=db.batch();for(const r of refs.slice(i,i+100))b.delete(r);await b.commit();}}
  const left=await Promise.all((await root.listCollections()).map(c=>c.listDocuments()));
  for(const u of Object.values(users))await auth.deleteUser(u.uid).catch(()=>undefined);
  await db.terminate();await deleteApp(adminApp);
  assert.equal(left.flat().length,0,'cleanup must leave nothing behind');
}
console.log(JSON.stringify({ok:true,...results,cleanup:'verified'}));
