/**
 * LV-019.B piece D: the operator endpoint connected to a LOCAL-ONLY server.
 * This is the only place that mounts `billingOperatorHttp`. It refuses to start unless the whole environment is isolated:
 * Firestore and Auth emulators on the loopback address, a `demo-*` project, no credentials file, no hosted-service marker,
 * and a Firestore root inside the dedicated `operator-local` collection (never the real candidate data). It listens on 127.0.0.1
 * only, answers 403 to any request whose Host header is not that exact address, and 404 to everything outside the operator
 * routes. The cloud entries (`cloudApi.ts`, `firestoreHttp.ts`, `cloudCandidateLocal.ts`, the Account service) do NOT import it;
 * a test enforces that. Without a complete operator configuration (see `billingOperatorConfig.ts`) every route answers 404.
 *   VISTAVO_OPERATOR_LOCAL=1  VISTAVO_OPERATOR_ROOT=operator-local/<name>  VISTAVO_OPERATOR_PORT=<0..65535>
 */
import {randomUUID} from 'node:crypto';
import {createServer,type IncomingMessage,type Server,type ServerResponse} from 'node:http';
import type {AddressInfo} from 'node:net';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {deleteApp,initializeApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {Firestore,type DocumentReference} from 'firebase-admin/firestore';
import {billingOperatorHttp,type OperatorHttpConfig} from './billingOperatorHttp';
import {operatorConfigFromEnv} from './billingOperatorConfig';

const DEMO=/^demo-[a-z0-9-]+$/,ROOT=/^operator-local\/[a-z0-9][a-z0-9-]{2,59}$/,PORT=/^(0|[1-9]\d{0,4})$/;
const loopbackHost=(value:string|undefined):boolean=>{const m=/^127\.0\.0\.1:([1-9]\d{0,4})$/.exec(value??'');return m!==null&&Number(m[1])<=65535;};
const refuse=(name:string):never=>{throw Error('Explicit isolated local operator environment required: '+name);};

/** Throws unless the environment is the isolated local one. The message names the failing variable, never a value. */
export function validateOperatorLocalEnvironment(env:Record<string,string|undefined>):void{
  if(env.VISTAVO_OPERATOR_LOCAL!=='1')refuse('VISTAVO_OPERATOR_LOCAL');
  if(!loopbackHost(env.FIRESTORE_EMULATOR_HOST))refuse('FIRESTORE_EMULATOR_HOST');
  if(!loopbackHost(env.FIREBASE_AUTH_EMULATOR_HOST))refuse('FIREBASE_AUTH_EMULATOR_HOST');
  if(!DEMO.test(env.GCLOUD_PROJECT??''))refuse('GCLOUD_PROJECT');
  if(env.GOOGLE_APPLICATION_CREDENTIALS)refuse('GOOGLE_APPLICATION_CREDENTIALS');
  if(env.K_SERVICE)refuse('K_SERVICE');
  if(!ROOT.test(env.VISTAVO_OPERATOR_ROOT??''))refuse('VISTAVO_OPERATOR_ROOT');
  const port=env.VISTAVO_OPERATOR_PORT??'';if(!PORT.test(port)||Number(port)>65535)refuse('VISTAVO_OPERATOR_PORT');
}

export interface OperatorLocalOptions{
  env:Record<string,string|undefined>;db:Firestore;root:DocumentReference;verifier:OperatorHttpConfig['verifier'];now:()=>number;log:(entry:Record<string,unknown>)=>void;
}
/**
 * Builds (does not start) the loopback server. It enforces the isolation contract itself: the environment (read once, as a
 * snapshot) must be the isolated one and the Firestore reference actually passed must be the validated root. Known limit: `db` is
 * trusted. A Firestore instance cannot be inspected for where it points, so the caller must build it from the validated emulator
 * environment, as `startBillingOperatorLocal` does. The test that walks `server/` keeps any other module from importing this file.
 */
export function createOperatorLocalServer(o:OperatorLocalOptions):{server:Server;enabled:boolean;writesEnabled:boolean;missing:string[]}{
  const env:Record<string,string|undefined>=Object.freeze({...o.env});
  validateOperatorLocalEnvironment(env);
  if(o.root.path!==env.VISTAVO_OPERATOR_ROOT)refuse('VISTAVO_OPERATOR_ROOT');
  const {config,enabled,writesEnabled,missing}=operatorConfigFromEnv(env,{db:o.db,root:o.root,verifier:o.verifier,now:o.now,log:o.log});
  const handler=billingOperatorHttp(config);
  const reply=(res:ServerResponse,status:number,error:string)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end(JSON.stringify({error}));};
  const server=createServer((req:IncomingMessage,res:ServerResponse)=>{
    void(async()=>{
      const address=server.address(),peer=req.socket.remoteAddress;
      if(!address||typeof address==='string'||address.address!=='127.0.0.1'||!['127.0.0.1','::ffff:127.0.0.1'].includes(peer??'')||req.headers.host!=='127.0.0.1:'+address.port){req.resume();reply(res,403,'request_rejected');return;}
      if(!await handler(req,res)){req.resume();reply(res,404,'not_found');}
    })().catch(()=>{
      try{o.log({event:'operator-local-error',code:'unhandled'});}catch{/* logging must never change the response */}
      if(res.headersSent)res.destroy();else{req.resume();reply(res,500,'error');}
    });
  });
  server.requestTimeout=30000;server.headersTimeout=10000;
  // Defense in depth: a server that ends up bound anywhere but 127.0.0.1 closes itself (its requests would be 403 anyway).
  server.on('listening',()=>{const a=server.address();if(a===null||typeof a==='string'||a.address!=='127.0.0.1')server.close();});
  return {server,enabled,writesEnabled,missing};
}

/** Starts the real thing against the emulators named in `process.env`. Validation happens before any Firebase object exists. */
export async function startBillingOperatorLocal(){
  validateOperatorLocalEnvironment(process.env);
  const env=process.env,projectId=env.GCLOUD_PROJECT as string;
  const app=initializeApp({projectId},'operator-local-'+randomUUID());
  let db:Firestore|undefined;
  // Every failure from here on releases both resources, even if the Firestore constructor or one of the releases fails.
  // It resolves to the release failures (none = clean) so a failed start keeps its original error and a close can report them.
  // Each release runs inside its own async function: `deleteApp` can throw synchronously, which must not escape `allSettled`.
  const release=async():Promise<unknown[]>=>(await Promise.allSettled([(async()=>{await db?.terminate();})(),(async()=>{await deleteApp(app);})()])).flatMap(r=>r.status==='rejected'?[r.reason]:[]);
  try{
    db=new Firestore({projectId});
    const made=createOperatorLocalServer({env,db,root:db.doc(env.VISTAVO_OPERATOR_ROOT as string),verifier:getAuth(app),now:()=>Date.now(),log:e=>console.log(JSON.stringify(e))});
    await new Promise<void>((ok,fail)=>{
      const onError=(error:Error)=>fail(error);
      made.server.once('error',onError);
      // Once listening, the start-up error listener is removed so a later server error is not swallowed.
      made.server.listen(Number(env.VISTAVO_OPERATOR_PORT),'127.0.0.1',()=>{made.server.off('error',onError);ok();});
    });
    // Idempotent: a second call returns the first. In-flight and idle connections are cut so a stuck client cannot stop the release;
    // release failures are reported, not swallowed.
    let closing:Promise<void>|undefined;
    const close=():Promise<void>=>closing??=(async()=>{
      const stopped=new Promise<void>(r=>made.server.close(()=>r()));made.server.closeAllConnections();await stopped;
      const failed=await release();if(failed.length)throw new AggregateError(failed,'Release failed');
    })();
    return {...made,port:(made.server.address() as AddressInfo).port,close};
  }catch(error){await release();throw error;}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  void startBillingOperatorLocal().then(r=>{
    console.log(JSON.stringify({event:'operator-local-started',port:r.port,enabled:r.enabled,writesEnabled:r.writesEnabled,missing:r.missing}));
    for(const signal of ['SIGTERM','SIGINT'] as const)process.once(signal,()=>void r.close().finally(()=>process.exit(0)));
  }).catch(error=>{console.error(JSON.stringify({event:'operator-local-start-failed',reason:String(error?.message??'error').split(':')[0]}));process.exitCode=1;});
}
