// LV-019.B phase 2: local sweep that chains the read-only report (B) and the durable alerts (C). It never moves balance,
// never calls the Account service, never edits a billing row. A failing step becomes a sweep alert and a loud failure.
import {describe,expect,it} from 'vitest';
import {ALERT_COLLECTION,alertKey} from './billingPendingAlerts';
import {runPendingSweep,SweepError} from './billingPendingSweep';
import {stub} from './billingFirestoreStub';

const NOW=9_000_000;
const alerts=(s:ReturnType<typeof stub>)=>[...s.store.entries()].filter(([k])=>k.startsWith(ALERT_COLLECTION+'/'));
const hold=(state:string,extra:Record<string,unknown>={})=>({state,createdAtMs:1000,...extra});
const fresh=()=>stub({billingHoldOutbox:{h1:hold('needs_review'),h2:hold('pending',{createdAtMs:'bad'}),h3:hold('applied')},accounts:{x:{available:5,reserved:2}},ledgerEntries:{l1:{kind:'video_reserve'}}});

describe('runPendingSweep',()=>{
  it('an empty system produces a clean summary and writes nothing',async()=>{
    const s=stub();
    expect(await runPendingSweep(s.db as never,s.root as never,NOW)).toMatchObject({ok:true,reported:0,created:0,seen:0,cleared:0,superseded:0,failures:[]});
    expect(s.writes).toEqual([]);
  });
  it('raises alerts for rows that need attention, only counts sightings on repeat, and clears once the row is terminal',async()=>{
    const s=fresh();
    const first=await runPendingSweep(s.db as never,s.root as never,NOW);
    expect(first).toMatchObject({ok:true,reported:2,created:2,seen:0,failures:[]});
    expect(alerts(s)).toHaveLength(2);
    const second=await runPendingSweep(s.db as never,s.root as never,NOW+60_000);
    expect(second).toMatchObject({ok:true,created:0,seen:2});expect(alerts(s)).toHaveLength(2);
    s.store.set('billingHoldOutbox/h1',{state:'applied'});s.store.set('billingHoldOutbox/h2',{state:'applied'});
    const third=await runPendingSweep(s.db as never,s.root as never,NOW+120_000);
    expect(third).toMatchObject({ok:true,reported:0,cleared:2});
    expect(alerts(s).every(([,d])=>d.status==='cleared')).toBe(true);
  });
  it('never writes outside the alert collection and never touches rows or balance data',async()=>{
    const s=fresh();
    await runPendingSweep(s.db as never,s.root as never,NOW);
    expect(s.writes.every(w=>w.split(':')[1].startsWith(ALERT_COLLECTION+'/'))).toBe(true);
    expect(s.store.get('accounts/x')).toEqual({available:5,reserved:2});expect(s.store.get('ledgerEntries/l1')).toEqual({kind:'video_reserve'});
    expect(s.store.get('billingHoldOutbox/h1')).toEqual(hold('needs_review'));
  });
  it('audit mode is opt-in: a row without a usable state is invisible to the fast sweep and alerts only when auditing',async()=>{
    const s=stub({billingIntents:{ok:{state:'reserve_pending',createdAtMs:1000},nostate:{createdAtMs:5}}});
    expect(await runPendingSweep(s.db as never,s.root as never,NOW)).toMatchObject({reported:1,created:0});
    expect(await runPendingSweep(s.db as never,s.root as never,NOW,{audit:true})).toMatchObject({reported:2,created:1});
    expect(alerts(s)[0][1]).toMatchObject({rowId:'nostate',reason:'malformed'});
  });
  it('passes the owner age policy through to raising and clearing; without it there are no age alerts',async()=>{
    const s=stub({billingOutbox:{o1:{state:'pending',createdAtMs:NOW-10_000}}});
    expect(await runPendingSweep(s.db as never,s.root as never,NOW)).toMatchObject({created:0});
    expect(await runPendingSweep(s.db as never,s.root as never,NOW,{policy:{ageThresholdMs:5_000}})).toMatchObject({created:1});
    expect(alerts(s)[0][1].reason).toBe('age');
  });
  it('a failing report read raises ONE sweep alert (counted on repeat) and fails loudly with a code, not a message',async()=>{
    const s=fresh();const original=s.root.collection.bind(s.root);
    (s.root as {collection:unknown}).collection=(name:string)=>{if(name==='billingIntents')throw new Error('boom with private detail');return original(name);};
    await expect(runPendingSweep(s.db as never,s.root as never,NOW)).rejects.toMatchObject({code:'sweep_failed',stage:'read'});
    await expect(runPendingSweep(s.db as never,s.root as never,NOW+1)).rejects.toMatchObject({code:'sweep_failed'});
    const sweep=alerts(s).filter(([,d])=>d.kind==='sweep');
    expect(sweep).toHaveLength(1);expect(sweep[0][1]).toMatchObject({seenCount:2,status:'open',reason:'sweep_failed'});
    expect(JSON.stringify(sweep[0][1])).not.toMatch(/boom|private/);
  });
  it('a failing step REJECTS with a SweepError carrying the partial summary (never a resolved ok:false); other rows are still alerted',async()=>{
    const s=fresh();
    const bad=alertKey('hold','h1','needs_review','needs_review');
    s.store.set(`${ALERT_COLLECTION}/${bad}`,{alertKey:bad,kind:'hold',rowId:'h1',state:'needs_review',reason:'needs_review',accountId:null,status:'open',seenCount:0,firstSeenAtMs:1,lastSeenAtMs:1});
    const error=await runPendingSweep(s.db as never,s.root as never,NOW).then(()=>null,e=>e);
    expect(error).toBeInstanceOf(SweepError);
    expect(error).toMatchObject({code:'sweep_failed',stage:'raise',alerted:true});
    expect(error.summary).toMatchObject({ok:false,created:1,failures:['raise','review']});
    expect(alerts(s).some(([,d])=>d.kind==='sweep'&&d.reason==='sweep_failed')).toBe(true);
    expect(alerts(s).some(([,d])=>d.rowId==='h2')).toBe(true);
  });
  it('an alert document found corrupt during clearing is an integrity problem: sweep_review alert, loud failure',async()=>{
    const s=stub();
    const k=alertKey('hold','h9','needs_review','needs_review');
    s.store.set(`${ALERT_COLLECTION}/${k}`,{alertKey:k,kind:'hold',rowId:'tampered',state:'needs_review',reason:'needs_review',accountId:null,status:'open',seenCount:1,firstSeenAtMs:1,lastSeenAtMs:1});
    const error=await runPendingSweep(s.db as never,s.root as never,NOW).then(()=>null,e=>e);
    expect(error).toMatchObject({code:'sweep_review',stage:'review',alerted:true});expect(error.summary).toMatchObject({corrupt:1,failures:['review']});
    expect(alerts(s).filter(([,d])=>d.reason==='sweep_review')).toHaveLength(1);
    await runPendingSweep(s.db as never,s.root as never,NOW+1).then(()=>null,()=>null);
    expect(alerts(s).filter(([,d])=>d.reason==='sweep_review')[0][1].seenCount).toBe(2);
  });
  it('keeps the counters of what was already cleared when clearing fails midway',async()=>{
    const s=stub({billingHoldOutbox:{h1:hold('needs_review'),h2:hold('needs_review')}});
    await runPendingSweep(s.db as never,s.root as never,NOW);
    s.store.set('billingHoldOutbox/h1',{state:'applied'});s.store.set('billingHoldOutbox/h2',{state:'applied'});
    const original=s.db.runTransaction.bind(s.db);let calls=0;
    (s.db as {runTransaction:unknown}).runTransaction=(fn:(tx:unknown)=>Promise<unknown>)=>{calls++;if(calls===2)return Promise.reject(new Error('lock timeout with private detail'));return original(fn);};
    const error=await runPendingSweep(s.db as never,s.root as never,NOW+1).then(()=>null,e=>e);
    expect(error).toMatchObject({code:'sweep_failed',stage:'clear'});expect(error.summary.cleared).toBe(1);
    expect(JSON.stringify(error.summary)+error.message).not.toMatch(/lock timeout|private/);
  });
  it('a read failure also carries a standard partial summary; a non-object rejection never breaks the error handling',async()=>{
    const s=fresh();const original=s.root.collection.bind(s.root);
    (s.root as {collection:unknown}).collection=(name:string)=>{if(name==='billingIntents')throw new Error('boom');return original(name);};
    const error=await runPendingSweep(s.db as never,s.root as never,NOW).then(()=>null,e=>e);
    expect(error).toBeInstanceOf(SweepError);expect(error.summary).toMatchObject({ok:false,reported:0,created:0,failures:['read']});
    // Every transaction rejects with `undefined`: raise and clear still end in a SweepError (not a TypeError), and the
    // impossible sweep alert is reported as such instead of being claimed.
    const t=fresh();(t.db as {runTransaction:unknown}).runTransaction=()=>Promise.reject(undefined);
    const bad=await runPendingSweep(t.db as never,t.root as never,NOW).then(()=>null,e=>e);
    expect(bad).toBeInstanceOf(SweepError);expect(bad).toMatchObject({code:'sweep_failed',alerted:false});expect(bad.summary.failures).toEqual(['raise','alert']);
  });
  it('rejects invalid options instead of guessing',async()=>{
    const s=stub();
    await expect(runPendingSweep(s.db as never,s.root as never,NOW,{pageSize:0})).rejects.toThrow();
    await expect(runPendingSweep(s.db as never,s.root as never,-1)).rejects.toThrow();
    await expect(runPendingSweep(s.db as never,s.root as never,NOW,{policy:{ageThresholdMs:0}})).rejects.toThrow();
  });
});
