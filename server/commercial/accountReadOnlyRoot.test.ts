// LV-019.B: the read-only facade policy for the ACCOUNT database (reservations, balances, guards, ledger). Same engine as the billing queues
// (readOnlyFirestoreRoot.ts), a different policy: only the collections and fields the reconciliation counts need, nothing identifying.
import {describe,expect,it} from 'vitest';
import {accountReadOnlyRoot,ACCOUNT_READABLE_COLLECTIONS} from './accountReadOnlyRoot';
import {createReadOnlyRoot} from './readOnlyFirestoreRoot';
import {stub} from './billingFirestoreStub';

const seed=()=>stub({
  accounts:{A1:{credited:100,available:70,reserved:20,consumed:10,active:1,identityKey:'LEAK-ik',uid:'LEAK-uid',activeProjectCount:3},A2:{credited:'x',available:{n:1}}},
  videoReservations:{r1:{ownerAccountId:'A1',identityKey:'LEAK-ik2',reservationId:'LEAK-rid',seconds:20,state:'reserved',admissionProtocol:2,createdAtMs:5,providerAdmission:{jobId:'LEAK-job',attemptId:'LEAK-attempt'},captureAdmission:{x:'LEAK-cap'}},r2:{ownerAccountId:'A1',seconds:3,state:'captured',createdAtMs:6}},
  videoReservationTombstones:{t1:{state:'sealed',seconds:4,identityKey:'LEAK-ik3'}},
  videoBillingGuards:{A1:{blocked:true,incidentCount:2,epoch:3,identityKey:'LEAK-ik4'}},
  videoBillingIncidents:{i1:{state:'active',incidentId:'LEAK-inc'},i2:{state:'resolved'}},
  ledgerEntries:{l1:{kind:'video_reserve',seconds:20,ownerAccountId:'A1'},l2:{kind:'video_capture',seconds:3},l3:{kind:'credit',seconds:100}},
  identities:{x:{uid:'LEAK-uid-2',accountId:'A1'}},
  projects:{p:{title:'LEAK-title',content:'LEAK-content'}},
  providerCalls:{c:{callKey:'LEAK-call'}},
});
const view=(s:ReturnType<typeof seed>)=>accountReadOnlyRoot(s.root as never);

describe('account policy: which collections, filters and fields are reachable',()=>{
  it('only the six reconciliation collections can be opened; identities, projects and provider calls cannot',()=>{
    const s=seed();
    expect([...ACCOUNT_READABLE_COLLECTIONS].sort()).toEqual(['accounts','ledgerEntries','videoBillingGuards','videoBillingIncidents','videoReservationTombstones','videoReservations']);
    for(const name of ACCOUNT_READABLE_COLLECTIONS)expect(()=>view(s).collection(name)).not.toThrow();
    for(const name of ['identities','projects','providerCalls','providerCallFences','createRequests','billingIntents','','__proto__','constructor','toString'])expect(()=>view(s).collection(name)).toThrow(/not readable/i);
  });
  it('filters: only the listed field with its listed values, per collection',()=>{
    const s=seed(),root=view(s);
    for(const state of ['reserved','captured','released'])expect(()=>root.collection('videoReservations').where('state','==',state)).not.toThrow();
    for(const bad of ['sealed','weird',''])expect(()=>root.collection('videoReservations').where('state','==',bad)).toThrow(/value/i);
    for(const field of ['ownerAccountId','seconds','identityKey','reservationId','providerAdmission'])expect(()=>root.collection('videoReservations').where(field,'==','x')).toThrow(/field/i);
    expect(()=>root.collection('videoReservationTombstones').where('state','==','sealed')).not.toThrow();
    expect(()=>root.collection('videoBillingGuards').where('blocked','==',true)).not.toThrow();
    expect(()=>root.collection('videoBillingGuards').where('blocked','==',false)).toThrow(/value/i);
    expect(()=>root.collection('videoBillingGuards').where('ownerAccountId','==','A1')).toThrow(/field/i);
    expect(()=>root.collection('videoBillingIncidents').where('state','==','active')).not.toThrow();
    for(const kind of ['video_reserve','video_capture','video_release'])expect(()=>root.collection('ledgerEntries').where('kind','==',kind)).not.toThrow();
    expect(()=>root.collection('ledgerEntries').where('kind','==','credit')).toThrow(/value/i);
    expect(()=>root.collection('ledgerEntries').where('ownerAccountId','==','A1')).toThrow(/field/i);
    for(const field of ['credited','available','reserved','state','identityKey'])expect(()=>root.collection('accounts').where(field,'==',1)).toThrow(/field/i); // balances cannot be probed by bisection
  });
  it('select: only the listed fields of each collection',()=>{
    const root=view(seed());
    expect(()=>root.collection('accounts').select('credited','available','reserved','consumed','active')).not.toThrow();
    for(const field of ['identityKey','uid','activeProjectCount','createdAtMs'])expect(()=>root.collection('accounts').select(field)).toThrow(/select/i);
    expect(()=>root.collection('videoReservations').select('ownerAccountId','seconds','state','createdAtMs','admissionProtocol','providerAdmission')).not.toThrow();
    for(const field of ['identityKey','reservationId','captureAdmission','updatedAtMs'])expect(()=>root.collection('videoReservations').select(field)).toThrow(/select/i);
    expect(()=>root.collection('ledgerEntries').select('kind','seconds')).not.toThrow();expect(()=>root.collection('ledgerEntries').select('ownerAccountId')).toThrow(/select/i);
    expect(()=>root.collection('videoBillingGuards').select('blocked','incidentCount')).not.toThrow();expect(()=>root.collection('videoBillingGuards').select('epoch')).toThrow(/select/i);
  });
  it('documents expose only the policy fields; identities, keys, admissions and the admission map itself never leave',async()=>{
    const root=view(seed());
    const accounts=await root.collection('accounts').orderBy('__name__').limit(10).get();
    expect(accounts.docs.map(d=>d.data())).toEqual([{credited:100,available:70,reserved:20,consumed:10,active:1},{credited:'x',available:'[object]'}]);
    const reservations=await root.collection('videoReservations').orderBy('__name__').limit(10).get();
    expect(reservations.docs[0].data()).toEqual({ownerAccountId:'A1',seconds:20,state:'reserved',admissionProtocol:2,createdAtMs:5,hasProviderAdmission:true});
    expect(reservations.docs[1].data()).toEqual({ownerAccountId:'A1',seconds:3,state:'captured',createdAtMs:6,hasProviderAdmission:false});
    const everything=JSON.stringify([accounts.docs,reservations.docs].map(p=>p.map(d=>d.data())));
    expect(everything).not.toMatch(/LEAK|identityKey|reservationId|jobId|attempt|captureAdmission|uid|activeProjectCount/);
    const ledger=await root.collection('ledgerEntries').orderBy('__name__').limit(10).get();
    expect(ledger.docs.map(d=>d.data())).toEqual([{kind:'video_reserve',seconds:20},{kind:'video_capture',seconds:3},{kind:'credit',seconds:100}]);
    const guards=await root.collection('videoBillingGuards').orderBy('__name__').limit(10).get();
    expect(guards.docs[0].data()).toEqual({blocked:true,incidentCount:2});
  });
  it('count aggregations work with the allowed filters and never read a document',async()=>{
    const s=seed(),root=view(s);
    expect(await root.collection('videoReservations').count()).toBe(2);
    expect(await root.collection('videoReservations').where('state','==','reserved').count()).toBe(1);
    expect(await root.collection('ledgerEntries').where('kind','==','video_reserve').count()).toBe(1);
    expect(await root.collection('videoBillingGuards').where('blocked','==',true).count()).toBe(1);
    expect(s.writes).toEqual([]);
  });
  it('never writes while reading',async()=>{
    const s=seed(),before=JSON.stringify([...s.store.entries()]);
    const root=view(s);
    for(const name of ACCOUNT_READABLE_COLLECTIONS)await root.collection(name).orderBy('__name__').limit(10).get();
    expect(s.writes).toEqual([]);expect(JSON.stringify([...s.store.entries()])).toBe(before);
  });
});

describe('the engine copies and freezes the policy it is given',()=>{
  it('widening the original policy object after creation changes nothing',async()=>{
    const policy:any={collections:{accounts:{select:['credited'],expose:['credited'],where:{}}}};
    const s=seed(),root=createReadOnlyRoot(s.root as never,policy);
    policy.collections.accounts.expose.push('identityKey');policy.collections.accounts.select.push('identityKey');policy.collections.accounts.where.state=['x'];policy.collections.videoReservations={select:[],expose:[],where:{}};
    const page=await root.collection('accounts').orderBy('__name__').limit(5).get();
    expect(page.docs[0].data()).toEqual({credited:100});
    expect(()=>root.collection('accounts').select('identityKey')).toThrow(/select/i);
    expect(()=>root.collection('accounts').where('state','==','x')).toThrow(/field/i);
    expect(()=>root.collection('videoReservations')).toThrow(/not readable/i);
  });
});
