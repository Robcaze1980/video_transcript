/**
 * LV-019.B: a read-only facade over a Firestore root document, parametrized by a POLICY, for running reconciliation readers against REAL data.
 * `collection(name)` opens a sub-collection of the root, but only those the policy lists, and the query it returns exposes only:
 * `where(<field>,'==',<an allowed value>)` for the fields the policy lists, `orderBy('__name__')`, `select(<fields the policy lists>)`,
 * `limit(n)`, `startAfter(<a document this facade returned from the same collection>)`, `get()` and `count()`. There is no `doc`, no write,
 * no transaction, no listener and no reference to a document, so whatever credentials the process holds, code that only sees this object
 * cannot write, cannot read another collection and cannot probe fields the policy does not list.
 * Returned documents carry just an id and a frozen copy of the policy's exposed scalar fields (a non-scalar value is replaced by the string
 * `[object]`, or omitted for fields marked `dropIfNotScalar`), plus booleans for the fields the policy asks to expose only as present/absent.
 * Every read can be journalled as collection / operation / number of filters / documents returned (never a value). `maxDocs` caps the
 * documents read: each query is limited BEFORE it runs to what is left of the budget plus one, and reads and counts run one after another.
 * Concrete policies: billingReadOnlyRoot.ts (billing queues in the Video database) and accountReadOnlyRoot.ts (the Account database).
 */
import type {DocumentReference} from 'firebase-admin/firestore';

export type Scalar=string|number|boolean;
export interface CollectionPolicy{
  /** Fields a `select()` may name (and only these). */readonly select:readonly string[];
  /** Scalar fields exposed from each document. */readonly expose:readonly string[];
  /** Exposed fields omitted (instead of marked `[object]`) when the stored value is not a scalar. */readonly dropIfNotScalar?:readonly string[];
  /** Source field -> name of a boolean that says whether the source is present and non-null; the value itself is never exposed. */readonly presence?:Readonly<Record<string,string>>;
  /** Equality filters allowed: field -> the exact values it may be compared with. */readonly where:Readonly<Record<string,readonly Scalar[]>>;
}
export interface ReadPolicy{readonly collections:Readonly<Record<string,CollectionPolicy>>}

export interface ReadOnlyDoc{readonly id:string;data():Readonly<Record<string,unknown>>|undefined}
export interface ReadOnlyQuery{
  where(field:string,op:'==',value:Scalar):ReadOnlyQuery;
  orderBy(field:'__name__'):ReadOnlyQuery;
  select(...fields:string[]):ReadOnlyQuery;
  limit(n:number):ReadOnlyQuery;
  startAfter(cursor:ReadOnlyDoc):ReadOnlyQuery;
  get():Promise<{readonly docs:readonly ReadOnlyDoc[]}>;
  count():Promise<number>;
}
export interface ReadOnlyRoot{collection(name:string):ReadOnlyQuery}
export interface ReadOnlyOptions{journal?:(entry:{collection:string;op:'get'|'count';filters:number;docs:number})=>void;maxDocs?:number}

type RawSnap={id:string;data():Record<string,unknown>|undefined};
type RawQuery={where(...a:unknown[]):RawQuery;orderBy(...a:unknown[]):RawQuery;select(...a:unknown[]):RawQuery;limit(n:number):RawQuery;startAfter(c:unknown):RawQuery;get():Promise<{docs:RawSnap[]}>;count?:()=>{get():Promise<{data():{count:number}}>}};

const isScalar=(value:unknown):value is Scalar|null=>value===null||typeof value==='string'||typeof value==='number'||typeof value==='boolean';
const has=(object:object,key:string)=>Object.prototype.hasOwnProperty.call(object,key);

/** Frozen copy of the exposed fields only. */
function project(policy:CollectionPolicy,data:Record<string,unknown>|undefined):Readonly<Record<string,unknown>>|undefined{
  if(data===undefined||data===null||typeof data!=='object')return undefined;
  const out:Record<string,unknown>={};
  for(const key of policy.expose){
    if(!has(data,key))continue;
    const value=data[key];
    if(isScalar(value))out[key]=value;
    else if(!policy.dropIfNotScalar?.includes(key))out[key]='[object]'; // present, but not a usable scalar
  }
  for(const [source,name] of Object.entries(policy.presence??{}))out[name]=has(data,source)&&data[source]!==null&&data[source]!==undefined;
  return Object.freeze(out);
}

export function createReadOnlyRoot(root:DocumentReference,policyInput:ReadPolicy,options:ReadOnlyOptions={}):ReadOnlyRoot{
  if(options.maxDocs!==undefined&&(!Number.isSafeInteger(options.maxDocs)||options.maxDocs<1))throw new RangeError('invalid maxDocs');
  // The policy is copied and frozen: whoever built it cannot widen it afterwards.
  const policy:ReadPolicy=Object.freeze({collections:Object.freeze(Object.fromEntries(Object.entries(policyInput.collections).map(([name,c])=>[name,Object.freeze({
    select:Object.freeze([...c.select]),expose:Object.freeze([...c.expose]),dropIfNotScalar:Object.freeze([...(c.dropIfNotScalar??[])]),
    presence:Object.freeze({...(c.presence??{})}),where:Object.freeze(Object.fromEntries(Object.entries(c.where).map(([f,v])=>[f,Object.freeze([...v])]))),
  })])))});
  const raw=new WeakMap<object,{snap:RawSnap;collection:string}>();let read=0;
  // Reads are serialized: a budget computed before the previous read finished could be spent twice.
  let chain:Promise<unknown>=Promise.resolve();
  // `docs` is informational; only documents actually read (`reads`) count against the cap. A count() aggregation reads none.
  const account=(collection:string,op:'get'|'count',filters:number,docs:number,reads:number)=>{
    read+=reads;options.journal?.({collection,op,filters,docs});
    if(options.maxDocs!==undefined&&read>options.maxDocs)throw new Error('maximum documents exceeded');
  };
  const wrapDoc=(collection:string,cp:CollectionPolicy,snap:RawSnap):ReadOnlyDoc=>{
    const data=project(cp,snap.data());
    const doc=Object.freeze({id:snap.id,data:()=>data});raw.set(doc,{snap,collection});return doc;
  };
  const wrap=(collection:string,cp:CollectionPolicy,query:RawQuery,filters:number,lim:number|undefined):ReadOnlyQuery=>Object.freeze({
    where(field:string,op:'==',value:Scalar){
      if(op!=='==')throw new TypeError('where: equality only');
      if(typeof field!=='string'||!has(cp.where,field))throw new TypeError('where: invalid field');
      if(!isScalar(value)||value===null||!cp.where[field].includes(value))throw new TypeError('where: invalid value');
      return wrap(collection,cp,query.where(field,'==',value),filters+1,lim);
    },
    orderBy(...args:unknown[]){
      if(args.length!==1||args[0]!=='__name__')throw new TypeError('orderBy: only the document id, ascending');
      return wrap(collection,cp,query.orderBy('__name__'),filters,lim);
    },
    select(...fields:unknown[]){
      if(fields.length<1||fields.length>cp.select.length||new Set(fields).size!==fields.length||!fields.every(f=>typeof f==='string'&&cp.select.includes(f)))throw new TypeError('select: field not allowed');
      return wrap(collection,cp,query.select(...fields),filters,lim);
    },
    limit(n:number){
      if(typeof n!=='number'||!Number.isSafeInteger(n)||n<1||n>1000)throw new RangeError('limit: invalid');
      return wrap(collection,cp,query,filters,n);
    },
    startAfter(cursor:ReadOnlyDoc){
      const entry=typeof cursor==='object'&&cursor!==null?raw.get(cursor):undefined;
      if(!entry||entry.collection!==collection)throw new TypeError('startAfter: not a cursor returned by this facade for this collection');
      return wrap(collection,cp,query.startAfter(entry.snap),filters,lim);
    },
    get(){
      const run=chain.then(async()=>{
        // Limit BEFORE running: never more than what is left of the budget plus one (the extra document proves the cap was exceeded).
        const budget=options.maxDocs===undefined?Infinity:Math.max(0,options.maxDocs-read)+1;
        const effective=Math.min(lim??Infinity,budget);
        const page=await (Number.isFinite(effective)?query.limit(effective):query).get();
        account(collection,'get',filters,page.docs.length,page.docs.length);
        return Object.freeze({docs:Object.freeze(page.docs.map(snap=>wrapDoc(collection,cp,snap)))});
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
      if(typeof name!=='string'||!has(policy.collections,name))throw new TypeError('collection not readable');
      return wrap(name,policy.collections[name],root.collection(name) as unknown as RawQuery,0,undefined);
    },
  });
}
