import {createHash,randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {AccountStore} from './backend';

type Row=Record<string,unknown>;
type Ref={path:string};
type Stored={data:Row;created:number;updated:number};
type Stamp={seconds:number;nanoseconds:number};
type Snapshot={exists:boolean;get:(field:string)=>unknown;data:()=>Row|undefined;createTime?:Stamp;updateTime?:Stamp};
type Tx={get:(ref:Ref)=>Promise<Snapshot>;getAll:(...refs:Ref[])=>Promise<Snapshot[]>;
 create:(ref:Ref,data:Row)=>void;update:(ref:Ref,data:Row)=>void;delete:(ref:Ref)=>void};
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const incidentId='a'.repeat(64),rivalId='b'.repeat(64);

function fixture(){
 const rows=new Map<string,Stored>(),writes:string[]=[];
 let sequence=0,transactions=0,dropAck=false,queue:Promise<unknown>=Promise.resolve();
 const put=(path:string,data:Row,version=++sequence)=>{
  rows.set(path,{data:structuredClone(data),created:rows.get(path)?.created??version,updated:version});
 };
 const at=(path:string)=>structuredClone(rows.get(path)!.data);
 const copy=()=>structuredClone(rows);
 const version=(path:string,kind:'created'|'updated')=>'42:'+rows.get(path)![kind];
 const time=(offset:number)=>({seconds:42,nanoseconds:offset});
 const root={collection:(collection:string)=>({doc:(id:string)=>({path:collection+'/'+id})})};
 const db={runTransaction<T>(fn:(tx:Tx)=>Promise<T>):Promise<T>{
  transactions++;
  const operation=queue.then(async()=>{
   const before=copy(),pending=new Map<string,Row|null>();
   const get=async({path}:Ref):Promise<Snapshot>=>{
    if(pending.size)throw Error('read after write');
    const row=before.get(path);
    return {exists:row!==undefined,get:key=>row?.data[key],data:()=>row?.data,
     createTime:row&&time(row.created),updateTime:row&&time(row.updated)};
   };
   const result=await fn({get,getAll:(...refs)=>Promise.all(refs.map(get)),
    create:({path},data)=>{
     if(before.has(path)||pending.has(path))throw Error('duplicate document');
     pending.set(path,data);
    },
    update:({path},data)=>{
     const existing=before.get(path);
     if(!existing||pending.has(path))throw Error('missing or already changed document');
     pending.set(path,{...existing.data,...data});
    },
    delete:({path})=>{pending.set(path,null);},
   });
   if(pending.size){
    const commit=++sequence;
    for(const [path,data] of pending){
     writes.push(path);
     if(data===null)rows.delete(path);else put(path,data,commit);
    }
    if(dropAck){dropAck=false;throw Error('synthetic commit response lost');}
   }
   return result;
  });
  queue=operation.catch(()=>{});
  return operation;
 }};
 const store=(now=100)=>new AccountStore(db as never,root as never,()=>now);

 function account(label:string){
  const accountId=randomUUID(),uid='synthetic-fence-'+label,identityKey=AccountStore.identityKey(uid);
  const owner={ownerAccountId:accountId,identityKey,incidentId};
  const identity='identities/'+identityKey,guard='videoBillingGuards/'+accountId;
  const key=hash([accountId,incidentId]),incident='videoBillingIncidents/'+key;
  const anchor='videoBillingUnblockAttempts/'+key;
  const receipt='videoBillingUnblocks/'+hash([accountId,incidentId,'unblock']);
  const economic=['accounts/'+accountId,'videoReservations/'+label,'ledgerEntries/'+label];
  put(identity,{uid,accountId});
  put(guard,{...owner,blocked:true,incidentCount:1,epoch:1,createdAtMs:5,updatedAtMs:5});
  put(incident,{...owner,state:'active',createdAtMs:5});
  put(economic[0],{identityKey,schemaVersion:1,unit:'video_seconds',credited:20,available:17,reserved:3,consumed:0,
   active:1,activeProjectCount:0,createdAtMs:1});
  put(economic[1],{ownerAccountId:accountId,state:'reserved',seconds:3});
  put(economic[2],{ownerAccountId:accountId,kind:'video_reserve',seconds:3});
  const legacy={incidentId,epoch:1,createdAtMs:5,reviewRef:'synthetic-evidence-'+label};
  const initial={...legacy,attemptId:randomUUID(),authorizationSha256:hash(['operator-decision',label])};
  const successor={...initial,attemptId:randomUUID()};
  const change={...successor,previousAttemptId:initial.attemptId,previousEpoch:initial.epoch,reconcileId:randomUUID()};
  const grant=(id=change.reconcileId)=>'videoBillingUnblockReconciliationGrants/'+hash([accountId,incidentId,id]);
  const authority=()=>({...owner,unblockProtocol:'fenced_v1',createdAtMs:initial.createdAtMs,reviewRef:initial.reviewRef,
   authorizationSha256:initial.authorizationSha256,identityVersion:version(identity,'updated'),
   incidentVersion:version(incident,'created'),guardVersion:version(guard,'created')});
  // Only the test harness stands in for the protected, previously authorized Account enrollment.
  function enroll(){
   put(incident,{...at(incident),unblockProtocol:'fenced_v1'});
   put(anchor,{...authority(),initialAttemptId:initial.attemptId,initialEpoch:initial.epoch});
  }
  function authorize(epoch=successor.epoch){
   successor.epoch=epoch;change.epoch=epoch;
   if(rows.has(grant()))change.reconcileId=randomUUID();
   put(grant(),{...authority(),...change});
  }
  return {accountId,identityKey,identity,guard,incident,anchor,grant,receipt,economic,legacy,initial,successor,change,
   enroll,authorize};
 }
 const a=account('a'),b=account('b');
 return {store,a,b,rows,writes,at,put,copy,transactions:()=>transactions,dropNextAck:()=>{dropAck=true;},
  economic:()=>[...a.economic,...b.economic].map(path=>structuredClone(rows.get(path))),
  reconcile:(target=a)=>store().reconcileVideoBillingUnblockAttempt(target.identityKey,target.change),
  read:(target=a,request=target.initial)=>store().fencedVideoBillingUnblockReceipt(target.identityKey,request),
  confirm:(target=a,request=target.initial)=>store().confirmFencedVideoBillingUnblockAttempt(target.identityKey,request)};
}

it('recovers a predecessor commit with lost ACK before granting any successor',async()=>{
 const f=fixture(),{a,b}=f;a.enroll();a.authorize();
 const money=f.economic(),other=f.rows.get(b.guard),before=f.copy();
 expect(await f.read()).toMatchObject({state:'pending',attemptId:a.initial.attemptId});
 expect(f.copy()).toEqual(before);
 f.dropNextAck();
 const first=f.confirm(),concurrent=f.reconcile();
 await expect(first).rejects.toThrow('commit response lost');
 expect(await concurrent).toMatchObject({state:'confirmed',attemptId:a.initial.attemptId,replayed:true,blocked:false});
 expect(await f.read()).toMatchObject({state:'confirmed',attemptId:a.initial.attemptId});
 expect(await f.confirm()).toMatchObject({state:'confirmed',replayed:true});
 expect(f.rows.get(a.anchor)).toEqual(before.get(a.anchor));
 expect(f.rows.get(b.guard)).toEqual(other);
 expect(f.writes).toEqual([a.receipt,a.incident,a.guard]);
 expect(f.economic()).toEqual(money);
});

it('recovers the same fence after its ACK is lost and rejects the predecessor even if its POST was already in flight',async()=>{
 const f=fixture(),{a,b}=f;a.enroll();a.authorize();b.enroll();b.authorize();
 const money=f.economic(),before=f.copy();
 expect(a.successor.epoch).toBe(a.initial.epoch);
 expect(a.successor.attemptId).not.toBe(a.initial.attemptId);
 f.dropNextAck();
 const fence=f.reconcile(),late=f.confirm();
 await expect(fence).rejects.toThrow('commit response lost');
 await expect(late).rejects.toMatchObject({code:'conflict'});
 expect(f.writes).toEqual([a.anchor]);
 expect(f.rows.get(a.guard)).toEqual(before.get(a.guard));
 expect(await f.reconcile()).toMatchObject({state:'permitted',attemptId:a.successor.attemptId,
  reconcileId:a.change.reconcileId,replayed:true});
 expect(await f.read(a,a.successor)).toMatchObject({state:'pending'});
 await expect(f.read()).rejects.toMatchObject({code:'conflict'});
 expect(f.writes).toEqual([a.anchor]);
 expect(await f.confirm(a,a.successor)).toMatchObject({state:'confirmed',replayed:false,blocked:false});
 expect(await f.reconcile()).toMatchObject({state:'confirmed',attemptId:a.successor.attemptId,replayed:true});
 await expect(f.confirm()).rejects.toMatchObject({code:'conflict'});
 expect(f.writes).toEqual([a.anchor,a.receipt,a.incident,a.guard]);
 for(const path of [b.anchor,b.guard,b.incident,b.receipt,b.grant()])expect(f.rows.get(path)).toEqual(before.get(path));
 expect(f.economic()).toEqual(money);
});

it('fences a prepared predecessor with no prior POST and gives concurrent conciliators the same permit',async()=>{
 const f=fixture(),{a}=f;a.enroll();a.authorize();
 const money=f.economic();
 expect(f.writes).toEqual([]);
 const [first,second]=await Promise.all([f.reconcile(),f.reconcile()]);
 expect(first).toMatchObject({state:'permitted',attemptId:a.successor.attemptId,replayed:false});
 expect(second).toMatchObject({state:'permitted',attemptId:a.successor.attemptId,replayed:true});
 expect(f.writes).toEqual([a.anchor]);
 await expect(f.confirm()).rejects.toMatchObject({code:'conflict'});
 expect(await f.confirm(a,a.successor)).toMatchObject({state:'confirmed',replayed:false});
 expect(f.writes).toEqual([a.anchor,a.receipt,a.incident,a.guard]);
 expect(f.economic()).toEqual(money);
});

it('keeps the first reconciliation when another protected grant names a different successor',async()=>{
 const f=fixture(),{a}=f;a.enroll();a.authorize();
 const competing={...a.change,reconcileId:randomUUID(),attemptId:randomUUID()};
 f.put(a.grant(competing.reconcileId),{...f.at(a.grant()),...competing});
 const first=f.reconcile(),second=f.store().reconcileVideoBillingUnblockAttempt(a.identityKey,competing);
 await expect(first).resolves.toMatchObject({state:'permitted',reconcileId:a.change.reconcileId});
 await expect(second).rejects.toMatchObject({code:'conflict'});
 const before=f.copy();
 await expect(f.reconcile()).resolves.toMatchObject({state:'permitted',replayed:true});
 expect(f.copy()).toEqual(before);
 expect(f.writes).toEqual([a.anchor]);
});

it('requires fresh approval after a generation conflict and leaves a sibling incident open',async()=>{
 const f=fixture(),{a}=f;a.enroll();a.authorize();
 const money=f.economic();
 await f.store().blockVideoBilling(a.identityKey,rivalId);
 const before=f.copy();
 await expect(f.confirm()).rejects.toMatchObject({code:'conflict'});
 await expect(f.reconcile()).rejects.toMatchObject({code:'conflict'});
 const unapproved={...a.change,epoch:2};
 await expect(f.store().reconcileVideoBillingUnblockAttempt(a.identityKey,unapproved)).rejects.toMatchObject({code:'conflict'});
 expect(f.copy()).toEqual(before);
 const oldGrant=a.grant();
 a.authorize(2);
 expect(a.grant()).not.toBe(oldGrant);
 expect(f.rows.get(oldGrant)).toEqual(before.get(oldGrant));
 expect(await f.reconcile()).toMatchObject({state:'permitted',epoch:2});
 await expect(f.confirm()).rejects.toMatchObject({code:'conflict'});
 expect(await f.confirm(a,a.successor)).toMatchObject({state:'confirmed',epoch:2,blocked:true,replayed:false});
 expect(await f.store().videoBillingHold(a.identityKey,rivalId)).toEqual({blocked:true,recorded:true});
 expect(f.at(a.guard)).toMatchObject({incidentCount:2,reviewedCount:1,epoch:2});
 expect(f.writes.filter(path=>path===a.receipt)).toHaveLength(1);
 expect(f.economic()).toEqual(money);
});

it('keeps a permitted successor in review if its generation moves again',async()=>{
 const f=fixture(),{a}=f;a.enroll();a.authorize();
 await f.reconcile();
 await f.store().blockVideoBilling(a.identityKey,rivalId);
 const before=f.copy();
 await expect(f.reconcile()).rejects.toMatchObject({code:'conflict'});
 await expect(f.confirm(a,a.successor)).rejects.toMatchObject({code:'conflict'});
 await expect(f.store().reconcileVideoBillingUnblockAttempt(a.identityKey,{...a.change,
  attemptId:randomUUID(),epoch:2,reconcileId:randomUUID()})).rejects.toMatchObject({code:'conflict'});
 expect(f.copy()).toEqual(before);
 expect(f.rows.has(a.receipt)).toBe(false);
});

it('rejects a grant edited and restored in place without consuming the still-valid predecessor',async()=>{
 const f=fixture(),{a}=f;a.enroll();a.authorize();
 const path=a.grant(),original=f.rows.get(path)!;
 f.put(path,{...original.data,epoch:2});f.put(path,original.data);
 expect(f.rows.get(path)?.created).toBe(original.created);
 expect(f.rows.get(path)?.updated).not.toBe(original.updated);
 const before=f.copy();
 await expect(f.reconcile()).rejects.toMatchObject({code:'conflict'});
 await expect(f.read()).resolves.toMatchObject({state:'pending',attemptId:a.initial.attemptId});
 expect(f.copy()).toEqual(before);
 expect(f.writes).toEqual([]);
});

it('keeps a successor receipt in review when its authorization grant is missing',async()=>{
 const f=fixture(),{a}=f;a.enroll();a.authorize();
 await f.reconcile();await f.confirm(a,a.successor);
 f.rows.delete(a.grant());
 const before=f.copy();
 expect(f.at(a.receipt)).toMatchObject({attemptId:a.successor.attemptId});
 await expect(f.read(a,a.successor)).rejects.toMatchObject({code:'conflict'});
 await expect(f.confirm(a,a.successor)).rejects.toMatchObject({code:'conflict'});
 await expect(f.reconcile()).rejects.toMatchObject({code:'conflict'});
 expect(f.copy()).toEqual(before);
 expect(f.writes).toEqual([a.anchor,a.receipt,a.incident,a.guard]);
});

it('recovers the old receipt and reports the new guard still blocked even when epoch and wall time repeat',async()=>{
 const f=fixture(),{a,b}=f;a.enroll();a.authorize();
 const originalGuard=f.rows.get(a.guard)!;
 await f.confirm();
 await f.store(a.initial.createdAtMs).blockVideoBilling(a.identityKey,rivalId);
 const currentGuard=f.rows.get(a.guard)!;
 expect(currentGuard.created).not.toBe(originalGuard.created);
 expect(currentGuard.data).toMatchObject({epoch:a.initial.epoch,createdAtMs:a.initial.createdAtMs});
 const before=f.copy(),writes=[...f.writes],money=f.economic();
 const expected={state:'confirmed',attemptId:a.initial.attemptId,epoch:a.initial.epoch,createdAtMs:a.initial.createdAtMs,blocked:true};
 await expect(f.read()).resolves.toMatchObject(expected);
 await expect(f.reconcile()).resolves.toMatchObject(expected);
 expect(await f.store().videoBillingHold(a.identityKey,rivalId)).toEqual({blocked:true,recorded:true});
 expect(f.rows.get(b.guard)).toEqual(before.get(b.guard));
 expect(f.copy()).toEqual(before);
 expect(f.writes).toEqual(writes);
 expect(f.economic()).toEqual(money);
});

it('accepts an incident with a valid creation time different from the guard creation time',async()=>{
 const f=fixture(),{a}=f;
 f.put(a.incident,{...f.at(a.incident),createdAtMs:a.initial.createdAtMs+3});
 a.enroll();a.authorize();
 expect(f.at(a.incident).createdAtMs).not.toBe(f.at(a.guard).createdAtMs);
 await expect(f.confirm()).resolves.toMatchObject({state:'confirmed',createdAtMs:a.initial.createdAtMs});
 expect(f.writes).toEqual([a.receipt,a.incident,a.guard]);
});

it('rejects a malformed incident creation time before applying or reconciling',async()=>{
 const f=fixture(),{a}=f;a.enroll();a.authorize();
 f.put(a.incident,{...f.at(a.incident),createdAtMs:'5'});
 const before=f.copy();
 await expect(f.confirm()).rejects.toMatchObject({code:'conflict'});
 await expect(f.reconcile()).rejects.toMatchObject({code:'conflict'});
 expect(f.copy()).toEqual(before);
 expect(f.writes).toEqual([]);
});

it('rejects a nonpositive incident count before nextGuardReview can authorize an action',async()=>{
 const f=fixture(),{a}=f;a.enroll();a.authorize();
 f.put(a.guard,{...f.at(a.guard),incidentCount:0});
 const before=f.copy();
 await expect(f.confirm()).rejects.toMatchObject({code:'invariant'});
 await expect(f.reconcile()).rejects.toMatchObject({code:'invariant'});
 expect(f.copy()).toEqual(before);
 expect(f.writes).toEqual([]);
});

it.each(['anchor missing','grant missing','guard recreated','incident recreated','identity restored','grant from another owner'] as const)(
 'fails closed without changing either account (%s)',async scenario=>{
  const f=fixture(),{a,b}=f;a.enroll();a.authorize();b.enroll();b.authorize();
  if(scenario==='anchor missing')f.rows.delete(a.anchor);
  if(scenario==='grant missing')f.rows.delete(a.grant());
  if(scenario==='guard recreated'){
   const original=f.at(a.guard);f.rows.delete(a.guard);f.put(a.guard,original);
  }
  if(scenario==='incident recreated'){
   const original=f.at(a.incident);f.rows.delete(a.incident);f.put(a.incident,original);
  }
  if(scenario==='identity restored'){
   const original=f.at(a.identity);f.put(a.identity,{...original,accountId:b.accountId});f.put(a.identity,original);
  }
  if(scenario==='grant from another owner')f.put(a.grant(),f.at(b.grant()));
  const before=f.copy();
  await expect(f.reconcile()).rejects.toMatchObject({code:'conflict'});
  if(scenario!=='grant missing'&&scenario!=='grant from another owner')await expect(f.confirm()).rejects.toMatchObject({code:'conflict'});
  await expect(f.store().reconcileVideoBillingUnblockAttempt(b.identityKey,a.change)).rejects.toMatchObject({code:'conflict'});
  expect(f.copy()).toEqual(before);
  expect(f.writes).toEqual([]);
 },
);

it('preserves the legacy path and never converts its receipts into fenced permits',async()=>{
 const f=fixture(),{a,b}=f;a.enroll();a.authorize();
 await expect(f.reconcile(b)).rejects.toMatchObject({code:'conflict'});
 await expect(f.confirm(b)).rejects.toMatchObject({code:'conflict'});
 await expect(f.store().unblockVideoBilling(a.identityKey,a.legacy)).rejects.toMatchObject({code:'conflict'});
 expect(await f.store().unblockVideoBilling(b.identityKey,b.legacy)).toMatchObject({unblocked:true,replayed:false});
 expect(await f.store().unblockVideoBilling(b.identityKey,b.legacy)).toMatchObject({unblocked:true,replayed:true});
 expect(await f.store().videoBillingUnblockReceipt(b.identityKey,incidentId,b.legacy.reviewRef)).toMatchObject({state:'confirmed'});
 expect(await f.confirm()).toMatchObject({state:'confirmed'});
 const before=f.copy();
 await expect(f.store().videoBillingUnblockReceipt(a.identityKey,incidentId,a.legacy.reviewRef)).rejects.toMatchObject({code:'conflict'});
 await expect(f.reconcile(b)).rejects.toMatchObject({code:'conflict'});
 expect(f.copy()).toEqual(before);
});

it('documents the trust boundary when a privileged fixture writer recreates an identical receipt',async()=>{
 const f=fixture(),{a}=f;a.enroll();a.authorize();
 const money=f.economic();
 await f.confirm();
 const original=f.rows.get(a.receipt)!;
 f.rows.delete(a.receipt);f.put(a.receipt,original.data);
 expect(f.rows.get(a.receipt)?.created).not.toBe(original.created);
 // No entry point grants this direct database write. Inside the trusted-writer model the row still reads as confirmed.
 const before=f.copy();
 await expect(f.read()).resolves.toMatchObject({state:'confirmed',replayed:true});
 expect(f.copy()).toEqual(before);
 expect(f.writes).toEqual([a.receipt,a.incident,a.guard]);
 expect(f.economic()).toEqual(money);
});

it('leaves the three new entry points closed outside tests',async()=>{
 const f=fixture(),{a}=f;a.enroll();a.authorize();
 vi.stubEnv('NODE_ENV','production');
 try{
  await expect(f.read()).rejects.toMatchObject({code:'conflict'});
  await expect(f.confirm()).rejects.toMatchObject({code:'conflict'});
  await expect(f.reconcile()).rejects.toMatchObject({code:'conflict'});
 }finally{vi.unstubAllEnvs();}
 expect(f.transactions()).toBe(0);
 expect(f.writes).toEqual([]);
});
