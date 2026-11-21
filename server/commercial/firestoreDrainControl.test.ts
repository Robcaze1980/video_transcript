// LV-019.B step 1.6b (first round): the PURE part of the drain CONTROL contract, with no emulator.
// It pins the optional rotation cursor the queue readers gain: `pendingExternalBillingIntents(limit, afterId)` and
// `pendingExternalBilling(limit, afterId)` start strictly AFTER the given document id, keep document-id order, wrap to
// the beginning to complete a rotation without repeating a row, and treat an unknown or foreign cursor as "read from the
// beginning". Without the cursor their behaviour and their query shape are unchanged (the existing billingSelection.test.ts
// already pins that side).
//
// These checks are written to FAIL TODAY for the right reason: the second argument is ignored, so a reader asked to start
// after an id still returns the plain document order from the beginning.
import {afterEach,describe,expect,it,vi} from 'vitest';
import {FirestoreBackend} from './firestoreBackend';
import {stub} from './billingFirestoreStub';

const NOW=Date.now(),DAY=24*60*60*1000;
const ids=(prefix:string,n:number)=>Array.from({length:n},(_,i)=>prefix+String(i).padStart(4,'0'));
const rows=(prefix:string,n:number,data:Record<string,unknown>)=>Object.fromEntries(ids(prefix,n).map(id=>[id,{...data}]));
const backend=(initial:Record<string,Record<string,Record<string,unknown>>>)=>{const s=stub(initial);return {s,b:new FirestoreBackend(s.db as never,s.root as never)};};
const idsOf=(r:Array<{id:string}>)=>r.map(x=>x.id);
/** A full rotation starts strictly after the cursor, wraps once and never repeats a row. */
const isRotationOf=(got:string[],all:string[],after:string)=>{
  if(got.length===0)return true;
  const start=all.indexOf(after),expected=all.slice(start+1).concat(all.slice(0,start+1));
  return got.every((id,index)=>id===expected[index]);
};

afterEach(()=>{vi.useRealTimers();});

describe('pendingExternalBillingIntents rotation cursor',()=>{
  const six=()=>backend({billingIntents:rows('res_',6,{state:'reserve_pending',nextAttemptAt:0})});

  it('starts strictly after the given id and keeps document-id order',async()=>{
    const {b}=six(),all=ids('res_',6);
    expect(idsOf(await b.pendingExternalBillingIntents(2,'res_0002'))).toEqual(['res_0003','res_0004']);
    expect(isRotationOf(idsOf(await b.pendingExternalBillingIntents(2,'res_0002')),all,'res_0002')).toBe(true);
  });

  it('wraps to the beginning to complete a rotation when the tail runs short',async()=>{
    const {b}=six(),all=ids('res_',6);
    const wrapped=idsOf(await b.pendingExternalBillingIntents(3,'res_0004'));
    expect(wrapped).toEqual(['res_0005','res_0000','res_0001']);
    expect(isRotationOf(wrapped,all,'res_0004')).toBe(true);
  });

  it('treats an unknown or foreign cursor, and a null cursor, as read from the beginning',async()=>{
    const {b}=six(),all=ids('res_',6);
    for(const cursor of ['not-a-row','other-collection-id',null])expect(idsOf(await b.pendingExternalBillingIntents(2,cursor as never))).toEqual(all.slice(0,2));
  });

  it('without a cursor the order is exactly the plain document order (unchanged today)',async()=>{
    const {b}=six();
    expect(idsOf(await b.pendingExternalBillingIntents(3))).toEqual(['res_0000','res_0001','res_0002']);
  });
});

describe('pendingExternalBilling rotation cursor',()=>{
  const six=()=>backend({billingOutbox:rows('p_',6,{state:'pending'})});

  it('starts strictly after the given id and keeps document-id order',async()=>{
    const {b}=six(),all=ids('p_',6);
    expect(idsOf(await b.pendingExternalBilling(2,'p_0002'))).toEqual(['p_0003','p_0004']);
    expect(isRotationOf(idsOf(await b.pendingExternalBilling(2,'p_0002')),all,'p_0002')).toBe(true);
  });

  it('wraps to the beginning to complete a rotation when the tail runs short',async()=>{
    const {b}=six();
    expect(idsOf(await b.pendingExternalBilling(3,'p_0004'))).toEqual(['p_0005','p_0000','p_0001']);
  });

  it('rotates the interleaved pending and retry_wait kinds without repeating a row',async()=>{
    // The exact interleave of the two kinds after a wrap is an implementation detail, so this pins what the contract
    // fixes: the rotation returns each due row at most once, it does NOT restart at the first row (which is what the
    // ignored second argument does today), and it leaves the cursor row out. Excluding the cursor is required for the
    // rotation to make progress: the cursor is the last row attended, so re-serving it would freeze `next` on the same
    // id every pass and the queue would never rotate.
    const {b}=backend({billingOutbox:{...rows('p_',4,{state:'pending'}),...rows('r_',4,{state:'retry_wait',nextAttemptAt:0})}});
    const all=idsOf(await b.pendingExternalBilling(100));
    const cursor=all[4];
    const got=idsOf(await b.pendingExternalBilling(100,cursor));
    expect(got.length).toBe(all.length-1);
    expect(new Set(got).size).toBe(got.length);
    expect(got).not.toContain(cursor);
    expect(got[0]).not.toBe(all[0]);
  });

  it('treats an unknown or foreign cursor, and a null cursor, as read from the beginning',async()=>{
    const {b}=six(),all=ids('p_',6);
    for(const cursor of ['not-a-row','res_0003',null])expect(idsOf(await b.pendingExternalBilling(2,cursor as never))).toEqual(all.slice(0,2));
  });

  it('still never selects a not-yet-due retry_wait row while rotating',async()=>{
    const {b}=backend({billingOutbox:{...rows('p_',3,{state:'pending'}),...rows('r_',3,{state:'retry_wait',nextAttemptAt:NOW+DAY})}});
    expect(idsOf(await b.pendingExternalBilling(10,'p_0000'))).toEqual(['p_0001','p_0002']);
  });
});

describe('the cursor is a document id, not a control object',()=>{
  it('leaves the limit validation intact with a cursor present',async()=>{
    const {b}=backend({billingOutbox:rows('p_',3,{state:'pending'})});
    for(const bad of [0,-1,101,1.5])await expect(b.pendingExternalBilling(bad,'p_0000')).rejects.toMatchObject({code:'invalid'});
  });
});
