// LV-019.B: the queue selectors used by the billing drains (FirestoreBackend.pendingExternalBillingIntents / pendingExternalBilling).
// Incident of 2026-11-18: `limit(100)` was applied BEFORE the date filter, so 100 not-yet-due rows with earlier ids hid a due row, and reserves were
// listed before releases, so a release could be left out. These tests pin the corrected behavior with the in-memory Firestore stub; the
// scripts/checkBillingSelectionEmulator.mjs diagnostic repeats it against the Firestore emulator.
import {afterEach,describe,expect,it,vi} from 'vitest';
import {FirestoreBackend} from './firestoreBackend';
import {stub} from './billingFirestoreStub';

const NOW=Date.now(),DAY=24*60*60*1000;
const ids=(prefix:string,n:number)=>Array.from({length:n},(_,i)=>prefix+String(i).padStart(4,'0'));
const rows=(prefix:string,n:number,data:Record<string,unknown>)=>Object.fromEntries(ids(prefix,n).map(id=>[id,{...data}]));
const backend=(initial:Record<string,Record<string,Record<string,unknown>>>)=>{const s=stub(initial);return {s,b:new FirestoreBackend(s.db as never,s.root as never)};};
const idsOf=(r:Array<{id:string}>)=>r.map(x=>x.id);

afterEach(()=>{vi.useRealTimers();});

describe('pendingExternalBillingIntents',()=>{
  it('finds due rows behind 100 not-yet-due rows with earlier ids (the 2026-11-18 incident) and serves both kinds',async()=>{
    const {s,b}=backend({billingIntents:{...rows('a_future_',100,{state:'reserve_pending',nextAttemptAt:NOW+DAY}),z_due_reserve:{state:'reserve_pending',nextAttemptAt:0},z_due_release:{state:'release_pending',nextAttemptAt:0}}});
    expect(idsOf(await b.pendingExternalBillingIntents(100))).toEqual(['z_due_release','z_due_reserve']);
    expect(idsOf(await b.pendingExternalBillingIntents(25))).toEqual(['z_due_release','z_due_reserve']);
    expect(s.writes).toEqual([]);
  });
  it('scans as many pages as it takes: 250 not-yet-due rows, then the due ones',async()=>{
    const {b}=backend({billingIntents:{...rows('a_',250,{state:'reserve_pending',nextAttemptAt:NOW+DAY}),z1:{state:'reserve_pending',nextAttemptAt:1},z2:{state:'release_pending',nextAttemptAt:1}}});
    expect(idsOf(await b.pendingExternalBillingIntents(10))).toEqual(['z2','z1']);
  });
  it('is fair: releases and reserves alternate, releases first, so neither kind is left out when both have due rows',async()=>{
    const {b}=backend({billingIntents:{...rows('res_',30,{state:'reserve_pending',nextAttemptAt:0}),...rows('rel_',30,{state:'release_pending',nextAttemptAt:0})}});
    const r=idsOf(await b.pendingExternalBillingIntents(25));
    expect(r).toHaveLength(25);
    expect(r.slice(0,6)).toEqual(['rel_0000','res_0000','rel_0001','res_0001','rel_0002','res_0002']);
    expect(r.filter(x=>x.startsWith('rel_'))).toHaveLength(13);expect(r.filter(x=>x.startsWith('res_'))).toHaveLength(12);
    expect(idsOf(await b.pendingExternalBillingIntents(1))).toEqual(['rel_0000']);
    expect(idsOf(await b.pendingExternalBillingIntents(2))).toEqual(['rel_0000','res_0000']);
  });
  it('when only one kind is due it fills the limit with it, in id order',async()=>{
    const {b}=backend({billingIntents:rows('res_',40,{state:'reserve_pending',nextAttemptAt:0})});
    expect(idsOf(await b.pendingExternalBillingIntents(25))).toEqual(ids('res_',25));
  });
  it('a missing, null or non-numeric date counts as due (unchanged); a future date does not; the boundary is inclusive',async()=>{
    const {b}=backend({billingIntents:{m:{state:'reserve_pending'},n:{state:'reserve_pending',nextAttemptAt:null},s:{state:'reserve_pending',nextAttemptAt:'soon'},f:{state:'reserve_pending',nextAttemptAt:NOW+DAY},p:{state:'reserve_pending',nextAttemptAt:NOW-1},x:{state:'closed',nextAttemptAt:0}}});
    expect(idsOf(await b.pendingExternalBillingIntents(100)).sort()).toEqual(['m','n','p','s']);
  });
  it('stops reading as soon as it has enough due rows (one query per kind when the first page is enough)',async()=>{
    const {s,b}=backend({billingIntents:{...rows('res_',250,{state:'reserve_pending',nextAttemptAt:0}),...rows('rel_',250,{state:'release_pending',nextAttemptAt:0})}});
    expect(await b.pendingExternalBillingIntents(10)).toHaveLength(10);
    expect(s.reads.filter(r=>r==='query:billingIntents')).toHaveLength(2);
  });
  it('a row due exactly now is due (inclusive boundary), one a millisecond later is not',async()=>{
    vi.useFakeTimers();vi.setSystemTime(NOW);
    const {b}=backend({billingIntents:{exact:{state:'reserve_pending',nextAttemptAt:NOW},later:{state:'reserve_pending',nextAttemptAt:NOW+1}},billingOutbox:{exact:{state:'retry_wait',nextAttemptAt:NOW},later:{state:'retry_wait',nextAttemptAt:NOW+1}}});
    expect(idsOf(await b.pendingExternalBillingIntents(10))).toEqual(['exact']);
    expect(idsOf(await b.pendingExternalBilling(10))).toEqual(['exact']);
  });
  it('only future rows: nothing; no rows at all: nothing',async()=>{
    expect(await backend({billingIntents:rows('f',5,{state:'release_pending',nextAttemptAt:NOW+DAY})}).b.pendingExternalBillingIntents(25)).toEqual([]);
    expect(await backend({}).b.pendingExternalBillingIntents(25)).toEqual([]);
  });
  it('keeps the shape of each row and the limit validation',async()=>{
    const {b}=backend({billingIntents:{a:{state:'reserve_pending',nextAttemptAt:0,accountId:'acc',attempts:2}}});
    const [row]=await b.pendingExternalBillingIntents(5);
    expect(row).toMatchObject({id:'a',state:'reserve_pending',accountId:'acc',attempts:2});expect('snapshotVersion' in row).toBe(true);
    for(const bad of [0,-1,101,1.5,Number.NaN,'5' as never])await expect(b.pendingExternalBillingIntents(bad)).rejects.toMatchObject({code:'invalid'});
  });
});

describe('pendingExternalBilling (settlement outbox)',()=>{
  it('finds due retry_wait rows behind 100 not-yet-due ones, selects pending rows whatever their date, and never a retry_wait row without a numeric date',async()=>{
    const {s,b}=backend({billingOutbox:{...rows('a_future_',100,{state:'retry_wait',nextAttemptAt:NOW+DAY}),z_due:{state:'retry_wait',nextAttemptAt:0},z_nodate:{state:'retry_wait'},z_text:{state:'retry_wait',nextAttemptAt:'x'},z_pending:{state:'pending',nextAttemptAt:NOW+DAY},z_pending_nodate:{state:'pending'},done:{state:'settled'}}});
    expect(idsOf(await b.pendingExternalBilling(100))).toEqual(['z_pending','z_due','z_pending_nodate']);
    expect(s.writes).toEqual([]);
  });
  it('is fair: pending and retry_wait alternate, pending first',async()=>{
    const {b}=backend({billingOutbox:{...rows('p_',30,{state:'pending'}),...rows('r_',30,{state:'retry_wait',nextAttemptAt:0})}});
    const r=idsOf(await b.pendingExternalBilling(25));
    expect(r).toHaveLength(25);expect(r.slice(0,4)).toEqual(['p_0000','r_0000','p_0001','r_0001']);
    expect(r.filter(x=>x.startsWith('p_'))).toHaveLength(13);expect(r.filter(x=>x.startsWith('r_'))).toHaveLength(12);
    expect(idsOf(await b.pendingExternalBilling(1))).toEqual(['p_0000']);
  });
  it('scans past 250 not-yet-due retry_wait rows',async()=>{
    const {b}=backend({billingOutbox:{...rows('a_',250,{state:'retry_wait',nextAttemptAt:NOW+DAY}),z:{state:'retry_wait',nextAttemptAt:5}}});
    expect(idsOf(await b.pendingExternalBilling(3))).toEqual(['z']);
  });
  it('keeps the limit validation and returns nothing when there is nothing',async()=>{
    const {b}=backend({});
    expect(await b.pendingExternalBilling(25)).toEqual([]);
    for(const bad of [0,101,1.5])await expect(b.pendingExternalBilling(bad)).rejects.toMatchObject({code:'invalid'});
  });
});
