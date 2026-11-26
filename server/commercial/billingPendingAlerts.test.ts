// LV-019.B phase 2, piece C: durable, deduplicated alerts derived from the read-only pending report.
// In-memory stub of Firestore (get/create/update inside transactions, equality queries). Concurrency and the real
// query semantics are checked separately against the emulator (scripts/checkBillingPendingAlertsEmulator.mjs).
import {describe,expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {AI_CATALOG_VERSION} from './aiContracts';
import {buildPendingReport,readPendingReport,type PendingRow} from './billingPendingReport';
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

// The server-side audit receives a bounded read capability. Independently reconstruct a real legacy wire binding.
function pollAuditFixture(){
  const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const accountId='11111111-1111-4111-8111-111111111111',inputId='22222222-2222-4222-8222-222222222222';
  const requestKey='test-request',intentId=hash([accountId,requestKey]),action='release';
  const witness={intentId,accountId,inputId,operation:'translation:en',revision:1,profile:AI_CATALOG_VERSION,provider:'account_seconds',
    identityKey:'f'.repeat(64),reservationId:'33333333-3333-4333-8333-333333333333',seconds:2};
  const terminalId=hash(['billing-intent-terminal-v1',intentId,action]),version={exists:true,createTime:'1:000000000',updateTime:'1:000000000'};
  const binding=hash([witness,action,version,version,{exists:false},{exists:false}]);
  const turn={terminalId,intentId,action,binding,generation:1,token:'44444444-4444-4444-8444-444444444444',lastPollAtMs:10,nextAttemptAt:2010};
  const data=new Map<string,Record<string,unknown>>([
    ['billingIntents/'+intentId,{id:intentId,...witness,state:'release_pending',requestKey}],
    ['billingIntentResolutionPolls/'+terminalId,turn],
    ['billingIntentWitnesses/'+intentId,{...witness,historyProtocol:1,baseline:'before_reservation',createdAtMs:1,
      terminalRecovery:{protocol:1,sealPrepared:false,releasePrepared:true}}],
    ['billingIntentTerminalWitnesses/'+terminalId,{...witness,action,historyProtocol:1,stage:'prepared',createdAtMs:1}],
    ['billingIntentTerminalRecovery/'+terminalId,{terminalId,protocol:1,state:'pending',generation:0,attempts:0,createdAtMs:1,nextAttemptAt:1}],
  ]);
  const evidence=['billingIntentWitnesses/'+intentId,'billingIntentTerminalWitnesses/'+terminalId,
    'billingIntentTerminalRecovery/'+terminalId,'billingIntentPreparationProofs/'+terminalId,'billingIntentDispatchClaims/'+terminalId];
  const sources=['billingIntents/'+intentId,'billingIntentResolutionPolls/'+terminalId,...evidence],read:string[]=[],writes:string[]=[];
  const allowed=new Set([...sources,'billingIntentResolutionPolls/'+hash(['billing-intent-terminal-v1',intentId,'seal'])]);
  const alert=alertKey('terminal_poll',terminalId,'invalid','malformed'),alertPath=ALERT_COLLECTION+'/'+alert;
  const root={collection:(col:string)=>({doc:(id:string)=>{
    const path=col+'/'+id;
    if(path!==alertPath&&!allowed.has(path))throw Error('unexpected lookup');
    return Object.freeze({id,path});
  }})};
  type Ref={id:string;path:string};
  const stamp={seconds:1,nanoseconds:0,isEqual:(other:unknown)=>other===stamp};
  let denied='',pollCommit:unknown=stamp;
  const snapshot=(ref:Ref)=>{
    if(ref.path===denied)throw Error('read denied');
    return {id:ref.id,createTime:stamp,updateTime:ref.path===sources[1]?pollCommit:stamp,exists:data.has(ref.path),data:()=>data.get(ref.path),get:(k:string)=>data.get(ref.path)?.[k]};
  };
  const write=(ref:Ref,value:Record<string,unknown>)=>{
    if(ref.path!==alertPath)throw Error('source write denied');
    writes.push(ref.path);data.set(ref.path,{...data.get(ref.path),...value});
  };
  const tx={getAll:async(...refs:Ref[])=>{const paths=refs.map(r=>r.path);
    if(JSON.stringify(paths)!==JSON.stringify(sources.slice(0,2))&&JSON.stringify(paths)!==JSON.stringify(evidence))throw Error('unexpected evidence access');
    read.push(...paths);return refs.map(snapshot);
  },get:async(ref:Ref)=>{if(ref.path!==alertPath)throw Error('unexpected alert access');return snapshot(ref);},create:write,update:write};
  const db={runTransaction:<T>(work:(txArg:typeof tx)=>Promise<T>)=>work(tx),getAll:async(...args:unknown[])=>{
    expect(args.pop()).toEqual({fieldMask:[]});const refs=args as Ref[];
    if(refs.length!==2||refs.some(r=>!r.path.startsWith('billingIntentResolutionPolls/')||!allowed.has(r.path)))throw Error('unexpected projection');
    return refs.map(snapshot);
  }};
  const snapshotReport=report([row({kind:'intent',id:intentId,state:'release_pending',accountId:null})]);
  return {data,turn,sources,read,writes,alertPath,tx,root,setPollCommit:(value:unknown)=>{pollCommit=value;},deny:(path:string)=>{denied=path;},
    sweep:()=>raisePendingAlerts(db as never,root as never,snapshotReport,NOW)};
}
it('rejects a corrupted alert tuple even when the stored key is unchanged',async()=>{
  async function inspectRaise(raise:()=>Promise<{created:number;seen:number}>){
    try{return {...await raise(),corrupt:false};}
    catch(error){
      if(!(error instanceof AggregateError)||!error.errors.some(item=>item instanceof Error&&item.message==='Corrupt alert document'))throw error;
      const {created,seen}=error as AggregateError&{created:number;seen:number};
      return {created,seen,corrupt:true};
    }
  }
  const expected={created:0,seen:0,corrupt:true};
  const key=alertKey('hold','h1','needs_review','needs_review'),path=ALERT_COLLECTION+'/'+key;
  const ordinary=[];
  for(const status of ['open','cleared']){
    const s=stub(),current=report([row({})]);
    const raise=(now:number)=>raisePendingAlerts(s.db as never,s.root as never,current,now);
    expect(await raise(NOW)).toEqual({created:1,seen:0});
    const damaged:Record<string,unknown>={...s.store.get(path)!,rowId:'other-hold',status,clearedAtMs:status==='cleared'?NOW+1:null};
    expect(damaged.alertKey).toBe(key);
    s.store.set(path,damaged);
    if(status==='open')expect(await clearResolvedAlerts(s.db as never,s.root as never,report([]),NOW+2)).toMatchObject({corrupt:1,cleared:0});
    const result=await inspectRaise(()=>raise(NOW+3)),stored=s.store.get(path)!;
    ordinary.push({result,storedStatus:stored.status,seenCount:stored.seenCount,reopenCount:stored.reopenCount??0});
  }

  const anotherIntent='a'.repeat(64);
  const anotherTerminal=createHash('sha256').update(JSON.stringify(['billing-intent-terminal-v1',anotherIntent,'release'])).digest('hex');
  for(const change of [{reason:'needs_review'},{pollIntentId:anotherIntent,rowId:anotherTerminal}]){
    const s=pollAuditFixture();
    s.data.set(s.sources[1],{...s.turn,generation:0});
    expect(await s.sweep()).toEqual({created:1,seen:0});
    const damaged={...s.data.get(s.alertPath)!,...change,status:'cleared',clearedAtMs:NOW};
    s.data.set(s.alertPath,damaged);
    s.writes.length=0;
    expect(await inspectRaise(s.sweep)).toEqual(expected);
    expect(s.data.get(s.alertPath)).toEqual(damaged);
    expect(s.writes).toEqual([]);
  }
  expect(ordinary).toEqual(['open','cleared'].map(storedStatus=>({result:expected,storedStatus,seenCount:1,reopenCount:0})));
});

it('preserves all stored fields when a superseded or dispositioned alert has another tuple',async()=>{
  const key=alertKey('hold','h1','needs_review','needs_review'),path=ALERT_COLLECTION+'/'+key;
  for(const status of ['superseded','dispositioned']){
    for(const change of [{kind:'outbox'},{rowId:'h2'},{state:'pending'},{reason:'age'}]){
      const s=stub(),current=report([row({})]);
      await raisePendingAlerts(s.db as never,s.root as never,current,NOW);
      const damaged={...s.store.get(path)!,status,...change};
      s.store.set(path,damaged);
      await expect(raisePendingAlerts(s.db as never,s.root as never,current,NOW+1)).rejects.toMatchObject({created:0,seen:0});
      expect(s.store.get(path)).toEqual(damaged);
    }
  }
});
describe('terminal poll evidence stays behind a read-only capability',()=>{
  it('reads only the seven deterministic sources and writes exclusively the derived alert',async()=>{
    const s=pollAuditFixture();
    const parent=s.root.collection('billingIntents').doc(s.turn.intentId);
    expect(()=>s.tx.update(parent,{})).toThrow('source write denied');
    expect(()=>s.root.collection('billingGuards').doc(s.turn.intentId)).toThrow('unexpected lookup');
    expect(await s.sweep()).toEqual({created:0,seen:0});expect(s.read).toEqual(s.sources);expect(s.writes).toEqual([]);
    s.data.set(s.sources[1],{...s.turn,binding:'b'.repeat(64)});
    expect(await s.sweep()).toEqual({created:1,seen:0});expect(s.writes).toEqual([s.alertPath]);
    expect(s.data.get(s.alertPath)?.accountId).toBe(null);
  });
  it('alerts only once for a saturated generation and accepts the last incrementable generation',async()=>{
    const s=pollAuditFixture(),turn={...s.turn,generation:Number.MAX_SAFE_INTEGER-1,nextAttemptAt:s.turn.lastPollAtMs+15*60_000};
    s.data.set(s.sources[1],turn);
    expect(await s.sweep()).toEqual({created:0,seen:0});
    s.data.set(s.sources[1],{...turn,generation:Number.MAX_SAFE_INTEGER});
    expect(await s.sweep()).toEqual({created:1,seen:0});
    expect(await s.sweep()).toEqual({created:0,seen:1});
    expect(s.data.get(s.alertPath)).toMatchObject({status:'open',accountId:null});
    expect(s.writes.every(path=>path===s.alertPath)).toBe(true);
  });
  it('propagates an inaccessible evidence document without writing financial data or reporting a clean inspection',async()=>{
    const s=pollAuditFixture();s.deny(s.sources[5]);
    await expect(s.sweep()).rejects.toMatchObject({created:0,seen:0});
    expect(s.writes).toEqual([]);expect(s.data.has(s.alertPath)).toBe(false);
  });
  it('does not follow a document reference or coerce a method embedded in poll data',async()=>{
    const s=pollAuditFixture();let invoked=false;
    const foreign={set:()=>{invoked=true;},toString:()=>{invoked=true;throw Error('coercion');}};
    s.data.set(s.sources[1],{...s.turn,binding:foreign});
    expect(await s.sweep()).toEqual({created:1,seen:0});expect(invoked).toBe(false);
    expect(s.read).toEqual(s.sources.slice(0,2));expect(s.writes).toEqual([s.alertPath]);
  });
});

describe('terminal schedule writer clock compared with the recorded Firestore commit',()=>{
  // This authoritative commit lands after the report was taken; the report clock cannot judge the turn.
  const commitMs=NOW+24*60*60_000,stamp={seconds:Math.floor(commitMs/1000),nanoseconds:999_999};
  it.each([[-60*60_000,false],[1000,false],[10*60_000,false],[10*60_000+1,true],[5*365*24*60*60_000,true]] as const)(
    'a writer offset of %i ms has a malformed alert = %s',async(offset,alerted)=>{
      const s=pollAuditFixture(),lastPollAtMs=commitMs+offset;
      s.setPollCommit(stamp);
      s.data.set(s.sources[1],{...s.turn,lastPollAtMs,nextAttemptAt:lastPollAtMs+2000});
      expect(await s.sweep()).toEqual({created:alerted?1:0,seen:0});
      expect(s.data.has(s.alertPath)).toBe(alerted);expect(s.writes).toEqual(alerted?[s.alertPath]:[]);
    });
  it.each([undefined,{seconds:1,nanoseconds:-1},{seconds:Number.MAX_SAFE_INTEGER,nanoseconds:0}])(
    'an unusable commit time prevents a successful audit',async(invalid)=>{
      const s=pollAuditFixture();s.setPollCommit(invalid);
      await expect(s.sweep()).rejects.toMatchObject({created:0,seen:0});
      expect(s.writes).toEqual([]);
    });
});

it('keeps the first unreadable alert open and clears independent rows through the final page',async()=>{
  const s=stub(),rows=Array.from({length:201},(_,n)=>row({id:'h'+n}));
  await raisePendingAlerts(s.db as never,s.root as never,report(rows),NOW);
  for(const item of rows)s.store.set('billingHoldOutbox/'+item.id,{state:'applied'});
  const [first]=alerts(s).map(([path])=>path).sort();
  const fault=Error('unavailable read'),run=s.db.runTransaction.bind(s.db);
  const adapter={runTransaction:(fn:(tx:unknown)=>Promise<unknown>)=>run(async tx=>{
    const source=tx as {get:(ref:{path:string})=>Promise<unknown>};
    return fn({...source,get:(ref:{path:string})=>{if(ref.path===first)throw fault;return source.get(ref);}});
  })};
  const failed=await clearResolvedAlerts(adapter as never,s.root as never,report([]),NOW+1).then(()=>null,e=>e);
  expect(failed).toBeInstanceOf(AggregateError);expect(failed.errors).toEqual([fault]);
  expect(failed.partial).toEqual(R({cleared:200,unverified:1}));
  expect(s.store.get(first)?.status).toBe('open');expect(alerts(s).filter(([,data])=>data.status==='cleared')).toHaveLength(200);
});

describe('Firestore-serializable corruption in alert metadata',()=>{
  it('does not record a sighting against an array status that the open-alert query cannot find',async()=>{
    const s=stub({billingHoldOutbox:{h1:{state:'needs_review'}}}),current=report([row({})]);
    await raisePendingAlerts(s.db as never,s.root as never,current,NOW);
    const key=alertKey('hold','h1','needs_review','needs_review'),path=ALERT_COLLECTION+'/'+key;
    const broken={...s.store.get(path)!,status:['open']};
    s.store.set(path,broken);
    const reads=await clearResolvedAlerts(s.db as never,s.root as never,current,NOW+1);
    expect(reads).toEqual(R({})); // Firestore equality of a string excludes an array containing that string.
    const attempt=await raisePendingAlerts(s.db as never,s.root as never,current,NOW+2).then(value=>({value,error:null}),error=>({value:null,error}));
    expect({result:attempt.value,seenCount:s.store.get(path)?.seenCount,status:s.store.get(path)?.status}).toEqual(
      {result:null,seenCount:1,status:['open']});
    expect(attempt.error).toBeInstanceOf(AggregateError);
  });
  it('does not count an explicitly non-string non-null owner on a live guard alert',async()=>{
    const a='11111111-1111-4111-8111-111111111111',guard={accountId:a,blocked:true,lastIncidentId:'a'.repeat(64)};
    const s=stub({billingGuards:{[a]:guard}}),current=await readPendingReport(s.root as never,NOW);
    await raisePendingAlerts(s.db as never,s.root as never,current,NOW);
    const key=alertKey('guard',a,current.rows[0].state,'needs_review'),path=ALERT_COLLECTION+'/'+key;
    const broken={...s.store.get(path)!,accountId:[a]};
    s.store.set(path,broken);
    const attempt=await raisePendingAlerts(s.db as never,s.root as never,current,NOW+1).then(value=>({value,error:null}),error=>({value:null,error}));
    expect(s.store.get('billingGuards/'+a)).toEqual(guard);
    expect({result:attempt.value,seenCount:s.store.get(path)?.seenCount,owner:s.store.get(path)?.accountId}).toEqual(
      {result:null,seenCount:1,owner:[a]});
    expect(attempt.error).toBeInstanceOf(AggregateError);
  });
  it('does not clear an ordinary open alert with an invalid owner type without reporting the corruption',async()=>{
    const s=stub({billingHoldOutbox:{h1:{state:'needs_review'}}}),current=report([row({})]);
    await raisePendingAlerts(s.db as never,s.root as never,current,NOW);
    const key=alertKey('hold','h1','needs_review','needs_review'),path=ALERT_COLLECTION+'/'+key;
    s.store.set('billingHoldOutbox/h1',{state:'applied'});
    s.store.set(path,{...s.store.get(path)!,accountId:{unexpected:'value'}});
    const out=await clearResolvedAlerts(s.db as never,s.root as never,report([]),NOW+1);
    expect(s.store.get('billingHoldOutbox/h1')).toEqual({state:'applied'});
    expect({cleared:out.cleared,corrupt:out.corrupt,status:s.store.get(path)?.status}).toEqual({cleared:0,corrupt:1,status:'open'});
  });
});
