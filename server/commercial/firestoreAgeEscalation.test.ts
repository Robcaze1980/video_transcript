// LV-019.B step 1.6c: MAXIMUM AGE with alert and the INTENT-ATTEMPT record (design 3.4).
// Tests first: they pin the contract before the code exists — the age boundary, the per-row re-read, a malformed or
// future `createdAtMs`, the three collections, the eight-attempt bound, and the section budget/gate/cursor/heartbeat.
import {afterEach,describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {FirestoreBackend,EXTERNAL_BILLING_ATTEMPT_LIMIT,EXTERNAL_BILLING_MAX_AGE_MS} from './firestoreBackend';
import {DRAIN_CURSOR_KINDS} from './billingDrainLease';
import {runBillingDrainSection,type BillingDrainSectionBackend} from './billingDrainSection';
import {stub} from './billingFirestoreStub';

const NOW=1_700_000_000_000,DAY=24*60*60*1000,ACCOUNT='11111111-1111-4111-8111-111111111111';
const backend=(initial:Record<string,Record<string,Record<string,unknown>>>)=>{const s=stub(initial,{trackVersions:true});return {s,b:new FirestoreBackend(s.db as never,s.root as never)};};
const intentRow=(extra:Record<string,unknown>={})=>({accountId:ACCOUNT,state:'reserve_pending',attempts:1,nextAttemptAt:0,createdAtMs:NOW,...extra});
const writesTo=(s:ReturnType<typeof stub>,collection:string)=>s.writes.filter(w=>w.split(':')[1].startsWith(collection+'/'));

afterEach(()=>{vi.useRealTimers();});

describe('escalateStaleBillingRows parameters',()=>{
  it('refuses a bad clock, limit, maxAgeMs, cursor or gate instead of touching a row',async()=>{
    const {s,b}=backend({billingIntents:{a:intentRow({createdAtMs:NOW-DAY})}});
    for(const options of [{now:-1,limit:5},{now:1.5,limit:5},{now:NOW,limit:0},{now:NOW,limit:101},{now:NOW,limit:5,maxAgeMs:0},{now:NOW,limit:5,maxAgeMs:1.5},{now:NOW,limit:5,after:'a/b'},{now:NOW,limit:5,after:'..'},{now:NOW,limit:5,shouldContinue:'nope'} as never]){
      await expect(b.escalateStaleBillingRows(options as never),JSON.stringify(options)).rejects.toMatchObject({code:'invalid'});
    }
    expect(s.writes).toEqual([]);
  });
  it('defaults to a 48 h maximum age',()=>{
    expect(EXTERNAL_BILLING_MAX_AGE_MS).toBe(48*60*60*1000);
  });
});

describe('escalateStaleBillingRows age boundary',()=>{
  it('leaves a row of exactly the maximum age and a younger one untouched, and escalates one millisecond older',async()=>{
    const maxAgeMs=1000;
    const {s,b}=backend({billingIntents:{
      exact:{...intentRow({createdAtMs:NOW-maxAgeMs})},
      younger:{...intentRow({createdAtMs:NOW-maxAgeMs+1})},
      older:{...intentRow({createdAtMs:NOW-maxAgeMs-1})},
    }});
    const report=await b.escalateStaleBillingRows({now:NOW,maxAgeMs,limit:10});
    expect(report.escalated).toBe(1);expect(report.failed).toBe(0);expect(report.stopped).toBe(false);
    expect(s.store.get('billingIntents/exact')!.state).toBe('reserve_pending');
    expect(s.store.get('billingIntents/younger')!.state).toBe('reserve_pending');
    const older=s.store.get('billingIntents/older')!;
    expect(older.state).toBe('needs_review');expect(older.reviewReason).toBe('max_age');
    expect(older.updatedAtMs).toBe(NOW);
  });
  it('never reads the wall clock to decide: the same row is young or stale depending only on `now`',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date(NOW+10*DAY));
    const {s,b}=backend({billingIntents:{a:intentRow({createdAtMs:NOW})}});
    expect((await b.escalateStaleBillingRows({now:NOW,maxAgeMs:DAY,limit:10})).escalated).toBe(0);
    expect((await b.escalateStaleBillingRows({now:NOW+2*DAY,maxAgeMs:DAY,limit:10})).escalated).toBe(1);
    expect(s.store.get('billingIntents/a')!.state).toBe('needs_review');
  });
});

describe('escalateStaleBillingRows malformed age, changed state and collections',()=>{
  it('counts a missing, textual, negative or future createdAtMs as a failure and leaves the row intact',async()=>{
    const {s,b}=backend({billingIntents:{
      absent:{accountId:ACCOUNT,state:'reserve_pending',attempts:1,nextAttemptAt:0},
      textual:{...intentRow(),createdAtMs:'yesterday'},
      negative:{...intentRow(),createdAtMs:-5},
      future:{...intentRow(),createdAtMs:NOW+1},
      stale:{...intentRow(),createdAtMs:NOW-DAY-1},
    }});
    const report=await b.escalateStaleBillingRows({now:NOW,maxAgeMs:DAY,limit:10});
    expect(report.failed).toBe(4);expect(report.escalated).toBe(1);
    for(const id of ['absent','textual','negative','future'])expect(s.store.get('billingIntents/'+id)!.state).toBe('reserve_pending');
    expect(s.store.get('billingIntents/stale')!.state).toBe('needs_review');
  });
  it('never overwrites a row whose state changed between the page read and its own transaction',async()=>{
    const {s,b}=backend({billingIntents:{a:{...intentRow(),createdAtMs:NOW-DAY-1}}});
    let changed=false;
    const report=await b.escalateStaleBillingRows({now:NOW,maxAgeMs:DAY,limit:10,shouldContinue:async()=>{
      if(!changed){changed=true;s.store.set('billingIntents/a',{...s.store.get('billingIntents/a')!,state:'closed'});}
      return true;
    }});
    expect(report.escalated).toBe(0);
    const row=s.store.get('billingIntents/a')!;
    expect(row.state).toBe('closed');expect(row.reviewReason).toBeUndefined();
  });
  it('covers the three non-terminal collections and only their non-terminal states',async()=>{
    const {s,b}=backend({
      billingIntents:{i_res:{...intentRow(),createdAtMs:NOW-DAY-1},i_rel:{...intentRow({state:'release_pending'}),createdAtMs:NOW-DAY-1},i_closed:{...intentRow({state:'closed'}),createdAtMs:NOW-DAY-1}},
      billingOutbox:{o_pending:{accountId:ACCOUNT,state:'pending',attempts:0,nextAttemptAt:0,createdAtMs:NOW-DAY-1},o_retry:{accountId:ACCOUNT,state:'retry_wait',attempts:1,nextAttemptAt:0,createdAtMs:NOW-DAY-1},o_settled:{accountId:ACCOUNT,state:'settled',createdAtMs:NOW-DAY-1}},
      billingHoldOutbox:{h_pending:{accountId:ACCOUNT,state:'pending',attempts:0,nextAttemptAt:0,createdAtMs:NOW-DAY-1},h_applied:{accountId:ACCOUNT,state:'applied',createdAtMs:NOW-DAY-1}},
    });
    const report=await b.escalateStaleBillingRows({now:NOW,maxAgeMs:DAY,limit:10});
    expect(report.escalated).toBe(5);expect(report.failed).toBe(0);
    for(const key of ['billingIntents/i_res','billingIntents/i_rel','billingOutbox/o_pending','billingOutbox/o_retry','billingHoldOutbox/h_pending'])expect(s.store.get(key)!.state).toBe('needs_review');
    for(const key of ['billingIntents/i_closed','billingOutbox/o_settled','billingHoldOutbox/h_applied'])expect(s.store.get(key)!.state).not.toBe('needs_review');
  });
  it('moves no balance, hold or guard while recording the escalation observation',async()=>{
    const {s,b}=backend({billingIntents:{a:{...intentRow(),createdAtMs:NOW-DAY-1}},accounts:{[ACCOUNT]:{available:5,reserved:2}},ledgerEntries:{l1:{kind:'video_reserve'}}});
    await b.escalateStaleBillingRows({now:NOW,maxAgeMs:DAY,limit:10});
    expect(writesTo(s,'accounts')).toEqual([]);expect(writesTo(s,'ledgerEntries')).toEqual([]);
    expect(writesTo(s,'billingHoldOutbox')).toEqual([]);expect(writesTo(s,'billingGuards')).toEqual([]);
    expect(writesTo(s,'billingIntentAgeObservations')).toHaveLength(1);
    expect(s.store.get('accounts/'+ACCOUNT)).toEqual({available:5,reserved:2});
    expect(s.store.get('ledgerEntries/l1')).toEqual({kind:'video_reserve'});
  });
  it('is idempotent: a second pass over an escalated row writes nothing more',async()=>{
    const {s,b}=backend({billingIntents:{a:{...intentRow(),createdAtMs:NOW-DAY-1}}});
    expect((await b.escalateStaleBillingRows({now:NOW,maxAgeMs:DAY,limit:10})).escalated).toBe(1);
    const after=s.store.get('billingIntents/a')!;
    expect((await b.escalateStaleBillingRows({now:NOW+1000,maxAgeMs:DAY,limit:10})).escalated).toBe(0);
    expect(s.store.get('billingIntents/a')).toEqual(after);
  });
  it('rotates with its cursor and limit, wrapping to the beginning',async()=>{
    const {b}=backend({billingIntents:Object.fromEntries(['a','b','c','d'].map(id=>[id,{...intentRow(),createdAtMs:NOW-DAY-1}]))});
    const first=await b.escalateStaleBillingRows({now:NOW,maxAgeMs:DAY,limit:2});
    expect(first.escalated).toBe(2);expect(first.next).toBe('b');
    const second=await b.escalateStaleBillingRows({now:NOW,maxAgeMs:DAY,limit:2,after:first.next});
    expect(second.escalated).toBe(2);expect(second.next).toBe('d');
    const wrapped=await b.escalateStaleBillingRows({now:NOW,maxAgeMs:DAY,limit:2,after:second.next});
    expect(wrapped.escalated).toBe(0);expect(wrapped.next).toBeNull();
  });
  it('stops inside a tie group on the last COMPLETED id, so the rest of the group is reached next',async()=>{
    const ids=['a'];
    const {s,b}=backend({billingIntents:{[ids[0]]:{...intentRow(),createdAtMs:NOW-DAY-1}},billingOutbox:{[ids[0]]:{accountId:ACCOUNT,state:'pending',attempts:0,nextAttemptAt:0,createdAtMs:NOW-DAY-1}},billingHoldOutbox:{[ids[0]]:{accountId:ACCOUNT,state:'pending',attempts:0,nextAttemptAt:0,createdAtMs:NOW-DAY-1}}});
    let asked=0;
    const first=await b.escalateStaleBillingRows({now:NOW,maxAgeMs:DAY,limit:1,shouldContinue:async()=>++asked<=1});
    expect(first.stopped).toBe(true);expect(first.escalated).toBe(1);expect(first.next).toBeNull();
    const second=await b.escalateStaleBillingRows({now:NOW,maxAgeMs:DAY,limit:10,after:first.next});
    expect(second.escalated).toBe(2);
    for(const key of ['billingIntents/a','billingOutbox/a','billingHoldOutbox/a'])expect(s.store.get(key)!.state).toBe('needs_review');
  });
  it('advances the stop cursor past a fully completed tie group and resumes at the next one',async()=>{
    const rows=Object.fromEntries(['a','b'].map(id=>[id,{...intentRow(),createdAtMs:NOW-DAY-1}]));
    const {s,b}=backend({billingIntents:rows,billingOutbox:Object.fromEntries(['a','b'].map(id=>[id,{accountId:ACCOUNT,state:'pending',attempts:0,nextAttemptAt:0,createdAtMs:NOW-DAY-1}]))});
    let asked=0;
    const report=await b.escalateStaleBillingRows({now:NOW,maxAgeMs:DAY,limit:10,shouldContinue:async()=>++asked<=4});
    expect(report.stopped).toBe(true);expect(report.escalated).toBe(2);expect(report.next).toBe('a');
    expect(s.store.get('billingIntents/b')!.state).toBe('reserve_pending');
  });
  it('requires the exact state seen by the scan, skipping a row that moved to another non-terminal state',async()=>{
    const {s,b}=backend({billingIntents:{a:{...intentRow(),createdAtMs:NOW-DAY-1}}});
    let changed=false;
    const report=await b.escalateStaleBillingRows({now:NOW,maxAgeMs:DAY,limit:10,shouldContinue:async()=>{
      if(!changed){changed=true;s.store.set('billingIntents/a',{...s.store.get('billingIntents/a')!,state:'release_pending'});}
      return true;
    }});
    expect(report.escalated).toBe(0);expect(s.store.get('billingIntents/a')!.state).toBe('release_pending');
  });
  it('escalates a dangling or expired intent lease and clears its three fields, but never an active one',async()=>{
    const {s,b}=backend({billingIntents:{
      active:{...intentRow(),createdAtMs:NOW-DAY-1,leaseToken:'11111111-1111-4111-8111-111111111111',leaseOwner:'holder-a',leaseUntil:NOW+1000},
      expired:{...intentRow(),createdAtMs:NOW-DAY-1,leaseToken:'22222222-2222-4222-8222-222222222222',leaseOwner:'holder-b',leaseUntil:NOW-1},
      dangling:{...intentRow(),createdAtMs:NOW-DAY-1,leaseToken:'33333333-3333-4333-8333-333333333333'},
    }});
    const report=await b.escalateStaleBillingRows({now:NOW,maxAgeMs:DAY,limit:10});
    expect(report.escalated).toBe(2);
    expect(s.store.get('billingIntents/active')!.state).toBe('reserve_pending');
    // Clearing the three lease fields uses FieldValue.delete(), which only real Firestore applies; the in-memory stub
    // keeps the sentinel as a value, so that half is pinned by the emulator case (real Firestore) and here we assert the
    // state outcome and that the escalation itself carries the delete sentinels for a leased row.
    for(const id of ['expired','dangling'])expect(s.store.get('billingIntents/'+id)!.state).toBe('needs_review');
    const written=s.store.get('billingIntents/expired')!;
    for(const field of ['leaseToken','leaseOwner','leaseUntil'])expect((written[field] as {methodName?:string})?.methodName).toBe('FieldValue.delete');
  });  it('stops row by row when the gate refuses and resumes right after the last attended row',async()=>{
    const {s,b}=backend({billingIntents:Object.fromEntries(['a','b','c'].map(id=>[id,{...intentRow(),createdAtMs:NOW-DAY-1}]))});
    let asked=0;
    const report=await b.escalateStaleBillingRows({now:NOW,maxAgeMs:DAY,limit:10,shouldContinue:async()=>++asked<4});
    expect(report.stopped).toBe(true);expect(report.escalated).toBe(1);expect(report.next).toBe('a');
    expect(s.store.get('billingIntents/b')!.state).toBe('reserve_pending');
  });
});

describe('recordExternalBillingIntentStall',()=>{
  const key=(accountId:string,requestKey:string)=>createHash('sha256').update(JSON.stringify([accountId,requestKey])).digest('hex');
  it('advances attempts, sets the growing wait and reaches needs_review at the eighth attempt without blocking the owner',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date(NOW));
    const requestKey='synthetic-stall-request',id=key(ACCOUNT,requestKey);
    const {s,b}=backend({billingIntents:{[id]:{...intentRow({attempts:7}),requestKey,id}}});
    expect(await b.recordExternalBillingIntentStall(ACCOUNT,requestKey,'unavailable')).toBe(true);
    const row=s.store.get('billingIntents/'+id)!;
    expect(row.state).toBe('needs_review');expect(row.attempts).toBe(EXTERNAL_BILLING_ATTEMPT_LIMIT);
    expect(row.lastErrorCode).toBe('unavailable');expect(row.lastAttemptAtMs).toBe(NOW);
    expect(row.nextAttemptAt).toBe(0);
    expect(writesTo(s,'billingHoldOutbox')).toEqual([]);expect(writesTo(s,'billingGuards')).toEqual([]);
  });
  it('uses min(15 min, 1 s times two to the attempts) and coerces an unknown code to unavailable',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date(NOW));
    const requestKey='synthetic-stall-wait',id=key(ACCOUNT,requestKey);
    const {s,b}=backend({billingIntents:{[id]:{...intentRow({attempts:3}),requestKey,id}}});
    expect(await b.recordExternalBillingIntentStall(ACCOUNT,requestKey,'not_a_code')).toBe(true);
    const row=s.store.get('billingIntents/'+id)!;
    expect(row.attempts).toBe(4);expect(row.nextAttemptAt).toBe(NOW+Math.min(15*60_000,1000*2**4));
    expect(row.lastErrorCode).toBe('unavailable');expect(row.state).toBe('reserve_pending');
  });
  it('counts one attempt per due window: a second call inside the new wait writes nothing',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date(NOW));
    const requestKey='synthetic-stall-due',id=key(ACCOUNT,requestKey);
    const {s,b}=backend({billingIntents:{[id]:{...intentRow({attempts:1,nextAttemptAt:0}),requestKey,id}}});
    expect(await b.recordExternalBillingIntentStall(ACCOUNT,requestKey,'unavailable')).toBe(true);
    expect(s.store.get('billingIntents/'+id)!.attempts).toBe(2);
    expect(await b.recordExternalBillingIntentStall(ACCOUNT,requestKey,'unavailable')).toBe(false);
    expect(s.store.get('billingIntents/'+id)!.attempts).toBe(2);
    expect(writesTo(s,'billingIntents')).toHaveLength(1);
    s.store.set('billingIntents/'+id,{...s.store.get('billingIntents/'+id)!,nextAttemptAt:NOW-1});
    expect(await b.recordExternalBillingIntentStall(ACCOUNT,requestKey,'unavailable')).toBe(true);
    expect(s.store.get('billingIntents/'+id)!.attempts).toBe(3);
  });  it('refuses a row that is no longer pending, a leased row and another account without writing',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date(NOW));
    const requestKey='synthetic-stall-refuse',id=key(ACCOUNT,requestKey);
    const {s,b}=backend({billingIntents:{[id]:{...intentRow({state:'closed'}),requestKey,id}}});
    expect(await b.recordExternalBillingIntentStall(ACCOUNT,requestKey,'unavailable')).toBe(false);
    expect(s.writes).toEqual([]);
    s.store.set('billingIntents/'+id,{...intentRow(),requestKey,id,leaseToken:'x',leaseOwner:'other',leaseUntil:NOW+1000});
    expect(await b.recordExternalBillingIntentStall(ACCOUNT,requestKey,'unavailable')).toBe(false);
    expect(s.store.get('billingIntents/'+id)!.attempts).toBe(1);
    await expect(b.recordExternalBillingIntentStall('not-a-uuid',requestKey,'unavailable')).rejects.toMatchObject({code:'invalid'});
    await expect(b.recordExternalBillingIntentStall(ACCOUNT,'','unavailable')).rejects.toMatchObject({code:'invalid'});
  });
});

describe('the age section of the drain executor',()=>{
  const leaseOps=(over:Record<string,unknown>={})=>{
    const releases:Array<{holderId:string;token:number}>=[],sets:Array<{kind:string;cursor:string|null}>=[],reads:string[]=[];
    const ops={
      acquire:async(o:{now:number})=>({acquired:true as const,token:7,expiresAtMs:o.now+90_000}),
      renew:async()=>true,release:async(o:{holderId:string;token:number})=>{releases.push(o);return true;},
      assertHeld:async()=>true,
      getCursor:async(o:{kind:string})=>{reads.push(o.kind);return (over.cursors as Record<string,string>|undefined)?.[o.kind]??null;},
      setCursor:async(o:{kind:string;cursor:string|null})=>{sets.push({kind:o.kind,cursor:o.cursor});return true;},
      ...over,
    };
    return {ops,releases,sets,reads};
  };
  const ai=()=>({drainExternalHolds:vi.fn(async()=>({applied:0,failed:0,review:0,skippedRows:0,stopped:false})),
    drainExternalBilling:vi.fn(async()=>({settled:0,failed:0,intentsRecovered:0,intentsFailed:0,skippedRows:0,stopped:false,next:{intents:null,outbox:null},traversed:{intents:true,outbox:true}}))}) as never;
  const backendDouble=(over:{age?:unknown}={},order:string[]=[])=>({
    resolveExpiredUnknown:vi.fn(async()=>{order.push('unknown');return {scanned:0,resolved:0,notDue:0,failed:0,next:null};}),
    escalateStaleBillingRows:vi.fn(async(o:any)=>{order.push('age');if(over.age instanceof Error)throw over.age;return over.age??{scanned:1,escalated:1,failed:0,next:'g1',stopped:false};}),
  }) as unknown as BillingDrainSectionBackend&{escalateStaleBillingRows:{mock:{calls:any[][]}}};
  const base=(extra:Record<string,unknown>={})=>({db:{} as never,root:{path:'age-unit-root'} as never,ai:ai(),backend:backendDouble(),now:NOW,enabled:true,budgetMs:60_000,log:vi.fn(),...extra});
  it('runs the age sweep LAST, after the unknown resolver, with its own cursor and gate',async()=>{
    const order:string[]=[],b=backendDouble({},order),{ops,reads,sets}=leaseOps();
    const result=await runBillingDrainSection({...base({backend:b,lease:ops}),enabled:true});
    expect(order).toEqual(['unknown','age']);
    expect(reads).toContain('age');expect(sets.map(s=>s.kind)).toContain('age');
    expect(result.staleEscalated).toBe(1);
    const args=(b.escalateStaleBillingRows as unknown as {mock:{calls:any[][]}}).mock.calls[0][0];
    expect(args.now).toBe(NOW);expect(typeof args.shouldContinue).toBe('function');expect(args.limit).toBe(100);
  });
  it('counts a failed age row and a stop, and never lets the age section throw out of the pass',async()=>{
    const failing=backendDouble({age:{scanned:2,escalated:0,failed:2,next:'g1',stopped:true}});
    const result=await runBillingDrainSection({...base({backend:failing,lease:leaseOps().ops}),enabled:true});
    expect(result.outcome).toBe('partial');expect(result.failed).toBe(2);expect(result.staleEscalated).toBe(0);
    const throwing=backendDouble({age:new Error('SECRET age failure')});
    const second=await runBillingDrainSection({...base({backend:throwing,root:{path:'age-unit-root-2'} as never,lease:leaseOps().ops}),enabled:true});
    expect(second.outcome).toBe('partial');expect(second.failed).toBe(1);
  });
  it('skips the age section when the backend has no such method and still emits the heartbeat',async()=>{
    const b={resolveExpiredUnknown:vi.fn(async()=>({scanned:0,resolved:0,notDue:0,failed:0,next:null}))} as unknown as BillingDrainSectionBackend;
    const result=await runBillingDrainSection({...base({backend:b,root:{path:'age-unit-root-3'} as never,lease:leaseOps().ops}),enabled:true});
    expect(result).toMatchObject({outcome:'ok',staleEscalated:0});
  });
  it('emits staleEscalated in the single-line heartbeat and declares the age cursor kind',async()=>{
    const log=vi.fn();
    await runBillingDrainSection({...base({log,root:{path:'age-unit-root-4'} as never,lease:leaseOps().ops}),enabled:true});
    const line=JSON.parse((log.mock.calls[0][0] as string));
    expect(Object.keys(line).sort()).toEqual(['durationMs','event','failed','holds','intentsFailed','intentsRecovered','leaseToken','outcome','settled','skippedRows','staleEscalated','startedAtMs','unknownResolved'].sort());
    expect(line.staleEscalated).toBe(1);
    expect(DRAIN_CURSOR_KINDS).toContain('age');
  });
});

