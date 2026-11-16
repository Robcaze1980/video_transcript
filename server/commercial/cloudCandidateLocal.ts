import {createServer,type IncomingMessage,type RequestListener,type ServerResponse} from 'node:http';
import {readFile,realpath} from 'node:fs/promises';
import {resolve,sep,extname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseEnv} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import {GoogleAuth} from 'google-auth-library';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {Firestore,type DocumentReference} from 'firebase-admin/firestore';
import {getAuth} from 'firebase-admin/auth';
import {FirestoreBackend} from './firestoreBackend';
import {FirestoreAi} from './firestoreAi';
import {FirestoreFiles} from './firestoreFiles';
import {GcsObjects} from './gcsObjects';
import {privateBucket,privateUuid} from './privateObjectPlan';
import {firestoreHttp} from './firestoreHttp';
import type {FirebaseWebConfig} from './firebaseAccess';

const project='vistavo-prod' as const;
export function publicCandidateConfig(web:FirebaseWebConfig){
 if(web.projectId!==project||web.authDomain!=='vistavo-prod.firebaseapp.com'||typeof web.apiKey!=='string'||web.apiKey.length<10||!/^1:107404655346:web:[a-f0-9]+$/.test(web.appId))throw Error('Client project boundary');
 return {web:{projectId:web.projectId,authDomain:web.authDomain,apiKey:web.apiKey,appId:web.appId},environment:'private-cloud-candidate',limits:{maxBytes:500000000,maxSeconds:30,chunkBytes:8388608},queueIntervalSeconds:300};
}
/** Read only: an ineligible sign-in never creates a commercial account or grants credits. */
export function existingPilotAuthorization(root:DocumentReference){return async(uid:string)=>{
 if(typeof uid!=='string'||!uid||uid.length>128)return false;
 const key=createHash('sha256').update(JSON.stringify(['firebase',uid])).digest('hex');
 const identity=await root.collection('identities').doc(key).get(),accountId=identity.get('accountId');
 if(!identity.exists||identity.get('uid')!==uid||typeof accountId!=='string'||!privateUuid.test(accountId))return false;
 const account=await root.collection('accounts').doc(accountId).get();return account.exists&&account.get('aiPilot')===true&&account.get('simulationOnly')===true;
};}
const mime:Record<string,string>={'.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2'};
/** Loopback surface only. This shares cloud data/adapters; it is NOT a proxy into Run internal ingress. */
export function createCloudCandidateServer(options:{web:FirebaseWebConfig;apiForOrigin:(origin:string)=>RequestListener;assetsDirectory:string;htmlPath:string;brandDirectory:string}){
 const config=publicCandidateConfig(options.web);let api:RequestListener|undefined;
 const server=createServer((req,res)=>{void handle(req,res).catch(()=>{if(res.headersSent)res.destroy();else{req.resume();res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({error:'unavailable'}));}});});
 async function handle(req:IncomingMessage,res:ServerResponse){
  const address=server.address(),peer=req.socket.remoteAddress;
  const reject=(status:number)=>{req.resume();res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end(JSON.stringify({error:'request_rejected'}));};
  if(!address||typeof address==='string'||address.address!=='127.0.0.1'||!['127.0.0.1','::ffff:127.0.0.1'].includes(peer??'')){reject(403);return;}
  const origin='http://127.0.0.1:'+address.port;
  if(req.headers.host!=='127.0.0.1:'+address.port||req.headers.origin&&req.headers.origin!==origin){reject(403);return;}
  const url=new URL(req.url??'/',origin);if(url.origin!==origin){reject(403);return;}
  if(!['GET','HEAD'].includes(req.method??'')&&req.headers.origin!==origin){reject(403);return;}
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Cross-Origin-Resource-Policy','same-origin');
  res.setHeader('Cross-Origin-Opener-Policy','same-origin-allow-popups');res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self' https://apis.google.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com https://vistavo-prod.firebaseapp.com; frame-src https://vistavo-prod.firebaseapp.com https://accounts.google.com; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'");
  if(url.pathname==='/api/cloud/config'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify(config));return;}
  if(url.pathname.startsWith('/api/cloud/')||url.pathname==='/healthz'){
   api??=options.apiForOrigin(origin);await api(req,res);return;
  }
  if(!['GET','HEAD'].includes(req.method??'')){reject(404);return;}
  if(url.pathname==='/'){
   let html=await readFile(options.htmlPath,'utf8');const manifest=JSON.parse(await readFile(join(options.assetsDirectory,'.vite','manifest.json'),'utf8'));
   const css=manifest['server/commercial/web/cloudCandidate.tsx']?.css as string[]|undefined;
   if(!css?.length||css.some(p=>!/^assets\/[a-zA-Z0-9_.-]+\.css$/.test(p)))throw Error('Candidate build missing');
   html=html.replace('<link rel="stylesheet" href="/candidate-assets/cloudCandidate.css">',css.map(p=>`<link rel="stylesheet" href="/candidate-assets/${p}">`).join(''));
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(req.method==='HEAD'?undefined:html);return;
  }
  const asset=/^\/candidate-assets\/([a-zA-Z0-9_./-]+)$/.exec(url.pathname),brand=/^\/brand\/(vistavo-symbol\.svg|vistavo-32\.png|favicon\.ico)$/.exec(url.pathname);
  if(!asset&&!brand){reject(404);return;}
  const relative=asset?.[1]??brand![1];if(relative.split('/').some(p=>p.startsWith('.'))||!mime[extname(relative)]){reject(404);return;}
  const base=await realpath(asset?options.assetsDirectory:options.brandDirectory),file=await realpath(resolve(base,relative)).catch(()=>null);
  if(!file||!file.startsWith(base+sep)){reject(404);return;}
  const bytes=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)],'Content-Length':String(bytes.length)}).end(req.method==='HEAD'?undefined:bytes);
 }
 server.requestTimeout=180000;server.headersTimeout=15000;return server;
}

export function validateLocalCloudEnvironment(env:NodeJS.ProcessEnv){
 if(env.VISTAVO_LOCAL_CLOUD!=='1'||!env.LOCALAPPDATA||env.GOOGLE_APPLICATION_CREDENTIALS||env.FIRESTORE_EMULATOR_HOST||env.FIREBASE_AUTH_EMULATOR_HOST)throw Error('Explicit isolated local cloud mode required');
}
export async function createLocalCloudRuntime(){
 validateLocalCloudEnvironment(process.env);const local=resolve(process.env.LOCALAPPDATA!,'LinguistVision'),credentialPath=join(local,'gcloud','application_default_credentials.json');
 const credentialFile=JSON.parse(await readFile(credentialPath,'utf8'));if(credentialFile.type!=='authorized_user')throw Error('Isolated user ADC required');
 const env=parseEnv(await readFile(join(local,'.firebase.vistavo-prod.env'),'utf8')),web=JSON.parse(env.LINGUISTVISION_FIREBASE_WEB_CONFIG??'null');publicCandidateConfig(web);
 process.env.GOOGLE_CLOUD_QUOTA_PROJECT=project;
 const googleAuth=new GoogleAuth({keyFilename:credentialPath,projectId:project,scopes:['https://www.googleapis.com/auth/cloud-platform']});
 const auth=await googleAuth.getClient();
 // The explicit-keyFilename path does not apply Google's ADC environment override.
 // Set only this in-memory client's documented quota property; never rewrite ADC files.
 auth.quotaProjectId=project;
 if((await googleAuth.getRequestHeaders('https://firestore.googleapis.com')).get('x-goog-user-project')!==project)throw Error('Process quota project boundary');
 const accessToken=async()=>{const value=(await auth.getAccessToken()).token;if(!value)throw Error('User authorization unavailable');return value;};
 const app=initializeApp({projectId:project,credential:{getAccessToken:async()=>({access_token:await accessToken(),expires_in:Math.max(1,Math.min(300,Math.floor(((auth.credentials.expiry_date??Date.now()+300000)-Date.now())/1000)))})}},'vistavo-local-'+randomUUID());
 const db=new Firestore({projectId:project,auth:googleAuth,preferRest:true}),root=db.collection('vistavo').doc('candidate-v1');
 try{
  const marker=(await root.get()).data();if(marker?.schemaVersion!==2||marker.service!=='vistavo'||marker.environment!=='candidate'||marker.storageProtocol!=='immutable-chunks-v1')throw Error('Cloud schema boundary');
  const backend=new FirestoreBackend(db,root),objects=new GcsObjects({bucket:privateBucket,projectId:project,accessToken}),ai=new FirestoreAi(db,root,backend,objects,{maxSourceSeconds:30,maxNarrationChars:600,maxVoiceChunks:3}),files=new FirestoreFiles(db,root,objects,{},(accountId,inputId)=>ai.purgeInput(accountId,inputId));
  return {web,apiForOrigin:(origin:string)=>firestoreHttp({origin,backend,identity:getAuth(app),authorizeUser:existingPilotAuthorization(root),files,ai}),close:async()=>{await db.terminate();await deleteApp(app);}};
 }catch(error){await db.terminate();await deleteApp(app);throw error;}
}
export async function startCloudCandidateLocal(){
 const runtime=await createLocalCloudRuntime(),server=createCloudCandidateServer({...runtime,assetsDirectory:resolve('dist/pilot-editor'),htmlPath:resolve('server/commercial/web/cloudCandidate.html'),brandDirectory:resolve('server/pilot-site/assets/brand')});
 server.listen(3002,'127.0.0.1',()=>console.log(JSON.stringify({event:'local-cloud-candidate',url:'http://127.0.0.1:3002/',publicRelease:false})));
 for(const signal of ['SIGTERM','SIGINT'] as const)process.once(signal,()=>server.close(()=>void runtime.close().finally(()=>process.exit(0))));
 server.once('error',()=>void runtime.close().finally(()=>{process.exitCode=1;}));return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)void startCloudCandidateLocal().catch(error=>{console.error(JSON.stringify({event:'local-cloud-start-failed',type:error?.name??'Error',code:typeof error?.code==='number'?error.code:'UNCLASSIFIED'}));process.exitCode=1;});
