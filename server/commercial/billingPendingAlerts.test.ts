// LV-019.B phase 2, piece C: durable, deduplicated alerts derived from the read-only pending report.
// In-memory stub of Firestore (get/create/update inside transactions, equality queries). Concurrency and the real
// query semantics are checked separately against the emulator (scripts/checkBillingPendingAlertsEmulator.mjs).
import {describe,expect,it} from 'vitest';
import {buildPendingReport,type PendingRow} from './billingPendingReport';
import {ALERT_COLLECTION,alertKey,clearResolvedAlerts,raisePendingAlerts,raiseSweepAlert} from './billingPendingAlerts';
import {stub} from './billingFirestoreStub';

const NOW=5_000_000;
const row=(over:Partial<PendingRow>):PendingRow=>({kind:'hold',id:'h1',state:'needs_review',createdAtMs:1000,nextAttemptAt:null,attempts:0,lastErrorCode:null,accountId:'11111111-1111-4111-8111-111111111111',malformed:false,...over});
const report=(rows:PendingRow[],now=NOW)=>buildPendingReport(rows,now);
const R=(o:Partial<Record<'cleared'|'superseded'|'kept'|'unverified'|'raced'|'corrupt',number>>)=>({cleared:0,superseded:0,kept:0,unverified:0,raced:0,corrupt:0,...o});
const alerts=(s:ReturnType<typeof stub>)=>[...s.store.entries()].filter(([k])=>k.startsWith(ALERT_COLLECTION+'/'));

describe('alertKey',()=>{
  it('is deterministic and changes with kind, row, state and reason (so a state change re-alerts)',()=>{
    const base=alertKey('hold','h1','needs_review','needs_review');
    expect(base).toBe(alertKey('hold','h1','needs_review','needs_review'));
    expect(base).toMatch(/^[a-f0-9]{64}$/);
    for(const other of [alertKey('outbox','h1','needs_review','needs_review'),alertKey('hold','h2','needs_review','needs_review'),alertKey('hold','h1','pending','needs_review'),alertKey('hold','h1','needs_review','age')])expect(other).not.toBe(base);
  });
});

describe('raisePendingAlerts',()=>{
  it('creates exactly one alert per needs_review/malformed/unknown-age row and none for healthy rows',async()=>{
    const s=stub();
    const r=report([row({id:'a'}),row({id:'m',state:'pending',malformed:true}),row({id:'u',state:'pending',createdAtMs:null}),row({id:'ok',state:'pending'})]);
    const out=await raisePendingAlerts(s.db as never,s.root as never,r,NOW);
    expect(out).toEqual({created:3,seen:0});expect(alerts(s)).toHaveLength(3);
    expect(alerts(s).every(([,d])=>d.status==='open'&&d.seenCount===1&&d.firstSeenAtMs===NOW&&d.lastSeenAtMs===NOW)).toBe(true);
  });
  it('a repeated run only counts a sighting: no second alert, firstSeen kept',async()=>{
    const s=stub();const r=report([row({})]);
    await raisePendingAlerts(s.db as never,s.root as never,r,NOW);
    const again=await raisePendingAlerts(s.db as never,s.root as never,r,NOW+60_000);
    expect(again).toEqual({created:0,seen:1});expect(alerts(s)).toHaveLength(1);
    expect(alerts(s)[0][1]).toMatchObject({seenCount:2,firstSeenAtMs:NOW,lastSeenAtMs:NOW+60_000,status:'open'});
  });
  it('a state change on the same row raises a new alert instead of hiding in the old one',async()=>{
    const s=stub();
    await raisePendingAlerts(s.db as never,s.root as never,report([row({state:'needs_review'})]),NOW);
    await raisePendingAlerts(s.db as never,s.root as never,report([row({state:'pending',malformed:true})]),NOW+1);
    expect(alerts(s)).toHaveLength(2);
  });
  it('age alerts exist only when the owner supplies a valid threshold, and never invent a default',async()=>{
    const old=row({id:'old',state:'pending',createdAtMs:NOW-10_000}),young=row({id:'young',state:'pending',createdAtMs:NOW-10});
    const none=stub();expect(await raisePendingAlerts(none.db as never,none.root as never,report([old,young]),NOW)).toEqual({created:0,seen:0});
    const some=stub();expect(await raisePendingAlerts(some.db as never,some.root as never,report([old,young]),NOW,{ageThresholdMs:5_000})).toEqual({created:1,seen:0});
    expect(alerts(some)[0][1]).toMatchObject({rowId:'old',reason:'age'});
    for(const bad of [0,-1,Number.NaN,1.5,Infinity])await expect(raisePendingAlerts(stub().db as never,stub().root as never,report([old]),NOW,{ageThresholdMs:bad})).rejects.toThrow();
  });
  it('stores only operator fields, writes only the alert collection and never touches balance data',async()=>{
    const s=stub({accounts:{x:{available:5}},billingHoldOutbox:{h1:{state:'needs_review'}}});
    await raisePendingAlerts(s.db as never,s.root as never,report([row({})]),NOW);
    expect(s.writes.every(w=>w.split(':')[1].startsWith(ALERT_COLLECTION+'/'))).toBe(true);
    expect(s.store.get('accounts/x')).toEqual({available:5});
    const [,d]=alerts(s)[0];expect(Object.keys(d).sort()).toEqual(['accountId','alertKey','firstSeenAtMs','kind','lastSeenAtMs','reason','rowId','seenCount','state','status']);
    expect(JSON.stringify(d)).not.toMatch(/identityKey|uid|email/);
  });
});

describe('a superseded alert whose condition comes back',()=>{
  it('reopens with its history instead of failing as corrupt',async()=>{
    const s=stub({billingHoldOutbox:{h1:{state:'needs_review'}}});
    await raisePendingAlerts(s.db as never,s.root as never,report([row({state:'needs_review'})]),NOW);
    const moved=report([row({state:'pending',malformed:true})]);await raisePendingAlerts(s.db as never,s.root as never,moved,NOW+1);
    s.store.set('billingHoldOutbox/h1',{state:'pending',createdAtMs:'bad'});
    await clearResolvedAlerts(s.db as never,s.root as never,moved,NOW+2);
    expect(alerts(s).find(([,d])=>d.state==='needs_review')![1].status).toBe('superseded');
    const back=await raisePendingAlerts(s.db as never,s.root as never,report([row({state:'needs_review'})]),NOW+3);
    expect(back).toEqual({created:0,seen:1});
    expect(alerts(s).find(([,d])=>d.state==='needs_review')![1]).toMatchObject({status:'open',reopenCount:1,seenCount:2});
  });
});

describe('clearResolvedAlerts',()=>{
  it('clears an alert only after reading the row itself in a known terminal state',async()=>{
    const s=stub({billingHoldOutbox:{h1:{state:'needs_review'}}});
    await raisePendingAlerts(s.db as never,s.root as never,report([row({})]),NOW);
    s.store.set('billingHoldOutbox/h1',{state:'applied'});
    const out=await clearResolvedAlerts(s.db as never,s.root as never,report([]),NOW+10);
    expect(out).toEqual(R({cleared:1}));
    expect(alerts(s)[0][1]).toMatchObject({status:'cleared',clearedAtMs:NOW+10,observedState:'applied'});
  });
  it('keeps the alert when the row is missing, unexpected, still reported, or has no verifiable terminal set',async()=>{
    const s=stub({billingHoldOutbox:{missing:{state:'needs_review'},odd:{state:'brand_new'},still:{state:'needs_review'}},jobs:{j1:{state:'unknown'}}});
    const rows=[row({id:'missing'}),row({id:'odd'}),row({id:'still'}),row({kind:'job_unknown',id:'j1',state:'unknown',malformed:true})];
    await raisePendingAlerts(s.db as never,s.root as never,report(rows),NOW);
    s.store.delete('billingHoldOutbox/missing');s.store.set('jobs/j1',{state:'succeeded'});
    const out=await clearResolvedAlerts(s.db as never,s.root as never,report([row({id:'still'})]),NOW+10);
    expect(out).toEqual(R({kept:2,unverified:2}));
    expect(alerts(s).every(([,d])=>d.status==='open')).toBe(true);
  });
  it('re-checks the row inside the clearing transaction: a row back in a listed state keeps its alert open',async()=>{
    const s=stub({billingHoldOutbox:{h1:{state:'needs_review'}}});
    await raisePendingAlerts(s.db as never,s.root as never,report([row({})]),NOW);
    // The row is not in the (stale) report, but a direct read at clear time still shows a non-terminal state.
    expect(await clearResolvedAlerts(s.db as never,s.root as never,report([]),NOW+1)).toEqual(R({unverified:1}));
    expect(alerts(s)[0][1].status).toBe('open');
  });
  it('a row that leaves its terminal state between the first look and the commit is not cleared (interleaving)',async()=>{
    const s=stub({billingHoldOutbox:{h1:{state:'needs_review'}}});
    await raisePendingAlerts(s.db as never,s.root as never,report([row({})]),NOW);
    s.store.set('billingHoldOutbox/h1',{state:'applied'});
    const original=s.db.runTransaction.bind(s.db);let flipped=false;
    // Simulates another writer: just before the clearing transaction runs, the row returns to a listed state.
    (s.db as {runTransaction:unknown}).runTransaction=(fn:(tx:unknown)=>Promise<unknown>)=>{if(!flipped){flipped=true;s.store.set('billingHoldOutbox/h1',{state:'needs_review'});}return original(fn);};
    expect(await clearResolvedAlerts(s.db as never,s.root as never,report([]),NOW+1)).toEqual(R({unverified:1}));
    expect(alerts(s)[0][1].status).toBe('open');
  });
  it('a cleared alert that reappears with the same key reopens WITH its history (reopenCount, previous clear time)',async()=>{
    const s=stub({billingHoldOutbox:{h1:{state:'needs_review'}}});
    const r=report([row({})]);
    await raisePendingAlerts(s.db as never,s.root as never,r,NOW);
    s.store.set('billingHoldOutbox/h1',{state:'applied'});
    await clearResolvedAlerts(s.db as never,s.root as never,report([]),NOW+10);
    s.store.set('billingHoldOutbox/h1',{state:'needs_review'});
    const out=await raisePendingAlerts(s.db as never,s.root as never,r,NOW+20);
    expect(out).toEqual({created:0,seen:1});
    expect(alerts(s)[0][1]).toMatchObject({status:'open',seenCount:2,firstSeenAtMs:NOW,lastSeenAtMs:NOW+20,reopenCount:1,previousClearedAtMs:NOW+10,clearedAtMs:null});
  });
  it('clears every terminal alert even when open alerts span several pages',async()=>{
    const hold:Record<string,Record<string,unknown>>={},rows:PendingRow[]=[];
    for(let i=0;i<230;i++){const id='h'+String(i).padStart(4,'0');hold[id]={state:'needs_review'};rows.push(row({id}));}
    const s=stub({billingHoldOutbox:hold});
    await raisePendingAlerts(s.db as never,s.root as never,report(rows),NOW);
    for(const id of Object.keys(hold))s.store.set('billingHoldOutbox/'+id,{state:'applied'});
    expect(await clearResolvedAlerts(s.db as never,s.root as never,report([]),NOW+1)).toEqual(R({cleared:230}));
    expect(alerts(s).every(([,d])=>d.status==='cleared')).toBe(true);
  });
  it('supersedes an old alert only when the row is still reported with a different live alert; never drops attention without a successor',async()=>{
    const s=stub({billingHoldOutbox:{h1:{state:'needs_review'}}});
    await raisePendingAlerts(s.db as never,s.root as never,report([row({state:'needs_review'})]),NOW);
    const moved=report([row({state:'pending',malformed:true})]);
    // Without the successor alert the old one must stay open.
    expect(await clearResolvedAlerts(s.db as never,s.root as never,moved,NOW+1)).toEqual(R({unverified:1}));
    await raisePendingAlerts(s.db as never,s.root as never,moved,NOW+2);
    s.store.set('billingHoldOutbox/h1',{state:'pending',createdAtMs:'bad'}); // really malformed now
    expect(await clearResolvedAlerts(s.db as never,s.root as never,moved,NOW+3)).toEqual(R({superseded:1,kept:1}));
    const byStatus=Object.fromEntries(alerts(s).map(([,d])=>[String(d.state),d.status]));
    expect(byStatus).toEqual({needs_review:'superseded',pending:'open'});
    const old=alerts(s).find(([,d])=>d.state==='needs_review')![1];expect(old).toMatchObject({supersededAtMs:NOW+3});expect(typeof old.supersededByKey).toBe('string');
  });
  it('re-reads the row inside the superseding transaction: a row that went back to the old state, or vanished, is not superseded',async()=>{
    for(const mutate of [(s:ReturnType<typeof stub>)=>s.store.set('billingHoldOutbox/h1',{state:'needs_review',createdAtMs:1}),(s:ReturnType<typeof stub>)=>s.store.delete('billingHoldOutbox/h1')]){
      const s=stub({billingHoldOutbox:{h1:{state:'needs_review'}}});
      await raisePendingAlerts(s.db as never,s.root as never,report([row({state:'needs_review'})]),NOW);
      const moved=report([row({state:'pending',malformed:true})]);await raisePendingAlerts(s.db as never,s.root as never,moved,NOW+1);
      s.store.set('billingHoldOutbox/h1',{state:'pending',createdAtMs:'bad'});
      const original=s.db.runTransaction.bind(s.db);let once=false;
      (s.db as {runTransaction:unknown}).runTransaction=(fn:(tx:unknown)=>Promise<unknown>)=>{if(!once){once=true;mutate(s);}return original(fn);};
      expect(await clearResolvedAlerts(s.db as never,s.root as never,moved,NOW+2)).toMatchObject({superseded:0,unverified:1});
      expect(alerts(s).find(([,d])=>d.state==='needs_review')![1].status).toBe('open');
    }
  });
  it('the superseding path also refuses an original alert whose content no longer matches its key',async()=>{
    const s=stub({billingHoldOutbox:{h1:{state:'needs_review'}}});
    await raisePendingAlerts(s.db as never,s.root as never,report([row({state:'needs_review'})]),NOW);
    const moved=report([row({state:'pending',malformed:true})]);await raisePendingAlerts(s.db as never,s.root as never,moved,NOW+1);
    s.store.set('billingHoldOutbox/h1',{state:'pending',createdAtMs:'bad'});
    const original=s.db.runTransaction.bind(s.db);let once=false;
    (s.db as {runTransaction:unknown}).runTransaction=(fn:(tx:unknown)=>Promise<unknown>)=>{if(!once){once=true;const k=alertKey('hold','h1','needs_review','needs_review');s.store.set(`${ALERT_COLLECTION}/${k}`,{...s.store.get(`${ALERT_COLLECTION}/${k}`)!,reason:'malformed'});}return original(fn);};
    expect(await clearResolvedAlerts(s.db as never,s.root as never,moved,NOW+2)).toMatchObject({superseded:0,corrupt:1});
    expect(alerts(s).find(([k])=>k.endsWith(alertKey('hold','h1','needs_review','needs_review')))![1].status).toBe('open');
  });
  it('refuses to act on an alert whose content no longer matches its key at commit time',async()=>{
    const s=stub({billingHoldOutbox:{h1:{state:'needs_review'}}});
    await raisePendingAlerts(s.db as never,s.root as never,report([row({})]),NOW);
    s.store.set('billingHoldOutbox/h1',{state:'applied'});
    const original=s.db.runTransaction.bind(s.db);let once=false;
    (s.db as {runTransaction:unknown}).runTransaction=(fn:(tx:unknown)=>Promise<unknown>)=>{if(!once){once=true;const k=alerts(s)[0][0];s.store.set(k,{...s.store.get(k)!,rowId:'someone-else'});}return original(fn);};
    expect(await clearResolvedAlerts(s.db as never,s.root as never,report([]),NOW+1)).toEqual(R({corrupt:1}));
    expect(alerts(s)[0][1].status).toBe('open');
  });
  it('does not supersede in favour of a corrupt or mismatching successor document',async()=>{
    const s=stub({billingHoldOutbox:{h1:{state:'needs_review'}}});
    await raisePendingAlerts(s.db as never,s.root as never,report([row({state:'needs_review'})]),NOW);
    const moved=report([row({state:'pending',malformed:true})]);
    const successorKey=alertKey('hold','h1','pending','malformed');
    for(const bad of [{status:'open'},{alertKey:successorKey,kind:'hold',rowId:'OTHER',state:'pending',reason:'malformed',accountId:null,status:'open',seenCount:1,firstSeenAtMs:1,lastSeenAtMs:1},
      {alertKey:successorKey,kind:'hold',rowId:'h1',state:'pending',reason:'malformed',accountId:null,status:'cleared',seenCount:1,firstSeenAtMs:1,lastSeenAtMs:1}]){
      s.store.set(`${ALERT_COLLECTION}/${successorKey}`,bad as Record<string,unknown>);
      expect(await clearResolvedAlerts(s.db as never,s.root as never,moved,NOW+1)).toMatchObject({superseded:0});
    }
    expect(alerts(s).find(([,d])=>d.state==='needs_review')![1].status).toBe('open');
  });
  it('a reported row with an unchanged state and reason keeps its alert; the age policy decides the current reason',async()=>{
    const s=stub({billingHoldOutbox:{h1:{state:'needs_review'}}});
    const r=report([row({})]);await raisePendingAlerts(s.db as never,s.root as never,r,NOW);
    expect(await clearResolvedAlerts(s.db as never,s.root as never,r,NOW+1,{ageThresholdMs:1})).toEqual(R({kept:1}));
  });
  it('reports (and never touches) an alert document whose key does not match its content',async()=>{
    const s=stub();
    s.store.set(`${ALERT_COLLECTION}/not-the-key`,{alertKey:'not-the-key',kind:'hold',rowId:'h1',state:'needs_review',reason:'needs_review',accountId:null,status:'open',seenCount:1,firstSeenAtMs:1,lastSeenAtMs:1});
    expect(await clearResolvedAlerts(s.db as never,s.root as never,report([]),NOW)).toEqual(R({corrupt:1}));
    expect(s.writes).toEqual([]);
  });
  it('tells apart an alert changed by another writer from a row that is not terminal',async()=>{
    const s=stub({billingHoldOutbox:{h1:{state:'needs_review'}}});
    await raisePendingAlerts(s.db as never,s.root as never,report([row({})]),NOW);
    s.store.set('billingHoldOutbox/h1',{state:'applied'});
    const original=s.db.runTransaction.bind(s.db);let once=false;
    (s.db as {runTransaction:unknown}).runTransaction=(fn:(tx:unknown)=>Promise<unknown>)=>{if(!once){once=true;const k=alerts(s)[0][0];s.store.set(k,{...s.store.get(k)!,status:'cleared'});}return original(fn);};
    expect(await clearResolvedAlerts(s.db as never,s.root as never,report([]),NOW+1)).toEqual(R({raced:1}));
  });
  it('never writes anything but alerts',async()=>{
    const s=stub({billingHoldOutbox:{h1:{state:'needs_review'}}});
    await raisePendingAlerts(s.db as never,s.root as never,report([row({})]),NOW);
    s.store.set('billingHoldOutbox/h1',{state:'applied'});s.writes.length=0;
    await clearResolvedAlerts(s.db as never,s.root as never,report([]),NOW+1);
    expect(s.writes.every(w=>w.startsWith('update:'+ALERT_COLLECTION+'/'))).toBe(true);
  });
});

describe('raiseSweepAlert',()=>{
  it('raises one open alert per allowed failure code and counts repeats',async()=>{
    const s=stub();
    expect(await raiseSweepAlert(s.db as never,s.root as never,'sweep_failed',NOW)).toEqual({created:true});
    expect(await raiseSweepAlert(s.db as never,s.root as never,'sweep_failed',NOW+5)).toEqual({created:false});
    expect(alerts(s)).toHaveLength(1);expect(alerts(s)[0][1]).toMatchObject({kind:'sweep',seenCount:2,reason:'sweep_failed',status:'open'});
    await expect(raiseSweepAlert(s.db as never,s.root as never,'free text with secrets',NOW)).rejects.toThrow();
  });
});
