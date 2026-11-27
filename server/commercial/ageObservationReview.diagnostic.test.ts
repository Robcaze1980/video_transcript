import {describe,expect,it} from 'vitest';
import {FieldValue} from 'firebase-admin/firestore';
import {FirestoreBackend,EXTERNAL_BILLING_MAX_AGE_MS} from './firestoreBackend';
import {runBillingDrainSection} from './billingDrainSection';
import {stub} from './billingFirestoreStub';
import {alertKey,ALERT_COLLECTION} from './billingPendingAlerts';
import {blockedState,unblockBillingAccount} from './billingUnblock';

const NOW=1_700_000_000_000;
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';

describe('review characterizations, not acceptance of a new admission policy',()=>{
  it('two young or exactly-at-threshold rows do not create observations or modify either account',async()=>{
    const s=stub({billingIntents:{young:{accountId:A,state:'reserve_pending',createdAtMs:NOW-999},
      exact:{accountId:B,state:'release_pending',createdAtMs:NOW-1000}},accounts:{[A]:{available:17},[B]:{available:20}}});
    const result=await new FirestoreBackend(s.db as never,s.root as never).escalateStaleBillingRows({now:NOW,maxAgeMs:1000,limit:10});
    expect(result).toMatchObject({escalated:0,failed:0});expect(s.writes).toEqual([]);
    expect(s.store.get('accounts/'+A)).toEqual({available:17});expect(s.store.get('accounts/'+B)).toEqual({available:20});
    expect([...s.store.keys()].some(path=>path.startsWith('billingIntentAgeObservations/'))).toBe(false);
  });

  it('the real drain reports partial after a lost commit response without a reconciliation read',async()=>{
    const s=stub({billingIntents:{only:{accountId:A,state:'reserve_pending',createdAtMs:NOW-EXTERNAL_BILLING_MAX_AGE_MS-1}}});
    let dropped=false,created=false;const readsAfterDrop:string[]=[];
    const root={...s.root,collection:(name:string)=>{
      const c=s.root.collection(name);
      return {...c,doc:(id:string)=>{const ref=c.doc(id);return {...ref,get:async()=>{if(dropped)readsAfterDrop.push(ref.path);return ref.get();}};}};
    }};
    const db={runTransaction:async(work:(tx:unknown)=>Promise<unknown>)=>{
      const result=await s.db.runTransaction(async tx=>work(new Proxy(tx as Record<string,unknown>,{get(target,name){
        if(name==='get')return async(ref:{path:string})=>{if(dropped)readsAfterDrop.push(ref.path);return (target.get as Function)(ref);};
        if(name==='create')return (ref:{path:string},data:unknown)=>{if(ref.path.startsWith('billingIntentAgeObservations/'))created=true;return (target.create as Function)(ref,data);};
        return target[name as string];
      }})));
      if(created&&!dropped){dropped=true;throw Error('synthetic ACK loss after committed transaction');}
      return result;
    }};
    const backend=new FirestoreBackend(db as never,root as never);
    const lease={acquire:async()=>({acquired:true as const,token:1}),renew:async()=>true,release:async()=>true,assertHeld:async()=>true,
      getCursor:async()=>null,setCursor:async()=>true};
    const ai={drainExternalHolds:async()=>({applied:0,failed:0}),drainExternalBilling:async()=>({settled:0,failed:0})};
    const result=await runBillingDrainSection({db:db as never,root:root as never,ai,backend:{escalateStaleBillingRows:o=>backend.escalateStaleBillingRows(o)},
      now:NOW,clock:()=>NOW,enabled:true,lease,log:()=>{}});
    expect(dropped).toBe(true);expect(result).toMatchObject({outcome:'partial',failed:1,staleEscalated:0});
    const row=s.store.get('billingIntents/only')!;
    expect(row.state).toBe('needs_review');expect(typeof row.ageObservationId).toBe('string');
    expect(s.store.has('billingIntentAgeObservations/'+row.ageObservationId)).toBe(true);
    expect(readsAfterDrop).toEqual([]); // The diagnostic inspects its memory only after the pass ended; it never repeats the operation.
  });

  it('the real audited unblock can leave a historical age pointer on the reopened row',async()=>{
    const incident='a'.repeat(64),identity='b'.repeat(64),oldId='44444444-4444-4444-8444-444444444444';
    const state=blockedState(1,10,incident),key=alertKey('guard',A,state,'needs_review');
    const rows=new Map<string,Record<string,unknown>>([
      ['billingGuards/'+A,{accountId:A,blocked:true,epoch:1,createdAtMs:10,updatedAtMs:11,lastIncidentId:incident}],
      ['billingGuards/'+B,{accountId:B,blocked:true,epoch:1,createdAtMs:20,updatedAtMs:21,lastIncidentId:'c'.repeat(64)}],
      [ALERT_COLLECTION+'/'+key,{alertKey:key,kind:'guard',rowId:A,state,reason:'needs_review',status:'open',accountId:A,seenCount:1,firstSeenAtMs:1,lastSeenAtMs:1}],
      ['billingIntents/'+incident,{accountId:A,state:'needs_review',reviewReason:'max_age',reviewIncidentId:incident,ageObservationId:oldId}],
      ['billingIntents/other',{accountId:B,state:'needs_review',ageObservationId:'synthetic-b'}],
      ['billingIntentWitnesses/'+incident,{terminalRecovery:{releasePrepared:true}}],
      ['billingIntentAgeObservations/'+oldId,{protocol:1,id:oldId,intentId:incident,priorState:'release_pending',reason:'max_age'}],
      ['identities/'+identity,{accountId:A,uid:'synthetic-a'}],
    ]);
    const clone=(v:Record<string,unknown>|undefined)=>v?structuredClone(v):undefined;
    const ref=(collection:string,id:string)=>({id,path:collection+'/'+id,kind:'doc' as const});
    const snap=(r:ReturnType<typeof ref>)=>{const value=clone(rows.get(r.path));return {id:r.id,ref:r,exists:!!value,data:()=>clone(value),get:(name:string)=>value?.[name]};};
    const query=(collection:string,field:string,value:unknown,limit=Infinity):any=>({kind:'query',collection,field,value,
      limit:(n:number)=>query(collection,field,value,n),get:async()=>queryRead(collection,field,value,limit)});
    const queryRead=(collection:string,field:string,value:unknown,limit:number)=>({docs:[...rows.entries()]
      .filter(([path,data])=>path.startsWith(collection+'/')&&data[field]===value).slice(0,limit)
      .map(([path])=>snap(ref(collection,path.slice(collection.length+1))))});
    const root={path:'synthetic-unblock-review',collection:(name:string)=>({doc:(id:string)=>ref(name,id),
      where:(field:string,op:string,value:unknown)=>{expect(op).toBe('==');return query(name,field,value);}})};
    const db={runTransaction:async<T>(work:(tx:any)=>Promise<T>)=>{
      const changes:Array<()=>void>=[];
      const read=async(target:any)=>target.kind==='query'?queryRead(target.collection,target.field,target.value,Infinity):snap(target);
      const tx={get:read,getAll:(...targets:any[])=>Promise.all(targets.map(read)),
        create:(r:ReturnType<typeof ref>,data:Record<string,unknown>)=>changes.push(()=>{if(rows.has(r.path))throw Error('synthetic duplicate');rows.set(r.path,clone(data)!);}),
        set:(r:ReturnType<typeof ref>,data:Record<string,unknown>)=>changes.push(()=>rows.set(r.path,clone(data)!)),
        delete:(r:ReturnType<typeof ref>)=>changes.push(()=>{rows.delete(r.path);}),
        update:(r:ReturnType<typeof ref>,data:Record<string,unknown>)=>changes.push(()=>{
          const current=rows.get(r.path);if(!current)throw Error('synthetic missing row');const next={...current};
          for(const [field,value] of Object.entries(data)){if(value&&typeof (value as any).isEqual==='function'&&(value as any).isEqual(FieldValue.delete()))delete next[field];else next[field]=value;}
          rows.set(r.path,next);
        })};
      const result=await work(tx);for(const change of changes)change();return result;
    }};
    const otherBefore=clone(rows.get('billingIntents/other')),guardBefore=clone(rows.get('billingGuards/'+B));
    const accountBilling={unblock:async()=>({unblocked:true as const,replayed:false,blocked:false}),unblockReceipt:async()=>null};
    const receipt=await unblockBillingAccount({db:db as never,root:root as never,accountBilling} as never,A,
      {incidentId:incident,alertKey:key,epoch:1,createdAtMs:10,updatedAtMs:11,accountEpoch:1,accountCreatedAtMs:1,evidenceRef:'synthetic-evidence'},'operator-local',NOW);
    expect(receipt).toMatchObject({unblocked:true,videoBlocked:false});
    expect(rows.get('billingIntents/'+incident)).toMatchObject({state:'release_pending',ageObservationId:oldId});
    expect(rows.has('billingIntentAgeObservations/'+oldId)).toBe(true);
    expect(rows.get('billingIntents/other')).toEqual(otherBefore);expect(rows.get('billingGuards/'+B)).toEqual(guardBefore);
  });
});
