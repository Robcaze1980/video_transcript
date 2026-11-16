import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {initializeApp,deleteApp,type App} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
import {AccountStore} from '../account/backend';
import {accountHttp} from '../account/http';
import {FirestoreBackend} from './firestoreBackend';
import {firestoreHttp} from './firestoreHttp';
import {FirestoreFiles} from './firestoreFiles';
import {IsolatedCandidateObjects} from './isolatedCandidateObjects';
import {privateVideoProbe} from './privateVideoProbe';
import {LocalTextFixture} from './localTextFixture';
import {validateIsolatedCandidateEnvironment} from './isolatedCandidateEnvironment';

const projectId='demo-vistavo-ledger';
const origin='http://127.0.0.1:3003';
const firestoreHost='127.0.0.1:8185';
const accountDatabase='account-candidate';

async function isolatedIdentity(){
 const app=initializeApp({projectId},'lv-isolated-candidate-'+randomUUID());
 return {app,identity:getAuth(app),close:()=>deleteApp(app)};
}

function isolatedFirestore(app:App,databaseId?:string){return getFirestore(app,databaseId);}

export async function createIsolatedAccountRuntime(){
 validateIsolatedCandidateEnvironment(process.env);
 const {app,identity,close:closeAuth}=await isolatedIdentity(),db=isolatedFirestore(app,accountDatabase);
 const root=db.collection('vistavo').doc('candidate-account-v1');
 let closing:Promise<void>|null=null;
 return {handler:accountHttp(new AccountStore(db,root),identity,origin),identity,close:()=>closing??=(async()=>{try{await db.recursiveDelete(root);}finally{await db.terminate();await closeAuth();}})()};
}

export async function createIsolatedCloudRuntime(){
 validateIsolatedCandidateEnvironment(process.env);
 const {app,identity,close:closeAuth}=await isolatedIdentity(),db=isolatedFirestore(app),root=db.collection('vistavo').doc('candidate-storage-'+randomUUID());
 try{
  const marker=await root.get();
  if(!marker.exists)await root.create({schemaVersion:2,service:'vistavo',environment:'candidate',storageProtocol:'ephemeral-memory-v1'});
  else if(marker.get('schemaVersion')!==2||marker.get('service')!=='vistavo'||marker.get('environment')!=='candidate'||marker.get('storageProtocol')!=='ephemeral-memory-v1')throw Error('Isolated Firestore marker mismatch');
  const backend=new FirestoreBackend(db,root),objects=new IsolatedCandidateObjects(),textFixture=new LocalTextFixture(db,root),files=new FirestoreFiles(db,root,objects,{quotaBytes:32*1024*1024,maxActive:2,ttlMs:60*60*1000,chunkBytes:8*1024*1024,leaseMs:30000},(accountId,inputId)=>textFixture.purge(accountId,inputId));
  const nudgeFile=async(id:string,role:'validate'|'cleanup')=>{
   const state=await files.work(id,role,role==='validate'?privateVideoProbe(objects):undefined);
   if(state==='cleaning')await files.work(id,'cleanup');
  };
  let closing:Promise<void>|null=null;
  return {handler:firestoreHttp({backend,identity,origin,files,nudgeFile,textFixture}),identity,backend,db,root,objects,files,close:()=>closing??=(async()=>{try{await db.recursiveDelete(root);}finally{await db.terminate();await closeAuth();}})()};
 }catch(error){await db.terminate();await closeAuth();throw error;}
}

function apiService(port:number,handler:(req:IncomingMessage,res:ServerResponse)=>unknown){
 const expectedHost=`127.0.0.1:${port}`;
 const server=createServer((req,res)=>{
  const peer=req.socket.remoteAddress;
  if(!['127.0.0.1','::ffff:127.0.0.1'].includes(peer??'')||req.headers.host!==expectedHost||req.headers.origin!==origin){req.resume();res.writeHead(403,{'Cache-Control':'no-store'}).end();return;}
  if(req.method==='GET'&&req.url==='/healthz'){res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}).end(JSON.stringify({status:'ok'}));return;}
  Promise.resolve(handler(req,res)).catch(()=>{if(res.headersSent)res.destroy();else{req.resume();res.writeHead(503,{'Cache-Control':'no-store'}).end();}});
 });server.requestTimeout=30000;server.headersTimeout=10000;return server;
}

export function createIsolatedAccountServer(runtime:Awaited<ReturnType<typeof createIsolatedAccountRuntime>>){
 const server=apiService(3004,runtime.handler);
 server.listen(3004,'127.0.0.1',()=>console.log(JSON.stringify({event:'isolated-account-api-ready',origin,projectId,database:accountDatabase,externalCloud:false})));
 server.once('close',()=>void runtime.close());server.once('error',()=>void runtime.close());return server;
}

export function createIsolatedCloudServer(runtime:Awaited<ReturnType<typeof createIsolatedCloudRuntime>>){
 const server=apiService(3005,runtime.handler);
 server.listen(3005,'127.0.0.1',()=>console.log(JSON.stringify({event:'isolated-cloud-api-ready',origin,projectId,database:'(default)',uploads:true,storageAdapter:'ephemeral-memory',ai:false,textFixture:true,externalCloud:false})));
 server.once('close',()=>void runtime.close());server.once('error',()=>void runtime.close());return server;
}

export async function startIsolatedAccountApi(){return createIsolatedAccountServer(await createIsolatedAccountRuntime());}
export async function startIsolatedCloudApi(){return createIsolatedCloudServer(await createIsolatedCloudRuntime());}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const role=process.argv[2];
 const start=role==='account'?startIsolatedAccountApi:role==='cloud'?startIsolatedCloudApi:null;
 if(!start){console.error(JSON.stringify({event:'isolated-candidate-invalid-role'}));process.exitCode=2;}
 else void start().catch(()=>{console.error(JSON.stringify({event:'isolated-candidate-start-failed',role}));process.exitCode=1;});
}
