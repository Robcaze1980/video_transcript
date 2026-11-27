import {describe,expect,it} from 'vitest';
import {FirestoreBackend} from './firestoreBackend';
import {stub} from './billingFirestoreStub';

const now=1_700_000_000_000,old=now-1001;
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const row=(accountId:string)=>({accountId,state:'reserve_pending',createdAtMs:old});
const make=(initial:Parameters<typeof stub>[0])=>stub(initial,{trackVersions:true});
const options={now,maxAgeMs:1000,limit:10};

/** Synthetic, in-memory dropped ACK after the staged commit, never a Firestore emulator or provider request. */
function dropCommitted(s:ReturnType<typeof make>,path:string){
  let dropped=false,readsAfterDrop=0;
  const db={runTransaction:async(work:(tx:unknown)=>Promise<unknown>)=>{
    let staged=false;
    const result=await s.db.runTransaction(async tx=>work(new Proxy(tx as Record<string,unknown>,{get(target,name){
      if(name==='create')return (ref:{path:string},data:unknown)=>{if(ref.path===path||path.endsWith('/')&&ref.path.startsWith(path))staged=true;return (target.create as Function)(ref,data);};
      if(name==='getAll')return async(...refs:unknown[])=>{if(dropped)readsAfterDrop++;return (target.getAll as Function)(...refs);};
      const value=target[name as string];return typeof value==='function'?value.bind(target):value;
    }})));
    if(staged&&!dropped){dropped=true;throw Error('synthetic dropped ACK after commit');}
    return result;
  }};
  return {db,dropped:()=>dropped,readsAfterDrop:()=>readsAfterDrop};
}

describe('durable age preparation; no owner attribution',()=>{
  it('a lost preparation survives restart and prevents a second transition while B and an outbox proceed',async()=>{
    const s=make({billingIntents:{a:row(A),b:row(B)},billingOutbox:{z:{state:'pending',createdAtMs:old}},
      accounts:{[A]:{available:17,reserved:3},[B]:{available:20,reserved:0}}});
    const transport=dropCommitted(s,'billingIntentAgeAttempts/a');
    const first=await new FirestoreBackend(transport.db as never,s.root as never).escalateStaleBillingRows(options);
    expect(transport.dropped()).toBe(true);expect(first).toMatchObject({failed:1,escalated:2});
    expect(s.store.get('billingIntentAgeAttempts/a')).toMatchObject({intentId:'a',status:'pending'});
    expect(s.store.get('billingIntents/a')!.state).toBe('reserve_pending');
    expect(s.store.get('billingIntents/b')!.state).toBe('needs_review');expect(s.store.get('billingOutbox/z')!.state).toBe('needs_review');
    const writesBefore=s.writes.slice(),second=await new FirestoreBackend(s.db as never,s.root as never).escalateStaleBillingRows(options);
    expect(second.failed).toBe(1);expect(s.writes).toEqual(writesBefore);
    expect(s.store.get('billingIntents/a')!.state).toBe('reserve_pending');
    expect([...s.store.values()].filter(value=>value.intentId==='a'&&value.reason==='max_age')).toHaveLength(0);
    expect(s.store.get('accounts/'+A)).toEqual({available:17,reserved:3});expect(s.store.get('accounts/'+B)).toEqual({available:20,reserved:0});
  });

  it('a commit with a dropped ACK is reconciled and confirmed from the stored row, attempt and observation',async()=>{
    const s=make({billingIntents:{a:row(A)}}),transport=dropCommitted(s,'billingIntentAgeObservations/');
    const result=await new FirestoreBackend(transport.db as never,s.root as never).escalateStaleBillingRows(options);
    expect(transport.dropped()).toBe(true);expect(transport.readsAfterDrop()).toBeGreaterThan(0);
    expect(result).toMatchObject({escalated:1,failed:0});
    const attempt=s.store.get('billingIntentAgeAttempts/a')!,intent=s.store.get('billingIntents/a')!;
    expect(attempt.status).toBe('confirmed');expect(intent.state).toBe('needs_review');expect(intent.ageObservationId).toBe(attempt.observationId);
    expect(s.store.get('billingIntentAgeObservations/'+attempt.observationId)).toMatchObject({intentId:'a',priorState:'reserve_pending'});
    expect([...s.store.keys()].filter(key=>key.startsWith('billingIntentAgeObservations/'))).toHaveLength(1);
  });

  it('two sweepers overlap after A is prepared: the second leaves A alone and can advance B',async()=>{
    const s=make({billingIntents:{a:row(A),b:row(B)}});let prepared=false,announce:()=>void=()=>{},resume:()=>void=()=>{};
    const reached=new Promise<void>(resolve=>{announce=resolve;}),gate=new Promise<void>(resolve=>{resume=resolve;});
    const db={runTransaction:async(work:(tx:unknown)=>Promise<unknown>)=>{
      let staged=false;
      const result=await s.db.runTransaction(async tx=>work(new Proxy(tx as Record<string,unknown>,{get(target,name){
        if(name==='create')return (ref:{path:string},data:unknown)=>{if(ref.path==='billingIntentAgeAttempts/a')staged=true;return (target.create as Function)(ref,data);};
        const value=target[name as string];return typeof value==='function'?value.bind(target):value;
      }})));
      if(staged&&!prepared){prepared=true;announce();await gate;}return result;
    }};
    const first=new FirestoreBackend(db as never,s.root as never).escalateStaleBillingRows(options);
    const timeout=setTimeout(()=>announce(),3000);
    try{
      await reached;expect(prepared).toBe(true);
      const second=await new FirestoreBackend(s.db as never,s.root as never).escalateStaleBillingRows(options);
      expect(second).toMatchObject({escalated:1,failed:1});expect(s.store.get('billingIntents/a')!.state).toBe('reserve_pending');
      expect(s.store.get('billingIntents/b')!.state).toBe('needs_review');
    }finally{clearTimeout(timeout);resume();}
    expect(await first).toMatchObject({escalated:1,failed:0});
    expect(s.store.get('billingIntents/a')!.state).toBe('needs_review');
    expect([...s.store.entries()].filter(([key,value])=>key.startsWith('billingIntentAgeObservations/')&&value.intentId==='a')).toHaveLength(1);
  });

  it('a lost confirmation ACK is resolved by a read without repeating the confirmation write',async()=>{
    const s=make({billingIntents:{a:row(A)}});let confirmations=0,dropped=false;
    const db={runTransaction:async(work:(tx:unknown)=>Promise<unknown>)=>{
      let staged=false;
      const result=await s.db.runTransaction(async tx=>work(new Proxy(tx as Record<string,unknown>,{get(target,name){
        if(name==='update')return (ref:{path:string},data:Record<string,unknown>)=>{
          if(ref.path==='billingIntentAgeAttempts/a'&&data.status==='confirmed'){confirmations++;staged=true;}
          return (target.update as Function)(ref,data);
        };
        const value=target[name as string];return typeof value==='function'?value.bind(target):value;
      }})));
      if(staged&&!dropped){dropped=true;throw Error('synthetic confirmation ACK lost');}return result;
    }};
    const result=await new FirestoreBackend(db as never,s.root as never).escalateStaleBillingRows(options);
    expect(dropped).toBe(true);expect(confirmations).toBe(1);expect(result).toMatchObject({escalated:1,failed:0});
    expect(s.store.get('billingIntentAgeAttempts/a')!.status).toBe('confirmed');
  });

  it('a lost maintenance gate after preparation stops that pass; a separate pass still advances B',async()=>{
    const s=make({billingIntents:{a:row(A),b:row(B)}});let checks=0;
    const first=await new FirestoreBackend(s.db as never,s.root as never).escalateStaleBillingRows({...options,shouldContinue:()=>++checks<2});
    expect(first).toMatchObject({stopped:true,failed:1,escalated:0,next:null});
    expect(s.store.get('billingIntentAgeAttempts/a')!.status).toBe('pending');expect(s.store.get('billingIntents/a')!.state).toBe('reserve_pending');
    expect(s.store.get('billingIntents/b')!.state).toBe('reserve_pending');
    const next=await new FirestoreBackend(s.db as never,s.root as never).escalateStaleBillingRows(options);
    expect(next).toMatchObject({failed:1,escalated:1});expect(s.store.get('billingIntents/b')!.state).toBe('needs_review');
    expect([...s.store.keys()].some(key=>key.startsWith('billingGuards/'))).toBe(false);
  });

  it('a lost gate after the action leaves applied evidence unresolved while another pass can advance B',async()=>{
    const s=make({billingIntents:{a:row(A),b:row(B)}});let checks=0;
    const first=await new FirestoreBackend(s.db as never,s.root as never).escalateStaleBillingRows({...options,shouldContinue:()=>++checks<3});
    expect(first).toMatchObject({stopped:true,failed:1,escalated:0,next:null});
    expect(s.store.get('billingIntentAgeAttempts/a')!.status).toBe('applied');expect(s.store.get('billingIntents/a')!.state).toBe('needs_review');
    const next=await new FirestoreBackend(s.db as never,s.root as never).escalateStaleBillingRows(options);
    expect(next).toMatchObject({failed:0,escalated:1});expect(s.store.get('billingIntents/b')!.state).toBe('needs_review');
    expect(s.store.get('billingIntentAgeAttempts/a')!.status).toBe('applied');
  });

  it('if reconciliation cannot be read, an applied attempt blocks a reopened row after restart',async()=>{
    const s=make({billingIntents:{a:row(A)}});let dropped=false;
    const db={runTransaction:async(work:(tx:unknown)=>Promise<unknown>)=>{
      if(dropped)throw Error('synthetic reconciliation unavailable');
      let staged=false;
      const result=await s.db.runTransaction(async tx=>work(new Proxy(tx as Record<string,unknown>,{get(target,name){
        if(name==='create')return (ref:{path:string},data:unknown)=>{if(ref.path.startsWith('billingIntentAgeObservations/'))staged=true;return (target.create as Function)(ref,data);};
        const value=target[name as string];return typeof value==='function'?value.bind(target):value;
      }})));
      if(staged){dropped=true;throw Error('synthetic commit ACK lost');}return result;
    }};
    const first=await new FirestoreBackend(db as never,s.root as never).escalateStaleBillingRows(options);
    expect(first).toMatchObject({escalated:0,failed:1});expect(s.store.get('billingIntentAgeAttempts/a')!.status).toBe('applied');
    const {ageObservationId,...rest}=s.store.get('billingIntents/a')!;
    s.store.set('billingIntents/a',{...rest,state:'reserve_pending'}); // privileged synthetic change, not an authorized reopening
    const before=s.writes.slice(),second=await new FirestoreBackend(s.db as never,s.root as never).escalateStaleBillingRows(options);
    expect(second.failed).toBe(1);expect(s.writes).toEqual(before);
    expect([...s.store.keys()].filter(key=>key.startsWith('billingIntentAgeObservations/'))).toHaveLength(1);
  });

  it('a same-value recreation between preparation and action is skipped by the transaction version check',async()=>{
    const s=make({billingIntents:{a:row(A)}});let changed=false;
    const db={runTransaction:async(work:(tx:unknown)=>Promise<unknown>)=>{
      let prepared=false;
      const result=await s.db.runTransaction(async tx=>work(new Proxy(tx as Record<string,unknown>,{get(target,name){
        if(name==='create')return (ref:{path:string},data:unknown)=>{if(ref.path==='billingIntentAgeAttempts/a')prepared=true;return (target.create as Function)(ref,data);};
        const value=target[name as string];return typeof value==='function'?value.bind(target):value;
      }})));
      if(prepared&&!changed){changed=true;const original={...s.store.get('billingIntents/a')!};s.store.delete('billingIntents/a');s.store.set('billingIntents/a',original);}
      return result;
    }};
    const result=await new FirestoreBackend(db as never,s.root as never).escalateStaleBillingRows(options);
    expect(changed).toBe(true);expect(result.escalated).toBe(0);expect(s.store.get('billingIntents/a')!.state).toBe('reserve_pending');
    expect(s.store.get('billingIntentAgeAttempts/a')!.status).toBe('skipped');
    expect([...s.store.keys()].some(key=>key.startsWith('billingIntentAgeObservations/'))).toBe(false);
  });

  it('malformed and legacy references fail closed for A without blocking B',async()=>{
    const s=make({billingIntents:{a:row(A),b:row(B)},billingIntentAgeAttempts:{a:{status:'confirmed',intentId:'a',observationId:'not-a-uuid'}},
      accounts:{[A]:{available:17},[B]:{available:20}}});
    const result=await new FirestoreBackend(s.db as never,s.root as never).escalateStaleBillingRows(options);
    expect(result).toMatchObject({failed:1,escalated:1});expect(s.store.get('billingIntents/a')!.state).toBe('reserve_pending');
    expect(s.store.get('billingIntents/b')!.state).toBe('needs_review');expect(s.store.get('accounts/'+A)).toEqual({available:17});
    expect(s.store.get('accounts/'+B)).toEqual({available:20});
  });

  it('a stale pointer on an old pending row is not adopted or removed automatically',async()=>{
    const oldId='44444444-4444-4444-8444-444444444444';
    const s=make({billingIntents:{a:{...row(A),ageObservationId:oldId},b:row(B)},
      billingIntentAgeObservations:{[oldId]:{intentId:'a',priorState:'release_pending'}}});
    const result=await new FirestoreBackend(s.db as never,s.root as never).escalateStaleBillingRows(options);
    expect(result).toMatchObject({failed:1,escalated:1});expect(s.store.get('billingIntents/a')).toMatchObject({state:'reserve_pending',ageObservationId:oldId});
    expect(s.store.has('billingIntentAgeAttempts/a')).toBe(false);expect(s.store.has('billingIntentAgeObservations/'+oldId)).toBe(true);
  });

  it('a confirmed attempt whose observation disappeared cannot authorize a new transition',async()=>{
    const s=make({billingIntents:{a:row(A)}}),backend=new FirestoreBackend(s.db as never,s.root as never);
    expect((await backend.escalateStaleBillingRows(options)).escalated).toBe(1);
    const {ageObservationId,...rest}=s.store.get('billingIntents/a')!;
    s.store.set('billingIntents/a',{...rest,state:'reserve_pending'}); // synthetic privileged perturbations
    s.store.delete('billingIntentAgeObservations/'+ageObservationId);
    const before=s.writes.slice(),result=await backend.escalateStaleBillingRows(options);
    expect(result).toMatchObject({escalated:0,failed:1});expect(s.writes).toEqual(before);
    expect(s.store.get('billingIntentAgeAttempts/a')!.status).toBe('confirmed');
  });

  it('missing source-version metadata leaves the row untouched and creates no attempt',async()=>{
    const s=stub({billingIntents:{a:row(A)}});
    const result=await new FirestoreBackend(s.db as never,s.root as never).escalateStaleBillingRows(options);
    expect(result).toMatchObject({escalated:0,failed:1});expect(s.writes).toEqual([]);
    expect(s.store.get('billingIntents/a')!.state).toBe('reserve_pending');
  });
});
