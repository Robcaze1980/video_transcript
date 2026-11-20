/**
 * LV-019.B: a read-only facade over a Firestore root, for running the pending report and the schedule inventory against REAL data.
 * The root is the candidate namespace DOCUMENT (e.g. `vistavo/candidate-v1`); `collection(name)` opens that document's sub-collections.
 * It exposes only what those two readers perform: `collection(name)` on a fixed list of collections and, on the result,
 * `where('state','==',<a state the readers query>)`, `orderBy('__name__')`, `select('state','nextAttemptAt')`, `limit(n)`,
 * `startAfter(<a document this facade returned from the same collection>)`, `get()` and `count()`. There is no `doc`, no write, no
 * transaction, no listener and no reference to a document, so whatever credentials the process holds, code that only sees this object
 * cannot write. Filters are limited to `state` equality, so it cannot be used to probe other fields by bisection.
 * Returned documents carry just an id and a frozen copy of six scalar fields (`state`, `createdAtMs`, `nextAttemptAt`, `attempts`,
 * `lastErrorCode`, `accountId`); a non-scalar value in one of them is replaced by the string `[object]` (it stays "present but not a number"),
 * and nothing else of the document is ever exposed, whatever it contains (references, maps, bytes...).
 * Every read can be journalled as collection / operation / number of filters / documents returned (never a value). `maxDocs` caps the documents
 * read: each query is limited BEFORE it runs to what is left of the budget plus one, so a runaway scan stops at most one document over it.
 */
import type {DocumentReference} from 'firebase-admin/firestore';
import {PENDING_SOURCES} from './billingPendingReport';

export const READABLE_COLLECTIONS:readonly string[]=Object.freeze(['billingIntents','billingIntentTerminalRecovery','billingHoldOutbox','billingOutbox','jobs']);
const COLLECTIONS=new Set(READABLE_COLLECTIONS),SELECTABLE=new Set(['state','nextAttemptAt']);
/** The only states the readers filter by (listed non-terminal states of the pending sources). */
const STATES=new Set(PENDING_SOURCES.flatMap(source=>source.states));
const EXPOSED=['state','createdAtMs','nextAttemptAt','attempts','lastErrorCode','accountId'] as const;

export interface ReadOnlyDoc{readonly id:string;data():Readonly<Record<string,unknown>>|undefined}
export interface ReadOnlyQuery{
  where(field:'state',op:'==',value:string):ReadOnlyQuery;
  orderBy(field:'__name__'):ReadOnlyQuery;
  select(...fields:Array<'state'|'nextAttemptAt'>):ReadOnlyQuery;
  limit(n:number):ReadOnlyQuery;
  startAfter(cursor:ReadOnlyDoc):ReadOnlyQuery;
  get():Promise<{readonly docs:readonly ReadOnlyDoc[]}>;
  count():Promise<number>;
}
export interface ReadOnlyRoot{collection(name:string):ReadOnlyQuery}
export interface ReadOnlyOptions{journal?:(entry:{collection:string;op:'get'|'count';filters:number;docs:number})=>void;maxDocs?:number}

type RawSnap={id:string;data():Record<string,unknown>|undefined};
type RawQuery={where(...a:unknown[]):RawQuery;orderBy(...a:unknown[]):RawQuery;select(...a:unknown[]):RawQuery;limit(n:number):RawQuery;startAfter(c:unknown):RawQuery;get():Promise<{docs:RawSnap[]}>;count?:()=>{get():Promise<{data():{count:number}}>}};

/** Frozen copy of the exposed scalar fields only. */
function project(data:Record<string,unknown>|undefined):Readonly<Record<string,unknown>>|undefined{
  if(data===undefined||data===null||typeof data!=='object')return undefined;
  const out:Record<string,unknown>={};
  for(const key of EXPOSED){
    if(!Object.prototype.hasOwnProperty.call(data,key))continue;
    const value=data[key];
    if(value===null||typeof value==='string'||typeof value==='number'||typeof value==='boolean')out[key]=value;
    else if(key!=='state')out[key]='[object]'; // present, but not a usable scalar
  }
  return Object.freeze(out);
}

export function readOnlyRoot(root:DocumentReference,options:ReadOnlyOptions={}):ReadOnlyRoot{
  if(options.maxDocs!==undefined&&(!Number.isSafeInteger(options.maxDocs)||options.maxDocs<1))throw new RangeError('invalid maxDocs');
  const raw=new WeakMap<object,{snap:RawSnap;collection:string}>();let read=0;
  // Reads are serialized: a budget computed before the previous read finished could be spent twice.
  let chain:Promise<unknown>=Promise.resolve();
  // `docs` is informational; only documents actually read (`reads`) count against the cap. A count() aggregation reads none.
  const account=(collection:string,op:'get'|'count',filters:number,docs:number,reads:number)=>{
    read+=reads;options.journal?.({collection,op,filters,docs});
    if(options.maxDocs!==undefined&&read>options.maxDocs)throw new Error('maximum documents exceeded');
  };
  const wrapDoc=(collection:string,snap:RawSnap):ReadOnlyDoc=>{
    const data=project(snap.data());
    const doc=Object.freeze({id:snap.id,data:()=>data});raw.set(doc,{snap,collection});return doc;
  };
  const wrap=(collection:string,query:RawQuery,filters:number,lim:number|undefined):ReadOnlyQuery=>Object.freeze({
    where(field:string,op:'==',value:string){
      if(op!=='==')throw new TypeError('where: equality only');
      if(field!=='state')throw new TypeError('where: invalid field');
      if(typeof value!=='string'||!STATES.has(value))throw new TypeError('where: invalid value');
      return wrap(collection,query.where(field,'==',value),filters+1,lim);
    },
    orderBy(...args:unknown[]){
      if(args.length!==1||args[0]!=='__name__')throw new TypeError('orderBy: only the document id, ascending');
      return wrap(collection,query.orderBy('__name__'),filters,lim);
    },
    select(...fields:unknown[]){
      if(fields.length<1||fields.length>SELECTABLE.size||new Set(fields).size!==fields.length||!fields.every(f=>typeof f==='string'&&SELECTABLE.has(f)))throw new TypeError('select: only state and nextAttemptAt');
      return wrap(collection,query.select(...fields),filters,lim);
    },
    limit(n:number){
      if(typeof n!=='number'||!Number.isSafeInteger(n)||n<1||n>1000)throw new RangeError('limit: invalid');
      return wrap(collection,query,filters,n);
    },
    startAfter(cursor:ReadOnlyDoc){
      const entry=typeof cursor==='object'&&cursor!==null?raw.get(cursor):undefined;
      if(!entry||entry.collection!==collection)throw new TypeError('startAfter: not a cursor returned by this facade for this collection');
      return wrap(collection,query.startAfter(entry.snap),filters,lim);
    },
    get(){
      const run=chain.then(async()=>{
        // Limit BEFORE running: never more than what is left of the budget plus one (the extra document proves the cap was exceeded).
        const budget=options.maxDocs===undefined?Infinity:Math.max(0,options.maxDocs-read)+1;
        const effective=Math.min(lim??Infinity,budget);
        const page=await (Number.isFinite(effective)?query.limit(effective):query).get();
        account(collection,'get',filters,page.docs.length,page.docs.length);
        return Object.freeze({docs:Object.freeze(page.docs.map(snap=>wrapDoc(collection,snap)))});
      });
      chain=run.catch(()=>undefined);
      return run;
    },
    count(){
      if(lim!==undefined)return Promise.reject(new TypeError('count: a limit is not supported'));
      const run=chain.then(async()=>{
        if(typeof query.count!=='function')throw new TypeError('count: not supported by this query');
        const n=(await query.count().get()).data().count;
        account(collection,'count',filters,n,0);
        return n;
      });
      chain=run.catch(()=>undefined);
      return run;
    },
  });
  return Object.freeze({
    collection(name:string){
      if(typeof name!=='string'||!COLLECTIONS.has(name))throw new TypeError('collection not readable');
      return wrap(name,root.collection(name) as unknown as RawQuery,0,undefined);
    },
  });
}
