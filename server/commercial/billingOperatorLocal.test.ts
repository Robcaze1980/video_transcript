// LV-019.B piece D: the operator endpoint connected to a LOCAL-ONLY server (emulators, loopback, demo project).
// Real in-process HTTP server + in-memory Firestore stub. The cloud entries must stay free of the endpoint.
import {readdirSync,readFileSync,statSync} from 'node:fs';
import {request,type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {join,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach,describe,expect,it} from 'vitest';
import {buildPendingReport,type PendingRow} from './billingPendingReport';
import {alertKey,raisePendingAlerts} from './billingPendingAlerts';
import {AUDIT_COLLECTION} from './billingPendingAudit';
import {operatorPseudonym} from './billingOperatorHttp';
import {createOperatorLocalServer,startBillingOperatorLocal,validateOperatorLocalEnvironment} from './billingOperatorLocal';
import {stub} from './billingFirestoreStub';

const NOW=2_000_000_000_000,NOW_SEC=Math.floor(NOW/1000),SECRET='local-secret-not-real-0123456789abcdef',KEY=alertKey('hold','h1','needs_review','needs_review');
const OPERATOR_ENV:Record<string,string>={VISTAVO_OPERATOR_UIDS:'uid-owner',VISTAVO_OPERATOR_SECRET:SECRET,VISTAVO_OPERATOR_REAUTH_SEC:'300',VISTAVO_OPERATOR_RATE_MAX:'2',VISTAVO_OPERATOR_RATE_WINDOW_SEC:'60'};
const LOCAL_ENV:Record<string,string>={VISTAVO_OPERATOR_LOCAL:'1',FIRESTORE_EMULATOR_HOST:'127.0.0.1:18791',FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:18792',GCLOUD_PROJECT:'demo-vistavo-review-browser',VISTAVO_OPERATOR_ROOT:'operator-local/stub-root',VISTAVO_OPERATOR_PORT:'0'};
const tokens:Record<string,{uid:string;email_verified?:boolean;auth_time?:number}>={
  owner:{uid:'uid-owner',email_verified:true,auth_time:NOW_SEC-10},stranger:{uid:'uid-stranger',email_verified:true,auth_time:NOW_SEC-10},
};
let server:Server|undefined;
afterEach(async()=>{await new Promise<void>(r=>server?server.close(()=>r()):r());server=undefined;});
const row=():PendingRow=>({kind:'hold',id:'h1',state:'needs_review',createdAtMs:1000,nextAttemptAt:null,attempts:0,lastErrorCode:null,accountId:'11111111-1111-4111-8111-111111111111',malformed:false});

async function setup(env:Record<string,string|undefined>=OPERATOR_ENV){
  const s=stub({billingHoldOutbox:{h1:{state:'needs_review',createdAtMs:1000}}});
  await raisePendingAlerts(s.db as never,s.root as never,buildPendingReport([row()],NOW),NOW);s.writes.length=0;
  const logs:Array<Record<string,unknown>>=[],verified:string[]=[];
  const made=createOperatorLocalServer({env:{...LOCAL_ENV,...env},db:s.db as never,root:s.root as never,now:()=>NOW,log:e=>logs.push(e),
    verifier:{verifyIdToken:async(t:string)=>{verified.push(t);const v=tokens[t];if(!v)throw new Error('bad token');return v;}}});
  server=made.server;await new Promise<void>(r=>server!.listen(0,'127.0.0.1',r));
  const port=(server.address() as AddressInfo).port,base=`http://127.0.0.1:${port}`;
  const call=async(method:string,path:string,o:{token?:string;body?:unknown}={})=>{
    const headers:Record<string,string>={};if(o.token)headers.authorization='Bearer '+o.token;if(o.body!==undefined)headers['content-type']='application/json';
    const r=await fetch(base+path,{method,headers,body:o.body!==undefined?JSON.stringify(o.body):undefined});const text=await r.text();let json:Record<string,any>={};try{json=JSON.parse(text);}catch{/* not JSON */}
    return {status:r.status,json,text};
  };
  const withHost=(host:string)=>new Promise<{status:number;text:string}>((resolve,reject)=>{
    const req=request({host:'127.0.0.1',port,path:'/api/operator/billing-alerts',method:'GET',headers:{host,authorization:'Bearer owner'}},res=>{let t='';res.on('data',c=>t+=c);res.on('end',()=>resolve({status:res.statusCode??0,text:t}));});
    req.on('error',reject);req.end();
  });
  return {s,logs,verified,call,withHost,made};
}
const audits=(s:ReturnType<typeof stub>)=>[...s.store.keys()].filter(k=>k.startsWith(AUDIT_COLLECTION+'/'));
const LIST='/api/operator/billing-alerts',post=(a:string)=>`${LIST}/${KEY}/${a}`;

describe('validateOperatorLocalEnvironment',()=>{
  it('accepts a loopback emulator environment',()=>{expect(()=>validateOperatorLocalEnvironment(LOCAL_ENV)).not.toThrow();});
  it.each([
    ['no local flag',{VISTAVO_OPERATOR_LOCAL:undefined}],['flag not 1',{VISTAVO_OPERATOR_LOCAL:'true'}],
    ['no firestore emulator',{FIRESTORE_EMULATOR_HOST:undefined}],['firestore not loopback',{FIRESTORE_EMULATOR_HOST:'10.0.0.5:8080'}],['firestore by name',{FIRESTORE_EMULATOR_HOST:'localhost:8080'}],['firestore with path',{FIRESTORE_EMULATOR_HOST:'127.0.0.1:8080/x'}],
    ['firestore port with leading zeros',{FIRESTORE_EMULATOR_HOST:'127.0.0.1:00080'}],['auth port with a leading zero',{FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:080'}],
    ['firestore port zero',{FIRESTORE_EMULATOR_HOST:'127.0.0.1:0'}],['firestore port above range',{FIRESTORE_EMULATOR_HOST:'127.0.0.1:99999'}],['auth port above range',{FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:65536'}],
    ['no auth emulator',{FIREBASE_AUTH_EMULATOR_HOST:undefined}],['auth not loopback',{FIREBASE_AUTH_EMULATOR_HOST:'auth.example.com:9099'}],
    ['no project',{GCLOUD_PROJECT:undefined}],['real project',{GCLOUD_PROJECT:'vistavo-prod'}],
    ['credentials file',{GOOGLE_APPLICATION_CREDENTIALS:'C:\\secret.json'}],['hosted service',{K_SERVICE:'video-api'}],
    ['no root',{VISTAVO_OPERATOR_ROOT:undefined}],['root with traversal',{VISTAVO_OPERATOR_ROOT:'../vistavo/candidate-v1'}],['root of the real candidate',{VISTAVO_OPERATOR_ROOT:'vistavo/candidate-v1'}],
    ['no port',{VISTAVO_OPERATOR_PORT:undefined}],['port out of range',{VISTAVO_OPERATOR_PORT:'70000'}],['port with text',{VISTAVO_OPERATOR_PORT:'80a'}],
  ])('refuses: %s',(_n,over)=>{
    expect(()=>validateOperatorLocalEnvironment({...LOCAL_ENV,...over})).toThrow(/isolated local operator environment/i);
  });
  it('the refusal never repeats a value from the environment',()=>{
    for(const over of [{FIRESTORE_EMULATOR_HOST:'LEAK-1.example.com:1'},{GOOGLE_APPLICATION_CREDENTIALS:'LEAK-2'},{GCLOUD_PROJECT:'LEAK-3'},{VISTAVO_OPERATOR_ROOT:'LEAK-4'}]){
      let message='';try{validateOperatorLocalEnvironment({...LOCAL_ENV,...over});}catch(e:any){message=String(e?.message);}
      expect(message).not.toBe('');expect(message).not.toMatch(/LEAK/);
    }
  });
  it('the exported server constructor enforces the same contract: a non-isolated environment or a root outside operator-local is refused',()=>{
    const s=stub({});const base={db:s.db as never,root:s.root as never,now:()=>NOW,log:()=>undefined,verifier:{verifyIdToken:async()=>({uid:'x'})}};
    expect(()=>createOperatorLocalServer({...base,env:LOCAL_ENV})).not.toThrow();
    expect(()=>createOperatorLocalServer({...base,env:{...LOCAL_ENV,VISTAVO_OPERATOR_LOCAL:undefined}})).toThrow(/isolated local operator environment/i);
    expect(()=>createOperatorLocalServer({...base,env:{...LOCAL_ENV,FIRESTORE_EMULATOR_HOST:'10.0.0.5:8080'}})).toThrow(/isolated local operator environment/i);
    expect(()=>createOperatorLocalServer({...base,env:{...LOCAL_ENV,VISTAVO_OPERATOR_ROOT:'operator-local/another-root'}})).toThrow(/isolated local operator environment/i); // env root differs from the reference actually passed
    expect(()=>createOperatorLocalServer({...base,root:{...s.root,path:'vistavo/candidate-v1'} as never,env:{...LOCAL_ENV,VISTAVO_OPERATOR_ROOT:'vistavo/candidate-v1'}})).toThrow(/isolated local operator environment/i);
  });
  it('the constructor reads each environment variable once: an environment that changes between reads cannot pass validation and then be used differently',()=>{
    const s=stub({});let reads=0;
    const env:Record<string,string|undefined>={...LOCAL_ENV,get VISTAVO_OPERATOR_ROOT(){return reads++===0?'operator-local/stub-root':'vistavo/candidate-v1';}};
    expect(()=>createOperatorLocalServer({db:s.db as never,root:s.root as never,now:()=>NOW,log:()=>undefined,verifier:{verifyIdToken:async()=>({uid:'x'})},env})).not.toThrow();
    expect(reads).toBe(1);
  });
  it('start refuses an environment that is not the isolated local one before it touches Firebase or opens a port',async()=>{
    // The test process does not set VISTAVO_OPERATOR_LOCAL, so the real environment is refused.
    expect(process.env.VISTAVO_OPERATOR_LOCAL).toBeUndefined();
    await expect(startBillingOperatorLocal()).rejects.toThrow(/isolated local operator environment/i);
  });
});

describe('local operator server',()=>{
  it('incomplete configuration: every operator route is 404 even with a valid operator token, and the report names variables only',async()=>{
    for(const over of [{VISTAVO_OPERATOR_UIDS:undefined},{VISTAVO_OPERATOR_SECRET:'short'},{VISTAVO_OPERATOR_RATE_MAX:undefined},{VISTAVO_OPERATOR_RATE_WINDOW_SEC:'0'}]){
      const {call,made,s,verified}=await setup({...OPERATOR_ENV,...over});
      expect(made.enabled).toBe(false);expect(made.missing.length).toBeGreaterThan(0);
      expect((await call('GET',LIST,{token:'owner'})).status).toBe(404);
      expect((await call('GET',`${LIST}/${KEY}`,{token:'owner'})).status).toBe(404);
      expect((await call('POST',post('resolve'),{token:'owner',body:{evidenceRef:'t-1'}})).status).toBe(404);
      expect(audits(s)).toEqual([]);expect(s.writes).toEqual([]);expect(verified).toEqual([]);
      await new Promise<void>(r=>server!.close(()=>r()));server=undefined;
    }
  });
  it('complete configuration: lists, resolves once with the keyed author, replays idempotently, and keeps non-operators out',async()=>{
    const {call,s,logs}=await setup();
    const list=await call('GET',LIST,{token:'owner'});expect(list.status).toBe(200);expect(list.json.alerts).toHaveLength(1);expect(list.json.alerts[0].alertKey).toBe(KEY);
    const first=await call('POST',post('resolve'),{token:'owner',body:{evidenceRef:'ticket-7'}});expect(first.status).toBe(201);
    const again=await call('POST',post('resolve'),{token:'owner',body:{evidenceRef:'ticket-7'}});expect(again.status).toBe(200);expect(again.json.replayed).toBe(true);
    const records=audits(s);expect(records).toHaveLength(1);
    expect((s.store.get(records[0]) as any).authorizedBy).toBe(operatorPseudonym(SECRET,'uid-owner'));
    expect((await call('GET',LIST,{token:'stranger'})).status).toBe(404);
    expect((await call('POST',post('acknowledge'),{token:'stranger',body:{evidenceRef:'x'}})).status).toBe(404);
    expect(audits(s)).toHaveLength(1);
    expect(JSON.stringify(logs)).not.toMatch(/uid-owner|uid-stranger|ticket-7|Bearer|local-secret/);
    expect(logs.length).toBeGreaterThan(0);
  });
  it('the write rate limit comes from the environment, per operator, and refused calls write nothing',async()=>{
    const {call,s}=await setup();
    const k=(n:number)=>alertKey('hold','x'+n,'needs_review','needs_review');
    for(let i=0;i<3;i++){const key=k(i);s.store.set(`billingPendingAlerts/${key}`,{alertKey:key,kind:'hold',rowId:'x'+i,state:'needs_review',reason:'needs_review',accountId:null,status:'open',seenCount:1,firstSeenAtMs:1,lastSeenAtMs:1});}
    const codes:number[]=[];
    for(let i=0;i<3;i++)codes.push((await call('POST',`${LIST}/${k(i)}/acknowledge`,{token:'owner',body:{}})).status);
    expect(codes).toEqual([201,201,429]);
    expect(audits(s)).toHaveLength(2);
  });
  it('without a reauthentication window reads work and writes are 404',async()=>{
    const {call,s}=await setup({...OPERATOR_ENV,VISTAVO_OPERATOR_REAUTH_SEC:undefined});
    expect((await call('GET',LIST,{token:'owner'})).status).toBe(200);
    expect((await call('POST',post('resolve'),{token:'owner',body:{evidenceRef:'t'}})).status).toBe(404);
    expect(audits(s)).toEqual([]);
  });
  it('rejects a request whose Host header is not the loopback address, before any token is looked at',async()=>{
    const {withHost,verified}=await setup();
    for(const host of ['evil.example.com','localhost','127.0.0.1','127.0.0.1:1']){const r=await withHost(host);expect(r.status).toBe(403);expect(r.text).not.toMatch(/alerts/);}
    expect(verified).toEqual([]);
  });
  it('a server that ends up bound to any address other than 127.0.0.1 closes itself',async()=>{
    const s=stub({});
    const made=createOperatorLocalServer({env:LOCAL_ENV,db:s.db as never,root:s.root as never,now:()=>NOW,log:()=>undefined,verifier:{verifyIdToken:async()=>({uid:'x'})}});
    server=made.server;await new Promise<void>(r=>server!.listen(0,'0.0.0.0',()=>r()));
    for(let i=0;i<50&&server.listening;i++)await new Promise(r=>setTimeout(r,20));
    expect(server.listening).toBe(false);
  });
  it('rejects a connection whose peer is not the loopback address, even with a correct Host header and a valid token',async()=>{
    const {verified}=await setup();const port=(server!.address() as AddressInfo).port;
    for(const [peer,expected] of [['203.0.113.9',403],['::1',403],[undefined,403],['127.0.0.1',200],['::ffff:127.0.0.1',200]] as const){
      const seen:{status?:number;body?:string}={};
      const req:any={headers:{host:'127.0.0.1:'+port,authorization:'Bearer owner'},method:'GET',url:LIST,socket:{remoteAddress:peer},resume(){return this;},origin:undefined};
      const res:any={headersSent:false,writeHead(s:number){seen.status=s;this.headersSent=true;return this;},end(b?:string){seen.body=b;return this;},destroy(){}};
      server!.emit('request',req,res);await new Promise(r=>setTimeout(r,60));
      if(expected===403){expect(seen.status).toBe(403);expect(seen.body).not.toMatch(/alerts/);}
      else expect(seen.status).not.toBe(403);
    }
    expect(verified.length).toBeLessThanOrEqual(2);
  });
  it('an unexpected failure inside the listener answers 500 and is logged with a fixed shape (no message, no values)',async()=>{
    const {logs}=await setup();const port=(server!.address() as AddressInfo).port;
    const seen:{status?:number;body?:string}={};
    const req:any={headers:{host:'127.0.0.1:'+port},method:'GET',url:LIST,socket:undefined,resume(){return this;}}; // a broken request object: reading the peer throws
    const res:any={headersSent:false,writeHead(s:number){seen.status=s;this.headersSent=true;return this;},end(b?:string){seen.body=b;return this;},destroy(){}};
    server!.emit('request',req,res);await new Promise(r=>setTimeout(r,60));
    expect(seen.status).toBe(500);expect(JSON.parse(seen.body??'{}')).toEqual({error:'error'});
    expect(logs).toContainEqual({event:'operator-local-error',code:'unhandled'});
    expect(JSON.stringify(logs)).not.toMatch(/TypeError|undefined|remoteAddress/);
  });
  it('paths outside the operator prefix are 404 and never reach the verifier',async()=>{
    const {call,verified}=await setup();
    for(const p of ['/','/api/cloud/config','/healthz','/api/operator','/api/operator/other']){const r=await call('GET',p,{token:'owner'});expect(r.status).toBe(404);expect(r.json).toEqual({error:'not_found'});}
    expect(verified).toEqual([]);
  });
});

describe('the endpoint stays out of every cloud entry',()=>{
  const root=fileURLToPath(new URL('..',import.meta.url));
  const walk=(dir:string):string[]=>readdirSync(dir).flatMap(n=>{const p=join(dir,n);if(n==='node_modules'||n==='.git')return [];return statSync(p).isDirectory()?walk(p):[p];});
  it('only the operator modules, their tests and the local entry mention the operator endpoint',()=>{
    const allowed=new Set(['commercial/billingOperatorHttp.ts','commercial/billingOperatorHttp.test.ts','commercial/billingOperatorConfig.ts','commercial/billingOperatorConfig.test.ts','commercial/billingOperatorLocal.ts','commercial/billingOperatorLocal.test.ts']);
    const offenders=walk(root).filter(f=>/\.(ts|tsx|mjs|js)$/.test(f)).map(f=>relative(root,f).split(sep).join('/')).filter(f=>!allowed.has(f)).filter(f=>/billingOperator(Http|Config|Local)/.test(readFileSync(join(root,f),'utf8')));
    expect(offenders).toEqual([]);
  });
});
