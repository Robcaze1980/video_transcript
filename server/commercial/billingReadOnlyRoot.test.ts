// LV-019.B: a read-only facade over a Firestore root. It exposes only the reads the pending report and the schedule inventory perform, on a
// fixed list of collections, so that running them against real data cannot write, whatever credentials the process holds.
import {describe,expect,it} from 'vitest';
import {readOnlyRoot,READABLE_COLLECTIONS} from './billingReadOnlyRoot';
import {readPendingReport} from './billingPendingReport';
import {readScheduleInventory} from './billingScheduleInventory';
import {stub} from './billingFirestoreStub';

const NOW=2_000_000_000_000;
const seed=()=>stub({
  billingIntents:{a:{state:'reserve_pending',nextAttemptAt:NOW-5,createdAtMs:NOW-100,accountId:'11111111-1111-4111-8111-111111111111'},b:{state:'closed'},c:{state:'needs_review',createdAtMs:NOW-50}},
  billingOutbox:{o1:{state:'retry_wait',nextAttemptAt:NOW+10,createdAtMs:NOW-20},o2:{state:'settled'}},
  billingHoldOutbox:{h1:{state:'pending',nextAttemptAt:NOW-1,createdAtMs:NOW-10}},
  jobs:{j1:{state:'unknown',createdAtMs:NOW-300}},
  accounts:{x:{available:5}},
});
const view=(s:ReturnType<typeof seed>)=>readOnlyRoot(s.root as never);

describe('the facade lets the real readers run and gives the same answers',()=>{
  it('pending report and schedule inventory through the facade equal the direct results',async()=>{
    const s=seed();
    expect(await readPendingReport(view(s) as never,NOW)).toEqual(await readPendingReport(s.root as never,NOW));
    expect(await readScheduleInventory(view(s) as never,NOW)).toEqual(await readScheduleInventory(s.root as never,NOW));
    expect(await readPendingReport(view(s) as never,NOW,{audit:true})).toEqual(await readPendingReport(s.root as never,NOW,{audit:true}));
    expect(s.writes).toEqual([]);
  });
  it('works with small pages too (the cursor goes through the facade)',async()=>{
    const s=seed();
    expect(await readPendingReport(view(s) as never,NOW,{pageSize:1})).toEqual(await readPendingReport(s.root as never,NOW));
    expect(await readScheduleInventory(view(s) as never,NOW,{pageSize:1})).toEqual(await readScheduleInventory(s.root as never,NOW));
  });
});

describe('what the facade refuses',()=>{
  it('only the listed collections can be opened',()=>{
    const s=seed();
    for(const name of READABLE_COLLECTIONS)expect(()=>view(s).collection(name)).not.toThrow();
    for(const name of ['accounts','ledgerEntries','identities','billingPendingAlerts','billingPendingAudit','uploads','','__proto__','constructor'])expect(()=>view(s).collection(name)).toThrow(/not readable/i);
  });
  it('exposes no write or navigation method on the root',()=>{
    const root=view(seed()) as unknown as Record<string,unknown>;
    for(const key of ['doc','set','create','update','delete','listCollections','firestore','parent','path','id','runTransaction','batch','add','withConverter','onSnapshot','get'])expect(root[key],key).toBeUndefined();
    expect(Object.keys(root)).toEqual(['collection']);
    expect(Object.isFrozen(root)).toBe(true);
  });
  it('exposes no write or navigation method on a query, and its operators are fixed',()=>{
    const q=view(seed()).collection('billingIntents') as unknown as Record<string,unknown>;
    for(const key of ['doc','add','set','create','update','delete','listDocuments','firestore','parent','path','onSnapshot','withConverter','endBefore','startAt','endAt','limitToLast','offset','stream','explain','aggregate'])expect(q[key],key).toBeUndefined();
    expect(Object.keys(q).sort()).toEqual(['count','get','limit','orderBy','select','startAfter','where']);
  });
  it('where accepts only equality on `state` and only for the states the readers query (no probing of other fields)',()=>{
    const q=view(seed()).collection('billingIntents') as any;
    for(const state of ['pending','reserve_pending','release_pending','needs_review','retry_wait','unknown'])expect(()=>q.where('state','==',state)).not.toThrow();
    for(const op of ['<','<=','>','>=','!=','in','array-contains','not-in'])expect(()=>q.where('state',op,'pending')).toThrow(/equality/i);
    for(const field of ['','a/b','__name__','state.x','accountId','nextAttemptAt','createdAtMs','apiKey','secret'])expect(()=>q.where(field,'==','pending')).toThrow(/field/i);
    for(const value of [{},['pending'],5,null,undefined,'closed','settled','bogus',''])expect(()=>q.where('state','==',value)).toThrow(/value/i);
  });
  it('orderBy accepts only the document id, ascending; select only the two scheduling fields; limit only a sane integer',()=>{
    const q=view(seed()).collection('billingIntents');
    expect(()=>q.orderBy('__name__')).not.toThrow();
    expect(()=>(q as any).orderBy('state')).toThrow(/orderBy/i);expect(()=>(q as any).orderBy('__name__','desc')).toThrow(/orderBy/i);
    expect(()=>q.select('state','nextAttemptAt')).not.toThrow();expect(()=>q.select('state')).not.toThrow();
    for(const bad of [[],['accountId'],['state','accountId'],['nextAttemptAt','']])expect(()=>(q as any).select(...bad)).toThrow(/select/i);
    for(const bad of [0,-1,1.5,Number.NaN,1001,'5'])expect(()=>q.limit(bad as never)).toThrow(/limit/i);
    expect(()=>q.limit(1)).not.toThrow();expect(()=>q.limit(1000)).not.toThrow();
  });
  it('startAfter accepts only a document the facade itself returned',async()=>{
    const s=seed(),facade=view(s),q=facade.collection('billingIntents').orderBy('__name__');
    expect(()=>q.startAfter({id:'a'} as never)).toThrow(/cursor/i);
    expect(()=>q.startAfter('a' as never)).toThrow(/cursor/i);
    expect(()=>q.startAfter(s.root.collection('billingIntents').doc('a') as never)).toThrow(/cursor/i);
    const page=await q.limit(1).get();expect(()=>q.startAfter(page.docs[0] as never)).not.toThrow();
    // a cursor from another readable collection is refused too
    const other=await facade.collection('billingOutbox').orderBy('__name__').limit(1).get(); // same facade, different collection
    expect(()=>facade.collection('billingOutbox').orderBy('__name__').startAfter(other.docs[0])).not.toThrow();
    expect(()=>q.startAfter(other.docs[0] as never)).toThrow(/cursor/i);
  });
  it('returned data is a frozen copy of six scalar fields only: nothing else, and no object that could carry a reference',async()=>{
    const ref={path:'accounts/x',set:()=>undefined,delete:()=>undefined};
    const docs=[
      {id:'a',data:()=>({state:'reserve_pending',createdAtMs:5,nextAttemptAt:{seconds:1},attempts:2,lastErrorCode:'unavailable',accountId:'acc',secretToken:'LEAK-1',nested:{deep:ref},owner:ref,bytes:[1,2,3]})},
      {id:'b',data:()=>({state:{x:1},attempts:[1],createdAtMs:7})},
    ];
    const fake={collection:()=>({orderBy(){return this;},limit(){return this;},async get(){return {docs};}})};
    const page=await readOnlyRoot(fake as never).collection('billingIntents').orderBy('__name__').limit(10).get();
    const a=page.docs[0].data()!,b=page.docs[1].data()!;
    expect(a).toEqual({state:'reserve_pending',createdAtMs:5,nextAttemptAt:'[object]',attempts:2,lastErrorCode:'unavailable',accountId:'acc'});
    expect(b).toEqual({attempts:'[object]',createdAtMs:7}); // an object state is dropped (it stays "no state"), other objects are marked
    expect(JSON.stringify(page.docs.map(d=>d.data()))).not.toMatch(/LEAK-1|secretToken|nested|owner|bytes|accounts/);
    expect(Object.isFrozen(a)).toBe(true);expect(()=>{(a as any).state='x';}).toThrow();expect(()=>{(a as any).extra=1;}).toThrow();
    expect(Object.getPrototypeOf(a)).toBe(Object.prototype);
  });
  it('a document without data exposes undefined, not an object',async()=>{
    const fake={collection:()=>({orderBy(){return this;},limit(){return this;},async get(){return {docs:[{id:'z',data:()=>undefined}]};}})};
    const page=await readOnlyRoot(fake as never).collection('billingIntents').orderBy('__name__').limit(1).get();
    expect(page.docs[0].id).toBe('z');expect(page.docs[0].data()).toBeUndefined();
  });
  it('returned documents carry only an id and their data: no reference that could write',async()=>{
    const page=await view(seed()).collection('billingIntents').orderBy('__name__').limit(10).get();
    expect(page.docs.length).toBe(3);
    for(const doc of page.docs){expect(Object.keys(doc).sort()).toEqual(['data','id']);expect((doc as any).ref).toBeUndefined();expect(Object.isFrozen(doc)).toBe(true);}
    expect(Object.keys(page).sort()).toEqual(['docs']);
  });
  it('count is available only when the underlying query supports it',async()=>{
    const s=seed(),calls:string[]=[];
    const real=s.root.collection('billingOutbox');
    const withCount={...real,count:()=>({get:async()=>{calls.push('count');return {data:()=>({count:2})};}})};
    const root=readOnlyRoot({collection:(c:string)=>c==='billingOutbox'?withCount:s.root.collection(c)} as never);
    expect(await root.collection('billingOutbox').count()).toBe(2);expect(calls).toEqual(['count']);
    const bare={collection:(c:string)=>{const q=s.root.collection(c) as Record<string,unknown>;const {count:_omit,...rest}=q;return rest;}};
    await expect(readOnlyRoot(bare as never).collection('billingIntents').count()).rejects.toThrow(/not supported/i);
    expect(await view(s).collection('billingIntents').where('state','==','needs_review').count()).toBe(1);
  });
});

describe('journal and cost guard',()=>{
  it('records each read as collection, operation and number of filters, never a value',async()=>{
    const s=seed(),journal:Array<Record<string,unknown>>=[];
    const root=readOnlyRoot(s.root as never,{journal:e=>journal.push(e)});
    await readPendingReport(root as never,NOW);
    expect(journal.length).toBeGreaterThan(0);
    for(const entry of journal)expect(Object.keys(entry).sort()).toEqual(['collection','docs','filters','op']);
    expect(JSON.stringify(journal)).not.toMatch(/reserve_pending|1111|needs_review|accountId/);
    expect(new Set(journal.map(e=>e.collection))).toEqual(new Set(['billingIntents','billingIntentTerminalRecovery','billingHoldOutbox','billingOutbox','jobs']));
  });
  it('aborts once more documents than the configured maximum have been read',async()=>{
    const s=seed();
    const root=readOnlyRoot(s.root as never,{maxDocs:3});
    await expect(readScheduleInventory(root as never,NOW)).rejects.toThrow(/maximum/i);
  });
  it('limits each query BEFORE it runs to what is left of the budget plus one, so a runaway scan cannot read more than one over the cap',async()=>{
    const s=seed(),limits:Array<number|undefined>=[];
    const spy=(c:string)=>{const real:any=s.root.collection(c);const wrap=(q:any):any=>new Proxy(q,{get:(t,p)=>p==='limit'?(n:number)=>{limits.push(n);return wrap(t.limit(n));}:typeof t[p]==='function'?(...a:unknown[])=>{const r=t[p](...a);return r&&typeof r==='object'&&'get' in r?wrap(r):r;}:t[p]});return wrap(real);};
    const root=readOnlyRoot({collection:spy} as never,{maxDocs:2});
    await expect(root.collection('billingIntents').limit(200).get()).rejects.toThrow(/maximum/i); // 3 documents exist
    expect(limits).toEqual([3]); // 200 requested, but only budget+1 may be read
    limits.length=0;
    await expect(root.collection('billingOutbox').orderBy('__name__').get()).rejects.toThrow(/maximum/i); // no limit requested: still capped
    expect(limits).toEqual([1]); // the budget is already exhausted: at most one document
  });
  it('queries issued at the same time cannot each spend the whole budget: they run one after another',async()=>{
    const s=seed(),limits:number[]=[];
    const spy=(c:string)=>{const real:any=s.root.collection(c);const wrap=(q:any):any=>new Proxy(q,{get:(t,p)=>p==='limit'?(n:number)=>{limits.push(n);return wrap(t.limit(n));}:typeof t[p]==='function'?(...a:unknown[])=>{const r=t[p](...a);return r&&typeof r==='object'&&'get' in r?wrap(r):r;}:t[p]});return wrap(real);};
    const root=readOnlyRoot({collection:spy} as never,{maxDocs:2});
    const results=await Promise.allSettled([root.collection('billingIntents').limit(200).get(),root.collection('billingIntents').limit(200).get()]);
    expect(results.map(r=>r.status)).toEqual(['rejected','rejected']);
    expect(limits).toEqual([3,1]); // the second one saw the first one's reads: budget already spent, one document at most
  });
  it('count refuses a limit (it would silently ignore it) and runs in the same order as reads',async()=>{
    const s=seed(),order:string[]=[];
    const root=readOnlyRoot(s.root as never);
    await expect(root.collection('billingIntents').limit(2).count()).rejects.toThrow(/limit/i);
    const [a,b]=await Promise.all([root.collection('billingIntents').count(),root.collection('billingOutbox').orderBy('__name__').limit(10).get().then(p=>{order.push('get');return p.docs.length;})]);
    expect([a,b]).toEqual([3,2]);expect(order).toEqual(['get']);
  });
  it('a count aggregation reads no document, so it does not consume the cap',async()=>{
    const s=seed(),journal:Array<Record<string,unknown>>=[];
    const root=readOnlyRoot(s.root as never,{maxDocs:1,journal:e=>journal.push(e)});
    expect(await root.collection('billingIntents').count()).toBe(3);expect(await root.collection('billingOutbox').count()).toBe(2);
    expect(journal.map(e=>e.op)).toEqual(['count','count']);
    await expect(root.collection('billingIntents').limit(3).get()).rejects.toThrow(/maximum/i);
  });
  it('rejects a nonsensical maximum at construction',()=>{
    for(const bad of [0,-1,1.5,Number.NaN])expect(()=>readOnlyRoot(seed().root as never,{maxDocs:bad})).toThrow(/maxDocs/i);
  });
  it('never writes while reading',async()=>{
    const s=seed(),before=JSON.stringify([...s.store.entries()]);
    const root=readOnlyRoot(s.root as never);
    await readPendingReport(root as never,NOW,{audit:true});await readScheduleInventory(root as never,NOW);
    expect(s.writes).toEqual([]);expect(JSON.stringify([...s.store.entries()])).toBe(before);
  });
});
