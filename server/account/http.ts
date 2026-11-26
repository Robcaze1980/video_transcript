import type {IncomingMessage,ServerResponse} from 'node:http';
import {AccountFault,type AccountStore,uuid} from './backend';
export type IdentityVerifier={verifyIdToken:(token:string,checkRevoked:true)=>Promise<{uid:string;email_verified?:boolean}>};
export type ServiceIdentityVerifier={verifyIdToken:(token:string,audience:string)=>Promise<{email?:string;email_verified?:boolean}>};
export type InternalServicePolicy={audience:string;allowedEmails:readonly string[];reservationCaller:string;settlementCaller:string;verifier:ServiceIdentityVerifier};
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
export function accountHttp(store:AccountStore,identity:IdentityVerifier,origin='https://vistavo.app',internal?:InternalServicePolicy){
 if(origin!=='https://vistavo.app'&&origin!=='http://127.0.0.1:3001'&&origin!=='http://127.0.0.1:3003')throw Error('Account origin boundary');
 return async(req:IncomingMessage,res:ServerResponse)=>{
  const send=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','Vary':'Authorization','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'"});res.end(JSON.stringify(value));};
  try{
   const url=new URL(req.url??'/',origin);if(url.origin!==origin)throw new HttpFault(403,'origin');
   if(url.pathname==='/healthz'&&req.method==='GET'){send(200,{status:'ok'});return;}
   if(url.pathname.startsWith('/api/internal/video/')){
    if(!internal||req.method!=='POST'||req.headers.origin)throw new HttpFault(404,'not_found');
    const serviceToken=/^Bearer ([A-Za-z0-9_.-]+)$/.exec(req.headers.authorization??'')?.[1];
    if(!serviceToken||serviceToken.length>7000)throw new HttpFault(401,'unauthorized');
    let caller;try{caller=await internal.verifier.verifyIdToken(serviceToken,internal.audience);}catch{throw new HttpFault(401,'unauthorized');}
    if(caller.email_verified!==true||typeof caller.email!=='string'||!internal.allowedEmails.includes(caller.email))throw new HttpFault(403,'forbidden');
    if(url.pathname==='/api/internal/video/reservations'){
     if([...url.searchParams.keys()].length)throw new HttpFault(400,'invalid');
     const b=await json(req,['identityKey','reservationId','seconds']);
     if(caller.email!==internal.reservationCaller)throw new HttpFault(403,'forbidden');
     const result=await store.reserveVideo(b.identityKey as string,b.reservationId as string,b.seconds as number);send(result.created?201:200,{...result,reservationId:b.reservationId});return;
    }
    if(url.pathname==='/api/internal/video/balance'){
     if([...url.searchParams.keys()].length)throw new HttpFault(400,'invalid');const b=await json(req,['identityKey']);
     if(caller.email!==internal.reservationCaller)throw new HttpFault(403,'forbidden');send(200,await store.videoBalance(b.identityKey as string));return;
    }
    if(url.pathname==='/api/internal/video/billing-holds'||url.pathname==='/api/internal/video/billing-holds/status'||
     url.pathname==='/api/internal/video/billing-holds/unblock'||url.pathname==='/api/internal/video/billing-holds/unblock-receipt'){
     if([...url.searchParams.keys()].length)throw new HttpFault(400,'invalid');
     // Only the general hold status is also available to the reservation caller.
     if(!url.pathname.endsWith('/status')&&caller.email!==internal.settlementCaller)throw new HttpFault(403,'forbidden');
     if(url.pathname.endsWith('/unblock')){
      const b=await json(req,['identityKey','incidentId','epoch','createdAtMs','reviewRef']);
      if(typeof b.identityKey!=='string'||!/^[a-f0-9]{64}(?![\s\S])/.test(b.identityKey)||typeof b.incidentId!=='string'||!(uuid.test(b.incidentId)||/^[a-f0-9]{64}(?![\s\S])/.test(b.incidentId))||!Number.isSafeInteger(b.epoch)||(b.epoch as number)<1||!Number.isSafeInteger(b.createdAtMs)||(b.createdAtMs as number)<0||typeof b.reviewRef!=='string'||!/^[^\u0000-\u001f\u007f]{1,200}$/.test(b.reviewRef))throw new HttpFault(400,'invalid');
      const result=await store.unblockVideoBilling(b.identityKey,{incidentId:b.incidentId as string,epoch:b.epoch as number,createdAtMs:b.createdAtMs as number,reviewRef:b.reviewRef as string});send(200,result);return;
     }
     if(url.pathname.endsWith('/unblock-receipt')){
      const b=await json(req,['identityKey','incidentId','reviewRef']);
      if(typeof b.identityKey!=='string'||!/^[a-f0-9]{64}(?![\s\S])/.test(b.identityKey)||typeof b.incidentId!=='string'||
       !(uuid.test(b.incidentId)||/^[a-f0-9]{64}(?![\s\S])/.test(b.incidentId))||typeof b.reviewRef!=='string'||
       !/^[^\u0000-\u001f\u007f]{1,200}$/.test(b.reviewRef))throw new HttpFault(400,'invalid');
      send(200,await store.videoBillingUnblockReceipt(b.identityKey,b.incidentId,b.reviewRef));return;
     }
     const b=await json(req,['identityKey','incidentId']);
     if(typeof b.identityKey!=='string'||!/^[a-f0-9]{64}(?![\s\S])/.test(b.identityKey)||typeof b.incidentId!=='string'||!(uuid.test(b.incidentId)||/^[a-f0-9]{64}(?![\s\S])/.test(b.incidentId)))throw new HttpFault(400,'invalid');
     if(url.pathname.endsWith('/status')){send(200,await store.videoBillingHold(b.identityKey,b.incidentId));return;}
     const result=await store.blockVideoBilling(b.identityKey,b.incidentId);send(result.created?201:200,result);return;
    }
    const match=/^\/api\/internal\/video\/reservations\/([a-f0-9-]{36})\/(status|resolution|capture|release|seal|admit)$/.exec(url.pathname);
    if(match){
     if([...url.searchParams.keys()].length)throw new HttpFault(400,'invalid');
     const action=match[2];
     if(action!=='status'&&caller.email!==internal.settlementCaller)throw new HttpFault(403,'forbidden');
     const fields=action==='status'?['identityKey']:action==='admit'?['identityKey','seconds','jobId','attemptId','callKey','model','requestSha256']:action==='capture'?['identityKey','seconds','jobId','attemptId','capturedSeconds']:action==='release'?['identityKey','seconds','jobId','attemptId','resolutionKind','evidenceSha256']:['identityKey','seconds'];
     const b=await json(req,fields);
     if(!uuid.test(match[1])||typeof b.identityKey!=='string'||!/^[a-f0-9]{64}(?![\s\S])/.test(b.identityKey))throw new HttpFault(400,'invalid');
     if(action!=='status'&&(!Number.isSafeInteger(b.seconds)||Number(b.seconds)<1||Number(b.seconds)>600))throw new HttpFault(400,'invalid');
     if((action==='capture'||action==='admit')&&(typeof b.jobId!=='string'||!uuid.test(b.jobId)||typeof b.attemptId!=='string'||!uuid.test(b.attemptId)))throw new HttpFault(400,'invalid');
     if(action==='capture'&&b.capturedSeconds!==undefined&&(!Number.isSafeInteger(b.capturedSeconds)||Number(b.capturedSeconds)<1||Number(b.capturedSeconds)>=Number(b.seconds)))throw new HttpFault(400,'invalid');
     // A release after a provider admission carries the admission and Video's resolution together; any partial set is refused here.
     const claim=['jobId','attemptId','resolutionKind','evidenceSha256'].filter(k=>b[k]!==undefined);
     if(action==='release'&&claim.length>0&&(claim.length!==4||typeof b.jobId!=='string'||!uuid.test(b.jobId)||typeof b.attemptId!=='string'||!uuid.test(b.attemptId)||typeof b.resolutionKind!=='string'||!['no_speech','not_delivered','unknown_expired'].includes(b.resolutionKind)||typeof b.evidenceSha256!=='string'||!/^[a-f0-9]{64}(?![\s\S])/.test(b.evidenceSha256)))throw new HttpFault(400,'invalid');
     if(action==='admit'&&(typeof b.callKey!=='string'||!(/^(text-window|voice-chunk):\d{4}(?![\s\S])/.test(b.callKey))||typeof b.requestSha256!=='string'||!/^[a-f0-9]{64}(?![\s\S])/.test(b.requestSha256)||b.model!==(b.callKey.startsWith('text-window:')?'gemini-3.8-flash':'gemini-3.8-flash-tts')))throw new HttpFault(400,'invalid');
     if(action==='status'){const result=await store.videoReservation(b.identityKey,match[1]);send(200,{...result,reservationId:match[1]});return;}
     if(action==='resolution'){const result=await store.videoReservationResolution(b.identityKey,match[1],b.seconds as number);send(200,result);return;}
     if(action==='seal'){const result=await store.sealVideoReservation(b.identityKey,match[1],b.seconds as number);send(result.created?201:200,result);return;}
     if(action==='admit'){const result=await store.admitVideoCall(b.identityKey,match[1],b.seconds as number,b.jobId as string,b.attemptId as string,b.callKey as string,b.model as string,b.requestSha256 as string);send(result.created?201:200,result);return;}
     const admission=action==='capture'||action==='release'&&claim.length===4?{jobId:b.jobId as string,attemptId:b.attemptId as string}:undefined;
     const options=action==='capture'&&b.capturedSeconds!==undefined?{capturedSeconds:b.capturedSeconds as number}:action==='release'&&claim.length===4?{resolution:{kind:b.resolutionKind,evidenceSha256:b.evidenceSha256}}:undefined;
     const result=options?await store.settleVideo(b.identityKey,match[1],action as 'capture'|'release',b.seconds as number,admission,options):await store.settleVideo(b.identityKey,match[1],action as 'capture'|'release',b.seconds as number,admission);send(200,{...result,reservationId:match[1]});return;
    }
    throw new HttpFault(404,'not_found');
   }
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
   if(error instanceof AccountFault){const statuses={invalid:400,not_found:404,account_not_provisioned:404,conflict:409,deleted:410,quota:429,insufficient:402,invariant:503,too_early:409};send(statuses[error.code],{error:error.code==='invariant'?'unavailable':error.code});return;}
   // No user identifiers, bodies, URLs, token contents, SDK errors or content in logs.
   send(503,{error:'unavailable'});
  }
 };
}
