import { Timestamp, type DocumentReference, type Firestore } from 'firebase-admin/firestore';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { LOCAL_VOICE_CONFLICTS } from './localVoiceFixture';
import { LOCAL_VOICE_CONFLICT_ALERTS,raiseLocalVoiceConflictAlerts,readLocalVoiceConflictReport } from './localVoiceConflictReview';

const rootA='11111111-1111-4111-8111-111111111111',rootB='22222222-2222-4222-8222-222222222222';
const attempt='33333333-3333-4333-8333-333333333333';
const collection='vistavo_review_contract_synthetic';
const conflict={protocol:1,state:'needs_review',lastErrorCode:'conflict',createdAtMs:10,accountId:'injected-owner'};

function fixture() {
  type Fields=Record<string,unknown>;
  type RecordVersion={data:Fields;createTime:Timestamp;updateTime:Timestamp};
  const data=new Map<string,RecordVersion>(),reads:string[]=[],writes:string[]=[];
  let sequence=1;
  const time=()=>Timestamp.fromMillis(sequence++);
  const put=(path:string,fields:Fields,create=false)=>{
    const updateTime=time(),createTime=(!create&&data.get(path)?.createTime)||updateTime;
    data.set(path,{data:structuredClone(fields),createTime,updateTime});
  };
  const snapshot=(path:string)=>{
    reads.push(path);
    const row=data.get(path);
    return {id:path.split('/').at(-1),ref:{path,firestore:db},exists:!!row,
      createTime:row?.createTime,updateTime:row?.updateTime,data:()=>row?.data,get:(name:string)=>row?.data[name]};
  };
  const db={
    projectId:'demo-vistavo-ledger',databaseId:'(default)',_settings:{servicePath:'127.0.0.1',port:8185,ssl:false},
    runTransaction:vi.fn(async callback=>callback({
      get:async (ref:{path:string})=>snapshot(ref.path),
      create:(ref:{path:string},fields:Fields)=>{
        if(data.has(ref.path))throw Error('already exists');
        writes.push(ref.path);
        put(ref.path,fields,true);
      },
      update:(ref:{path:string},fields:Fields)=>{
        writes.push(ref.path);
        put(ref.path,{...data.get(ref.path)!.data,...fields});
      },
    })),
  };
  function root(id:string) {
    const path=collection+'/'+id;
    return {id,path,parent:{path:collection},firestore:db,get:async()=>snapshot(path),collection(name:string){
      const prefix=path+'/'+name+'/';
      const query=(limit:number,after='')=>({
        startAfter(row:{id:string}){return query(limit,row.id);},
        async get(){
          reads.push(prefix);
          const keys=[...data.keys()].filter(key=>key.startsWith(prefix)&&key>prefix+after&&
            data.get(key)?.data.state==='needs_review').sort().slice(0,limit);
          return {docs:keys.map(snapshot)};
        },
      });
      return {doc:(key:string)=>({path:prefix+key}),where:()=>({orderBy:()=>({limit:query})})};
    }} as unknown as DocumentReference;
  }
  function mark(ref:DocumentReference) {
    put(ref.path,{marker:ref.id,purpose:'review-contract-synthetic-v1',project:'demo-vistavo-ledger',localRequestKeyIndex:1},true);
  }
  const a=root(rootA),b=root(rootB);
  mark(a);mark(b);
  const incident=(ref:DocumentReference)=>ref.path+'/'+LOCAL_VOICE_CONFLICTS+'/'+attempt;
  const alert=(ref:DocumentReference)=>ref.path+'/'+LOCAL_VOICE_CONFLICT_ALERTS+'/'+attempt;
  return {a,b,db:db as unknown as Firestore,transact:db.runTransaction,mark,put,data,reads,writes,incident,alert};
}

describe('local voice conflict review',()=>{
  beforeEach(()=>{
    vi.stubEnv('NODE_ENV','test');
    vi.stubEnv('LV_VOICE_C1_FIXTURE','1');
    vi.stubEnv('FIRESTORE_EMULATOR_HOST','127.0.0.1:8185');
  });
  afterEach(()=>vi.unstubAllEnvs());

  it('requires the flag and a marked root before any conflict query or alert transaction',async()=>{
    const f=fixture();
    f.put(f.incident(f.a),conflict);
    const report=await readLocalVoiceConflictReport(f.a);
    f.reads.length=0;
    vi.stubEnv('LV_VOICE_C1_FIXTURE','0');
    await expect(readLocalVoiceConflictReport(f.a)).rejects.toThrow('Invalid local voice fixture');
    await expect(raiseLocalVoiceConflictAlerts(f.db,f.a,report,20)).rejects.toThrow('Invalid local voice fixture');
    expect(f.reads).toEqual([]);
    expect(f.transact).not.toHaveBeenCalled();
    vi.stubEnv('LV_VOICE_C1_FIXTURE','1');
    f.data.delete(f.a.path);
    await expect(readLocalVoiceConflictReport(f.a)).rejects.toThrow('Invalid local voice fixture');
    expect(f.reads).toEqual([f.a.path]);
    expect(await raiseLocalVoiceConflictAlerts(f.db,f.a,report,20)).toEqual({created:0,seen:0,stale:1});
    expect(f.reads).toEqual([f.a.path,f.a.path]);
    expect(f.writes).toEqual([]);
  });

  it('rejects a report at another root even when that root contains an identical incident ID',async()=>{
    const f=fixture();
    f.put(f.incident(f.a),conflict);
    const report=await readLocalVoiceConflictReport(f.a);
    await expect(raiseLocalVoiceConflictAlerts(f.db,f.b,report,20)).rejects.toThrow('Invalid local voice report origin');
    f.put(f.incident(f.b),conflict);
    await expect(raiseLocalVoiceConflictAlerts(f.db,f.b,report,20)).rejects.toThrow('Invalid local voice report origin');
    await expect(raiseLocalVoiceConflictAlerts(f.db,f.a,structuredClone(report),20)).rejects.toThrow('Invalid local voice report origin');
    expect(f.transact).not.toHaveBeenCalled();
    expect(f.writes).toEqual([]);
    expect(await raiseLocalVoiceConflictAlerts(f.db,f.b,await readLocalVoiceConflictReport(f.b),20)).toEqual({created:1,seen:0,stale:0});
    expect(f.writes).toEqual([f.alert(f.b)]);
  });

  it('skips a deleted or recreated incident and a recreated root even when fields match',async()=>{
    const f=fixture();
    f.put(f.incident(f.a),conflict);
    const original=await readLocalVoiceConflictReport(f.a);
    f.data.delete(f.incident(f.a));
    expect(await raiseLocalVoiceConflictAlerts(f.db,f.a,original,20)).toEqual({created:0,seen:0,stale:1});
    f.put(f.incident(f.a),conflict,true);
    expect(await raiseLocalVoiceConflictAlerts(f.db,f.a,original,20)).toEqual({created:0,seen:0,stale:1});
    const fresh=await readLocalVoiceConflictReport(f.a);
    f.mark(f.a);
    expect(await raiseLocalVoiceConflictAlerts(f.db,f.a,fresh,20)).toEqual({created:0,seen:0,stale:1});
    expect(f.writes).toEqual([]);
  });

  it('paginates, discards owner fields and deduplicates alerts only in the local collection',async()=>{
    const f=fixture(),another='44444444-4444-4444-8444-444444444444';
    f.put(f.incident(f.a),conflict);
    f.put(f.a.path+'/'+LOCAL_VOICE_CONFLICTS+'/'+another,conflict);
    const report=await readLocalVoiceConflictReport(f.a,1);
    expect(report.attention).toEqual([attempt,another].map(id=>({id,kind:'voice_reserve_conflict',attention:'needs_review',accountId:null})));
    expect(await raiseLocalVoiceConflictAlerts(f.db,f.a,report,20)).toEqual({created:2,seen:0,stale:0});
    expect(await raiseLocalVoiceConflictAlerts(f.db,f.a,report,21)).toEqual({created:0,seen:2,stale:0});
    expect(f.data.get(f.alert(f.a))?.data).toMatchObject({rowId:attempt,accountId:null,seenCount:2,lastSeenAtMs:21,status:'open'});
    expect(f.writes.every(path=>path.startsWith(f.a.path+'/'+LOCAL_VOICE_CONFLICT_ALERTS+'/'))).toBe(true);
  });
});
