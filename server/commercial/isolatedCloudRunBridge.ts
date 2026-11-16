import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth,type Auth} from 'firebase-admin/auth';
import {validateIsolatedCandidateEnvironment} from './isolatedCandidateEnvironment';

const projectId='demo-vistavo-ledger';
const publicOrigin='http://127.0.0.1:3003';
const privateAudience='http://127.0.0.1:3005';
const gatewayPort=3006;
const maxJsonBytes=400_000;
const maxChunkBytes=8*1024*1024;
const maxRejectedBodyDrain=16*1024*1024;
const uuid='[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';

type Route={backendPath:string;allowedQuery?:'offset'|'download';bodyLimit?:number};
function mapRoute(method:string,path:string,search:URLSearchParams):Route|null{
 const exact=new Map<string,string>([
  ['GET /api/video/me','/api/cloud/me'],
  ['POST /api/video/uploads','/api/cloud/uploads'],
  ['POST /api/video/text-fixture/transcribe','/api/cloud/text-fixture/transcribe'],
 ]);
 const direct=exact.get(`${method} ${path}`);
 if(direct)return search.size?null:{backendPath:direct,bodyLimit:method==='GET'?undefined:maxJsonBytes};
 let match=path.match(new RegExp(`^/api/video/uploads/(${uuid})$`));
 if(match&&['GET','HEAD','DELETE'].includes(method)&&!search.size)return{backendPath:`/api/cloud/uploads/${match[1]}`};
 match=path.match(new RegExp(`^/api/video/uploads/(${uuid})/chunks$`));
 if(match&&method==='PUT'&&search.size===1){const value=search.get('offset')??'';if(!/^\d+$/.test(value))return{backendPath:`/api/cloud/uploads/${match[1]}/chunks?offset=${encodeURIComponent(value)}`,bodyLimit:maxChunkBytes};const n=Number(value);return{backendPath:`/api/cloud/uploads/${match[1]}/chunks?offset=${Number.isSafeInteger(n)?n:encodeURIComponent(value)}`,bodyLimit:maxChunkBytes};}
 match=path.match(new RegExp(`^/api/video/uploads/(${uuid})/complete$`));
 if(match&&method==='POST'&&!search.size)return{backendPath:`/api/cloud/uploads/${match[1]}/complete`,bodyLimit:maxJsonBytes};
 match=path.match(new RegExp(`^/api/video/uploads/(${uuid})/content$`));
 if(match&&['GET','HEAD'].includes(method)&&!search.size)return{backendPath:`/api/cloud/uploads/${match[1]}/content`};
 match=path.match(new RegExp(`^/api/video/text-fixture/(${uuid})$`));
 if(match&&['GET','HEAD'].includes(method)&&!search.size)return{backendPath:`/api/cloud/text-fixture/${match[1]}`};
 match=path.match(new RegExp(`^/api/video/text-fixture/(${uuid})/review$`));
 if(match&&method==='PUT'&&!search.size)return{backendPath:`/api/cloud/text-fixture/${match[1]}/review`,bodyLimit:maxJsonBytes};
 match=path.match(new RegExp(`^/api/video/text-fixture/(${uuid})/translate$`));
 if(match&&method==='POST'&&!search.size)return{backendPath:`/api/cloud/text-fixture/${match[1]}/translate`,bodyLimit:maxJsonBytes};
 match=path.match(new RegExp(`^/api/video/text-fixture/(${uuid})/results/(transcript-es\\.(?:txt|srt)|translation-en\\.(?:txt|srt))$`));
 if(match&&['GET','HEAD'].includes(method)&&(search.size===0||(search.size===1&&search.get('download')==='1')))return{backendPath:`/api/cloud/text-fixture/${match[1]}/results/${match[2]}${search.size?'?download=1':''}`,allowedQuery:search.size?'download':undefined};
 return null;
}

function json(res:ServerResponse,status:number,value:unknown){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','Vary':'Authorization','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
function bearer(value: string|undefined){const match=/^Bearer ([A-Za-z0-9._~-]{20,8192})$/.exec(value??'');return match?.[1]??null;}
function drainRequest(req:IncomingMessage,maxBytes:number){return new Promise<boolean>(resolve=>{if(req.readableEnded||req.destroyed){resolve(false);return;}let bytes=0,settled=false;const finish=(incomplete:boolean)=>{if(settled)return;settled=true;clearTimeout(timer);req.off('data',onData);req.off('end',onEnd);req.off('close',onClose);resolve(incomplete);};const onData=(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>maxBytes){req.pause();finish(true);}};const onEnd=()=>finish(false);const onClose=()=>finish(!req.readableEnded);const timer=setTimeout(()=>{req.pause();finish(true);},10_000);timer.unref();req.on('data',onData);req.once('end',onEnd);req.once('close',onClose);req.resume();});}
async function rejectBody(req:IncomingMessage,res:ServerResponse,status:411|413,error:'content_length_required'|'request_too_large'){const incomplete=await drainRequest(req,maxRejectedBodyDrain);if(incomplete){res.setHeader('Connection','close');res.once('finish',()=>{if(!req.socket.destroyed)req.socket.destroy();});}json(res,status,{error});}
export function createIsolatedCloudRunBridge(options:{identity:Auth;privateServiceUrl:string;tokenForAudience:(audience:string)=>Promise<string>;port?:number}){
 if(options.privateServiceUrl!==privateAudience)throw Error('private service destination is not the isolated loopback audience');
 const server=createServer((req,res)=>{void handle(req,res).catch(error=>{console.error(JSON.stringify({event:'isolated-cloudrun-bridge-request-failed',method:req.method,path:(req.url??'/').split('?')[0],name:error instanceof Error?error.name:'Error',code:(error as NodeJS.ErrnoException)?.code??'unknown'}));if(!res.headersSent)json(res,503,{error:'private_backend_unavailable'});else res.destroy();});});
 async function handle(req:IncomingMessage,res:ServerResponse){
  const peer=req.socket.remoteAddress;
  if(!['127.0.0.1','::ffff:127.0.0.1'].includes(peer??'')||req.headers.host!==`127.0.0.1:${options.port??gatewayPort}`||req.headers.origin!==publicOrigin){req.resume();json(res,403,{error:'request_rejected'});return;}
  const url=new URL(req.url??'/',publicOrigin);
  if(req.method==='GET'&&url.pathname==='/healthz'&&!url.search){json(res,200,{status:'ok'});return;}
  const mapped=mapRoute(req.method??'GET',url.pathname,url.searchParams);
  if(!mapped){req.resume();json(res,404,{error:'not_found'});return;}
  const userToken=bearer(req.headers.authorization);if(!userToken){req.resume();json(res,401,{error:'unauthenticated'});return;}
  let claims;try{claims=await options.identity.verifyIdToken(userToken,true);}catch{req.resume();json(res,401,{error:'unauthenticated'});return;}
  if(claims.email_verified!==true){req.resume();json(res,403,{error:'email_verification_required'});return;}
  const method=req.method??'GET',hasBody=!['GET','HEAD'].includes(method),declared=req.headers['content-length'];
  if(hasBody&&mapped.bodyLimit!==undefined){if(typeof declared!=='string'||!/^\d+$/.test(declared)){await rejectBody(req,res,411,'content_length_required');return;}if(Number(declared)>mapped.bodyLimit){await rejectBody(req,res,413,'request_too_large');return;}}
  const serviceToken=await options.tokenForAudience(privateAudience);if(!/^[A-Za-z0-9._~-]{32,4096}$/.test(serviceToken))throw Error('local service assertion is invalid');
  const headers=new Headers({origin:publicOrigin,authorization:`Bearer ${userToken}`,'x-serverless-authorization':`Bearer ${serviceToken}`});
  for(const name of ['content-type','accept','content-length','range','if-range']){const value=req.headers[name];if(typeof value==='string')headers.set(name,value);}
  const response=await fetch(new URL(mapped.backendPath,options.privateServiceUrl),{method,headers,body:hasBody?req as unknown as BodyInit:undefined,duplex:hasBody?'half':undefined} as RequestInit & {duplex?:'half'});
  const forwarded:Record<string,string>={'Cache-Control':'private, no-store','Vary':'Authorization','X-Content-Type-Options':'nosniff'};
  for(const name of ['content-type','content-length','accept-ranges','content-range','content-disposition','etag','x-vistavo-fixture']){const value=response.headers.get(name);if(value)forwarded[name]=value;}
  res.writeHead(response.status,forwarded);if(!response.body||method==='HEAD'){res.end();return;}
  await response.body.pipeTo(new WritableStream({write(chunk){if(!res.write(Buffer.from(chunk)))return new Promise<void>(resolve=>res.once('drain',resolve));},close(){res.end();},abort(reason){res.destroy(reason instanceof Error?reason:undefined);}}));
 }
 server.requestTimeout=30_000;server.headersTimeout=10_000;
 server.listen(options.port??gatewayPort,'127.0.0.1',()=>console.log(JSON.stringify({event:'isolated-cloudrun-bridge-ready',port:options.port??gatewayPort,privateAudience,externalCloud:false,googleIdentityToken:false})));
 return server;
}

export async function startIsolatedCloudRunBridge(){
 validateIsolatedCandidateEnvironment(process.env);
 const token=process.env.VISTAVO_LOCAL_GATEWAY_TOKEN;
 if(!token||!/^[a-f0-9]{64}$/.test(token))throw Error('local gateway assertion missing');
 const app=initializeApp({projectId},'lv-local-cloudrun-gateway');
 try{const server=createIsolatedCloudRunBridge({identity:getAuth(app),privateServiceUrl:privateAudience,tokenForAudience:async audience=>{if(audience!==privateAudience)throw Error('audience mismatch');return token;}});server.once('close',()=>void deleteApp(app));server.once('error',()=>void deleteApp(app));return server;}
 catch(error){await deleteApp(app);throw error;}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 if(process.argv[2]!=='gateway'){console.error(JSON.stringify({event:'isolated-cloudrun-bridge-invalid-role'}));process.exitCode=2;}
 else void startIsolatedCloudRunBridge().catch(()=>{console.error(JSON.stringify({event:'isolated-cloudrun-bridge-start-failed'}));process.exitCode=1;});
}
