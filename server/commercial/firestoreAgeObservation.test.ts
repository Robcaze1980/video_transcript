import {describe,expect,it} from 'vitest';
import {FirestoreBackend} from './firestoreBackend';
import {stub} from './billingFirestoreStub';

const now=1_700_000_000_000,old=now-1001;
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
const row=(owner:string,state:string,extra:Record<string,unknown>={})=>({accountId:owner,state,createdAtMs:old,attempts:1,nextAttemptAt:0,...extra});
const observations=(s:ReturnType<typeof stub>)=>[...s.store.entries()].filter(([path])=>path.startsWith('billingIntentAgeObservations/'));
const backend=(s:ReturnType<typeof stub>)=>new FirestoreBackend(s.db as never,s.root as never);
const ageStub=(initial:Parameters<typeof stub>[0])=>stub(initial,{trackVersions:true});

describe('age transition observations are unassigned evidence, not a guard',()=>{
  it('records the exact prior intent state for two accounts; leaves legacy review and other row types alone',async()=>{
    const s=ageStub({billingIntents:{first:row(a,'release_pending'),second:row(b,'reserve_pending'),legacy:row(a,'needs_review',{reviewReason:'max_age'})},
      billingOutbox:{out:row(a,'pending',{action:'release'})},billingHoldOutbox:{hold:row(b,'pending')},
      accounts:{[a]:{available:17,reserved:3},[b]:{available:20,reserved:0}}});
    const report=await backend(s).escalateStaleBillingRows({now,maxAgeMs:1000,limit:10});
    expect(report).toMatchObject({escalated:4,failed:0});
    const first=s.store.get('billingIntents/first')!,second=s.store.get('billingIntents/second')!;
    expect(first.state).toBe('needs_review');expect(second.state).toBe('needs_review');
    const firstId=first.ageObservationId as string,secondId=second.ageObservationId as string;
    expect(firstId).toMatch(/^[0-9a-f-]{36}$/);expect(secondId).toMatch(/^[0-9a-f-]{36}$/);expect(firstId).not.toBe(secondId);
    expect(s.store.get('billingIntentAgeObservations/'+firstId)).toEqual({protocol:1,id:firstId,intentId:'first',priorState:'release_pending',reason:'max_age',observedAtMs:now,sourceCreatedAtMs:old});
    expect(s.store.get('billingIntentAgeObservations/'+secondId)).toEqual({protocol:1,id:secondId,intentId:'second',priorState:'reserve_pending',reason:'max_age',observedAtMs:now,sourceCreatedAtMs:old});
    expect(observations(s)).toHaveLength(2);
    expect(s.store.get('billingIntents/legacy')!.ageObservationId).toBeUndefined();
    expect(s.store.get('billingOutbox/out')!.ageObservationId).toBeUndefined();
    expect(s.store.get('billingHoldOutbox/hold')!.ageObservationId).toBeUndefined();
    expect(s.store.get('accounts/'+a)).toEqual({available:17,reserved:3});
    expect(s.store.get('accounts/'+b)).toEqual({available:20,reserved:0});
    expect(s.writes.some(write=>write.includes('billingGuards/'))).toBe(false);
  });

  it('retains the first observation after a reopen, and a second transition gets a different ID',async()=>{
    const s=ageStub({billingIntents:{item:row(a,'release_pending')}}),store=backend(s);
    expect((await store.escalateStaleBillingRows({now,maxAgeMs:1000,limit:10})).escalated).toBe(1);
    const first=s.store.get('billingIntents/item')!.ageObservationId as string;
    expect((await store.escalateStaleBillingRows({now:now+1,maxAgeMs:1000,limit:10})).escalated).toBe(0);
    expect(observations(s)).toHaveLength(1);
    // A privileged fixture simulates a later reopen with the old pointer cleared; it does not authorize one.
    const {ageObservationId,...reopened}=s.store.get('billingIntents/item')!;
    s.store.set('billingIntents/item',{...reopened,state:'reserve_pending',reviewReason:null});
    expect((await store.escalateStaleBillingRows({now:now+2,maxAgeMs:1000,limit:10})).escalated).toBe(1);
    const second=s.store.get('billingIntents/item')!.ageObservationId as string;
    expect(second).not.toBe(first);expect(observations(s)).toHaveLength(2);
    expect(s.store.get('billingIntentAgeObservations/'+first)!.priorState).toBe('release_pending');
    expect(s.store.get('billingIntentAgeObservations/'+second)!.priorState).toBe('reserve_pending');
  });

  it('does not partly change the row when the observation create fails',async()=>{
    const s=ageStub({billingIntents:{item:row(a,'release_pending')}}),before=structuredClone(s.store.get('billingIntents/item'));
    const rejecting={runTransaction:(work:(tx:unknown)=>unknown)=>s.db.runTransaction(async tx=>{
      const original=tx as {create:(ref:{path:string},data:unknown)=>void};
      return work({...original,create:(ref:{path:string},data:unknown)=>{
        if(ref.path.startsWith('billingIntentAgeObservations/'))throw Error('synthetic write failure');
        return original.create(ref,data);
      }});
    })};
    const report=await new FirestoreBackend(rejecting as never,s.root as never).escalateStaleBillingRows({now,maxAgeMs:1000,limit:10});
    expect(report).toMatchObject({failed:1,escalated:0});
    expect(s.store.get('billingIntents/item')).toEqual(before);expect(observations(s)).toHaveLength(0);
    expect(s.writes).toEqual(['create:billingIntentAgeAttempts/item']);
    expect(s.store.get('billingIntentAgeAttempts/item')).toMatchObject({intentId:'item',status:'pending'});
  });

  it('does not create observations for an active lease, invalid age or state changed since scan',async()=>{
    const s=ageStub({billingIntents:{active:row(a,'release_pending',{leaseUntil:now+1}),bad:row(b,'release_pending',{createdAtMs:'unknown'}),
      changed:row(a,'reserve_pending')}}),store=backend(s);
    const report=await store.escalateStaleBillingRows({now,maxAgeMs:1000,limit:10,shouldContinue:()=>{
      s.store.set('billingIntents/changed',{...s.store.get('billingIntents/changed')!,state:'closed'});return true;
    }});
    expect(report).toMatchObject({escalated:0,failed:1});expect(observations(s)).toHaveLength(0);
    expect(s.store.get('billingIntents/active')!.state).toBe('release_pending');
    expect(s.store.get('billingIntents/changed')!.state).toBe('closed');
  });
});
