/**
 * LV-019.B piece D: operator endpoint for acknowledging/resolving pending-billing alerts.
 * Design and the full condition -> code table: docs/specs/LV-019-B-conciliacion-endpoint-d-diseno.md
 *
 * Mounted ONLY by `billingOperatorLocal.ts`, a loopback/emulator-only server; no cloud entry imports it (a test enforces
 * that). It is also disabled by itself (every route answers 404) unless ALL of the following are configured: a non-empty
 * operator list, a server secret, a rate limiter, a token verifier, a clock and a log; writes additionally need the
 * reauthentication window. `billingOperatorConfig.ts` reads them from the environment with no defaults. It never moves
 * balance, never edits a billing row and never reads or writes account data.
 * - Identity: Firebase ID token verified with revocation check, e-mail verified, UID on the operator list.
 * - Author: derived here with a keyed hash (`operatorPseudonym`); the request cannot supply it, nor the clock.
 * - Not an operator, disabled route and missing alert are indistinguishable (same 404).
 */
import {createHmac} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {DocumentReference,Firestore} from 'firebase-admin/firestore';
import {ALERT_COLLECTION,ALERT_PAGE_SIZE,alertIdentity} from './billingPendingAlerts';
import {AUDIT_COLLECTION,AuditFault,auditId,recordDisposition,type AuditAction} from './billingPendingAudit';

export interface OperatorHttpConfig{
  db:Firestore;root:DocumentReference;
  /** Firebase UIDs allowed to act as operators. Empty = the whole endpoint is off. */operators:ReadonlySet<string>;
  /** Server secret for the author pseudonym; at least 32 characters. Absent/short = off. */secret:string;
  /** Reauthentication window in seconds for writes; no default. Absent/invalid = writes are off. */reauthWindowSec?:number;
  /** Per-operator write limiter (keyed by pseudonym); the service's existing mechanism is injected. Absent = off. */limiter?:(key:string)=>boolean|Promise<boolean>;
  now:()=>number;log:(entry:Record<string,unknown>)=>void;
  verifier:{verifyIdToken:(token:string,checkRevoked:true)=>Promise<{uid:string;email_verified?:boolean;auth_time?:number}>};
}
const BASE='/api/operator/billing-alerts',MAX_BODY=8192; // MAX_BODY is an input bound: evidence <=200 and note <=500 characters
const hex64=/^[a-f0-9]{64}$/;

/** Stable, keyed pseudonym of an operator; not computable without the server secret. */
export function operatorPseudonym(secret:string,uid:string):string{
  return 'op-'+createHmac('sha256',secret).update('operator-v1:'+uid).digest('hex').slice(0,16);
}
class Stop extends Error{constructor(readonly status:number,readonly body:Record<string,unknown>){super(String(status));}}
const notFound=()=>new Stop(404,{code:'not_found'}),unauthorized=()=>new Stop(401,{code:'unauthorized'});
const asRecord=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};

async function readBody(req:IncomingMessage):Promise<Record<string,unknown>>{
  if(req.headers['content-type']?.split(';')[0]?.trim().toLowerCase()!=='application/json')throw new Stop(415,{code:'content_type'});
  if(Number(req.headers['content-length'])>MAX_BODY)throw new Stop(413,{code:'too_large'});
  const chunks:Buffer[]=[];let size=0;
  for await(const part of req.iterator({destroyOnReturn:false})){size+=part.length;if(size>MAX_BODY){req.resume();throw new Stop(413,{code:'too_large'});}chunks.push(part as Buffer);}
  let data:unknown;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw new Stop(400,{code:'invalid'});}
  if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(k=>k!=='evidenceRef'&&k!=='note'))throw new Stop(400,{code:'invalid'});
  return data as Record<string,unknown>;
}
const publicAlert=(i:NonNullable<ReturnType<typeof alertIdentity>>,d:Record<string,unknown>)=>({
  alertKey:undefined as string|undefined,kind:i.kind,rowId:i.rowId,state:i.state,reason:i.reason,status:i.status,seenCount:d.seenCount,firstSeenAtMs:d.firstSeenAtMs,lastSeenAtMs:d.lastSeenAtMs,
  acknowledgedAtMs:d.acknowledgedAtMs??null,acknowledgedBy:d.acknowledgedBy??null,dispositionedAtMs:d.dispositionedAtMs??null,dispositionedBy:d.dispositionedBy??null,
});

/** Returns a handler that resolves `false` for paths outside the operator prefix (so it can be composed), `true` otherwise. */
export function billingOperatorHttp(config:OperatorHttpConfig){
  const enabled=config.operators.size>0&&typeof config.secret==='string'&&config.secret.length>=32&&typeof config.limiter==='function'&&
    typeof config.verifier?.verifyIdToken==='function'&&typeof config.now==='function'&&typeof config.log==='function';
  const windowOk=Number.isSafeInteger(config.reauthWindowSec)&&(config.reauthWindowSec as number)>=1;
  return async(req:IncomingMessage,res:ServerResponse):Promise<boolean>=>{
    const url=new URL(req.url??'/','http://localhost');
    if(url.pathname!==BASE&&!url.pathname.startsWith(BASE+'/'))return false;
    const entry:{event:string;action:string|null;alertKey:string|null;actor:string|null;code:number}={event:'operator-billing-alert',action:null,alertKey:null,actor:null,code:0};
    const send=(status:number,body:unknown)=>{
      entry.code=status;
      res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store',Vary:'Authorization','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
      res.end(JSON.stringify(body));
    };
    try{
      const parts=url.pathname.slice(BASE.length).split('/').filter(Boolean);
      let route:'list'|'detail'|AuditAction|null=null,key:string|null=null;
      if(parts.length===0&&req.method==='GET')route='list';
      else if(parts.length===1&&hex64.test(parts[0])&&req.method==='GET'){route='detail';key=parts[0];}
      else if(parts.length===2&&hex64.test(parts[0])&&(parts[1]==='acknowledge'||parts[1]==='resolve')&&req.method==='POST'){route=parts[1];key=parts[0];}
      entry.action=route;entry.alertKey=key;
      const write=route==='acknowledge'||route==='resolve';
      // An invalid clock is a misconfiguration: fail closed like a disabled route (a NaN clock must never pass a freshness check).
      let nowMs=Number.NaN;
      if(enabled){try{nowMs=config.now();}catch{/* a throwing clock is an invalid clock */}}
      if(!enabled||route===null||req.headers.origin!==undefined||(write&&!windowOk)||!Number.isSafeInteger(nowMs)||nowMs<0)throw notFound();

      // Identity first; the RESPONSE never tells a non-operator anything about alerts (the access log, server-side only, still
      // records the attempt for monitoring). Knowing that the endpoint is switched on is not treated as sensitive.
      const bearer=/^Bearer ([A-Za-z0-9_.-]{1,7000})$/.exec(req.headers.authorization??'')?.[1];
      if(!bearer)throw unauthorized();
      let token;try{token=await config.verifier.verifyIdToken(bearer,true);}catch{throw unauthorized();}
      if(!token||token.email_verified!==true||typeof token.uid!=='string'||!token.uid)throw unauthorized();
      if(!config.operators.has(token.uid))throw notFound();
      const actor=operatorPseudonym(config.secret,token.uid);entry.actor=actor;
      if(write){
        const nowSec=Math.floor(nowMs/1000),authTime=token.auth_time;
        // Positive form: anything that is not provably fresh (missing, NaN, future, stale) is rejected.
        if(!(typeof authTime==='number'&&Number.isSafeInteger(authTime)&&authTime<=nowSec&&nowSec-authTime<=(config.reauthWindowSec as number)))throw new Stop(401,{code:'reauth_required'});
      }
      // Only the list route accepts a query string, and only a validated paging cursor.
      const queryKeys=[...url.searchParams.keys()],after=url.searchParams.get('after');
      if(queryKeys.length&&!(route==='list'&&queryKeys.length===1&&queryKeys[0]==='after'&&after!==null&&hex64.test(after)&&url.searchParams.getAll('after').length===1))throw new Stop(400,{code:'invalid'});

      if(route==='list'){
        let query=config.root.collection(ALERT_COLLECTION).where('status','==','open').orderBy('__name__');
        if(after)query=query.startAfter(config.root.collection(ALERT_COLLECTION).doc(after));
        // One extra row tells an exactly-full page from a truncated one.
        const page=await query.limit(ALERT_PAGE_SIZE+1).get();
        const docs=page.docs.slice(0,ALERT_PAGE_SIZE),more=page.docs.length>ALERT_PAGE_SIZE;
        let corrupt=0;const alerts=[];
        for(const doc of docs){
          const data=doc.data() as Record<string,unknown>,identity=alertIdentity({exists:true,id:doc.id,data:()=>data});
          if(!identity){corrupt++;continue;}
          alerts.push({...publicAlert(identity,data),alertKey:doc.id});
        }
        send(200,{alerts,truncated:more,next:more?docs[docs.length-1].id:null,corrupt});return true;
      }
      if(route==='detail'){
        const alert=await config.root.collection(ALERT_COLLECTION).doc(key!).get();
        if(!alert.exists)throw notFound();
        const data=alert.data() as Record<string,unknown>,identity=alertIdentity(alert);
        if(!identity)throw new Stop(422,{code:'corrupt'});
        const records=[];
        for(const action of ['acknowledge','resolve'] as const){
          const a=await config.root.collection(AUDIT_COLLECTION).doc(auditId(key!,action)).get();
          if(a.exists){const d=a.data() as Record<string,unknown>;records.push({action:d.action,authorizedBy:d.authorizedBy,createdAtMs:d.createdAtMs,evidenceRef:d.evidenceRef??null,note:d.note??null,observedRowState:d.observedRowState??null});}
        }
        send(200,{alert:{...publicAlert(identity,data),alertKey:key},audit:records});return true;
      }

      // Writes: rate limit per verified operator, then the strict body, then the audited library call.
      if(!await config.limiter!(actor))throw new Stop(429,{code:'rate_limited'});
      const body=await readBody(req);
      try{
        const out=await recordDisposition(config.db,config.root,key!,route as AuditAction,{authorizedBy:actor,evidenceRef:body.evidenceRef as string|undefined,note:body.note as string|undefined},config.now());
        send(out.replayed?200:201,{replayed:out.replayed,action:route,alertKey:key,auditId:auditId(key!,route as AuditAction)});
      }catch(error){
        if(!(error instanceof AuditFault))throw error;
        if(error.code==='invalid')throw new Stop(400,{code:'invalid'});
        if(error.code==='not_found')throw notFound();
        if(error.code==='corrupt')throw new Stop(422,{code:'corrupt'});
        if(error.code!=='conflict')throw error; // anything unexpected is a loud 500, never disguised as a conflict
        // Conflict: show the person the record that already exists (pseudonym only), never someone's evidence or note.
        const existing=await config.root.collection(AUDIT_COLLECTION).doc(auditId(key!,route as AuditAction)).get();
        const d=existing.exists?asRecord(existing.data()):null;
        throw new Stop(409,{code:'conflict',existing:d?{action:d.action,authorizedBy:d.authorizedBy,createdAtMs:d.createdAtMs}:null});
      }
      return true;
    }catch(error){
      if(error instanceof Stop)send(error.status,error.body);
      else send(500,{code:'error'});
      return true;
    }finally{
      try{config.log({...entry});}catch{/* logging must never change the response */}
    }
  };
}
