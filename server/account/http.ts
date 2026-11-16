import type {IncomingMessage,ServerResponse} from 'node:http';
import {AccountFault,type AccountStore,uuid} from './backend';
export type IdentityVerifier={verifyIdToken:(token:string,checkRevoked:true)=>Promise<{uid:string;email_verified?:boolean}>};
class HttpFault extends Error {constructor(readonly status:number,readonly code:string){super(code);}}
async function json(req:IncomingMessage,allowed:string[]){
 if(req.headers['content-type']?.split(';')[0]!=='application/json')throw new HttpFault(415,'content_type');
 if(Number(req.headers['content-length'])>400000)throw new HttpFault(413,'too_large');
 const chunks:Buffer[]=[];let n=0;
 for await(const part of req.iterator({destroyOnReturn:false})){n+=part.length;if(n>400000){req.resume();throw new HttpFault(413,'too_large');}chunks.push(part);}
 let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw new HttpFault(400,'invalid');}
 if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(k=>!allowed.includes(k)))throw new HttpFault(400,'invalid');return data;
}
/** Public transport; every account route still authenticates the real Firebase user. */
export function accountHttp(store:AccountStore,identity:IdentityVerifier,origin='https://vistavo.app'){
 if(origin!=='https://vistavo.app'&&origin!=='http://127.0.0.1:3001'&&origin!=='http://127.0.0.1:3003')throw Error('Account origin boundary');
 return async(req:IncomingMessage,res:ServerResponse)=>{
  const send=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','Vary':'Authorization','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'"});res.end(JSON.stringify(value));};
  try{
   const url=new URL(req.url??'/',origin);if(url.origin!==origin)throw new HttpFault(403,'origin');
   if(url.pathname==='/healthz'&&req.method==='GET'){send(200,{status:'ok'});return;}
   if(!url.pathname.startsWith('/api/account/'))throw new HttpFault(404,'not_found');
   if(req.headers.origin&&req.headers.origin!==origin)throw new HttpFault(403,'origin');
   const token=/^Bearer ([A-Za-z0-9_.-]+)$/.exec(req.headers.authorization??'')?.[1];if(!token||token.length>7000)throw new HttpFault(401,'unauthorized');
   let user;try{user=await identity.verifyIdToken(token,true);}catch{throw new HttpFault(401,'unauthorized');}
   if(typeof user.uid!=='string'||!user.uid||user.uid.length>128)throw new HttpFault(401,'unauthorized');
   if(user.email_verified!==true)throw new HttpFault(403,'verification_required');
   const pathname=url.pathname,method=req.method;
   const listing=(pathname==='/api/account/projects'||pathname==='/api/account/ledger')&&method==='GET';
   if([...url.searchParams.keys()].some(k=>!listing||!['limit','cursor'].includes(k)||url.searchParams.getAll(k).length!==1))throw new HttpFault(400,'invalid');
   if(pathname==='/api/account/bootstrap'&&method==='POST'){await json(req,[]);const r=await store.bootstrap(user.uid);send(r.created?201:200,r);return;}
   if(pathname==='/api/account/me'&&method==='GET'){send(200,await store.me(user.uid));return;}
   if(pathname==='/api/account/projects'&&method==='GET'){send(200,await store.list(user.uid,url.searchParams.get('limit')??undefined,url.searchParams.get('cursor')??undefined));return;}
   if(pathname==='/api/account/ledger'&&method==='GET'){send(200,await store.ledger(user.uid,url.searchParams.get('limit')??undefined,url.searchParams.get('cursor')??undefined));return;}
   if(pathname==='/api/account/projects'&&method==='POST'){
    const key=req.headers['idempotency-key'];if(typeof key!=='string'||!uuid.test(key))throw new HttpFault(400,'invalid');
    const b=await json(req,['title','kind','content']),r=await store.create(user.uid,key,b.title,b.kind,b.content);send(r.created?201:200,r);return;
   }
   const match=/^\/api\/account\/projects\/([a-f0-9-]{36})$/.exec(pathname);
   if(match&&method==='GET'){send(200,await store.read(user.uid,match[1]));return;}
   if(match&&method==='PUT'){const b=await json(req,['expectedRevision','title','content']);send(200,await store.save(user.uid,match[1],b.expectedRevision,b.title,b.content));return;}
   if(match&&method==='DELETE'){const r=req.headers['x-expected-revision'];if(typeof r!=='string'||! /^[1-9]\d{0,15}$/.test(r))throw new HttpFault(400,'invalid');if(req.headers['transfer-encoding']||Number(req.headers['content-length']??0)!==0)throw new HttpFault(400,'invalid');send(200,await store.remove(user.uid,match[1],Number(r)));return;}
   throw new HttpFault(404,'not_found');
  }catch(error){
   req.resume();if(res.headersSent){res.destroy();return;}
   if(error instanceof HttpFault){send(error.status,{error:error.code});return;}
   if(error instanceof AccountFault){const statuses={invalid:400,not_found:404,account_not_provisioned:404,conflict:409,deleted:410,quota:429,invariant:503};send(statuses[error.code],{error:error.code==='invariant'?'unavailable':error.code});return;}
   // No user identifiers, bodies, URLs, token contents, SDK errors or content in logs.
   send(503,{error:'unavailable'});
  }
 };
}
