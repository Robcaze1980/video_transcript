// LV-019.B step 1.6b (second part): the periodic drain executor SECTION.
// Tests first: they pin the contract (outcomes, lease gate, renewal timer, budgets, order, cursors, heartbeat with an
// EXACT key set, import fence) before the module exists.
import {describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import type {BillingDrainSectionAi,BillingDrainSectionBackend,BillingDrainSectionResult,BillingDrainSectionOptions} from './billingDrainSection';
import {runBillingDrainSection} from './billingDrainSection';

const NOW=9_000_000;
const HEARTBEAT_KEYS=['durationMs','event','failed','holds','intentsFailed','intentsRecovered','leaseToken','outcome','settled','skippedRows','startedAtMs','unknownResolved'].sort();
const EMPTY={settled:0,failed:0,intentsRecovered:0,intentsFailed:0,holds:0,skippedRows:0,unknownResolved:0};

type LeaseOps=NonNullable<BillingDrainSectionOptions['lease']>;
const deferred=()=>{let resolve:(v:unknown)=>void=()=>{};const promise=new Promise<unknown>(res=>{resolve=res;});return {promise,resolve};};

/** A fake lease layer: the real one needs Firestore, so the unit contract is pinned against this double. */
function leaseOps(over:{acquire?:LeaseOps['acquire'];assertHeld?:LeaseOps['assertHeld'];renew?:LeaseOps['renew'];cursors?:Record<string,string|null>;
  log?:{releases:{holderId:string;token:number}[];sets:{kind:string;cursor:string|null;holderId:string;token:number}[]}}= {}){
 const releases: {holderId:string;token:number}[]=[],sets:{kind:string;cursor:string|null;holderId:string;token:number}[]=[];
 const ops:LeaseOps={
  acquire:over.acquire??vi.fn(async o=>({acquired:true as const,token:7,expiresAtMs:o.now+90_000})),
  renew:over.renew??vi.fn(async()=>true),
  release:vi.fn(async o=>{releases.push({holderId:o.holderId,token:o.token});return true;}),
  assertHeld:over.assertHeld??vi.fn(async()=>true),
  getCursor:vi.fn(async o=>over.cursors?.[o.kind]??null),
  setCursor:vi.fn(async o=>{sets.push({kind:o.kind,cursor:o.cursor,holderId:o.holderId,token:o.token});return true;}),
 };
 return {ops,releases,sets};
}
function ai(over:Partial<Record<'holds'|'billing',unknown>>={},order:string[]=[]){
 const double={
  drainExternalHolds:vi.fn(async(_limit:number,control:any)=>{order.push('holds');if(over.holds instanceof Error)throw over.holds;
   return over.holds??{applied:1,failed:0,review:0,skippedRows:0,stopped:false};}),
  drainExternalBilling:vi.fn(async(_limit:number,control:any)=>{order.push('billing');if(over.billing instanceof Error)throw over.billing;
   return over.billing??{settled:1,failed:0,intentsRecovered:0,intentsFailed:0,skippedRows:0,stopped:false,next:{intents:'i9',outbox:'o9'},traversed:{intents:true,outbox:true}};}),
 };
 return double as unknown as BillingDrainSectionAi;
}
function backend(over:Partial<Record<'unknown',unknown>>={},order:string[]=[]){
 const double={
  resolveExpiredUnknown:vi.fn(async()=>{order.push('unknown');if(over.unknown instanceof Error)throw over.unknown;
   return over.unknown??{scanned:1,resolved:1,notDue:0,failed:0,next:'u9'};}),
 };
 return double as unknown as BillingDrainSectionBackend;
}
const base=(extra:Partial<BillingDrainSectionOptions>={})=>({db:{} as never,root:{path:'unit-root'} as never,ai:ai(),backend:backend(),now:NOW,budgetMs:60_000,log:vi.fn(),...extra});
const heartbeat=(log:{mock:{calls:unknown[][]}})=>{expect(log.mock.calls).toHaveLength(1);const raw=log.mock.calls[0][0] as string;expect(raw).not.toContain('\n');return JSON.parse(raw);};
const expectKeys=(line:Record<string,unknown>)=>expect(Object.keys(line).sort()).toEqual(HEARTBEAT_KEYS);
const rows=(n:number)=>Array.from({length:n},(_,i)=>i);

describe('runBillingDrainSection outcomes',()=>{
  it('disabled: touches nothing, still emits one heartbeat with zero counts and token 0',async()=>{
    const a=ai(),b=backend(),log=vi.fn(),{ops}=leaseOps();
    const result=await runBillingDrainSection({...base({log,ai:a,backend:b,lease:ops}),enabled:false});
    expect(result).toMatchObject({outcome:'disabled',...EMPTY,leaseToken:0});
    expect(ops.acquire).not.toHaveBeenCalled();expect(a.drainExternalHolds).not.toHaveBeenCalled();expect(b.resolveExpiredUnknown).not.toHaveBeenCalled();
    const line=heartbeat(log);expectKeys(line);expect(line).toMatchObject({event:'billing-drain',outcome:'disabled',leaseToken:0,...EMPTY});
  });
  it('lease_held: another pass owns a live lease, so this one skips without touching a row',async()=>{
    const a=ai(),log=vi.fn(),{ops}=leaseOps({acquire:vi.fn(async()=>({acquired:false as const,reason:'held' as const}))});
    const result=await runBillingDrainSection({...base({log,ai:a,lease:ops}),enabled:true});
    expect(result).toMatchObject({outcome:'skipped',reason:'lease_held',...EMPTY,leaseToken:0});
    expect(a.drainExternalHolds).not.toHaveBeenCalled();expect(a.drainExternalBilling).not.toHaveBeenCalled();
    expectKeys(heartbeat(log));
  });
  it('acquire throws: error, no row is touched and the heartbeat still comes out',async()=>{
    const a=ai(),log=vi.fn(),{ops}=leaseOps({acquire:vi.fn(async()=>{throw new Error('lease store down SECRET');})});
    const result=await runBillingDrainSection({...base({log,ai:a,lease:ops}),enabled:true});
    expect(result).toMatchObject({outcome:'error',...EMPTY});
    expect(a.drainExternalHolds).not.toHaveBeenCalled();expect(a.drainExternalBilling).not.toHaveBeenCalled();
    const raw=log.mock.calls[0][0] as string;expect(raw).not.toMatch(/SECRET|lease store down/);expectKeys(JSON.parse(raw));
  });
  it('ok: runs holds, billing, holds, unknown in that order, writes both cursors and releases with holder and token',async()=>{
    const order:string[]=[],a=ai({},order),b=backend({},order),log=vi.fn(),{ops,releases,sets}=leaseOps();
    const result=await runBillingDrainSection({...base({log,ai:a,backend:b,lease:ops}),enabled:true});
    expect(result).toMatchObject({outcome:'ok',leaseToken:7,settled:1,failed:0,intentsRecovered:0,intentsFailed:0,holds:2,skippedRows:0,unknownResolved:1});
    expect(order).toEqual(['holds','billing','holds','unknown']);
    expect(sets.map(s=>[s.kind,s.cursor])).toEqual([['intents','i9'],['outbox','o9'],['unknown','u9']]);
    for(const s of sets){expect(s.token).toBe(7);expect(s.holderId.length).toBeGreaterThan(0);}
    expect(releases).toHaveLength(1);expect(releases[0].token).toBe(7);
    expectKeys(heartbeat(log));
  });
  it('a drain that throws is counted and never stops the other sections (partial, not error)',async()=>{
    const order:string[]=[],a=ai({holds:new Error('row write failed SECRET')},order),b=backend({},order),log=vi.fn(),{ops,releases}=leaseOps();
    const result=await runBillingDrainSection({...base({log,ai:a,backend:b,lease:ops}),enabled:true});
    expect(result.outcome).toBe('partial');expect(result.failed).toBe(2);expect(result.settled).toBe(1);expect(result.unknownResolved).toBe(1);
    expect(order).toEqual(['holds','billing','holds','unknown']);
    expect(releases).toHaveLength(1);
    const raw=log.mock.calls[0][0] as string;expect(raw).not.toMatch(/SECRET/);
  });
  it('a billing drain that throws is counted and the later sections still run',async()=>{
    const order:string[]=[],a=ai({billing:new Error('SECRET settlement failure')},order),b=backend({},order),log=vi.fn();
    const result=await runBillingDrainSection({...base({ai:a,backend:b,log,lease:leaseOps().ops}),enabled:true});
    expect(result.outcome).toBe('partial');expect(result.failed).toBe(1);expect(result.settled).toBe(0);
    expect(order,'later sections still run after a billing failure').toEqual(['holds','billing','holds','unknown']);
    expect(result.unknownResolved).toBe(1);
    expect(log.mock.calls[0][0] as string).not.toMatch(/SECRET/);
  });
  it('`notDue` is not a resolution: only `resolved` counts in the heartbeat',async()=>{
    const b=backend({unknown:{scanned:3,resolved:1,notDue:2,failed:0,next:null}}),log=vi.fn();
    const result=await runBillingDrainSection({...base({backend:b,log,lease:leaseOps().ops}),enabled:true});
    expect(result.unknownResolved).toBe(1);
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({unknownResolved:1});
  });
  it('the unknown section is optional: a backend without the resolver is skipped, the pass is still ok',async()=>{
    const b={} as unknown as BillingDrainSectionBackend,{ops}=leaseOps();
    const result=await runBillingDrainSection({...base({backend:b,lease:ops}),enabled:true});
    expect(result).toMatchObject({outcome:'ok',unknownResolved:0});
  });
  it('an in-flight pass on the same root skips the next one before it ever asks for the lease',async()=>{
    const d=deferred(),order:string[]=[];
    const slow=ai({},order) as unknown as {drainExternalBilling:(l:number,c:any)=>Promise<unknown>;drainExternalHolds:(l:number,c:any)=>Promise<unknown>};
    slow.drainExternalBilling=vi.fn(async()=>{order.push('billing');await d.promise;return {settled:1,failed:0,intentsRecovered:0,intentsFailed:0,skippedRows:0,stopped:false,next:{intents:null,outbox:null}};});
    slow.drainExternalHolds=vi.fn(async()=>({applied:0,failed:0,review:0,skippedRows:0,stopped:false}));
    const root={path:'unit-guard-root'} as never,{ops}=leaseOps();
    const first=runBillingDrainSection({...base({root,ai:slow as never,lease:ops}),enabled:true});
    await new Promise(r=>setTimeout(r,0));
    const log=vi.fn();
    const second=await runBillingDrainSection({...base({root,log,lease:ops}),enabled:true});
    expect(second).toMatchObject({outcome:'skipped',reason:'in_flight'});
    expect(ops.acquire).toHaveBeenCalledTimes(1);
    expectKeys(heartbeat(log));
    d.resolve(undefined);
    expect((await first).outcome).toBe('ok');
  });
});

describe('runBillingDrainSection lease tenure',()=>{
  it('renews every 10 s through an unref timer and always clears it when the pass ends',async()=>{
    const d=deferred(),{ops}=leaseOps();
    const renew=(ops.renew as unknown as {mock:{calls:unknown[][]}});
    const handle={unref:vi.fn()};
    const setSpy=vi.spyOn(globalThis,'setInterval').mockReturnValue(handle as never);
    const clearSpy=vi.spyOn(globalThis,'clearInterval').mockReturnValue(undefined as never);
    const a=ai();
    (a as unknown as {drainExternalBilling:unknown}).drainExternalBilling=vi.fn(async()=>{await d.promise;return {settled:0,failed:0,intentsRecovered:0,intentsFailed:0,skippedRows:0,stopped:false,next:{intents:null,outbox:null}};});
    try{
      const run=runBillingDrainSection({...base({ai:a,lease:ops}),enabled:true});
      await new Promise(r=>setTimeout(r,0));
      expect(setSpy).toHaveBeenCalledTimes(1);expect(handle.unref).toHaveBeenCalledTimes(1);
      const callback=setSpy.mock.calls[0][0] as ()=>void;
      callback();await new Promise(r=>setTimeout(r,0));
      expect(renew.mock.calls.length).toBe(1);
      d.resolve(undefined);
      expect((await run).outcome).toBe('ok');
      expect(clearSpy).toHaveBeenCalledWith(handle);
      callback();await new Promise(r=>setTimeout(r,0));
      expect(renew.mock.calls.length).toBe(1);
    }finally{setSpy.mockRestore();clearSpy.mockRestore();}
  });
  it('a lease lost mid-pass stops the pass before the next row: later sections are never started and release still runs',async()=>{
    const order:string[]=[],{ops,releases}=leaseOps();
    let checks=0;
    (ops.assertHeld as unknown as {mockImplementation:(impl:()=>Promise<boolean>)=>void}).mockImplementation(async()=>{checks++;return checks<2;});
    // Every drain asks the gate before EVERY row: the second check loses the lease, so no later row AND no later
    // section may run. The billing section here ignores its control entirely, so only the structural guard can stop it.
    const taken:{section:string;row:number}[]=[];
    const a=ai() as unknown as {drainExternalHolds:unknown;drainExternalBilling:unknown};
    a.drainExternalBilling=vi.fn(async()=>{order.push('billing');for(const row of rows(5))taken.push({section:'billing',row});
      return {settled:taken.length,failed:0,intentsRecovered:0,intentsFailed:0,skippedRows:0,stopped:false,next:{intents:null,outbox:null}};});
    a.drainExternalHolds=vi.fn(async(_l:number,control:any)=>{order.push('holds');for(const row of rows(3)){if(!(await control.shouldContinue()))break;taken.push({section:'holds',row});}
      return {applied:taken.length,failed:0,review:0,skippedRows:0,stopped:taken.length<3};});
    const result=await runBillingDrainSection({...base({ai:a as never,lease:ops}),enabled:true});
    expect(result.outcome).toBe('partial');
    expect(order,'no later section starts after the lease is lost, even one that ignores its control').toEqual(['holds']);
    expect(taken,'exactly one row before the lease was lost, none after').toEqual([{section:'holds',row:0}]);
    expect(releases).toHaveLength(1);
  });
  it('every renewal carries the pass budget as the tenure ceiling',async()=>{
    const d=deferred(),{ops}=leaseOps();
    const handle={unref:vi.fn()};
    const setSpy=vi.spyOn(globalThis,'setInterval').mockReturnValue(handle as never);
    const clearSpy=vi.spyOn(globalThis,'clearInterval').mockReturnValue(undefined as never);
    const a=ai() as unknown as {drainExternalBilling:unknown};
    a.drainExternalBilling=vi.fn(async()=>{await d.promise;return {settled:0,failed:0,intentsRecovered:0,intentsFailed:0,skippedRows:0,stopped:false,next:{intents:null,outbox:null}};});
    try{
      const run=runBillingDrainSection({...base({ai:a as never,lease:ops}),enabled:true,budgetMs:30_000});
      await new Promise(r=>setTimeout(r,0));
      (setSpy.mock.calls[0][0] as ()=>void)();await new Promise(r=>setTimeout(r,0));
      expect((ops.renew as unknown as {mock:{calls:any[][]}}).mock.calls[0][0]).toMatchObject({maxTenureMs:30_000});
      d.resolve(undefined);await run;
    }finally{setSpy.mockRestore();clearSpy.mockRestore();}
  });
  it('a pass that never acquired the lease never releases (no stray delete of someone else lease)',async()=>{
    const {ops,releases}=leaseOps({acquire:vi.fn(async()=>({acquired:false as const,reason:'held' as const}))});
    await runBillingDrainSection({...base({lease:ops}),enabled:true});
    expect(releases).toHaveLength(0);
    const erroring=leaseOps({acquire:vi.fn(async()=>{throw new Error('down');})});
    await runBillingDrainSection({...base({root:{path:'unit-root-no-acquire'} as never,lease:erroring.ops}),enabled:true});
    expect(erroring.releases).toHaveLength(0);
  });
  it('the holder id is random per pass unless the caller pins one',async()=>{
    const seen:string[]=[];
    const {ops}=leaseOps({acquire:vi.fn(async o=>{seen.push(o.holderId);return {acquired:true as const,token:1,expiresAtMs:o.now+90_000};})});
    await runBillingDrainSection({...base({lease:ops}),enabled:true});
    await runBillingDrainSection({...base({root:{path:'unit-root-2'} as never,lease:ops}),enabled:true});
    expect(seen).toHaveLength(2);expect(seen[0]).not.toBe(seen[1]);expect(seen[0].length).toBeGreaterThan(8);
    const pinned:string[]=[];
    const {ops:pinnedOps}=leaseOps({acquire:vi.fn(async o=>{pinned.push(o.holderId);return {acquired:true as const,token:1,expiresAtMs:o.now+90_000};})});
    await runBillingDrainSection({...base({root:{path:'unit-root-3'} as never,holderId:'pinned-holder',lease:pinnedOps}),enabled:true});
    expect(pinned).toEqual(['pinned-holder']);
  });
});

describe('runBillingDrainSection renewal and failure accounting',()=>{
  it('a refused renewal stops the renewal timer, so it never asks again',async()=>{
    const d=deferred(),{ops}=leaseOps({renew:vi.fn(async()=>false)});
    const handle={unref:vi.fn()};
    const setSpy=vi.spyOn(globalThis,'setInterval').mockReturnValue(handle as never);
    const clearSpy=vi.spyOn(globalThis,'clearInterval').mockReturnValue(undefined as never);
    const a=ai() as unknown as {drainExternalBilling:unknown};
    a.drainExternalBilling=vi.fn(async()=>{await d.promise;return {settled:0,failed:0,intentsRecovered:0,intentsFailed:0,skippedRows:0,stopped:false,next:{intents:null,outbox:null}};});
    try{
      const run=runBillingDrainSection({...base({ai:a as never,lease:ops}),enabled:true});
      await new Promise(r=>setTimeout(r,0));
      const callback=setSpy.mock.calls[0][0] as ()=>void;
      callback();await new Promise(r=>setTimeout(r,0));
      expect(ops.renew).toHaveBeenCalledTimes(1);
      expect(clearSpy).toHaveBeenCalledWith(handle);
      callback();await new Promise(r=>setTimeout(r,0));
      expect(ops.renew).toHaveBeenCalledTimes(1);
      // RONDA 2: a refused renewal is a LOST lease, distinct from an exhausted tenure: the pass ends `partial`.
      d.resolve(undefined);expect((await run).outcome).toBe('partial');
    }finally{setSpy.mockRestore();clearSpy.mockRestore();}
  });
  it('a throwing drain is counted in `failed` and makes the pass partial, without hiding a clean section',async()=>{
    const a=ai({holds:new Error('SECRET row write')}),log=vi.fn();
    const result=await runBillingDrainSection({...base({ai:a,log,lease:leaseOps().ops}),enabled:true});
    expect(result.outcome).toBe('partial');expect(result.failed).toBe(2);expect(result.settled).toBe(1);
    expect(JSON.parse(log.mock.calls[0][0]).failed).toBe(2);
  });
});
describe('runBillingDrainSection budgets',()=>{
  it('each section gets its own budget: an exhausted billing section never consumes the later ones',async()=>{
    let t=0;const clock=()=>t;
    const a=ai() as unknown as {drainExternalBilling:unknown;drainExternalHolds:unknown};
    const billingAnswers:boolean[]=[],holdsAfterAnswers:boolean[]=[],beforeAnswers:boolean[]=[];
    a.drainExternalBilling=vi.fn(async(_l:number,control:any)=>{for(const _ of rows(6)){t+=4000;const ok=await control.shouldContinue();billingAnswers.push(ok);if(!ok)break;}
      return {settled:0,failed:0,intentsRecovered:0,intentsFailed:0,skippedRows:0,stopped:true,next:{intents:null,outbox:null}};});
    let holdsCalls=0;
    a.drainExternalHolds=vi.fn(async(_l:number,control:any)=>{holdsCalls++;const bucket=holdsCalls===1?beforeAnswers:holdsAfterAnswers;
      for(const _ of rows(3)){t+=6000;const ok=await control.shouldContinue();bucket.push(ok);if(!ok)break;}
      return {applied:0,failed:0,review:0,skippedRows:0,stopped:true};});
    const result=await runBillingDrainSection({...base({ai:a as never,clock,sectionBudgetsMs:{holdsBefore:10_000,billing:12_000,holdsAfter:8_000,unknown:10_000},lease:leaseOps().ops,budgetMs:60_000}),enabled:true});
    expect(beforeAnswers).toEqual([true,false]);
    expect(billingAnswers).toEqual([true,true,false]);
    expect(holdsAfterAnswers).toEqual([true,false]);
    expect(result.outcome).toBe('partial');
  });
  it('an unusable budget or section split is a config error that touches no row',async()=>{
    const a=ai();
    for(const extra of [{budgetMs:0},{budgetMs:60_001},{budgetMs:1.5},{sectionBudgetsMs:{billing:-1}},{sectionBudgetsMs:{billing:10_000,holdsBefore:10_000,holdsAfter:10_000,unknown:40_000}}] as Partial<BillingDrainSectionOptions>[]){
      const log=vi.fn();
      const result=await runBillingDrainSection({...base({log,ai:a,lease:leaseOps().ops}),enabled:true,...extra});
      expect(result,JSON.stringify(extra)).toMatchObject({outcome:'error',...EMPTY});
      expectKeys(heartbeat(log));
    }
    expect(a.drainExternalHolds).not.toHaveBeenCalled();
  });
  it('per-account cap and per-kind row ceiling are passed to every drain',async()=>{
    const a=ai(),b=backend(),{ops}=leaseOps();
    const {ops:held}=leaseOps();
    await runBillingDrainSection({...base({ai:a,backend:b,lease:ops}),enabled:true});void held;
    const holdsCall=(a.drainExternalHolds as unknown as {mock:{calls:any[][]}}).mock.calls[0];
    const billingCall=(a.drainExternalBilling as unknown as {mock:{calls:any[][]}}).mock.calls[0];
    expect(holdsCall[0]).toBe(100);expect(holdsCall[1]).toMatchObject({perAccountCap:5,maxRows:100});
    expect(billingCall[0]).toBe(100);expect(billingCall[1]).toMatchObject({perAccountCap:5,maxRows:100});
    const unknownCall=(b.resolveExpiredUnknown as unknown as {mock:{calls:any[][]}}).mock.calls[0][0];
    expect(unknownCall.limit).toBe(100);
  });
});

describe('runBillingDrainSection round-2 findings',()=>{
  it('one accountUsage map is shared by the three drains, so the cap is per pass and not per section',async()=>{
    const seen:unknown[]=[];
    let attended=0;
    const capped=async(control:any,name:string,rowsHere:number)=>{
      seen.push(control.accountUsage);order.push(name);
      let taken=0;
      for(const _ of rows(rowsHere)){
        const cap=control.perAccountCap as number,map=control.accountUsage as Map<string,number>;
        const used=map.get('acct')??0;
        if(used>=cap)continue;
        map.set('acct',used+1);taken++;attended++;
      }
      return name==='billing'
        ?{settled:taken,failed:0,intentsRecovered:0,intentsFailed:0,skippedRows:0,stopped:false,next:{intents:null,outbox:null},traversed:{intents:true,outbox:true}}
        :{applied:taken,failed:0,review:0,skippedRows:0,stopped:false};
    };
    const order:string[]=[];
    const double={
      drainExternalHolds:vi.fn(async(_l:number,control:any)=>capped(control,'holds',3)),
      drainExternalBilling:vi.fn(async(_l:number,control:any)=>capped(control,'billing',3)),
    } as unknown as BillingDrainSectionAi;
    const result=await runBillingDrainSection({...base({ai:double,lease:leaseOps().ops}),enabled:true});
    expect(seen).toHaveLength(3);
    expect(seen[0]).toBe(seen[1]);expect(seen[1]).toBe(seen[2]);
    expect(attended).toBe(5);
    expect(result.holds+result.settled).toBe(5);
  });
  it('persists only the cursor of a kind that was actually traversed',async()=>{
    const a=ai({billing:{settled:1,failed:0,intentsRecovered:0,intentsFailed:0,skippedRows:0,stopped:true,next:{intents:'i9',outbox:'o9'},traversed:{intents:true,outbox:false}}});
    const {ops,sets}=leaseOps({cursors:{outbox:'o1'}});
    await runBillingDrainSection({...base({ai:a,lease:ops}),enabled:true});
    expect(sets.filter(s=>s.kind==='intents').map(s=>s.cursor)).toEqual(['i9']);
    expect(sets.filter(s=>s.kind==='outbox')).toHaveLength(0);
  });
  it('without a Cuenta client no billing kind is traversed, so no billing cursor is rewritten',async()=>{
    const a=ai({billing:{settled:0,failed:0,intentsRecovered:0,intentsFailed:0,skippedRows:0,stopped:false,next:{intents:null,outbox:null},traversed:{intents:false,outbox:false}}});
    const {ops,sets}=leaseOps();
    await runBillingDrainSection({...base({ai:a,lease:ops}),enabled:true});
    expect(sets.filter(s=>s.kind==='intents'||s.kind==='outbox')).toHaveLength(0);
  });
  it('the unknown resolver receives the same section gate and is consulted row by row',async()=>{
    const {ops}=leaseOps();
    const b=backend();
    await runBillingDrainSection({...base({backend:b,lease:ops}),enabled:true});
    const args=(b.resolveExpiredUnknown as unknown as {mock:{calls:any[][]}}).mock.calls[0][0];
    expect(typeof args.shouldContinue).toBe('function');
    const before=(ops.assertHeld as unknown as {mock:{calls:unknown[][]}}).mock.calls.length;
    expect(await args.shouldContinue()).toBe(true);
    expect((ops.assertHeld as unknown as {mock:{calls:unknown[][]}}).mock.calls.length).toBe(before+1);
  });
  it('the resolver is cut row by row when its OWN section budget runs out, leaving the rest untouched',async()=>{
    let t=0;
    const b=backend();
    const rowsRead:number[]=[];
    (b.resolveExpiredUnknown as unknown as {mockImplementation:(impl:(o:any)=>Promise<unknown>)=>void}).mockImplementation(async o=>{
      for(const index of rows(6)){
        t+=3_000;
        if(!(await o.shouldContinue()))return {scanned:6,resolved:index,notDue:0,failed:0,stopped:true,next:index?'u'+(index-1):null};
        rowsRead.push(index);
      }
      return {scanned:6,resolved:6,notDue:0,failed:0,stopped:false,next:null};
    });
    const result=await runBillingDrainSection({...base({backend:b,clock:()=>t,lease:leaseOps().ops}),enabled:true,sectionBudgetsMs:{unknown:10_000}});
    expect(rowsRead).toEqual([0,1,2]);
    expect(result.unknownResolved).toBe(3);
    expect(result.outcome).toBe('partial');
  });
  it('a resolver that stopped early is partial even with zero row failures and a clean rest of the pass',async()=>{
    const b=backend({unknown:{scanned:5,resolved:2,notDue:0,failed:0,stopped:true,next:'u2'}});
    const result=await runBillingDrainSection({...base({backend:b,lease:leaseOps().ops}),enabled:true});
    expect(result).toMatchObject({outcome:'partial',unknownResolved:2,failed:0,settled:1});
  });
  it('a refused renewal marks the lease lost and no drain starts another row',async()=>{
    const d=deferred(),order:string[]=[];
    const {ops}=leaseOps({renew:vi.fn(async()=>false)});
    const handle={unref:vi.fn()};
    const setSpy=vi.spyOn(globalThis,'setInterval').mockReturnValue(handle as never);
    const clearSpy=vi.spyOn(globalThis,'clearInterval').mockReturnValue(undefined as never);
    let asked=0;
    const double={
      drainExternalHolds:vi.fn(async(_l:number,control:any)=>{order.push('holds');await d.promise;const ok=await control.shouldContinue();asked++;expect(ok).toBe(false);
        return {applied:0,failed:0,review:0,skippedRows:0,stopped:!ok};}),
      drainExternalBilling:vi.fn(async()=>{order.push('billing');return {settled:0,failed:0,intentsRecovered:0,intentsFailed:0,skippedRows:0,stopped:false,next:{intents:null,outbox:null},traversed:{intents:true,outbox:true}};}),
    } as unknown as BillingDrainSectionAi;
    try{
      const run=runBillingDrainSection({...base({ai:double,lease:ops}),enabled:true});
      await new Promise(r=>setTimeout(r,0));
      (setSpy.mock.calls[0][0] as ()=>void)();await new Promise(r=>setTimeout(r,0));
      d.resolve(undefined);
      const result=await run;
      expect(asked).toBe(1);
      expect(order).toEqual(['holds']);
      expect(result.outcome).toBe('partial');
      expect(clearSpy).toHaveBeenCalledWith(handle);
    }finally{setSpy.mockRestore();clearSpy.mockRestore();}
  });
  it('the lost-lease mark itself cuts the gate: it returns false with no lease read and no deadline spent',async()=>{
    // Start the pass, let a renewal be refused, and then ask the SAME gate the drains receive. The mark must short
    // circuit the gate on its own, even with a non-exhausted budget and a lease that would still read as held.
    const d=deferred(),{ops}=leaseOps({renew:vi.fn(async()=>false)});
    const handle={unref:vi.fn()};
    const setSpy=vi.spyOn(globalThis,'setInterval').mockReturnValue(handle as never);
    const clearSpy=vi.spyOn(globalThis,'clearInterval').mockReturnValue(undefined as never);
    let gate:()=>Promise<boolean>=async()=>true;
    const a=ai() as unknown as {drainExternalHolds:unknown;drainExternalBilling:unknown};
    a.drainExternalHolds=vi.fn(async(_l:number,control:any)=>{gate=()=>control.shouldContinue();await d.promise;return {applied:0,failed:0,review:0,skippedRows:0,stopped:false};});
    try{
      const run=runBillingDrainSection({...base({ai:a as never,lease:ops}),enabled:true});
      await new Promise(r=>setTimeout(r,0));
      (setSpy.mock.calls[0][0] as ()=>void)();await new Promise(r=>setTimeout(r,0));
      const before=(ops.assertHeld as unknown as {mock:{calls:unknown[][]}}).mock.calls.length;
      expect(await gate()).toBe(false);
      expect((ops.assertHeld as unknown as {mock:{calls:unknown[][]}}).mock.calls.length).toBe(before);
      d.resolve(undefined);expect((await run).outcome).toBe('partial');
    }finally{setSpy.mockRestore();clearSpy.mockRestore();}
  });
});

describe('runBillingDrainSection heartbeat',()=>{
  it('never leaks ids or row content: only the twelve fixed keys survive a poisoned summary',async()=>{
    const poisoned={settled:1,failed:0,intentsRecovered:0,intentsFailed:0,skippedRows:0,stopped:false,next:{intents:'SECRET-INTENT',outbox:'SECRET-OUTBOX'},
      accountId:'SECRET-ACCOUNT',rowId:'SECRET-ROW',uid:'SECRET-UID',message:'SECRET-MSG'};
    const a=ai({holds:{applied:1,failed:0,review:0,skippedRows:0,stopped:false,accountId:'SECRET-HOLD'},billing:poisoned});
    const b=backend({unknown:{scanned:1,resolved:1,notDue:0,failed:0,next:'SECRET-UNKNOWN'}});
    const log=vi.fn();
    const result=await runBillingDrainSection({...base({log,ai:a,backend:b,lease:leaseOps().ops}),enabled:true});
    const raw=log.mock.calls[0][0] as string;expect(raw).not.toMatch(/SECRET/);
    expectKeys(JSON.parse(raw));expectKeys(Object.fromEntries(HEARTBEAT_KEYS.map(k=>[k,(result as unknown as Record<string,unknown>)[k]])));
    expect(result.holds).toBe(2);expect(result.unknownResolved).toBe(1);
  });
  it('a broken logger never breaks the pass, and a non-object drain result counts as zero',async()=>{
    const a=ai() as unknown as {drainExternalBilling:unknown};
    a.drainExternalBilling=vi.fn(async()=>'not a summary');
    const result=await runBillingDrainSection({...base({ai:a as never,log:()=>{throw new Error('logger down');},lease:leaseOps().ops}),enabled:true});
    // A drain that answers something that is not a summary is a counted failure, never a fake `ok`.
    expect(result.outcome).toBe('partial');expect(result.settled).toBe(0);expect(result.failed).toBe(1);
  });
  it('sanitizes copies: a negative, fractional or non-numeric count becomes 0',async()=>{
    const a=ai({holds:{applied:-4,failed:2.9,review:Number.POSITIVE_INFINITY,skippedRows:'3',stopped:false},billing:{settled:1,failed:-1,intentsRecovered:0,intentsFailed:0,skippedRows:0,stopped:false,next:{intents:null,outbox:null}}});
    const result=await runBillingDrainSection({...base({ai:a,lease:leaseOps().ops}),enabled:true});
    // The holds drain runs twice in one pass, so its `failed:2.9` is copied as 2 in each section.
    expect(result).toMatchObject({holds:0,failed:4,skippedRows:0,settled:1});
  });
  it('cursors: reads intents/outbox/unknown before the section and writes next only while the lease is held',async()=>{
    const {ops,sets}=leaseOps({cursors:{intents:'i1',outbox:'o1',unknown:'u1'}});
    const a=ai(),b=backend();
    await runBillingDrainSection({...base({ai:a,backend:b,lease:ops}),enabled:true});
    const readKinds=(ops.getCursor as unknown as {mock:{calls:any[][]}}).mock.calls.map(c=>c[0].kind);
    expect(readKinds).toEqual(['intents','outbox','unknown']);
    const billingControl=(a.drainExternalBilling as unknown as {mock:{calls:any[][]}}).mock.calls[0][1];
    expect(billingControl.after).toEqual({intents:'i1',outbox:'o1'});
    const unknownArgs=(b.resolveExpiredUnknown as unknown as {mock:{calls:any[][]}}).mock.calls[0][0];
    expect(unknownArgs.after).toBe('u1');
    expect(sets.map(s=>s.kind)).toEqual(['intents','outbox','unknown']);
  });
});

describe('the drain section keeps its import fence',()=>{
  const source=readFileSync(new URL('./billingDrainSection.ts',import.meta.url),'utf8');
  const forbidden=new Set(['firestore'+'Backend','firestore'+'Ai','accountBilling'+'Client']);
  const specifier=(spec:string)=>spec.replace(/^\.\//,'').replace(/\.ts$/,'');
  it('never value-imports a Cuenta or Video write module: it receives ai and backend as parameters',()=>{
    for(const match of source.matchAll(/import\s+(type\s+)?[^;]*?from\s+['"]([^'"]+)['"]/g)){
      const typeOnly=!!match[1],name=specifier(match[2]);
      if(forbidden.has(name))expect(typeOnly,'value import of '+name).toBe(true);
    }
    expect(source).not.toMatch(/require\(/);
    expect(source).not.toMatch(/import\(/);
  });
  it('imports the certified lease by value, so the real executor always uses it',()=>{
    expect(source).toMatch(/import \{[^}]*acquireDrainLease[^}]*\} from '\.\/billingDrainLease';/);
    expect(source).toMatch(/releaseDrainLease/);
    expect(source).toMatch(/assertDrainLeaseHeld/);
  });
});

describe('the maintenance response isolates the drain from the file and AI sections',()=>{
  const later=(async()=>import('./cloudFilesRuntime'))();
  const sections=(drainResult:{outcome:string},fileFailed=0)=>({fileDrain:{due:2,failed:fileFailed},aiDrain:{failures:[]},drain:drainResult,sweep:{outcome:'ok'}});
  it('a drain that reports error or skipped changes neither the status nor the failure count',async()=>{
    const {maintenanceResponse}=await later;
    for(const drainResult of [{outcome:'error'},{outcome:'skipped',reason:'lease_held'},{outcome:'partial',failed:3},{outcome:'disabled'}]){
      const result=maintenanceResponse(sections(drainResult));
      expect(result.status).toBe(200);
      expect((result.body as {failed:number}).failed).toBe(0);
      expect((result.body as {drain:{outcome:string}}).drain.outcome).toBe(drainResult.outcome);
    }
  });
  it('the file and AI sections alone decide the status: a failing file drain is 503 with its own count',async()=>{
    const {maintenanceResponse}=await later;
    const result=maintenanceResponse(sections({outcome:'skipped'},1));
    expect(result.status).toBe(503);
    expect((result.body as {failed:number}).failed).toBe(1);
  });
  it('an absent sweep or AI section is tolerated and never invents a failure',async()=>{
    const {maintenanceResponse}=await later;
    const result=maintenanceResponse({fileDrain:{due:0,failed:0},drain:{outcome:'ok'}});
    expect(result.status).toBe(200);expect((result.body as {failed:number}).failed).toBe(0);
  });
});
describe('the maintenance entry wires the drain as its own section',()=>{
  const runtime=readFileSync(new URL('./cloudFilesRuntime.ts',import.meta.url),'utf8');
  it('starts the drain before the file/AI sections, behind VISTAVO_BILLING_DRAIN, and awaits it at the end',()=>{
    expect(runtime).toMatch(/import \{runBillingDrainSection\} from '\.\/billingDrainSection';/);
    const start=runtime.indexOf('const drainPromise=runBillingDrainSection(');
    const fileDrain=runtime.indexOf('const fileDrain=await drainCloudFiles(');
    const aiDrain=runtime.indexOf('const aiDrain=await runtime.nudgeAi(');
    const awaited=runtime.indexOf('const drain=await drainPromise');
    expect(start).toBeGreaterThan(-1);
    expect(start).toBeLessThan(fileDrain);
    expect(fileDrain).toBeLessThan(aiDrain);
    expect(aiDrain).toBeLessThan(awaited);
    expect(runtime).toMatch(/enabled:process\.env\.VISTAVO_BILLING_DRAIN==='1'/);
    // The same runtime client is reused: the section never builds its own Cuenta client.
    expect(runtime).toMatch(/ai:runtime\.ai,backend:runtime\.backend/);
    expect(runtime).toMatch(/budgetMs:60000/);
    // Neither the billing mode nor its switch is touched by this wiring.
    expect(runtime).toMatch(/if\(mode==='billing'\)\{/);
  });
  it('gives the drain its own try/catch so a thrown section can never escape the handler',()=>{
    expect(runtime).toMatch(/const drainPromise=runBillingDrainSection\(\{[\s\S]{0,400}?\n\s*\.catch\(error=>\{console\.error\(JSON\.stringify\(\{event:'billing-drain-section-failed',type:error\?\.name,code:error\?\.code\}\)\);return \{outcome:'error'\};\}\);/);
  });
});
