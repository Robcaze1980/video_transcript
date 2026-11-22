/**
 * LV-019.B step 1.6b (second part): the periodic drain executor SECTION of the maintenance pass.
 * It runs the certified drains in the design order (holds, billing intents/outbox, holds again, expired-unknown
 * resolver) under ONE lease, with ONE budget per section, rotation cursors per kind, a per-account cap and a
 * per-kind row ceiling. It NEVER throws: every failure is a count in an `error`/`partial` value.
 *
 * Isolation: the section receives `ai` (drains) and `backend` (unknown resolver) as PARAMETERS. It value-imports only
 * the certified lease module: never the Cuenta client, the Video backend or the AI drain module, so a load failure of
 * one of those can never take down the maintenance pass by import. `backend.resolveExpiredUnknown` is optional.
 *
 * The lease is an optimization, never the safety guarantee: Cuenta is idempotent per action and reservation, and Video
 * compares atomically. What the lease buys is less redundant work and fewer false positives. Renewal runs every 10 s
 * through an unref timer that is ALWAYS cleared when the pass ends. Before each row `shouldContinue` checks the section
 * deadline AND that the lease is still held with the certified 15 s margin; a lost lease ends the pass cleanly without
 * touching more rows (`partial`).
 *
 * The heartbeat is exactly one single-line JSON record per run with the timestamps, the outcome, the lease token and
 * COUNTS ONLY: never an account id, a row id or any row content, including when disabled, skipped or failed.
 *
 * Budget: 60 s total by default, split holds-before 12 s, billing (intents+outbox share the drain's single control)
 * 26 s, holds-after 8 s, unknown 9 s and age 5 s (step 1.6c; the last section takes any rounding remainder).
 * Deadlines are taken one after another, so no section can consume another's
 * time, and once a section's deadline passes it takes no new row. Design: docs/specs/LV-019-B-ejecutor-periodico-drenajes.md (3.1-3.6).
 */
import {performance} from 'node:perf_hooks';
import {randomUUID} from 'node:crypto';
import type {DocumentReference,Firestore} from 'firebase-admin/firestore';
import {
  acquireDrainLease,
  renewDrainLease,
  releaseDrainLease,
  assertDrainLeaseHeld,
  getDrainCursor,
  setDrainCursor,
  DEFAULT_DRAIN_LEASE_RENEW_EVERY_MS,
  type DrainCursorKind,
} from './billingDrainLease';

export type BillingDrainOutcome='ok'|'partial'|'error'|'disabled'|'skipped';
export type BillingDrainSkipReason='lease_held'|'in_flight';
/** Wall-clock budget of one pass; the maintenance pass passes the same 60 s explicitly. */
export const BILLING_DRAIN_BUDGET_MS=60_000;
export const BILLING_DRAIN_PER_ACCOUNT_CAP=5;
export const BILLING_DRAIN_MAX_ROWS_PER_KIND=100;
const MAX_BUDGET_MS=60_000;
const MIN_CAP=1,MAX_CAP=100,MIN_ROWS=1,MAX_ROWS=100;

/** The section of the pass a budget belongs to; billing covers intents and outbox (one shared drain control). */
export const DRAIN_SECTIONS=['holdsBefore','billing','holdsAfter','unknown','age'] as const;
export type DrainSection=typeof DRAIN_SECTIONS[number];
/** Default split of the 60 s budget: 12 + 26 + 8 + 9 + 5; a different total scales the same proportions. */
const DEFAULT_SPLIT:Record<DrainSection,number>={holdsBefore:12,billing:26,holdsAfter:8,unknown:9,age:5};
const DEFAULT_SPLIT_TOTAL=Object.values(DEFAULT_SPLIT).reduce((total,part)=>total+part,0);

export interface BillingDrainSectionAi{
  drainExternalHolds(limit:number,control?:unknown):Promise<unknown>;
  drainExternalBilling(limit:number,control?:unknown):Promise<unknown>;
}
export interface BillingDrainSectionBackend{
  /** Step 1.2. An absent method is a version without the resolver: the section is then simply skipped. */
  resolveExpiredUnknown?(options:{now:number;limit:number;after?:string|null;shouldContinue?:()=>boolean|Promise<boolean>}):Promise<unknown>;
  /** Step 1.6c. An absent method is a version without the age escalation: the section is then simply skipped. */
  escalateStaleBillingRows?(options:{now:number;limit:number;after?:string|null;shouldContinue?:()=>boolean|Promise<boolean>}):Promise<unknown>;
}
export interface BillingDrainLeaseOps{
  acquire(options:{db:Firestore;root:DocumentReference;holderId:string;now:number}):Promise<{acquired:true;token:number}|{acquired:false;reason:'held'}>;
  renew(options:{db:Firestore;root:DocumentReference;holderId:string;token:number;now:number;maxTenureMs?:number}):Promise<boolean>;
  release(options:{db:Firestore;root:DocumentReference;holderId:string;token:number}):Promise<boolean>;
  assertHeld(options:{db:Firestore;root:DocumentReference;holderId:string;token:number;now:number}):Promise<boolean>;
  getCursor(options:{db:Firestore;root:DocumentReference;kind:DrainCursorKind}):Promise<string|null>;
  setCursor(options:{db:Firestore;root:DocumentReference;kind:DrainCursorKind;holderId:string;token:number;cursor:string|null;now:number}):Promise<boolean>;
}
export interface BillingDrainSectionOptions{
  db:Firestore;root:DocumentReference;ai:BillingDrainSectionAi;backend:BillingDrainSectionBackend;
  /** Clock value in epoch ms for the lease acquisition and the unknown resolver's `now`. */
  now:number;enabled?:boolean;
  /** Lease holder label; a random one per pass unless a caller pins it. */
  holderId?:string;log?:(line:string)=>void;budgetMs?:number;
  sectionBudgetsMs?:Partial<Record<DrainSection,number>>;
  perAccountCap?:number;maxRowsPerKind?:number;
  /** Clock for budgets, the pre-row margin and the renewal; defaults to the wall clock. */
  clock?:()=>number;
  /** Injectable only to keep the section testable; the default is the certified lease module. */
  lease?:BillingDrainLeaseOps;
}
export interface BillingDrainSectionResult{
  outcome:BillingDrainOutcome;/** Only on a skip; never part of the heartbeat. */reason?:BillingDrainSkipReason;
  settled:number;failed:number;intentsRecovered:number;intentsFailed:number;
  holds:number;skippedRows:number;unknownResolved:number;staleEscalated:number;leaseToken:number;
}

export const REAL_DRAIN_LEASE_OPS:BillingDrainLeaseOps={
  acquire:options=>acquireDrainLease(options),
  renew:options=>renewDrainLease(options),
  release:options=>releaseDrainLease(options),
  assertHeld:options=>assertDrainLeaseHeld(options),
  getCursor:options=>getDrainCursor(options),
  setCursor:options=>setDrainCursor(options),
};

const asRecord=(value:unknown):Record<string,unknown>|undefined=>value!==null&&typeof value==='object'?value as Record<string,unknown>:undefined;
/** Copies a count and nothing else: a negative, fractional, NaN or non-numeric value becomes 0. */
const count=(value:unknown):number=>typeof value==='number'&&Number.isFinite(value)&&value>=0?Math.floor(value):0;
const integer=(value:unknown,min:number,max:number):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=min&&value<=max;
/** A cursor as the drain reports it: a plain string, or `null` for a full wrap; anything else is ignored. */
const cursorValue=(value:unknown):string|null|undefined=>value===null?null:typeof value==='string'?value:undefined;
type DrainCounts={settled:number;failed:number;intentsRecovered:number;intentsFailed:number;holds:number;skippedRows:number;unknownResolved:number;staleEscalated:number};
const emptyCounts=():DrainCounts=>({settled:0,failed:0,intentsRecovered:0,intentsFailed:0,holds:0,skippedRows:0,unknownResolved:0,staleEscalated:0});

/** Roots whose real pass is still running in this process; keyed by document path, like the alert sweep. */
const inFlight=new Set<string>();
let anonSeq=0;

/** The default split, part by part; the last section takes the remainder so the parts always add up exactly. */
function defaultSectionBudgets(budgetMs:number):Record<DrainSection,number>{
  const out={} as Record<DrainSection,number>;
  let assigned=0;
  for(const section of DRAIN_SECTIONS.slice(0,-1)){
    const share=Math.floor(budgetMs*DEFAULT_SPLIT[section]/DEFAULT_SPLIT_TOTAL);
    out[section]=share;assigned+=share;
  }
  const tail=DRAIN_SECTIONS[DRAIN_SECTIONS.length-1];
  out[tail]=Math.max(0,budgetMs-assigned);
  return out;
}
/** Validates an optional override: only known sections, each a safe integer in the allowed range, and the total must fit the pass budget. */
function sectionBudgets(budgetMs:number,override:Partial<Record<DrainSection,number>>|undefined):Record<DrainSection,number>|null{
  const out=defaultSectionBudgets(budgetMs);
  if(override===undefined)return out;
  const record=asRecord(override);
  if(record===undefined)return null;
  for(const key of Object.keys(record))if(!(DRAIN_SECTIONS as readonly string[]).includes(key))return null;
  let total=0;
  for(const section of DRAIN_SECTIONS){
    const value=record[section];
    if(value===undefined){total+=out[section];continue;}
    if(!integer(value,0,MAX_BUDGET_MS))return null;
    out[section]=value;total+=value;
  }
  return total<=budgetMs?out:null;
}

export async function runBillingDrainSection(options:BillingDrainSectionOptions):Promise<BillingDrainSectionResult>{
  const {db,root,ai,backend,now,enabled=false,log=line=>console.log(line),clock=()=>Date.now(),lease=REAL_DRAIN_LEASE_OPS}=options;
  const started=performance.now();
  const counts=emptyCounts();
  let leaseToken=0;
  const finish=(outcome:BillingDrainOutcome,reason?:BillingDrainSkipReason):BillingDrainSectionResult=>{
    const line=JSON.stringify({event:'billing-drain',startedAtMs:now,durationMs:Math.max(0,Math.round(performance.now()-started)),outcome,...counts,leaseToken});
    try{log(line);}catch{/* a broken logger must never break the pass */}
    return reason===undefined?{outcome,...counts,leaseToken}:{outcome,reason,...counts,leaseToken};
  };
  if(!enabled)return finish('disabled');
  const budgetMs=options.budgetMs??BILLING_DRAIN_BUDGET_MS;
  if(!integer(budgetMs,1,MAX_BUDGET_MS))return finish('error');
  const budgets=sectionBudgets(budgetMs,options.sectionBudgetsMs);
  if(budgets===null)return finish('error');
  const perAccountCap=options.perAccountCap??BILLING_DRAIN_PER_ACCOUNT_CAP;
  const maxRows=options.maxRowsPerKind??BILLING_DRAIN_MAX_ROWS_PER_KIND;
  if(!integer(perAccountCap,MIN_CAP,MAX_CAP)||!integer(maxRows,MIN_ROWS,MAX_ROWS))return finish('error');
  // Stable identity of the root; an unnamed root is never shared, so unrelated roots can never block each other.
  const key=typeof root?.path==='string'&&root.path.length>0?root.path:'anonymous:'+(anonSeq++);
  // Taken before the first await so a hung pass is not re-armed; released when the REAL pass settles, never on a budget.
  if(inFlight.has(key))return finish('skipped','in_flight');
  inFlight.add(key);
  let renewTimer:ReturnType<typeof setInterval>|undefined;
  const stopRenewal=()=>{const handle=renewTimer;renewTimer=undefined;if(handle!==undefined)clearInterval(handle);};
  let acquired=false,holderId='';
  try{
    holderId=options.holderId??'drain-'+randomUUID();
    let leaseLost=false;
    try{
      const result=await lease.acquire({db,root,holderId,now});
      // Another pass owns a live lease: a healthy skip, no error, no row touched.
      if(!result.acquired)return finish('skipped','lease_held');
      leaseToken=result.token;acquired=true;
    }catch{
      return finish('error');
    }
    const token=leaseToken;
    // Renewal is fenced by holderId+token inside the real lease, so a stale holder cannot extend (or keep) it. The
    // tenure ceiling is the pass budget (design 3.2): a renewal loop with a defect can never hold the lease past it.
    renewTimer=setInterval(()=>{
      if(renewTimer===undefined)return;
      // A refused renewal (another holder, an expired lease, an exhausted tenure) is a LOST lease, distinct from the
      // budget: it stops the renewal loop and cuts the pass at the next pre-row gate of ANY section.
      void lease.renew({db,root,holderId,token,now:clock(),maxTenureMs:budgetMs}).then(live=>{if(!live){leaseLost=true;stopRenewal();}}).catch(()=>undefined);
    },DEFAULT_DRAIN_LEASE_RENEW_EVERY_MS);
    const unref=(renewTimer as unknown as {unref?:()=>void}).unref;
    if(typeof unref==='function')unref.call(renewTimer);
    /** A section gate: the section deadline has not passed AND the lease is still held with the certified margin. */
    const gate=(section:DrainSection)=>{
      const deadline=clock()+budgets[section];
      return async():Promise<boolean>=>{
        if(leaseLost)return false;
        if(clock()>=deadline)return false;
        try{
          const held=await lease.assertHeld({db,root,holderId,token,now:clock()});
          if(!held)leaseLost=true;
          return held;
        }catch{leaseLost=true;return false;}
      };
    };
    let partial=false;
    // ONE usage map per pass: the per-account cap covers holds-before, billing and holds-after together, never per section.
    const accountUsage=new Map<string,number>();
    const absorbHolds=(value:unknown)=>{
      const record=asRecord(value);
      if(record===undefined){counts.failed++;partial=true;return;}
      counts.holds+=count(record.applied)+count(record.review);
      counts.failed+=count(record.failed);
      counts.skippedRows+=count(record.skippedRows);
      if(count(record.failed)>0||record.stopped===true)partial=true;
    };
    // ORDER (design 3.3): holds, intents+outbox, holds again, expired-unknown resolver.
    try{absorbHolds(await ai.drainExternalHolds(maxRows,{shouldContinue:gate('holdsBefore'),perAccountCap,maxRows,accountUsage}));}
    catch{counts.failed++;partial=true;}
    // A lost lease ends the pass cleanly: no later section starts, so no further row is touched.
    if(!leaseLost)try{
      const after={intents:await lease.getCursor({db,root,kind:'intents'}),outbox:await lease.getCursor({db,root,kind:'outbox'})};
      const record=asRecord(await ai.drainExternalBilling(maxRows,{shouldContinue:gate('billing'),perAccountCap,maxRows,after,accountUsage}));
      if(record===undefined){counts.failed++;partial=true;}
      else{
        counts.settled+=count(record.settled);counts.failed+=count(record.failed);
        counts.intentsRecovered+=count(record.intentsRecovered);counts.intentsFailed+=count(record.intentsFailed);
        counts.skippedRows+=count(record.skippedRows);
        if(count(record.failed)>0||count(record.intentsFailed)>0||record.stopped===true)partial=true;
        // Cursors are written only while the lease is still held; a refused write is silent (it is an optimization).
        const next=asRecord(record.next);
        const traversed=asRecord(record.traversed);
        if(next!==undefined&&!leaseLost)for(const kind of ['intents','outbox'] as const){
          if(traversed?.[kind]!==true)continue;
          const cursor=cursorValue(next[kind]);
          if(cursor!==undefined)await lease.setCursor({db,root,kind,holderId,token,cursor,now:clock()}).catch(()=>false);
        }
      }
    }catch{counts.failed++;partial=true;}
    if(!leaseLost)try{absorbHolds(await ai.drainExternalHolds(maxRows,{shouldContinue:gate('holdsAfter'),perAccountCap,maxRows,accountUsage}));}
    catch{counts.failed++;partial=true;}
    if(!leaseLost&&typeof backend.resolveExpiredUnknown==='function')try{
      const after=await lease.getCursor({db,root,kind:'unknown'});
      // The resolver shares the same pre-row gate: its own section budget plus the lease margin, row by row.
      const record=asRecord(await backend.resolveExpiredUnknown({now,limit:maxRows,after,shouldContinue:gate('unknown')}));
      if(record===undefined){counts.failed++;partial=true;}
      else{
        counts.unknownResolved+=count(record.resolved);counts.failed+=count(record.failed);
        if(count(record.failed)>0||record.stopped===true)partial=true;
        const next=cursorValue(record.next);
        if(next!==undefined&&!leaseLost)await lease.setCursor({db,root,kind:'unknown',holderId,token,cursor:next,now:clock()}).catch(()=>false);
      }
    }catch{counts.failed++;partial=true;}
    if(!leaseLost&&typeof backend.escalateStaleBillingRows==='function')try{
      const after=await lease.getCursor({db,root,kind:'age'});
      // The age sweep shares the same pre-row gate and gets its OWN section budget and cursor, like the unknown resolver.
      const record=asRecord(await backend.escalateStaleBillingRows({now,limit:maxRows,after,shouldContinue:gate('age')}));
      if(record===undefined){counts.failed++;partial=true;}
      else{
        counts.staleEscalated+=count(record.escalated);counts.failed+=count(record.failed);
        if(count(record.failed)>0||record.stopped===true)partial=true;
        const next=cursorValue(record.next);
        if(next!==undefined&&!leaseLost)await lease.setCursor({db,root,kind:'age',holderId,token,cursor:next,now:clock()}).catch(()=>false);
      }
    }catch{counts.failed++;partial=true;}
    if(leaseLost)partial=true;
    return finish(partial?'partial':'ok');
  }finally{
    stopRenewal();
    inFlight.delete(key);
    // Conditional on holderId+token inside the real lease: a stale holder never drops the new holder's lease.
    if(acquired)await lease.release({db,root,holderId,token:leaseToken}).catch(()=>false);
  }
}
