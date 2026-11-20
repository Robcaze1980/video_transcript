/**
 * LV-019.B piece D: configuration of the operator endpoint, read from the environment.
 * Fail closed. Nothing here has a default: an absent or malformed variable switches the endpoint off (or only its writes, for the
 * reauthentication window). The report of what is missing lists variable NAMES only, never a value.
 *   VISTAVO_OPERATOR_UIDS               comma-separated Firebase UIDs allowed to act as operators
 *   VISTAVO_OPERATOR_SECRET             server secret (>= 32 characters) for the author pseudonym
 *   VISTAVO_OPERATOR_REAUTH_SEC         reauthentication window for writes, positive integer seconds
 *   VISTAVO_OPERATOR_RATE_MAX           writes allowed per operator per window, positive integer
 *   VISTAVO_OPERATOR_RATE_WINDOW_SEC    rate-limit window, positive integer seconds
 */
import type {DocumentReference,Firestore} from 'firebase-admin/firestore';
import type {OperatorHttpConfig} from './billingOperatorHttp';

export interface OperatorEnvDeps{
  db:Firestore;root:DocumentReference;verifier:OperatorHttpConfig['verifier'];now:()=>number;log:(entry:Record<string,unknown>)=>void;
}
export interface OperatorEnvResult{
  /** Ready to hand to `billingOperatorHttp`; when `enabled` is false the endpoint answers 404 on every route. */config:OperatorHttpConfig;
  enabled:boolean;writesEnabled:boolean;/** Variable names that are absent or malformed; never values. */missing:string[];
}
const UID=/^[A-Za-z0-9_.:@-]{1,128}$/,COUNT=/^[1-9]\d{0,8}$/;

/**
 * In-memory sliding-window limiter, per key. Per process only: a service with several instances needs a shared one.
 * `maxKeys` bounds the distinct keys tracked at once; a new key beyond it is refused (fail closed) until an old one expires.
 */
export function createRateLimiter(o:{max:number;windowMs:number;now:()=>number;maxKeys?:number}){
  if(!Number.isSafeInteger(o.max)||o.max<1||!Number.isSafeInteger(o.windowMs)||o.windowMs<1)throw Error('Invalid rate limit');
  if(o.maxKeys!==undefined&&(!Number.isSafeInteger(o.maxKeys)||o.maxKeys<1))throw Error('Invalid rate limit');
  const calls=new Map<string,number[]>();
  const limiter=(key:string):boolean=>{
    let now:number;try{now=o.now();}catch{return false;}
    if(!Number.isSafeInteger(now)||now<0)return false;
    const cutoff=now-o.windowMs;
    for(const [k,times] of calls){const live=times.filter(t=>t>cutoff);if(live.length)calls.set(k,live);else calls.delete(k);}
    const own=calls.get(key)??[];
    if(!calls.has(key)&&o.maxKeys!==undefined&&calls.size>=o.maxKeys)return false;
    if(own.length>=o.max)return false; // a refused call is not recorded, so it cannot extend the block
    own.push(now);calls.set(key,own);return true;
  };
  return Object.assign(limiter,{size:()=>calls.size});
}

export function operatorConfigFromEnv(env:Record<string,string|undefined>,deps:OperatorEnvDeps):OperatorEnvResult{
  const missing:string[]=[];
  const rawUids=env.VISTAVO_OPERATOR_UIDS;let operators=new Set<string>();
  if(typeof rawUids==='string'){
    const parts=rawUids.split(',').map(p=>p.trim());
    // One malformed entry (an empty one included) invalidates the whole list: a typo must never silently reshape who may act.
    if(parts.every(p=>UID.test(p)))operators=new Set(parts);
  }
  if(operators.size===0)missing.push('VISTAVO_OPERATOR_UIDS');
  const secret=env.VISTAVO_OPERATOR_SECRET,secretOk=typeof secret==='string'&&secret.length>=32;
  if(!secretOk)missing.push('VISTAVO_OPERATOR_SECRET');
  const count=(name:string):number|undefined=>{const v=env[name];if(typeof v==='string'&&COUNT.test(v))return Number(v);missing.push(name);return undefined;};
  const reauth=count('VISTAVO_OPERATOR_REAUTH_SEC'),rateMax=count('VISTAVO_OPERATOR_RATE_MAX'),rateWindow=count('VISTAVO_OPERATOR_RATE_WINDOW_SEC');
  const limiter=rateMax!==undefined&&rateWindow!==undefined?createRateLimiter({max:rateMax,windowMs:rateWindow*1000,now:deps.now,maxKeys:operators.size||1}):undefined;
  const config:OperatorHttpConfig={db:deps.db,root:deps.root,operators,secret:secretOk?secret:'',reauthWindowSec:reauth,limiter,now:deps.now,log:deps.log,verifier:deps.verifier};
  const enabled=operators.size>0&&secretOk&&limiter!==undefined&&typeof deps.verifier?.verifyIdToken==='function'&&typeof deps.now==='function'&&typeof deps.log==='function';
  return {config,enabled,writesEnabled:enabled&&reauth!==undefined,missing};
}
