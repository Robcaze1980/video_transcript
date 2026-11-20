// Diagnostic only: the operator endpoint (piece D) behind a real local HTTP server against a LOCAL Firestore emulator,
// with a fake token verifier (no Firebase, no credentials). Refuses anything but a loopback emulator and a demo-* project;
// touches only its own random root document; prints no env values.
// Usage: FIRESTORE_EMULATOR_HOST=127.0.0.1:<port> GCLOUD_PROJECT=demo-... node --import tsx scripts/checkBillingOperatorHttpEmulator.mjs
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {Firestore} from 'firebase-admin/firestore';
import {buildPendingReport,readPendingReport} from '../server/commercial/billingPendingReport.ts';
import {alertKey,raisePendingAlerts} from '../server/commercial/billingPendingAlerts.ts';
import {AUDIT_COLLECTION} from '../server/commercial/billingPendingAudit.ts';
import {billingOperatorHttp,operatorPseudonym} from '../server/commercial/billingOperatorHttp.ts';

const host=process.env.FIRESTORE_EMULATOR_HOST,project=process.env.GCLOUD_PROJECT;
assert.match(host??'',/^127\.0\.0\.1:\d{2,5}$/,'Loopback emulator required');assert.match(project??'',/^demo-[a-z0-9-]+$/,'demo-* project required');
for(const key of ['GOOGLE_APPLICATION_CREDENTIALS','GEMINI_API_KEY','OPENROUTER_API_KEY','K_SERVICE'])assert.ok(process.env[key]===undefined,'Unexpected variable set: '+key);
const db=new Firestore({projectId:project});
const root=db.collection('operator_http_check').doc(randomUUID());
const NOW=Date.now(),SECRET='check-secret-not-real-0123456789abcdef',logs=[];
const tokens={a:{uid:'op-a',email_verified:true,auth_time:Math.floor(NOW/1000)-5},b:{uid:'op-b',email_verified:true,auth_time:Math.floor(NOW/1000)-5},x:{uid:'nobody',email_verified:true,auth_time:Math.floor(NOW/1000)-5}};
const handler=billingOperatorHttp({db,root,operators:new Set(['op-a','op-b']),secret:SECRET,reauthWindowSec:300,limiter:()=>true,now:()=>Date.now(),log:e=>logs.push(e),
  verifier:{verifyIdToken:async t=>{if(!tokens[t])throw new Error('bad');return {...tokens[t],auth_time:Math.floor(Date.now()/1000)-5};}}});
const server=createServer((req,res)=>{handler(req,res).then(done=>{if(!done){res.writeHead(418);res.end();}},()=>{res.writeHead(500);res.end();});});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const call=async(method,path,token,body)=>{const r=await fetch(base+path,{method,headers:{...(token?{authorization:'Bearer '+token}:{}),...(body!==undefined?{'content-type':'application/json'}:{})},body:body!==undefined?JSON.stringify(body):undefined});const t=await r.text();let j={};try{j=JSON.parse(t);}catch{}return {status:r.status,json:j,text:t};};
const results={};
try{
  const account='11111111-1111-4111-8111-111111111111';
  await root.collection('accounts').doc(account).set({available:100,reserved:5});
  for(const id of ['h1','h2'])await root.collection('billingHoldOutbox').doc(id).set({state:'needs_review',createdAtMs:NOW-5000,accountId:account});
  await raisePendingAlerts(db,root,await readPendingReport(root,NOW,{audit:true}),NOW);
  const k1=alertKey('hold','h1','needs_review','needs_review'),k2=alertKey('hold','h2','needs_review','needs_review');
  // 1. Real HTTP + real Firestore: list, then operators racing on the same alert.
  const list=await call('GET','/api/operator/billing-alerts','a');assert.equal(list.status,200);assert.equal(list.json.alerts.length,2);
  const race=await Promise.all([call('POST',`/api/operator/billing-alerts/${k1}/resolve`,'a',{evidenceRef:'ev-a'}),call('POST',`/api/operator/billing-alerts/${k1}/resolve`,'b',{evidenceRef:'ev-b'}),
    call('POST',`/api/operator/billing-alerts/${k1}/resolve`,'a',{evidenceRef:'ev-a'}),call('POST',`/api/operator/billing-alerts/${k1}/resolve`,'b',{evidenceRef:'ev-b'})]);
  const wins=race.filter(r=>r.status===201);assert.equal(wins.length,1,'exactly one disposition is created');
  assert.ok(race.every(r=>[200,201,409].includes(r.status)||r.status===500),'only create, replay, conflict (or a loud abort)');
  const audits=(await root.collection(AUDIT_COLLECTION).get()).docs.map(d=>d.data());assert.equal(audits.length,1,'one audit record');
  assert.ok([operatorPseudonym(SECRET,'op-a'),operatorPseudonym(SECRET,'op-b')].includes(audits[0].authorizedBy));
  // 1b. Paging against the real emulator: 200 per page, an exact cursor, no duplicates and no gaps.
  for(let i=0;i<204;i++)await root.collection('billingHoldOutbox').doc('p'+String(i).padStart(4,'0')).set({state:'needs_review',createdAtMs:NOW-4000+i,accountId:account});
  await raisePendingAlerts(db,root,await readPendingReport(root,NOW,{audit:true}),NOW);
  const page1=await call('GET','/api/operator/billing-alerts','a');
  assert.equal(page1.status,200);assert.equal(page1.json.alerts.length,200);assert.equal(page1.json.truncated,true);assert.match(page1.json.next,/^[a-f0-9]{64}$/);
  const page2=await call('GET','/api/operator/billing-alerts?after='+page1.json.next,'a');
  assert.equal(page2.status,200);assert.equal(page2.json.truncated,false);assert.equal(page2.json.next,null);
  const keys=new Set([...page1.json.alerts,...page2.json.alerts].map(x=>x.alertKey));
  assert.equal(keys.size,page1.json.alerts.length+page2.json.alerts.length,'no duplicates across pages');
  assert.equal(keys.size,206-1,'every open alert exactly once (the resolved one is not open)');
  // 2. Negative branches change nothing.
  const before=(await root.collection(AUDIT_COLLECTION).get()).size;
  const negatives=[await call('POST',`/api/operator/billing-alerts/${k2}/resolve`,undefined,{evidenceRef:'e'}),await call('POST',`/api/operator/billing-alerts/${k2}/resolve`,'zzz',{evidenceRef:'e'}),
    await call('POST',`/api/operator/billing-alerts/${k2}/resolve`,'x',{evidenceRef:'e'}),await call('POST',`/api/operator/billing-alerts/${k2}/resolve`,'a',{evidenceRef:'e',authorizedBy:'someone'}),
    await call('POST',`/api/operator/billing-alerts/${k2}/resolve`,'a',{evidenceRef:''}),await call('GET','/api/other','a')];
  assert.deepEqual(negatives.map(r=>r.status),[401,401,404,400,400,418]);
  assert.equal((await root.collection(AUDIT_COLLECTION).get()).size,before,'negative branches wrote nothing');
  // 3. Rows and balances are untouched; responses and logs carry no identity or secrets.
  assert.deepEqual((await root.collection('accounts').doc(account).get()).data(),{available:100,reserved:5});
  for(const id of ['h1','h2'])assert.equal((await root.collection('billingHoldOutbox').doc(id).get()).data().state,'needs_review');
  assert.ok(![...race,...negatives,list].some(r=>/op-a|op-b|nobody|accountId|11111111-1111-4111/.test(r.text)),'no identity in responses');
  assert.ok(!/ev-a|ev-b|Bearer|op-a|op-b|nobody/.test(JSON.stringify(logs)),'no secrets in the access log');
  results.logged=logs.length;results.raceStatuses=race.map(r=>r.status).sort();
}finally{
  await new Promise(r=>server.close(r));
  const cols=await root.listCollections();
  for(const col of cols){const refs=await col.listDocuments();for(let i=0;i<refs.length;i+=100){const b=db.batch();for(const r of refs.slice(i,i+100))b.delete(r);await b.commit();}}
  const left=await Promise.all((await root.listCollections()).map(c=>c.listDocuments()));
  assert.equal(left.flat().length,0,'cleanup must leave nothing behind');
}
console.log(JSON.stringify({ok:true,...results,cleanup:'verified'}));
