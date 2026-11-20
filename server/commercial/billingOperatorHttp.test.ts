// LV-019.B piece D: operator endpoint (design: docs/specs/LV-019-B-conciliacion-endpoint-d-diseno.md).
// Real in-process HTTP server + in-memory Firestore stub. The handler is mounted only by the local-only server
// (billingOperatorLocal.ts); it is disabled unless every piece of configuration is present. Every negative branch must leave zero audit records and zero writes.
import {createServer,type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {afterEach,describe,expect,it} from 'vitest';
import {buildPendingReport,type PendingRow} from './billingPendingReport';
import {ALERT_COLLECTION,alertKey,raisePendingAlerts} from './billingPendingAlerts';
import {AUDIT_COLLECTION,auditId} from './billingPendingAudit';
import {billingOperatorHttp,operatorPseudonym,type OperatorHttpConfig} from './billingOperatorHttp';
import {stub} from './billingFirestoreStub';

const NOW=2_000_000_000_000,NOW_SEC=Math.floor(NOW/1000),WINDOW=300,SECRET='test-secret-not-real-1234567890abcdef';
const KEY=alertKey('hold','h1','needs_review','needs_review');
const tokens:Record<string,{uid:string;email_verified?:boolean;auth_time?:number}|Error>={
  owner:{uid:'uid-owner',email_verified:true,auth_time:NOW_SEC-10},second:{uid:'uid-second',email_verified:true,auth_time:NOW_SEC-10},
  stranger:{uid:'uid-stranger',email_verified:true,auth_time:NOW_SEC-10},unverified:{uid:'uid-owner',email_verified:false,auth_time:NOW_SEC-10},
  stale:{uid:'uid-owner',email_verified:true,auth_time:NOW_SEC-WINDOW-1},future:{uid:'uid-owner',email_verified:true,auth_time:NOW_SEC+5},
  noauth:{uid:'uid-owner',email_verified:true},nan:{uid:'uid-owner',email_verified:true,auth_time:Number.NaN},fractional:{uid:'uid-owner',email_verified:true,auth_time:NOW_SEC-10.5},revoked:new Error('token revoked for uid-owner secret-detail'),
};
let server:Server|undefined;
afterEach(async()=>{await new Promise<void>(r=>server?server.close(()=>r()):r());server=undefined;});
const row=():PendingRow=>({kind:'hold',id:'h1',state:'needs_review',createdAtMs:1000,nextAttemptAt:null,attempts:0,lastErrorCode:null,accountId:'11111111-1111-4111-8111-111111111111',malformed:false});
async function setup(over:Partial<OperatorHttpConfig>={},operators=['uid-owner','uid-second']){
  const s=stub({billingHoldOutbox:{h1:{state:'needs_review',createdAtMs:1000}},accounts:{x:{available:5,reserved:2}},ledgerEntries:{l1:{kind:'video_reserve'}}});
  await raisePendingAlerts(s.db as never,s.root as never,buildPendingReport([row()],NOW),NOW);s.writes.length=0;
  const logs:Array<Record<string,unknown>>=[];
  const config:OperatorHttpConfig={db:s.db as never,root:s.root as never,operators:new Set(operators),secret:SECRET,reauthWindowSec:WINDOW,limiter:()=>true,now:()=>NOW,log:e=>logs.push(e),
    verifier:{verifyIdToken:async(t:string,checkRevoked:true)=>{expect(checkRevoked).toBe(true);const v=tokens[t];if(!v||v instanceof Error)throw v??new Error('bad');return v;}},...over};
  const handler=billingOperatorHttp(config);
  server=createServer((req,res)=>{handler(req,res).then(done=>{if(!done){res.writeHead(418);res.end();}},()=>{res.writeHead(500);res.end();});});
  await new Promise<void>(r=>server!.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  const call=async(method:string,path:string,o:{token?:string;body?:unknown;raw?:string;type?:string|null;headers?:Record<string,string>}={})=>{
    const headers:Record<string,string>={...(o.headers??{})};if(o.token!==undefined)headers.authorization='Bearer '+o.token;
    const hasBody=o.body!==undefined||o.raw!==undefined;if(hasBody&&o.type!==null)headers['content-type']=o.type??'application/json';
    const r=await fetch(base+path,{method,headers,body:hasBody?(o.raw??JSON.stringify(o.body)):undefined});
    const text=await r.text();let json:Record<string,any>={};try{json=JSON.parse(text);}catch{/* empty or non-JSON */}
    return {status:r.status,json,text,headers:r.headers};
  };
  return {s,logs,call};
}
const post=(k:string,a:string)=>`/api/operator/billing-alerts/${k}/${a}`;
const GOOD={evidenceRef:'ticket-42',note:'checked'};
const audits=(s:ReturnType<typeof stub>)=>[...s.store.keys()].filter(k=>k.startsWith(AUDIT_COLLECTION+'/'));

describe('fail closed when disabled or misconfigured',()=>{
  it.each([
    ['no operators',{},[]],['no secret',{secret:''},undefined],['no limiter',{limiter:undefined},undefined],['no verifier',{verifier:undefined},undefined],['invalid clock',{now:()=>Number.NaN},undefined],['throwing clock',{now:()=>{throw new Error('clock down');}},undefined],['no clock function',{now:undefined},undefined],['no log function',{log:undefined},undefined],
  ] as const)('%s: every route answers 404 and nothing is written',async(_n,over,ops)=>{
    const {s,call}=await setup(over as never,ops as never);
    for(const [m,p,b] of [['GET','/api/operator/billing-alerts'],['GET','/api/operator/billing-alerts/'+KEY],['POST',post(KEY,'resolve'),GOOD]] as const){
      const r=await call(m,p,{token:'owner',body:b});expect(r.status).toBe(404);
    }
    expect(s.writes).toEqual([]);
  });
  it('without a reauthentication window writes are 404 but reads still work',async()=>{
    const {s,call}=await setup({reauthWindowSec:undefined});
    expect((await call('POST',post(KEY,'resolve'),{token:'owner',body:GOOD})).status).toBe(404);
    expect((await call('GET','/api/operator/billing-alerts',{token:'owner'})).status).toBe(200);
    expect(s.writes).toEqual([]);
  });
  it('paths outside the operator prefix are not handled at all',async()=>{
    const {call}=await setup();expect((await call('GET','/api/other')).status).toBe(418);
  });
});

describe('authentication and authorization',()=>{
  it('no token, garbage, invalid, revoked or unverified e-mail: one generic 401 and no effect',async()=>{
    const {s,call,logs}=await setup();const bodies=new Set<string>();
    for(const token of [undefined,'','not a token','unknown-token','revoked','unverified']){
      const r=await call('POST',post(KEY,'resolve'),{token,body:GOOD});expect(r.status).toBe(401);bodies.add(r.text);
    }
    expect(bodies.size).toBe(1);expect(s.writes).toEqual([]);expect(audits(s)).toEqual([]);
    expect(logs.every(l=>l.code===401)).toBe(true);
  });
  it('a valid user who is not an operator gets the same 404 as a disabled route or a missing alert',async()=>{
    const {s,call}=await setup();
    const a=await call('POST',post(KEY,'resolve'),{token:'stranger',body:GOOD}),b=await call('POST',post('0'.repeat(64),'resolve'),{token:'owner',body:GOOD}),c=await call('GET','/api/operator/billing-alerts/'+KEY,{token:'stranger'});
    expect([a.status,b.status,c.status]).toEqual([404,404,404]);expect(a.text).toBe(b.text);expect(a.text).toBe(c.text);expect(s.writes).toEqual([]);
  });
  it('writes need a recent authentication: missing, future or stale auth_time is 401 reauth_required (operators only)',async()=>{
    const {s,call}=await setup();
    for(const t of ['noauth','future','stale','nan','fractional']){const r=await call('POST',post(KEY,'resolve'),{token:t,body:GOOD});expect(r.status).toBe(401);expect(r.json.code).toBe('reauth_required');}
    expect(s.writes).toEqual([]);
    const reads=await call('GET','/api/operator/billing-alerts',{token:'stale'});expect(reads.status).toBe(200);
  });
});

describe('request validation',()=>{
  it('rejects wrong content type, unknown keys (author/clock), bad contents, query strings, browsers and other methods',async()=>{
    const {s,call}=await setup();const p=post(KEY,'resolve');
    expect((await call('POST',p,{token:'owner',body:GOOD,type:'text/plain'})).status).toBe(415);
    expect((await call('POST',p,{token:'owner',raw:JSON.stringify(GOOD),type:null})).status).toBe(415);
    for(const body of [{...GOOD,authorizedBy:'someone'},{...GOOD,nowMs:1},{...GOOD,evidenceRef:''},{note:'no evidence'},{...GOOD,evidenceRef:'x\nINJECT'},{...GOOD,note:'y'.repeat(2000)},[1],'text']){
      expect((await call('POST',p,{token:'owner',body})).status).toBe(400);
    }
    expect((await call('POST',p,{token:'owner',raw:'{broken'})).status).toBe(400);
    expect((await call('POST',p+'?authorizedBy=x',{token:'owner',body:GOOD})).status).toBe(400);
    expect((await call('POST',p,{token:'owner',body:GOOD,headers:{origin:'https://evil.example'}})).status).toBe(404);
    expect((await call('PUT',p,{token:'owner',body:GOOD})).status).toBe(404);
    expect((await call('POST',post('not-hex','resolve'),{token:'owner',body:GOOD})).status).toBe(404);
    expect((await call('POST',post(KEY,'delete'),{token:'owner',body:GOOD})).status).toBe(404);
    expect(s.writes).toEqual([]);expect(audits(s)).toEqual([]);
  });
  it('accepts a mixed-case JSON content type and rejects non-text evidence or notes',async()=>{
    const {s,call}=await setup();const p=post(KEY,'resolve');
    for(const body of [{evidenceRef:123},{evidenceRef:'ok',note:{}},{evidenceRef:'ok',note:['x']},{evidenceRef:null}])expect((await call('POST',p,{token:'owner',body})).status).toBe(400);
    expect(s.writes).toEqual([]);
    expect((await call('POST',p,{token:'owner',body:GOOD,type:'Application/JSON; charset=UTF-8'})).status).toBe(201);
  });
  it('lists open alerts in pages with a cursor: truncated is exact, the next page continues, and other routes refuse query strings',async()=>{
    const {s,call}=await setup();
    const put=(n:number)=>{for(let i=0;i<n;i++){const id='r'+String(i).padStart(4,'0'),k=alertKey('hold',id,'needs_review','needs_review');s.store.set(`${ALERT_COLLECTION}/${k}`,{alertKey:k,kind:'hold',rowId:id,state:'needs_review',reason:'needs_review',accountId:null,status:'open',seenCount:1,firstSeenAtMs:1,lastSeenAtMs:1});}};
    put(204); // plus the seeded alert: 205 open
    const first=await call('GET','/api/operator/billing-alerts',{token:'owner'});
    expect(first.json.alerts).toHaveLength(200);expect(first.json.truncated).toBe(true);expect(first.json.next).toMatch(/^[a-f0-9]{64}$/);
    const second=await call('GET','/api/operator/billing-alerts?after='+first.json.next,{token:'owner'});
    expect(second.json.alerts).toHaveLength(5);expect(second.json.truncated).toBe(false);expect(second.json.next).toBeNull();
    const seen=new Set([...first.json.alerts,...second.json.alerts].map((a:any)=>a.alertKey));expect(seen.size).toBe(205);
    for(const bad of ['?after=nope','?after='+first.json.next+'&x=1','?x=1'])expect((await call('GET','/api/operator/billing-alerts'+bad,{token:'owner'})).status).toBe(400);
    expect((await call('GET','/api/operator/billing-alerts/'+KEY+'?after='+KEY,{token:'owner'})).status).toBe(400);
  });
  it('a list of exactly one page is not marked truncated',async()=>{
    const {s,call}=await setup();
    for(let i=0;i<199;i++){const id='q'+String(i).padStart(4,'0'),k=alertKey('hold',id,'needs_review','needs_review');s.store.set(`${ALERT_COLLECTION}/${k}`,{alertKey:k,kind:'hold',rowId:id,state:'needs_review',reason:'needs_review',accountId:null,status:'open',seenCount:1,firstSeenAtMs:1,lastSeenAtMs:1});}
    const r=await call('GET','/api/operator/billing-alerts',{token:'owner'});expect(r.json.alerts).toHaveLength(200);expect(r.json.truncated).toBe(false);expect(r.json.next).toBeNull();
  });
  it('a rate-limited operator gets 429 and nothing is written',async()=>{
    const keys:string[]=[];const {s,call}=await setup({limiter:k=>{keys.push(k);return false;}});
    expect((await call('POST',post(KEY,'resolve'),{token:'owner',body:GOOD})).status).toBe(429);
    expect(s.writes).toEqual([]);expect(keys).toEqual([operatorPseudonym(SECRET,'uid-owner')]);
  });
});

describe('dispositions',()=>{
  it('creates (201), replays identically (200), and conflicts for a different person or payload (409 with the existing record)',async()=>{
    const {s,call}=await setup();const p=post(KEY,'resolve');
    const first=await call('POST',p,{token:'owner',body:GOOD});expect(first.status).toBe(201);expect(first.json).toMatchObject({replayed:false,action:'resolve',alertKey:KEY,auditId:auditId(KEY,'resolve')});
    const again=await call('POST',p,{token:'owner',body:GOOD});expect(again.status).toBe(200);expect(again.json.replayed).toBe(true);
    const other=await call('POST',p,{token:'second',body:GOOD});expect(other.status).toBe(409);
    expect(other.json.existing).toMatchObject({action:'resolve',authorizedBy:operatorPseudonym(SECRET,'uid-owner')});
    const changed=await call('POST',p,{token:'owner',body:{...GOOD,note:'different'}});expect(changed.status).toBe(409);
    expect(audits(s)).toHaveLength(1);
    expect(s.store.get(`${AUDIT_COLLECTION}/${auditId(KEY,'resolve')}`)).toMatchObject({authorizedBy:operatorPseudonym(SECRET,'uid-owner'),evidenceRef:'ticket-42'});
  });
  it('two operators at once: exactly one wins',async()=>{
    const {s,call}=await setup();
    const [a,b]=await Promise.all([call('POST',post(KEY,'resolve'),{token:'owner',body:GOOD}),call('POST',post(KEY,'resolve'),{token:'second',body:GOOD})]);
    expect([a.status,b.status].sort()).toEqual([201,409]);expect(audits(s)).toHaveLength(1);
  });
  it('acknowledge keeps the alert listed; resolve removes it from the open list; the detail shows the records',async()=>{
    const {call}=await setup();
    expect((await call('POST',post(KEY,'acknowledge'),{token:'owner',body:{evidenceRef:'seen'}})).status).toBe(201);
    let list=await call('GET','/api/operator/billing-alerts',{token:'owner'});expect(list.json.alerts.map((a:any)=>a.alertKey)).toEqual([KEY]);
    expect(list.json.alerts[0]).toMatchObject({status:'open',acknowledgedBy:operatorPseudonym(SECRET,'uid-owner')});
    expect((await call('POST',post(KEY,'resolve'),{token:'second',body:GOOD})).status).toBe(201);
    list=await call('GET','/api/operator/billing-alerts',{token:'owner'});expect(list.json.alerts).toEqual([]);
    const detail=await call('GET','/api/operator/billing-alerts/'+KEY,{token:'owner'});
    expect(detail.status).toBe(200);expect(detail.json.alert).toMatchObject({status:'dispositioned',kind:'hold',rowId:'h1'});
    expect(detail.json.audit.map((a:any)=>a.action).sort()).toEqual(['acknowledge','resolve']);
  });
});

describe('what never leaks and never changes',()=>{
  it('responses carry no uid, e-mail, token or account data, and are no-store',async()=>{
    const {call}=await setup();
    const all=[await call('GET','/api/operator/billing-alerts',{token:'owner'}),await call('GET','/api/operator/billing-alerts/'+KEY,{token:'owner'}),await call('POST',post(KEY,'resolve'),{token:'owner',body:GOOD}),await call('POST',post(KEY,'resolve'),{token:'second',body:GOOD}),await call('POST',post(KEY,'resolve'),{token:'revoked',body:GOOD})];
    for(const r of all){expect(r.text).not.toMatch(/uid-owner|uid-second|secret-detail|11111111-1111-4111|accountId|email|Bearer/);expect(r.headers.get('cache-control')).toMatch(/no-store/);}
  });
  it('the access log records every attempt, denials included, with the pseudonym, and never token, body, evidence, note, uid or e-mail',async()=>{
    const {call,logs}=await setup();
    await call('POST',post(KEY,'resolve'),{token:'owner',body:{evidenceRef:'SENSITIVE-EVIDENCE',note:'SENSITIVE-NOTE'}});
    await call('POST',post(KEY,'resolve'),{token:'revoked',body:GOOD});await call('POST',post(KEY,'resolve'),{token:'stranger',body:GOOD});await call('POST',post(KEY+'x','resolve'),{token:'owner',body:GOOD});
    expect(logs.map(l=>l.code)).toEqual([201,401,404,404]);
    const text=JSON.stringify(logs);
    expect(text).not.toMatch(/SENSITIVE|uid-|owner"|secret-detail|Bearer|@/);
    expect(logs[0]).toMatchObject({actor:operatorPseudonym(SECRET,'uid-owner'),action:'resolve',alertKey:KEY});expect(logs[1].actor).toBeNull();
  });
  it('balance data, rows and ledgers stay intact; the pseudonym is a keyed hash',async()=>{
    const {s,call}=await setup();
    await call('POST',post(KEY,'resolve'),{token:'owner',body:GOOD});
    expect(s.store.get('accounts/x')).toEqual({available:5,reserved:2});expect(s.store.get('ledgerEntries/l1')).toEqual({kind:'video_reserve'});expect(s.store.get('billingHoldOutbox/h1')).toEqual({state:'needs_review',createdAtMs:1000});
    expect(s.writes.every(w=>/^(create|update):(billingPendingAudit|billingPendingAlerts)\//.test(w))).toBe(true);
    const p=operatorPseudonym(SECRET,'uid-owner');expect(p).toMatch(/^op-[a-f0-9]{16}$/);expect(operatorPseudonym('another-secret-value-1234567890123456','uid-owner')).not.toBe(p);expect(operatorPseudonym(SECRET,'uid-second')).not.toBe(p);
    expect(ALERT_COLLECTION).toBe('billingPendingAlerts');
  });
});
