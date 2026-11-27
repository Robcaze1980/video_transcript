import {createHash,randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {AccountStore} from './backend';

type Row=Record<string,unknown>;
type Ref={path:string};
type Timestamp={seconds:number;nanoseconds:number};
type Stored={data:Row;created:number;updated:number};
type Snapshot={exists:boolean;get:(field:string)=>unknown;data:()=>Row|undefined;
 createTime?:Timestamp;updateTime?:Timestamp};
type Tx={get:(ref:Ref)=>Promise<Snapshot>;getAll:(...refs:Ref[])=>Promise<Snapshot[]>;
 create:(ref:Ref,data:Row)=>void;update:(ref:Ref,data:Row)=>void;delete:(ref:Ref)=>void};
type Command=Parameters<AccountStore['confirmVideoBillingUnblockAttempt']>[1];
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const incident='1'.repeat(64);

function fixture(){
 const rows=new Map<string,Stored>();
 const writes:string[]=[];
 let sequence=0,transactions=0,next:Promise<unknown>=Promise.resolve(),dropAck=false,failCommit=false;
 const put=(path:string,data:Row,version=++sequence)=>{
  rows.set(path,{data:structuredClone(data),created:rows.get(path)?.created??version,updated:version});
 };
 const at=(path:string)=>structuredClone(rows.get(path)!.data);
 const recreate=(path:string)=>{
  const data=at(path);
  rows.delete(path);
  put(path,data);
 };
 const time=(version:number):Timestamp=>({seconds:42,nanoseconds:version});
 const version=(path:string,field:'created'|'updated')=>'42:'+rows.get(path)![field];
 const root={collection:(collection:string)=>({doc:(id:string)=>({path:collection+'/'+id})})};
 const db={runTransaction<T>(fn:(tx:Tx)=>Promise<T>):Promise<T>{
  transactions++;
  const operation=next.then(async()=>{
   const before=structuredClone(rows);
   const pending=new Map<string,Row|null>();
   const get=async(ref:Ref):Promise<Snapshot>=>{
    if(pending.size)throw Error('read after write');
    const row=before.get(ref.path);
    return {exists:row!==undefined,get:field=>row?.data[field],data:()=>row?.data,
     createTime:row&&time(row.created),updateTime:row&&time(row.updated)};
   };
   const result=await fn({get,getAll:(...refs)=>Promise.all(refs.map(get)),
    create:(ref,data)=>{
     if(before.has(ref.path)||pending.has(ref.path))throw Error('duplicate document');
     pending.set(ref.path,data);
    },
    update:(ref,data)=>{
     const previous=before.get(ref.path);
     if(!previous||pending.has(ref.path))throw Error('missing or already written document');
     pending.set(ref.path,{...previous.data,...data});
    },
    delete:ref=>{pending.set(ref.path,null);},
   });
   if(pending.size){
    if(failCommit){failCommit=false;throw Error('synthetic commit rejected');}
    const commit=++sequence;
    for(const [path,data] of pending){
     writes.push(path);
     if(data===null)rows.delete(path);else put(path,data,commit);
    }
    if(dropAck){dropAck=false;throw Error('synthetic committed ACK lost');}
   }
   return result;
  });
  next=operation.catch(()=>{});
  return operation;
 }};
 const freshStore=()=>new AccountStore(db as never,root as never,()=>100);
 const store=freshStore();

 function makeAccount(label:'A'|'B'){
  const accountId=randomUUID(),uid='unblock-demo-user-'+label,identityKey=AccountStore.identityKey(uid);
  const tuple={ownerAccountId:accountId,identityKey,incidentId:incident};
  const guardPath='videoBillingGuards/'+accountId;
  const identityPath='identities/'+identityKey;
  const accountPath='accounts/'+accountId;
  const key=digest([accountId,incident]);
  const incidentPath='videoBillingIncidents/'+key;
  const authorityPath='videoBillingUnblockAuthorities/'+key;
  const receiptPath='videoBillingUnblocks/'+digest([accountId,incident,'unblock']);
  const reservationPath='videoReservations/'+label,ledgerPath='ledgerEntries/'+label;
  const command:Command={incidentId:incident,attemptId:randomUUID(),authorizationSha256:digest(['fixture',label]),
   reviewRef:'synthetic-evidence-'+label,epoch:1,createdAtMs:5};
  put(identityPath,{uid,accountId});
  put(accountPath,{identityKey,schemaVersion:1,unit:'video_seconds',credited:20,
   available:17,reserved:3,consumed:0,active:1,activeProjectCount:0,createdAtMs:1});
  put(guardPath,{ownerAccountId:accountId,identityKey,blocked:true,incidentCount:1,epoch:1,createdAtMs:5,updatedAtMs:6});
  put(incidentPath,{...tuple,state:'active',createdAtMs:6});
  put(reservationPath,{ownerAccountId:accountId,identityKey,seconds:3,state:'reserved'});
  put(ledgerPath,{ownerAccountId:accountId,kind:'video_reserve',seconds:3});
  // Stands in for a protected Account enrollment and an already-approved dispatch.
  // No running component in this cut can manufacture these documents from a request.
  function grant(overrides:Partial<Command>={}){
   Object.assign(command,overrides);
   put(authorityPath,{...tuple,...command,unblockProtocol:2,identityVersion:version(identityPath,'updated'),
    incidentVersion:version(incidentPath,'created'),guardVersion:version(guardPath,'created')});
   put(incidentPath,{...at(incidentPath),unblockProtocol:2,unblockAuthorityVersion:version(authorityPath,'created')});
  }
  const {incidentId,epoch,createdAtMs,reviewRef}=command;
  return {accountId,uid,identityKey,guardPath,identityPath,incidentPath,authorityPath,receiptPath,
   economic:[accountPath,reservationPath,ledgerPath],command,legacy:{incidentId,epoch,createdAtMs,reviewRef},grant};
 }
 const a=makeAccount('A'),b=makeAccount('B');
 const economicSnapshot=()=>[...a.economic,...b.economic].map(path=>structuredClone(rows.get(path)));
 return {a,b,store,rows,writes,at,put,recreate,freshStore,economicSnapshot,snapshot:()=>structuredClone(rows),
  transactions:()=>transactions,dropNextAck:()=>{dropAck=true;},rejectNextCommit:()=>{failCommit=true;}};
}

it('recovers a lost commit response by exact read and replay with one decision and no changes to either account balance or ledger',async()=>{
 const f=fixture(),{a,b}=f;
 a.grant();
 const balance=f.economicSnapshot(),bGuard=structuredClone(f.rows.get(b.guardPath));
 const before=f.snapshot();
 const read=()=>f.freshStore().videoBillingUnblockAttemptReceipt(a.identityKey,a.command);
 expect(await read()).toEqual({state:'pending',...a.command});
 expect(f.snapshot()).toEqual(before);
 f.dropNextAck();
 await expect(f.store.confirmVideoBillingUnblockAttempt(a.identityKey,a.command)).rejects.toThrow('committed ACK lost');
 expect(f.writes).toEqual([a.receiptPath,a.incidentPath,a.guardPath]);
 expect(f.rows.has(a.guardPath)).toBe(false);
 const committed=f.snapshot();
 expect(await read()).toEqual({state:'confirmed',...a.command,blocked:false,replayed:true});
 expect(await f.freshStore().confirmVideoBillingUnblockAttempt(a.identityKey,a.command)).toEqual({
  state:'confirmed',...a.command,blocked:false,replayed:true,
 });
 expect(f.snapshot()).toEqual(committed);
 expect(f.rows.get(b.guardPath)).toEqual(bGuard);
 expect(f.economicSnapshot()).toEqual(balance);
});

it('rejects a failed commit without publishing a receipt, then two exact attempts share the eventual result',async()=>{
 const f=fixture(),{a}=f;
 a.grant();
 const before=f.snapshot(),balance=f.economicSnapshot();
 f.rejectNextCommit();
 const apply=()=>f.freshStore().confirmVideoBillingUnblockAttempt(a.identityKey,a.command);
 await expect(apply()).rejects.toThrow('commit rejected');
 expect(f.snapshot()).toEqual(before);
 expect(await f.store.videoBillingUnblockAttemptReceipt(a.identityKey,a.command)).toMatchObject({state:'pending'});
 const first=apply(),second=apply();
 expect(await first).toMatchObject({state:'confirmed',replayed:false});
 expect(await second).toMatchObject({state:'confirmed',replayed:true});
 const result=await f.store.videoBillingUnblockAttemptReceipt(a.identityKey,a.command);
 expect(result).toMatchObject({state:'confirmed',replayed:true});
 expect(f.writes.filter(path=>path===a.receiptPath)).toHaveLength(1);
 expect(f.economicSnapshot()).toEqual(balance);
});

it('keeps identical incident keys in separate accounts and rejects crossover of exact permits',async()=>{
 const f=fixture(),{a,b}=f;
 a.grant();b.grant();
 const before=f.snapshot(),economic=f.economicSnapshot();
 for(const [key,request] of [[a.identityKey,b.command],[b.identityKey,a.command]] as const){
  await expect(f.store.confirmVideoBillingUnblockAttempt(key,request)).rejects.toMatchObject({code:'conflict'});
  await expect(f.store.videoBillingUnblockAttemptReceipt(key,request)).rejects.toMatchObject({code:'conflict'});
 }
 expect(f.snapshot()).toEqual(before);
 await f.store.confirmVideoBillingUnblockAttempt(a.identityKey,a.command);
 expect(f.rows.get(b.guardPath)).toEqual(before.get(b.guardPath));
 expect(f.rows.has(b.receiptPath)).toBe(false);
 expect(await f.store.videoBillingUnblockAttemptReceipt(b.identityKey,b.command)).toMatchObject({state:'pending'});
 expect(await f.store.confirmVideoBillingUnblockAttempt(b.identityKey,b.command)).toMatchObject({state:'confirmed'});
 expect(f.economicSnapshot()).toEqual(economic);
});

it.each([
 'missing authority','identical authority recreation','authority restored in place','identical incident recreation',
 'identical current guard recreation','identity changed and restored','same epoch with changed historical reference',
] as const)('fails closed with %s before allowing a first dispatch',async scenario=>{
 const f=fixture(),{a,b}=f;
 a.grant();
 if(scenario==='missing authority')f.rows.delete(a.authorityPath);
 if(scenario==='identical authority recreation')f.recreate(a.authorityPath);
 if(scenario==='authority restored in place'){
  const original=f.at(a.authorityPath);
  f.put(a.authorityPath,{...original,reviewRef:'changed'});
  f.put(a.authorityPath,original);
 }
 if(scenario==='identical incident recreation')f.recreate(a.incidentPath);
 if(scenario==='identical current guard recreation')f.recreate(a.guardPath);
 if(scenario==='identity changed and restored'){
  const original=f.at(a.identityPath);
  f.put(a.identityPath,{...original,accountId:b.accountId});
  f.put(a.identityPath,original);
 }
 if(scenario==='same epoch with changed historical reference'){
  f.put(a.guardPath,{...f.at(a.guardPath),createdAtMs:6});
 }
 const before=f.snapshot();
 await expect(f.store.confirmVideoBillingUnblockAttempt(a.identityKey,a.command)).rejects.toMatchObject({code:'conflict'});
 await expect(f.store.videoBillingUnblockAttemptReceipt(a.identityKey,a.command)).rejects.toMatchObject({code:'conflict'});
 expect(f.snapshot()).toEqual(before);
 expect(f.writes).toEqual([]);
});

it('old generation before the Account decision fails, but a later guard does not erase an accepted decision',async()=>{
 const first=fixture();
 first.a.grant();
 await first.store.blockVideoBilling(first.a.identityKey,'2'.repeat(64));
 const moved=first.snapshot(),money=first.economicSnapshot();
 await expect(first.store.confirmVideoBillingUnblockAttempt(first.a.identityKey,first.a.command)).rejects.toMatchObject({code:'conflict'});
 expect(first.snapshot()).toEqual(moved);
 expect(first.economicSnapshot()).toEqual(money);

 const second=fixture(),{a}=second;
 a.grant();
 await second.store.confirmVideoBillingUnblockAttempt(a.identityKey,a.command);
 await second.store.blockVideoBilling(a.identityKey,'2'.repeat(64));
 const later=second.snapshot(),laterMoney=second.economicSnapshot();
 expect(await second.store.videoBillingUnblockAttemptReceipt(a.identityKey,a.command)).toMatchObject({
  state:'confirmed',epoch:a.command.epoch,createdAtMs:a.command.createdAtMs,blocked:true,replayed:true,
 });
 expect(await second.store.confirmVideoBillingUnblockAttempt(a.identityKey,a.command)).toMatchObject({blocked:true,replayed:true});
 expect(second.snapshot()).toEqual(later);
 expect(second.economicSnapshot()).toEqual(laterMoney);
});

it('shares a live guard with another incident and consumes the approved attempt only once',async()=>{
 const f=fixture(),{a}=f;
 const rival='3'.repeat(64);
 await f.store.blockVideoBilling(a.identityKey,rival);
 a.grant({epoch:2});
 const money=f.economicSnapshot();
 // A legitimate completion of another incident changes reviewedCount, not the guard birth or epoch.
 await f.store.unblockVideoBilling(a.identityKey,{...a.legacy,incidentId:rival,epoch:2});
 const prepared=f.snapshot();
 expect(await f.store.videoBillingUnblockAttemptReceipt(a.identityKey,a.command)).toMatchObject({state:'pending'});
 expect(f.snapshot()).toEqual(prepared);
 expect(await f.store.confirmVideoBillingUnblockAttempt(a.identityKey,a.command)).toMatchObject({state:'confirmed',blocked:false,replayed:false});
 expect(f.economicSnapshot()).toEqual(money);
});

it('does not reinterpret a missing or corrupted receipt after the incident is reviewed',async()=>{
 const f=fixture(),{a}=f;
 a.grant();
 await f.store.confirmVideoBillingUnblockAttempt(a.identityKey,a.command);
 const receipt=f.at(a.receiptPath);
 f.put(a.receiptPath,{...receipt,authorizationSha256:'c'.repeat(64)});
 const read=()=>f.store.videoBillingUnblockAttemptReceipt(a.identityKey,a.command);
 const apply=()=>f.store.confirmVideoBillingUnblockAttempt(a.identityKey,a.command);
 for(const missing of [false,true]){
  if(missing)f.rows.delete(a.receiptPath);
  const before=f.snapshot();
  await expect(read()).rejects.toMatchObject({code:'conflict'});
  await expect(apply()).rejects.toMatchObject({code:'conflict'});
  expect(f.snapshot()).toEqual(before);
 }
});

it('an altered attempt, audit, reference or generation cannot read or overwrite the exact receipt',async()=>{
 const f=fixture(),{a}=f;
 a.grant();
 const changes=[{attemptId:randomUUID()},{authorizationSha256:'b'.repeat(64)},
  {reviewRef:'other-evidence'},{epoch:2},{createdAtMs:9}];
 for(const phase of ['before','after']){
  if(phase==='after')await f.store.confirmVideoBillingUnblockAttempt(a.identityKey,a.command);
  const before=f.snapshot();
  for(const fields of changes){
   const changed={...a.command,...fields};
   await expect(f.store.videoBillingUnblockAttemptReceipt(a.identityKey,changed)).rejects.toMatchObject({code:'conflict'});
   await expect(f.store.confirmVideoBillingUnblockAttempt(a.identityKey,changed)).rejects.toMatchObject({code:'conflict'});
  }
  expect(f.snapshot()).toEqual(before);
 }
 expect(f.writes.filter(path=>path===a.receiptPath)).toHaveLength(1);
});

it('an inconsistent reviewed count does not report pending or authorize dispatch',async()=>{
 const f=fixture(),{a}=f;
 a.grant();
 f.put(a.guardPath,{...f.at(a.guardPath),reviewedCount:1});
 const before=f.snapshot();
 await expect(f.store.videoBillingUnblockAttemptReceipt(a.identityKey,a.command)).rejects.toMatchObject({code:'invariant'});
 await expect(f.store.confirmVideoBillingUnblockAttempt(a.identityKey,a.command)).rejects.toMatchObject({code:'invariant'});
 expect(f.snapshot()).toEqual(before);
});

it('new entry points reject legacy and existing methods reject versioned records without changing legacy replay',async()=>{
 const f=fixture(),{a,b}=f;
 const original=f.snapshot();
 await expect(f.store.confirmVideoBillingUnblockAttempt(b.identityKey,b.command)).rejects.toMatchObject({code:'conflict'});
 expect(f.snapshot()).toEqual(original);
 a.grant();
 const before=f.snapshot();
 await expect(f.store.unblockVideoBilling(a.identityKey,a.legacy)).rejects.toMatchObject({code:'conflict'});
 await expect(f.store.videoBillingUnblockReceipt(a.identityKey,incident,a.legacy.reviewRef)).rejects.toMatchObject({code:'conflict'});
 expect(f.snapshot()).toEqual(before);
 expect(await f.store.unblockVideoBilling(b.identityKey,b.legacy)).toMatchObject({unblocked:true,replayed:false});
 expect(await f.store.videoBillingUnblockReceipt(b.identityKey,incident,b.legacy.reviewRef)).toMatchObject({state:'confirmed'});
 expect(await f.store.unblockVideoBilling(b.identityKey,b.legacy)).toMatchObject({unblocked:true,replayed:true});
});

it('rejects non-test execution and rejects malformed body before opening a transaction',async()=>{
 const f=fixture(),{a}=f;
 a.grant();
 const malformed={...a.command,authorizationSha256:'A'.repeat(64)};
 await expect(f.store.confirmVideoBillingUnblockAttempt(a.identityKey,malformed)).rejects.toMatchObject({code:'invalid'});
 await expect(f.store.videoBillingUnblockAttemptReceipt(a.identityKey,malformed)).rejects.toMatchObject({code:'invalid'});
 vi.stubEnv('NODE_ENV','production');
 try{
  await expect(f.store.confirmVideoBillingUnblockAttempt(a.identityKey,a.command)).rejects.toMatchObject({code:'conflict'});
  await expect(f.store.videoBillingUnblockAttemptReceipt(a.identityKey,a.command)).rejects.toMatchObject({code:'conflict'});
 }finally{vi.unstubAllEnvs();}
 expect(f.transactions()).toBe(0);
 expect(f.writes).toEqual([]);
});

// These tests mutate the synthetic persistence directly, outside the application API.
it('provenance audit: an identically recreated receipt must not certify the original commit',async()=>{
 const f=fixture(),{a,b}=f;
 a.grant();
 const query=()=>f.freshStore().videoBillingUnblockAttemptReceipt(a.identityKey,a.command);
 const apply=()=>f.freshStore().confirmVideoBillingUnblockAttempt(a.identityKey,a.command);
 f.dropNextAck();
 await expect(apply()).rejects.toThrow('committed ACK lost');
 expect(await query()).toMatchObject({state:'confirmed',replayed:true});

 const original=structuredClone(f.rows.get(a.receiptPath)!);
 f.recreate(a.receiptPath);
 const recovered=f.rows.get(a.receiptPath)!;
 expect(recovered.data).toEqual(original.data);
 expect(recovered.created).not.toBe(original.created);
 expect(recovered.created).toBe(recovered.updated);
 const before=f.snapshot(),economic=f.economicSnapshot();

 const answers=await Promise.allSettled([query(),apply()]);
 expect(f.snapshot()).toEqual(before);
 expect(f.economicSnapshot()).toEqual(economic);
 expect(f.rows.get(b.guardPath)).toEqual(before.get(b.guardPath));
 expect(f.writes.filter(path=>path===a.receiptPath)).toHaveLength(1);
 expect(answers.map(answer=>answer.status)).toEqual(['rejected','rejected']);
});

it('provenance audit: coordinated recreation with coherent new pins must not reauthorize the original request',async()=>{
 const f=fixture(),{a,b}=f;
 a.grant();
 const paths=[a.identityPath,a.incidentPath,a.guardPath,a.authorityPath];
 const original=paths.map(path=>structuredClone(f.rows.get(path)!));
 const command=structuredClone(a.command);
 // Reserved precondition: a privileged writer can replace protected records and recompute their pointers.
 // The fixture deliberately grants this ability to no application method or HTTP caller.
 for(const path of paths.slice(0,3))f.recreate(path);
 f.rows.delete(a.authorityPath);
 a.grant();

 for(const [index,path] of paths.entries())expect(f.rows.get(path)!.created).not.toBe(original[index].created);
 expect(f.at(a.authorityPath)).toMatchObject({
  identityVersion:'42:'+f.rows.get(a.identityPath)!.updated,
  incidentVersion:'42:'+f.rows.get(a.incidentPath)!.created,
  guardVersion:'42:'+f.rows.get(a.guardPath)!.created,
 });
 expect(f.at(a.incidentPath).unblockAuthorityVersion).toBe('42:'+f.rows.get(a.authorityPath)!.created);
 expect(a.command).toEqual(command);
 expect(f.at(a.identityPath)).toEqual(original[0].data);
 expect(f.at(a.guardPath)).toEqual(original[2].data);
 const before=f.snapshot(),economic=f.economicSnapshot();
 const answers=await Promise.allSettled([
  f.freshStore().videoBillingUnblockAttemptReceipt(a.identityKey,command),
  f.freshStore().confirmVideoBillingUnblockAttempt(a.identityKey,command),
 ]);
 expect(f.economicSnapshot()).toEqual(economic);
 expect(f.rows.get(b.guardPath)).toEqual(before.get(b.guardPath));
 expect({outcomes:answers.map(answer=>answer.status),
  receiptWrites:f.writes.filter(path=>path===a.receiptPath).length,
  guardRemains:f.rows.has(a.guardPath),
 }).toEqual({outcomes:['rejected','rejected'],receiptWrites:0,guardRemains:true});
 expect(f.snapshot()).toEqual(before);
 expect(f.writes).toEqual([]);
});

it.each(['before decision','after decision'] as const)(
 'provenance audit: a same-owner maintenance write changes the identity pin %s',async phase=>{
  const f=fixture(),{a}=f;
  a.grant();
  if(phase==='after decision')await f.store.confirmVideoBillingUnblockAttempt(a.identityKey,a.command);
  const original=structuredClone(f.rows.get(a.identityPath)!);
  // No matching runtime writer was found. This represents a possible future repair or backfill.
  f.put(a.identityPath,{...original.data,syntheticMaintenanceNote:'version changes without rebinding'});
  const updated=f.rows.get(a.identityPath)!;
  expect(updated.data.uid).toEqual(original.data.uid);
  expect(updated.data.accountId).toEqual(original.data.accountId);
  expect(updated.created).toBe(original.created);
  expect(updated.updated).not.toBe(original.updated);
  const before=f.snapshot(),writes=f.writes.length;
  expect(await f.store.me(a.uid)).toMatchObject({id:a.accountId});
  await expect(f.freshStore().videoBillingUnblockAttemptReceipt(a.identityKey,a.command))
   .rejects.toMatchObject({code:'conflict'});
  await expect(f.freshStore().confirmVideoBillingUnblockAttempt(a.identityKey,a.command))
   .rejects.toMatchObject({code:'conflict'});
  expect(f.snapshot()).toEqual(before);
  expect(f.writes).toHaveLength(writes);
 },
);

it('provenance audit: existing bootstrap and a project write leave the enrolled identity and its receipt usable',async()=>{
 const f=fixture(),{a,b}=f;
 a.grant();
 const originalIdentity=structuredClone(f.rows.get(a.identityPath)!);
 expect(await f.store.bootstrap(a.uid)).toMatchObject({created:false});
 expect(await f.store.create(a.uid,randomUUID(),'Synthetic draft','text','synthetic content'))
  .toMatchObject({created:true});
 expect(f.rows.get(a.identityPath)).toEqual(originalIdentity);
 const afterProject=f.economicSnapshot(),bGuard=structuredClone(f.rows.get(b.guardPath));
 expect(await f.store.videoBillingUnblockAttemptReceipt(a.identityKey,a.command)).toMatchObject({state:'pending'});
 await f.store.confirmVideoBillingUnblockAttempt(a.identityKey,a.command);
 expect(await f.store.bootstrap(a.uid)).toMatchObject({created:false});
 expect(await f.freshStore().videoBillingUnblockAttemptReceipt(a.identityKey,a.command))
  .toMatchObject({state:'confirmed',replayed:true});
 expect(f.rows.get(a.identityPath)).toEqual(originalIdentity);
 expect(f.rows.get(b.guardPath)).toEqual(bGuard);
 expect(f.economicSnapshot()).toEqual(afterProject);
});
