// LV-019.B: counts-only summary of the billing queues (collection sizes, pending report, schedule inventory) over a READ-ONLY root.
// Nothing identifying leaves it: no row id, no account id, no timestamp of a specific row, only totals, per-state counts and ages.
import {describe,expect,it} from 'vitest';
import {summarizeQueues} from './billingQueueCounts';
import {readOnlyRoot} from './billingReadOnlyRoot';
import {stub} from './billingFirestoreStub';

const NOW=2_000_000_000_000,ACC='11111111-1111-4111-8111-111111111111';
const seed=()=>stub({
  billingIntents:{
    i1:{state:'reserve_pending',createdAtMs:NOW-1000,nextAttemptAt:NOW-1,attempts:1,accountId:ACC},i2:{state:'reserve_pending',createdAtMs:NOW-5000,nextAttemptAt:NOW+99,lastErrorCode:'unavailable'},
    i3:{state:'release_pending',createdAtMs:NOW-300},i4:{state:'needs_review',createdAtMs:NOW-70},i5:{state:'closed'},i6:{state:'reserve_pending',nextAttemptAt:'x',createdAtMs:NOW-20},
  },
  billingIntentTerminalRecovery:{t1:{state:'pending',createdAtMs:NOW-40}},
  billingHoldOutbox:{h1:{state:'pending',createdAtMs:NOW-10,nextAttemptAt:NOW-1},h2:{state:'needs_review',createdAtMs:NOW-8000},h3:{state:'applied'}},
  billingOutbox:{o1:{state:'retry_wait',createdAtMs:NOW-60,lastErrorCode:'conflict'},o2:{state:'pending'},o3:{state:'settled'}},
  jobs:{j1:{state:'unknown',createdAtMs:NOW-9000},j2:{state:'running'}},
  accounts:{a:{available:1}},
});

describe('summarizeQueues',()=>{
  it('counts sizes, states, attention, ages and error codes exactly',async()=>{
    const s=seed(),c=await summarizeQueues(readOnlyRoot(s.root as never),NOW);
    expect(c.generatedAtMs).toBe(NOW);
    expect(c.sizes).toEqual({billingIntents:6,billingIntentTerminalRecovery:1,billingHoldOutbox:3,billingOutbox:3,jobs:2,billingGuards:0});
    expect(c.report.total).toBe(11);
    const i=c.report.byKind.intent;
    expect(i.total).toBe(5);expect(i.byState).toEqual({reserve_pending:3,release_pending:1,needs_review:1});
    expect(i.malformed).toBe(1);expect(i.needsReview).toBe(1);expect(i.unknownAge).toBe(0);expect(i.oldestAgeMs).toBe(5000);
    const h=c.report.byKind.hold;expect(h.total).toBe(2);expect(h.byState).toEqual({pending:1,needs_review:1});expect(h.oldestAgeMs).toBe(8000);
    const o=c.report.byKind.outbox;expect(o.total).toBe(2);expect(o.byState).toEqual({pending:1,retry_wait:1});expect(o.unknownAge).toBe(1);expect(o.oldestAgeMs).toBe(60);
    const j=c.report.byKind.job_unknown;expect(j.total).toBe(1);expect(j.oldestAgeMs).toBe(9000);
    expect(c.report.byKind.terminal_recovery.total).toBe(1);
    expect(c.report.oldestAgeMs).toBe(9000);
    expect(c.report.byLastErrorCode).toEqual({none:9,unavailable:1,conflict:1});
    expect(c.inventory.collections.map(x=>x.collection)).toEqual(['billingIntents','billingOutbox','billingHoldOutbox']);
    expect(c.inventory.neverSelectedAtLeast).toBe(1); // the retry_wait row o1 has no date
  });
  it('returns counts only: no id, account id or per-row timestamp anywhere in the result',async()=>{
    const text=JSON.stringify(await summarizeQueues(readOnlyRoot(seed().root as never),NOW));
    expect(text).not.toMatch(/11111111-1111|"i[1-6]"|"h[1-3]"|"o[1-3]"|"j[12]"|"t1"|createdAtMs|accountId|"id"/);
  });
  it('never writes',async()=>{
    const s=seed(),before=JSON.stringify([...s.store.entries()]);
    await summarizeQueues(readOnlyRoot(s.root as never),NOW);
    expect(s.writes).toEqual([]);expect(JSON.stringify([...s.store.entries()])).toBe(before);
  });
  it('an empty root gives zeros and null ages',async()=>{
    const c=await summarizeQueues(readOnlyRoot(stub({}).root as never),NOW);
    expect(Object.values(c.sizes)).toEqual([0,0,0,0,0,0]);expect(c.report.total).toBe(0);expect(c.report.oldestAgeMs).toBeNull();
    for(const kind of Object.values(c.report.byKind)){expect(kind.total).toBe(0);expect(kind.oldestAgeMs).toBeNull();expect(kind.byState).toEqual({});}
    expect(c.report.byLastErrorCode).toEqual({});
  });
  it('rejects an invalid clock before reading anything',async()=>{
    const s=seed();
    for(const bad of [Number.NaN,-1,1.5])await expect(summarizeQueues(readOnlyRoot(s.root as never),bad)).rejects.toThrow(/clock/i);
    expect(s.reads).toEqual([]);
  });
  it('a failing read rejects instead of returning partial counts',async()=>{
    const s=seed();
    const thrower:any=new Proxy({},{get:(_t,prop)=>prop==='get'||prop==='count'?()=>({get:async()=>{throw new Error('unavailable');}}):()=>thrower});
    const root=readOnlyRoot({collection:(c:string)=>c==='billingOutbox'?thrower:s.root.collection(c)} as never);
    await expect(summarizeQueues(root,NOW)).rejects.toThrow();
  });
});
