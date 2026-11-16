import {FirestoreAi,AiFault} from './firestoreAi';
import {AiContractFault} from './aiContracts';
import {aiHttp} from './firestoreAiHttp';
import type {IncomingMessage, ServerResponse} from 'node:http';
import type {FirebaseIdentity} from './firebaseAccess';
import {verifiedFirebaseUser} from './firebaseAccess';
import {FirestoreBackend, LedgerFault} from './firestoreBackend';
import {FirestoreFiles,FileFault} from './firestoreFiles';
import {ObjectFault} from './gcsObjects';
import {pipeline} from 'node:stream/promises';
import {withCloudDiagnostics,diagnosticStage,cloudDiagnosticError} from './cloudDiagnostics';
import type {LocalTextFixture} from './localTextFixture';

class HttpFault extends Error {constructor(readonly status: number) {super('request rejected');}}
async function body(req: IncomingMessage, allowed: readonly string[]) {
  // A valid 64 KiB draft can expand up to sixfold through JSON escaping.
  const limit = 400000;
  if (Number(req.headers['content-length']) > limit) {req.resume(); throw new HttpFault(413);}
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') {req.resume(); throw new HttpFault(415);}
  const chunks: Buffer[] = []; let size = 0;
  for await (const part of req.iterator({destroyOnReturn: false})) {
    size += part.length;
    if (size > limit) {req.resume(); throw new HttpFault(413);}
    chunks.push(part);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw Error();
    return value;
  } catch {throw new HttpFault(400);}
}

/** Private cloud candidate API. No credit, provider completion or reconciliation routes. */
export function firestoreHttp(options: {
  backend: FirestoreBackend; identity: Pick<FirebaseIdentity, 'verifyIdToken'>; origin: string;
  // Server catalog only. Null disables processing while providers/artifacts are not integrated.
  quote?: (accountId: string, inputId: string, operation: string) => Promise<number>;
  files?:FirestoreFiles;
  nudgeFile?:(uploadId:string,role:'validate'|'cleanup')=>Promise<void>;
  ai?:FirestoreAi;
  textFixture?:LocalTextFixture;
  authorizeUser?:(uid:string)=>Promise<boolean>;
}) {
  const origin = new URL(options.origin);
  if (origin.origin !== options.origin || (origin.protocol !== 'https:' && origin.hostname !== '127.0.0.1')) throw Error('Invalid API origin');
  return async (req: IncomingMessage, res: ServerResponse) => {
    return withCloudDiagnostics(async traceId=>{
    res.setHeader('X-Vistavo-Trace',traceId);
    const send = (status: number, value: unknown) => {res.writeHead(status, {'Content-Type':'application/json; charset=utf-8',
      'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
    try {
      const pathname = new URL(req.url ?? '/', options.origin).pathname;
      if (req.method === 'GET' && pathname === '/healthz') {send(200,{status:'ok'});return;}
      // Bearer-only API; cross-site writes do not receive a permissive CORS response.
      if (req.headers.origin && req.headers.origin !== options.origin) throw new HttpFault(403);
      const token = /^Bearer ([^\s]+)$/.exec(req.headers.authorization ?? '')?.[1];
      if (!token || token.length > 7000) throw new HttpFault(401);
      let user;
      try {user = await diagnosticStage('auth',()=>options.identity.verifyIdToken(token, true));} catch {throw new HttpFault(401);}
      if (!verifiedFirebaseUser(user)) throw new HttpFault(403);
      if(options.authorizeUser&&!await diagnosticStage('authorization',()=>options.authorizeUser!(user.uid)))throw new HttpFault(403);
      const accountId = await options.backend.accountForUid(user.uid);
      if(options.ai&&await diagnosticStage('routing',()=>aiHttp(req,res,accountId,options.ai!,body,send)))return;
      if(options.textFixture&&await options.textFixture.handle(req,res,accountId,body,send))return;
      if (pathname === '/api/cloud/me' && req.method === 'GET') {send(200,{id:accountId,balance:await options.backend.readBalance(accountId)});return;}
      const files=options.files;
      const nudge=async(id:string,role:'validate'|'cleanup')=>{try{await options.nudgeFile?.(id,role);}catch{/* Durable outbox is recovered independently. */}};
      if(files&&pathname==='/api/cloud/uploads'&&req.method==='POST'){
        const data=await body(req,['name','size','sha256','requestKey']);send(201,await files.begin(accountId,data.name,data.size,data.sha256,data.requestKey));return;
      }
      const upload=/^\/api\/cloud\/uploads\/([a-f0-9-]{36})(?:\/(chunks|complete|content))?$/.exec(pathname);
      if(files&&upload){
        const id=upload[1],action=upload[2];
        if(!action&&req.method==='GET'){send(200,await files.status(accountId,id));return;}
        if(!action&&req.method==='DELETE'){const value=await files.remove(accountId,id);await nudge(id,'cleanup');send(202,value);return;}
        if(action==='chunks'&&req.method==='PUT'){
          const declared=Number(req.headers['content-length']);if(declared>files.limits.chunkBytes){req.resume();throw new HttpFault(413);}
          if(req.headers['content-type']!=='application/octet-stream'){req.resume();throw new HttpFault(415);}
          const offset=new URL(req.url!,options.origin).searchParams.get('offset');if(!offset||!/^\d+$/.test(offset))throw new HttpFault(400);
          let count=0;const chunks:Buffer[]=[];
          for await(const part of req.iterator({destroyOnReturn:false})){count+=part.length;if(count>files.limits.chunkBytes){req.resume();throw new HttpFault(413);}chunks.push(part);}
          send(200,await files.append(accountId,id,Number(offset),Buffer.concat(chunks)));return;
        }
        if(action==='complete'&&req.method==='POST'){
          await body(req,[]);const value=await files.complete(accountId,id);await nudge(id,'validate');send(202,value);return;
        }
        if(action==='content'&&['GET','HEAD'].includes(req.method!)){
          const value=await files.download(accountId,id),size=value.object.size,etag='"gcs-'+value.object.generation+'"';
          const raw=req.headers['if-range']&&req.headers['if-range']!==etag?undefined:req.headers.range;
          let range:{start:number;end:number}|undefined;
          if(raw){const m=typeof raw==='string'?/^bytes=(\d*)-(\d*)$/.exec(raw):null;
            const invalid=()=>{res.setHeader('Content-Range','bytes */'+size);throw new HttpFault(416);};
            if(!m||(!m[1]&&!m[2]))invalid();
            if(!m![1]){const tail=Number(m![2]);if(!Number.isSafeInteger(tail)||tail<1)invalid();range={start:Math.max(0,size-tail),end:size-1};}
            else{const start=Number(m![1]),end=m![2]?Number(m![2]):size-1;
              if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=size||end<start)invalid();range={start,end:Math.min(end,size-1)};}
          }
          const length=range?range.end-range.start+1:size;
          const headers:Record<string,string>={'Content-Type':'video/mp4','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
            'Accept-Ranges':'bytes','Content-Disposition':'inline; filename="video.mp4"','ETag':etag};
          if(range)headers['Content-Range']=`bytes ${range.start}-${range.end}/${size}`;
          // Cloud Run HTTP/1 requires streaming/chunked responses beyond its buffered limit.
          if(length<=30*1024*1024||req.method==='HEAD')headers['Content-Length']=String(length);
          if(req.method==='HEAD'){res.writeHead(range?206:200,headers);res.end();return;}
          const stream=await files.objects.read(value.object,range);res.writeHead(range?206:200,headers);await pipeline(stream,res);return;
        }
      }
      const project = /^\/api\/cloud\/projects\/([a-f0-9-]{36})$/.exec(pathname);
      if (project && req.method === 'GET') {send(200,await options.backend.readProject(accountId,project[1]));return;}
      if (project && req.method === 'PUT') {
        const data=await body(req,['expectedRevision','draft']);
        send(200,await options.backend.saveProject(accountId,project[1],data.expectedRevision,data.draft));return;
      }
      const job = /^\/api\/cloud\/jobs\/([a-f0-9-]{36})$/.exec(pathname);
      if (job && req.method === 'GET') {
        const value=await options.backend.job(accountId,job[1]);
        send(200,{id:job[1],inputId:value.inputId,state:value.state,price:value.price});return;
      }
      if (job && req.method === 'DELETE') {
        await options.backend.cancel(accountId,job[1]);
        const value=await options.backend.job(accountId,job[1]);
        send(200,{cancelled:value.state === 'cancelled',state:value.state});return;
      }
      if (pathname === '/api/cloud/jobs' && req.method === 'POST') {
        if (!options.quote) throw new HttpFault(503);
        const data = await body(req,['inputId','requestKey','operation','expectedRevision']);
        if (!['transcript:es','translation:en','narration:en:female','narration:en:male'].includes(data.operation) ||
            typeof data.expectedRevision !== 'number') throw new HttpFault(400);
        const prior = await options.backend.priorRequest(accountId,data.inputId,data.requestKey,data.operation,data.expectedRevision);
        if (prior) {send(202,{id:prior});return;}
        // Owner check before quote; expectedRevision is rechecked atomically with reservation.
        await options.backend.readProject(accountId,data.inputId);
        const price = await options.quote(accountId,data.inputId,data.operation);
        const id = await options.backend.reserve(accountId,data.inputId,data.requestKey,price,data.operation,data.expectedRevision);
        send(202,{id});return;
      }
      throw new HttpFault(404);
    } catch (error) {
      if(res.headersSent){cloudDiagnosticError(error);res.destroy();return;}
      if(error instanceof AiFault){const codes={invalid:400,not_found:404,conflict:409,disabled:503,unknown:409};send(codes[error.code],{error:error.code});return;}
      if(error instanceof AiContractFault){send(error.code==='quota'?429:400,{error:error.code});return;}
      if(error instanceof FileFault){const codes={invalid:400,not_found:404,conflict:409,expired:410,quota:429,invariant:500,unavailable:503};send(codes[error.code],{error:error.code==='invariant'?'internal':error.code});return;}
      if(error instanceof ObjectFault){send(error.code==='missing'?404:503,{error:'unavailable'});return;}
      const code = error instanceof LedgerFault ? error.code : null;
      const status = error instanceof HttpFault ? error.status : code === 'not_found' ? 404 : code === 'conflict' ? 409 : code === 'insufficient' ? 402 : code === 'invalid' ? 400 : 500;
      if(status===500){
        cloudDiagnosticError(error);
      }
      send(status,{error:status === 500 ? 'internal' : code ?? 'request_rejected'});
    }
    },()=>res.statusCode);
  };
}
