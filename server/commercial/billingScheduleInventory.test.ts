// LV-019.B: strictly read-only inventory of the scheduling field `nextAttemptAt` in the queue collections.
// It answers, with counts only, how many selectable rows are due, in the future, missing the field or carrying an invalid one.
import {describe,expect,it} from 'vitest';
import {SCHEDULED_SOURCES,classifySchedule,readScheduleInventory} from './billingScheduleInventory';
import {stub} from './billingFirestoreStub';

const NOW=2_000_000_000_000;
const intents=['reserve_pending','release_pending'];

describe('classifySchedule',()=>{
  it.each([
    ['no data',undefined,'noState'],['empty state',{state:''},'noState'],['state not a string',{state:7},'noState'],
    ['unlisted state',{state:'closed',nextAttemptAt:5},'otherState'],['terminal state without the field',{state:'job_created'},'otherState'],
    ['due',{state:'reserve_pending',nextAttemptAt:NOW-1},{state:'reserve_pending',kind:'due'}],
    ['due exactly now',{state:'reserve_pending',nextAttemptAt:NOW},{state:'reserve_pending',kind:'due'}],
    ['zero is a valid date',{state:'release_pending',nextAttemptAt:0},{state:'release_pending',kind:'due'}],
    ['future',{state:'release_pending',nextAttemptAt:NOW+1},{state:'release_pending',kind:'future'}],
    ['missing',{state:'reserve_pending'},{state:'reserve_pending',kind:'missing'}],
    ['undefined is missing',{state:'reserve_pending',nextAttemptAt:undefined},{state:'reserve_pending',kind:'missing'}],
    ['null is present but invalid',{state:'reserve_pending',nextAttemptAt:null},{state:'reserve_pending',kind:'invalid'}],
    ['string',{state:'reserve_pending',nextAttemptAt:'1'},{state:'reserve_pending',kind:'invalid'}],
    ['fraction',{state:'reserve_pending',nextAttemptAt:1.5},{state:'reserve_pending',kind:'invalid'}],
    ['negative',{state:'reserve_pending',nextAttemptAt:-1},{state:'reserve_pending',kind:'invalid'}],
    ['NaN',{state:'reserve_pending',nextAttemptAt:Number.NaN},{state:'reserve_pending',kind:'invalid'}],
    ['beyond the safe range',{state:'reserve_pending',nextAttemptAt:2**60},{state:'reserve_pending',kind:'invalid'}],
    ['object',{state:'reserve_pending',nextAttemptAt:{}},{state:'reserve_pending',kind:'invalid'}],
  ] as const)('%s',(_n,data,expected)=>{
    expect(classifySchedule(data as never,NOW,intents)).toEqual(expected);
  });
});

describe('readScheduleInventory',()=>{
  const seed=()=>stub({
    billingIntents:{
      a:{state:'reserve_pending',nextAttemptAt:NOW-10,accountId:'11111111-1111-4111-8111-111111111111'},b:{state:'reserve_pending',nextAttemptAt:NOW+10},
      c:{state:'reserve_pending'},d:{state:'release_pending',nextAttemptAt:null},e:{state:'release_pending',nextAttemptAt:NOW+5},f:{state:'closed',nextAttemptAt:1},
      g:{state:'needs_review'},h:{},i:{state:'reserve_pending',nextAttemptAt:'soon'},
    },
    billingOutbox:{o1:{state:'pending',nextAttemptAt:NOW},o2:{state:'retry_wait',nextAttemptAt:NOW+99},o3:{state:'settled'},o4:{state:'retry_wait'}},
    billingHoldOutbox:{h1:{state:'pending',nextAttemptAt:NOW+1},h2:{state:'pending',nextAttemptAt:NOW+2},h3:{state:'applied'}},
  });
  const find=(inv:Awaited<ReturnType<typeof readScheduleInventory>>,c:string)=>inv.collections.find(x=>x.collection===c)!;

  it('counts every collection, state and kind exactly',async()=>{
    const s=seed(),inv=await readScheduleInventory(s.root as never,NOW);
    const i=find(inv,'billingIntents');
    expect(i.scanned).toBe(9);expect(i.noState).toBe(1);expect(i.otherStates).toBe(2);
    expect(i.selectable.reserve_pending).toEqual({due:1,future:1,missing:1,invalid:1});
    expect(i.selectable.release_pending).toEqual({due:0,future:1,missing:0,invalid:1});
    const o=find(inv,'billingOutbox');expect(o.scanned).toBe(4);expect(o.otherStates).toBe(1);
    expect(o.selectable.pending).toEqual({due:1,future:0,missing:0,invalid:0});expect(o.selectable.retry_wait).toEqual({due:0,future:1,missing:1,invalid:0});
    const h=find(inv,'billingHoldOutbox');expect(h.scanned).toBe(3);expect(h.selectable.pending).toEqual({due:0,future:2,missing:0,invalid:0});
    expect(inv.maxFuturePerState).toBe(2);expect(inv.generatedAtMs).toBe(NOW);
  });
  it('lists every scheduled source and every selectable state, with zeros, even for an empty collection',async()=>{
    const s=stub({}),inv=await readScheduleInventory(s.root as never,NOW);
    expect(inv.collections.map(c=>c.collection)).toEqual(SCHEDULED_SOURCES.map(x=>x.collection));
    for(const source of SCHEDULED_SOURCES){const c=find(inv,source.collection);expect(c.scanned).toBe(0);expect(Object.keys(c.selectable)).toEqual([...source.selectable]);}
    expect(inv.maxFuturePerState).toBe(0);
  });
  it('is identical for any page size and scans every page (including an exact multiple)',async()=>{
    const reference=await readScheduleInventory(seed().root as never,NOW);
    for(const pageSize of [1,2,3,4,9,10,1000]){const s=seed();expect(await readScheduleInventory(s.root as never,NOW,{pageSize})).toEqual(reference);}
  });
  it('never writes, never reads a document by id and projects only the two fields it needs',async()=>{
    const s=seed(),before=JSON.stringify([...s.store.entries()]);
    await readScheduleInventory(s.root as never,NOW);
    expect(s.writes).toEqual([]);expect(JSON.stringify([...s.store.entries()])).toBe(before);
    expect(s.reads.every(r=>r.startsWith('query:'))).toBe(true);
    expect(s.selects.length).toBeGreaterThan(0);expect(s.selects.every(f=>f!==null&&f.join(',')==='state,nextAttemptAt')).toBe(true);
  });
  it('returns counts only: no document id, account id or value appears in the result',async()=>{
    const inv=await readScheduleInventory(seed().root as never,NOW),text=JSON.stringify(inv);
    expect(text).not.toMatch(/11111111-1111|"id"|accountId|soon|o1|h1/);
  });
  it('a failing read rejects loudly instead of returning a partial inventory',async()=>{
    const s=seed();
    const thrower:any=new Proxy({},{get:(_t,prop)=>prop==='get'?async()=>{throw new Error('unavailable');}:()=>thrower});
    const broken={...s.root,collection:(c:string)=>c==='billingOutbox'?thrower:s.root.collection(c)};
    await expect(readScheduleInventory(broken as never,NOW)).rejects.toThrow('unavailable');
  });
  it.each([[Number.NaN],[-1],[1.5],[Number.POSITIVE_INFINITY],[2**60]])('rejects an invalid clock (%s) before reading anything',async(bad)=>{
    const s=seed();await expect(readScheduleInventory(s.root as never,bad)).rejects.toThrow(/clock/i);expect(s.reads).toEqual([]);
  });
  it.each([[0],[-1],[1.5],[Number.NaN],[1001]])('rejects an invalid page size (%s) before reading anything',async(bad)=>{
    const s=seed();await expect(readScheduleInventory(s.root as never,NOW,{pageSize:bad})).rejects.toThrow(/page size/i);expect(s.reads).toEqual([]);
  });
  it('the scheduled sources cannot be changed at runtime, state lists included',()=>{
    expect(Object.isFrozen(SCHEDULED_SOURCES)).toBe(true);
    for(const source of SCHEDULED_SOURCES){expect(Object.isFrozen(source)).toBe(true);expect(Object.isFrozen(source.selectable)).toBe(true);}
  });
  it('the scheduled sources match the selectors in the backend (intents, outbox, hold outbox)',()=>{
    expect(SCHEDULED_SOURCES).toEqual([
      {collection:'billingIntents',selectable:['reserve_pending','release_pending']},
      {collection:'billingOutbox',selectable:['pending','retry_wait']},
      {collection:'billingHoldOutbox',selectable:['pending']},
    ]);
  });
});
