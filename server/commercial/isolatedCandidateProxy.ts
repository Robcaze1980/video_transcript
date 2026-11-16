import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {readFile,realpath} from 'node:fs/promises';
import {resolve,sep,extname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {validateIsolatedCandidateEnvironment} from './isolatedCandidateEnvironment';

const projectId='demo-vistavo-ledger';
const origin='http://127.0.0.1:3003';
const authHost='127.0.0.1:9099';
const assetsDirectory=resolve('dist/pilot-editor');
const htmlPath=resolve('server/commercial/web/isolatedCandidate.html');
const brandDirectory=resolve('server/pilot-site/assets/brand');
const mime:Record<string,string>={'.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2'};
const id='[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';
function allowedVideoQuery(path:string,query:URLSearchParams){
 if(query.size===0)return true;
 const pairs=[...query.entries()];if(pairs.length!==1)return false;
 if(new RegExp(`^/api/video/uploads/${id}/chunks$`).test(path))return pairs[0][0]==='offset'&&pairs[0][1].length<=20;
 if(new RegExp(`^/api/video/text-fixture/${id}/results/(?:transcript-es|translation-en)\\.(?:txt|srt)$`).test(path))return pairs[0][0]==='download'&&pairs[0][1]==='1';
 return false;
}

function respond(res:ServerResponse,status:number,value:unknown){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}

export function createIsolatedCandidateProxy(){
 validateIsolatedCandidateEnvironment(process.env);
 const server=createServer((req,res)=>{void handle(req,res).catch(error=>{console.error(JSON.stringify({event:'isolated-candidate-proxy-request-failed',method:req.method,path:(req.url??'/').split('?')[0],name:error instanceof Error?error.name:'Error',code:(error as NodeJS.ErrnoException)?.code??'unknown'}));respond(res,503,{error:'unavailable'});});});
 async function handle(req:IncomingMessage,res:ServerResponse){
  const peer=req.socket.remoteAddress;
  if(!['127.0.0.1','::ffff:127.0.0.1'].includes(peer??'')||req.headers.host!=='127.0.0.1:3003'||(req.headers.origin&&req.headers.origin!==origin)){req.resume();respond(res,403,{error:'request_rejected'});return;}
  const url=new URL(req.url??'/',origin);
  if(url.origin!==origin){req.resume();respond(res,403,{error:'request_rejected'});return;}
  if(!['GET','HEAD'].includes(req.method??'')&&req.headers.origin!==origin){req.resume();respond(res,403,{error:'request_rejected'});return;}
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Cross-Origin-Resource-Policy','same-origin');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' http://127.0.0.1:9099; frame-src http://127.0.0.1:9099; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'");
  if(url.pathname==='/api/candidate/config'&&req.method==='GET'){
   respond(res,200,{environment:'isolated-local',web:{projectId,authDomain:'demo-vistavo-ledger.firebaseapp.com',apiKey:'emulator-only-not-a-secret',appId:'1:0:web:isolated-candidate'},authEmulatorUrl:'http://127.0.0.1:9099',features:{accountApi:true,cloudApi:true,privateBridge:true,videoWorkflow:false,uploads:true,ai:false,textFixture:true,payments:false}});return;
  }
  if(url.pathname.startsWith('/api/account/')||url.pathname.startsWith('/api/video/')){
   const route=`${req.method??'GET'} ${url.pathname}`;
   const accountRoute=route==='POST /api/account/bootstrap'||route==='GET /api/account/me';
   const videoRoute=url.pathname.startsWith('/api/video/')&&['GET','HEAD','POST','PUT','DELETE'].includes(req.method??'')&&!url.pathname.includes('..')&&!url.pathname.includes('//')&&allowedVideoQuery(url.pathname,url.searchParams);
   const upstream=accountRoute?'http://127.0.0.1:3004':videoRoute?'http://127.0.0.1:3006':null;
   if(!upstream){req.resume();respond(res,404,{error:'not_found'});return;}
   const headers=new Headers();headers.set('origin',origin);
   for(const name of ['authorization','content-type','accept','content-length','range','if-range']){const value=req.headers[name];if(typeof value==='string')headers.set(name,value);}
   const method=req.method??'GET',hasBody=!['GET','HEAD'].includes(method);
   const upstreamResponse=await fetch(new URL(url.pathname+url.search,upstream),{method,headers,body:hasBody?req as unknown as BodyInit:undefined,duplex:hasBody?'half':undefined} as RequestInit & {duplex?:'half'});
   const forwardedHeaders:Record<string,string>={};
   for(const name of ['content-type','content-length','cache-control','vary','x-content-type-options','x-vistavo-fixture','accept-ranges','content-range','content-disposition','etag']){const value=upstreamResponse.headers.get(name);if(value)forwardedHeaders[name]=value;}
   res.writeHead(upstreamResponse.status,forwardedHeaders);
   if(!upstreamResponse.body||method==='HEAD'){res.end();return;}
   await new Promise<void>((resolve,reject)=>{upstreamResponse.body!.pipeTo(new WritableStream({write(chunk){if(!res.write(Buffer.from(chunk)))return new Promise<void>(r=>res.once('drain',r));},close(){res.end();resolve();},abort(reason){res.destroy(reason instanceof Error?reason:undefined);reject(reason);}})).catch(reject);});
   return;
  }
  if(!['GET','HEAD'].includes(req.method??'')){req.resume();respond(res,404,{error:'not_found'});return;}
  if(url.pathname==='/'){
   const manifest=JSON.parse(await readFile(join(assetsDirectory,'.vite/manifest.json'),'utf8'));
   const entry=manifest['server/commercial/web/isolatedCandidate.tsx'];
   if(typeof entry?.file!=='string'||!/^isolatedCandidate\.js$/.test(entry.file)||!Array.isArray(entry.css)||!entry.css.length||entry.css.some((file:string)=>!/^assets\/[a-zA-Z0-9_.-]+\.css$/.test(file)))throw Error('Isolated candidate build missing');
   let html=await readFile(htmlPath,'utf8');html=html.replace('href="/candidate-assets/isolatedCandidate.css"',entry.css.map((file:string)=>`href="/candidate-assets/${file}"`).join(' '));
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(req.method==='HEAD'?undefined:html);return;
  }
  const asset=/^\/candidate-assets\/([a-zA-Z0-9_./-]+)$/.exec(url.pathname),brand=/^\/brand\/(vistavo-symbol\.svg|vistavo-32\.png|favicon\.ico)$/.exec(url.pathname);
  if(!asset&&!brand){req.resume();respond(res,404,{error:'not_found'});return;}
  const relative=asset?.[1]??brand![1];
  if(relative.split('/').some(part=>part==='.'||part==='..'||part.startsWith('.'))||!mime[extname(relative)]){req.resume();respond(res,404,{error:'not_found'});return;}
  const base=await realpath(asset?assetsDirectory:brandDirectory),file=await realpath(resolve(base,relative)).catch(()=>null);
  if(!file||!file.startsWith(base+sep)){req.resume();respond(res,404,{error:'not_found'});return;}
  const bytes=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)],'Content-Length':String(bytes.length)}).end(req.method==='HEAD'?undefined:bytes);
 }
 server.requestTimeout=30000;server.headersTimeout=10000;server.listen(3003,'127.0.0.1',()=>console.log(JSON.stringify({event:'isolated-candidate-proxy-ready',origin,projectId,proxyHasFirebaseSdk:false,proxyHasDatabaseAccess:false,videoWorkflow:false,uploads:true,externalCloud:false})));
 return server;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 if(process.argv[2]!=='front'){console.error(JSON.stringify({event:'isolated-candidate-invalid-role'}));process.exitCode=2;}
 else {try{createIsolatedCandidateProxy();}catch{console.error(JSON.stringify({event:'isolated-candidate-proxy-start-failed'}));process.exitCode=1;}}
}
