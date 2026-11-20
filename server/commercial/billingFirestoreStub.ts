// Shared in-memory stand-in for the Firestore surface the pending-billing modules use (get/create/update in
// transactions, equality and `in` queries, startAfter paging). It cannot prove real Firestore semantics: those are
// checked against the emulator by the scripts/checkBilling*Emulator.mjs diagnostics.
export function stub(initial:Record<string,Record<string,Record<string,unknown>>>={}){
  const store=new Map<string,Record<string,unknown>>(),writes:string[]=[],reads:string[]=[],selects:Array<string[]|null>=[];
  for(const [c,docs] of Object.entries(initial))for(const [id,data] of Object.entries(docs))store.set(`${c}/${id}`,structuredClone(data));
  const docRef=(c:string,id:string)=>({id,path:`${c}/${id}`,async get(){reads.push(`${c}/${id}`);const d=store.get(`${c}/${id}`);return {id,exists:!!d,data:()=>d?structuredClone(d):undefined};}});
  const project=(data:Record<string,unknown>,fields:string[]|null)=>fields===null?structuredClone(data):Object.fromEntries(fields.filter(f=>f in data).map(f=>[f,structuredClone(data[f])]));
  const query=(c:string,filters:Array<[string,string,unknown]>,after:string|null,limit:number|null,fields:string[]|null=null):Record<string,any>=>({
    where(f:string,op:string,v:unknown){return query(c,[...filters,[f,op,v]],after,limit,fields);},
    orderBy(){return query(c,filters,after,limit,fields);},
    startAfter(s:{id:string}){return query(c,filters,s.id,limit,fields);},
    limit(n:number){return query(c,filters,after,n,fields);},
    select(...f:string[]){return query(c,filters,after,limit,f);},
    count(){return {get:async()=>{let ids=[...store.keys()].filter(k=>k.startsWith(c+'/')).map(k=>k.slice(c.length+1));ids=ids.filter(id=>filters.every(([f,op,v])=>{const d=store.get(`${c}/${id}`)!;return op==='=='?d[f]===v:Array.isArray(v)&&v.includes(d[f]);}));reads.push(`count:${c}`);return {data:()=>({count:ids.length})};}};},
    async get(){
      let ids=[...store.keys()].filter(k=>k.startsWith(c+'/')).map(k=>k.slice(c.length+1)).sort();
      ids=ids.filter(id=>filters.every(([f,op,v])=>{const d=store.get(`${c}/${id}`)!;return op==='=='?d[f]===v:Array.isArray(v)&&v.includes(d[f]);}));
      if(after!==null)ids=ids.filter(id=>id>after!);if(limit!==null)ids=ids.slice(0,limit);
      reads.push(`query:${c}`);selects.push(fields);
      return {docs:ids.map(id=>({id,ref:docRef(c,id),data:()=>project(store.get(`${c}/${id}`)!,fields),get:(f:string)=>store.get(`${c}/${id}`)?.[f]}))};
    }
  });
  const root={path:'operator-local/stub-root',collection:(c:string)=>({doc:(id:string)=>docRef(c,id),...query(c,[],null,null)})};
  const db={async runTransaction<T>(fn:(tx:unknown)=>Promise<T>){
    const staged:Array<()=>void>=[];
    const tx={async get(ref:{path:string;id:string}){const d=store.get(ref.path);return {id:ref.id,exists:!!d,data:()=>d?structuredClone(d):undefined,get:(f:string)=>d?.[f]};},
      create(ref:{path:string},data:Record<string,unknown>){if(store.has(ref.path)||staged.length>50)throw Error('ALREADY_EXISTS');staged.push(()=>{writes.push('create:'+ref.path);store.set(ref.path,structuredClone(data));});},
      update(ref:{path:string},data:Record<string,unknown>){if(!store.has(ref.path))throw Error('NOT_FOUND');staged.push(()=>{writes.push('update:'+ref.path);store.set(ref.path,{...store.get(ref.path)!,...data});});}};
    const result=await fn(tx);staged.forEach(f=>f());return result;}};
  return {db,root,store,writes,reads,selects};
}
