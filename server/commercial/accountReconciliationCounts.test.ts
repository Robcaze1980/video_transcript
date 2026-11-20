// LV-019.B: counts-only reconciliation of the ACCOUNT database over a READ-ONLY root. It checks the invariants the Account code itself keeps
// (credited = available + reserved + consumed; reserved/active = what the open reservations add up to; one ledger entry per reservation and
// action) and returns only totals and counts: no account id, no reservation id, no per-row value.
import {describe,expect,it} from 'vitest';
import {summarizeAccounts} from './accountReconciliationCounts';
import {accountReadOnlyRoot} from './accountReadOnlyRoot';
import {stub} from './billingFirestoreStub';

const NOW=2_000_000_000_000;
const seed=(over:Record<string,Record<string,Record<string,unknown>>>={})=>stub({
  accounts:{
    A1:{credited:100,available:70,reserved:20,consumed:10,active:1},A2:{credited:50,available:50,reserved:0,consumed:0,active:0},
    A3:{credited:30,available:10,reserved:15,consumed:5,active:1},A4:{credited:10,available:5,reserved:0,consumed:0,active:0},
  },
  videoReservations:{
    r1:{ownerAccountId:'A1',seconds:20,state:'reserved',createdAtMs:NOW-5000,admissionProtocol:2,providerAdmission:{jobId:'j'}},
    r2:{ownerAccountId:'A3',seconds:10,state:'reserved',createdAtMs:NOW-100,admissionProtocol:1},
    r3:{ownerAccountId:'A1',seconds:10,state:'captured',createdAtMs:NOW-300},r4:{ownerAccountId:'A2',seconds:5,state:'released',createdAtMs:NOW-400},
    r5:{ownerAccountId:'ZZ',seconds:7,state:'reserved',createdAtMs:NOW-9000,admissionProtocol:2},r6:{state:'weird'},
  },
  videoReservationTombstones:{t1:{state:'sealed'},t2:{state:'sealed'}},
  videoBillingGuards:{A1:{blocked:true,incidentCount:2},A9:{blocked:false,incidentCount:0}},
  videoBillingIncidents:{i1:{state:'active'},i2:{state:'active'},i3:{state:'resolved'}},
  ledgerEntries:{
    l1:{kind:'video_reserve',seconds:20},l2:{kind:'video_reserve',seconds:10},l3:{kind:'video_reserve',seconds:5},l4:{kind:'video_reserve',seconds:7},l5:{kind:'video_reserve',seconds:10},
    l6:{kind:'video_capture',seconds:10},l7:{kind:'video_release',seconds:5},l8:{kind:'credit',seconds:100},
  },
  ...over,
});
const run=(s:ReturnType<typeof seed>)=>summarizeAccounts(accountReadOnlyRoot(s.root as never),NOW);

describe('summarizeAccounts',()=>{
  it('counts sizes, reservations, ledger, guards and incidents exactly',async()=>{
    const c=await run(seed());
    expect(c.generatedAtMs).toBe(NOW);
    expect(c.sizes).toEqual({accounts:4,videoReservations:6,videoReservationTombstones:2,videoBillingGuards:2,videoBillingIncidents:3,ledgerEntries:8});
    expect(c.reservations).toEqual({total:6,byState:{reserved:3,captured:1,released:1,other:1}});
    expect(c.ledger).toEqual({total:8,byKind:{video_reserve:5,video_capture:1,video_release:1,other:1}});
    expect(c.tombstonesSealed).toBe(2);expect(c.guardsBlocked).toBe(1);expect(c.incidentsActive).toBe(2);
    // one ledger entry per reservation and action: reserve 5 entries for 6 reservations (one is the unknown-state row), capture and release match
    expect(c.ledgerMinusReservations).toEqual({reserve:-1,capture:0,release:0});
  });
  it('checks the balance invariants over every account and against the open reservations',async()=>{
    const a=(await run(seed())).accounts;
    expect(a.scanned).toBe(4);expect(a.invalid).toBe(0);
    expect(a.balanceBreaks).toBe(1); // A4: credited 10, available 5
    expect(a.withReservedBalance).toBe(2);
    expect(a.totals).toEqual({credited:190,available:135,reserved:35,consumed:15,active:2});
    expect(a.reservedMismatch).toBe(1); // A3 says 15 reserved, its open reservation adds up to 10
    expect(a.activeMismatch).toBe(0);
  });
  it('summarizes the open reservations: count, seconds, age, admission, legacy protocol and orphans',async()=>{
    const r=(await run(seed())).openReservations;
    expect(r).toEqual({count:3,secondsTotal:37,oldestAgeMs:9000,withProviderAdmission:1,legacyProtocol:1,orphan:1,invalid:0});
  });
  it('a malformed account is counted as invalid and left out of the balance arithmetic',async()=>{
    const s=seed({accounts:{A1:{credited:100,available:70,reserved:20,consumed:10,active:1},B1:{credited:'x',available:1,reserved:0,consumed:0,active:0},B2:{credited:5,available:-5,reserved:0,consumed:0,active:0},B3:{credited:1.5,available:1.5,reserved:0,consumed:0,active:0}}});
    const a=(await run(s)).accounts;
    expect(a.scanned).toBe(4);expect(a.invalid).toBe(3);expect(a.balanceBreaks).toBe(0);expect(a.totals.credited).toBe(100);
  });
  it('a malformed open reservation is counted as invalid and not added up',async()=>{
    const s=seed({videoReservations:{r1:{ownerAccountId:'A1',seconds:20,state:'reserved',createdAtMs:NOW-5000,admissionProtocol:2},bad1:{ownerAccountId:'A1',seconds:'x',state:'reserved'},bad2:{seconds:3,state:'reserved'},bad3:{ownerAccountId:'A1',seconds:0,state:'reserved'}}});
    const r=(await run(s)).openReservations;
    expect(r.count).toBe(4);expect(r.invalid).toBe(3);expect(r.secondsTotal).toBe(20);
  });
  it('reports every disagreement between ledger and reservations, and an account whose open count differs while its seconds agree',async()=>{
    const s=seed({
      accounts:{A1:{credited:30,available:10,reserved:20,consumed:0,active:2}}, // reserved agrees (20 = 20) but active says 2 open reservations, there is 1
      videoReservations:{r1:{ownerAccountId:'A1',seconds:20,state:'reserved',createdAtMs:NOW-1,admissionProtocol:2},r2:{ownerAccountId:'A1',seconds:3,state:'captured'},r3:{ownerAccountId:'A1',seconds:3,state:'released'}},
      ledgerEntries:{l1:{kind:'video_reserve'},l2:{kind:'video_reserve'},l3:{kind:'video_reserve'},l4:{kind:'video_capture'},l5:{kind:'video_capture'},l6:{kind:'video_capture'}}, // 2 more captures than reservations; the release is missing
    });
    const c=await run(s);
    expect(c.accounts.reservedMismatch).toBe(0);expect(c.accounts.activeMismatch).toBe(1);
    expect(c.ledgerMinusReservations).toEqual({reserve:0,capture:2,release:-1});
  });
  it('rejects instead of reporting wrong totals when the sums stop being exact integers',async()=>{
    const max=Number.MAX_SAFE_INTEGER; // each account is a valid integer on its own; their sum is not
    const s=seed({accounts:{A1:{credited:max,available:max,reserved:0,consumed:0,active:0},A2:{credited:max,available:max,reserved:0,consumed:0,active:0}},videoReservations:{}});
    await expect(run(s)).rejects.toThrow(/overflow/i);
  });
  it('`other` is the signed remainder: negative when the counts were read at different instants',async()=>{
    // 6 listed-state reservations were counted but the total says 5 (a write between the two reads)
    const s=seed();let first=true;
    const real=s.root.collection.bind(s.root);
    const root=accountReadOnlyRoot({...s.root,collection:(c:string)=>{const q:any=real(c);if(c!=='videoReservations')return q;return {...q,count:()=>({get:async()=>{const r=await q.count().get();const n=r.data().count;return {data:()=>({count:first?(first=false,n-2):n})};}}),where:(...a:unknown[])=>real(c).where(...a)};}} as never);
    const c=await summarizeAccounts(root,NOW);
    expect(c.reservations.total).toBe(4);expect(c.reservations.byState.other).toBeLessThan(0);
  });
  it('scans every page of accounts and of open reservations (more than one page of each)',async()=>{
    const accounts:Record<string,Record<string,unknown>>={},reservations:Record<string,Record<string,unknown>>={};
    for(let i=0;i<205;i++){const id='acc'+String(i).padStart(4,'0');accounts[id]={credited:10,available:6,reserved:4,consumed:0,active:1};reservations['res'+String(i).padStart(4,'0')]={ownerAccountId:id,seconds:4,state:'reserved',createdAtMs:NOW-i,admissionProtocol:2};}
    const c=await run(stub({accounts,videoReservations:reservations}));
    expect(c.accounts.scanned).toBe(205);expect(c.accounts.balanceBreaks).toBe(0);expect(c.accounts.reservedMismatch).toBe(0);expect(c.accounts.activeMismatch).toBe(0);
    expect(c.accounts.totals).toEqual({credited:2050,available:1230,reserved:820,consumed:0,active:205});
    expect(c.openReservations).toMatchObject({count:205,secondsTotal:820,orphan:0,oldestAgeMs:204});
  });
  it('an empty root gives zeros and null ages',async()=>{
    const c=await run(stub({}));
    expect(Object.values(c.sizes)).toEqual([0,0,0,0,0,0]);expect(c.accounts.scanned).toBe(0);expect(c.accounts.totals).toEqual({credited:0,available:0,reserved:0,consumed:0,active:0});
    expect(c.openReservations).toEqual({count:0,secondsTotal:0,oldestAgeMs:null,withProviderAdmission:0,legacyProtocol:0,orphan:0,invalid:0});
    expect(c.ledgerMinusReservations).toEqual({reserve:0,capture:0,release:0});
  });
  it('returns counts only: no account id, reservation id, per-row value or secret anywhere',async()=>{
    const s=seed({accounts:{A1:{credited:100,available:70,reserved:20,consumed:10,active:1,identityKey:'LEAK-ik',uid:'LEAK-uid'}},videoReservations:{r1:{ownerAccountId:'A1',identityKey:'LEAK-ik2',reservationId:'LEAK-rid',seconds:20,state:'reserved',createdAtMs:NOW-5,providerAdmission:{jobId:'LEAK-job'}}}});
    const text=JSON.stringify(await run(s));
    expect(text).not.toMatch(/LEAK|"A1"|"A2"|"ZZ"|"r1"|ownerAccountId|identityKey|reservationId|uid|jobId/);
  });
  it('never writes',async()=>{
    const s=seed(),before=JSON.stringify([...s.store.entries()]);
    await run(s);
    expect(s.writes).toEqual([]);expect(JSON.stringify([...s.store.entries()])).toBe(before);
  });
  it('rejects an invalid clock before reading anything, and a failing read rejects instead of returning partial counts',async()=>{
    const s=seed();
    for(const bad of [Number.NaN,-1,1.5])await expect(summarizeAccounts(accountReadOnlyRoot(s.root as never),bad)).rejects.toThrow(/clock/i);
    expect(s.reads).toEqual([]);
    const thrower:any=new Proxy({},{get:(_t,prop)=>prop==='get'||prop==='count'?()=>({get:async()=>{throw new Error('unavailable');}}):()=>thrower});
    const root=accountReadOnlyRoot({collection:(c:string)=>c==='ledgerEntries'?thrower:s.root.collection(c)} as never);
    await expect(summarizeAccounts(root,NOW)).rejects.toThrow();
  });
});
