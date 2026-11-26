// LV-019.B phase 2, piece B: read-only report of every non-terminal billing row.
// The reader is exercised against an in-memory stub of the Firestore query surface;
// the real emulator test is still pending (see docs/specs/LV-019-B-conciliacion-fase2-barrido-diseno.md).
import {describe,expect,it,vi} from 'vitest';
import {buildPendingReport,normalizePending,PENDING_SOURCES,readPendingReport,type PendingRow} from './billingPendingReport';

type Doc={id:string;data:Record<string,unknown>};
function stubRoot(collections:Record<string,Doc[]>,log:string[]=[],duplicateBoundary=false){
  return {
    collection(name:string){
      const docs=collections[name]??[];
      const build=(states:string[]|null,after:string|null,limit:number|null)=>({
        where(field:string,op:string,value:string|string[]){const list=Array.isArray(value)?value:[value];log.push(`where:${name}:${field}:${op}:${list.join('|')}`);return build(list,after,limit);},
        orderBy(field:string){log.push(`orderBy:${name}:${field}`);return build(states,after,limit);},
        startAfter(snapshot:{id:string}){log.push(`startAfter:${name}`);return build(states,snapshot.id,limit);},
        limit(n:number){log.push(`limit:${name}:${n}`);return build(states,after,n);},
        async get(){
          log.push(`get:${name}`);
          let rows=docs.filter(d=>!states||states.includes(String(d.data.state))).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
          if(after!==null)rows=rows.filter(d=>d.id>after!);
          let page=limit===null?rows:rows.slice(0,limit);
          if(duplicateBoundary&&after!==null&&page.length&&rows.length<docs.length)page=[docs.find(d=>d.id===after)!,...page];
          return {docs:page.map(d=>({id:d.id,data:()=>d.data}))};
        }
      });
      return build(null,null,null);
    }
  };
}
const NOW=10_000_000;
const row=(over:Partial<PendingRow>):PendingRow=>({kind:'intent',id:'a',state:'reserve_pending',createdAtMs:1000,nextAttemptAt:null,attempts:0,lastErrorCode:null,accountId:null,malformed:false,...over});

describe('synthetic voice conflicts',()=>{
  it('omits the query and the count unless the caller explicitly opts in under the marked fixture gate',async()=>{
    const collection='localVoiceReserveConflicts',id='11111111-1111-4111-8111-111111111111',log:string[]=[];
    const get=vi.fn(async()=>({exists:true,get:(field:string)=>({
      marker:id,purpose:'review-contract-synthetic-v1',project:'demo-vistavo-ledger',localRequestKeyIndex:1,
    })[field]}));
    const root={...stubRoot({[collection]:[{id,data:{protocol:1,state:'needs_review',createdAtMs:1,lastErrorCode:'conflict',accountId:id}}]},log),
      parent:{path:'vistavo_review_contract_synthetic'},id,
      firestore:{projectId:'demo-vistavo-ledger',databaseId:'(default)',_settings:{servicePath:'127.0.0.1',port:8185,ssl:false}},get,
    };
    vi.stubEnv('NODE_ENV','test');vi.stubEnv('FIRESTORE_EMULATOR_HOST','127.0.0.1:8185');vi.stubEnv('LV_VOICE_C1_FIXTURE','1');
    try{
      const base=await readPendingReport(root as any,NOW);
      expect(base.byKind).not.toHaveProperty('voice_reserve_conflict');
      expect(log).not.toContain('get:'+collection);
      expect(get).not.toHaveBeenCalled();
      const options={includeLocalVoiceConflicts:true} as const;
      vi.stubEnv('LV_VOICE_C1_FIXTURE','0');
      await expect(readPendingReport(root as any,NOW,options)).rejects.toThrow('invalid local voice fixture');
      expect(get).not.toHaveBeenCalled();
      vi.stubEnv('LV_VOICE_C1_FIXTURE','1');
      get.mockResolvedValueOnce({exists:false,get:()=>undefined});
      await expect(readPendingReport(root as any,NOW,options)).rejects.toThrow('invalid local voice fixture');
      expect(log).not.toContain('get:'+collection);
      const scoped=await readPendingReport(root as any,NOW,options);
      expect(scoped.byKind.voice_reserve_conflict).toBe(1);
      expect(scoped.attention).toMatchObject([{kind:'voice_reserve_conflict',id,accountId:null,attention:'needs_review'}]);
    }finally{vi.unstubAllEnvs();}
  });
});

describe('normalizePending',()=>{
  it('keeps a valid row and never copies identity material',()=>{
    const r=normalizePending('outbox','job-1',{state:'retry_wait',createdAtMs:5,nextAttemptAt:9,attempts:3,lastErrorCode:'conflict',accountId:'11111111-1111-4111-8111-111111111111',identityKey:'secret-key',uid:'u1',email:'x@y.z'});
    expect(r).toMatchObject({kind:'outbox',id:'job-1',state:'retry_wait',createdAtMs:5,attempts:3,lastErrorCode:'conflict',malformed:false});
    expect(JSON.stringify(r)).not.toMatch(/secret-key|"uid"|email|identityKey/);
  });
  it('marks malformed data instead of dropping or trusting it',()=>{
    expect(normalizePending('intent','x',{state:'reserve_pending',createdAtMs:1}).malformed).toBe(false);
    expect(normalizePending('intent','x',{state:'reserve_pending',createdAtMs:'soon'}).malformed).toBe(true);
    expect(normalizePending('intent','x',{createdAtMs:1}).malformed).toBe(true);
    expect(normalizePending('intent','x',{state:'reserve_pending',createdAtMs:1,lastErrorCode:'Bad Code!'}).malformed).toBe(true);
    for(const code of ['unavailable','insufficient','conflict','invalid','quota','not_found','forbidden','reserved_unconfirmed'])expect(normalizePending('outbox','x',{state:'pending',createdAtMs:1,lastErrorCode:code}).malformed).toBe(false);
    expect(normalizePending('outbox','x',{state:'pending',createdAtMs:1,lastErrorCode:'rate_limited'}).malformed).toBe(true);
    expect(normalizePending('intent','x',{state:'reserve_pending',createdAtMs:1,accountId:'not-a-uuid'}).malformed).toBe(true);
    expect(normalizePending('hold','x',undefined as unknown as Record<string,unknown>).malformed).toBe(true);
    expect(normalizePending('hold','x',{state:'pending',createdAtMs:-4}).malformed).toBe(true);
  });
});

describe('buildPendingReport',()=>{
  it('orders totally (unknown age first, then age, kind, id) and counts by kind',()=>{
    const report=buildPendingReport([
      row({id:'b',createdAtMs:2000}),row({id:'a',createdAtMs:2000}),row({kind:'hold',id:'z',state:'pending',createdAtMs:2000}),
      row({id:'old',createdAtMs:100}),row({id:'noage',createdAtMs:null}),
    ],NOW);
    expect(report.rows.map(r=>r.id)).toEqual(['noage','old','a','b','z']);
    expect(report.total).toBe(5);expect(report.byKind.intent).toBe(4);expect(report.byKind.hold).toBe(1);
    expect(report.oldest?.id).toBe('old');
    expect(report.rows.find(r=>r.id==='old')?.ageMs).toBe(NOW-100);
    expect(report.rows.find(r=>r.id==='noage')?.ageMs).toBeNull();
  });
  it('flags needs_review, malformed and unknown-age rows as attention, never as healthy',()=>{
    const report=buildPendingReport([
      row({id:'n',state:'needs_review'}),row({id:'m',malformed:true}),row({id:'u',createdAtMs:null}),row({id:'p'}),
    ],NOW);
    const by=Object.fromEntries(report.rows.map(r=>[r.id,r.attention]));
    expect(by).toEqual({n:'needs_review',m:'malformed',u:'unknown_age',p:'pending'});
    expect(report.attention.map(r=>r.id).sort()).toEqual(['m','n','u']);
  });
  it('removes exact duplicates from overlapping reads and is deterministic',()=>{
    const input=[row({id:'a'}),row({id:'a'}),row({id:'b',createdAtMs:5})];
    const one=buildPendingReport(input,NOW),two=buildPendingReport([...input].reverse(),NOW);
    expect(one.total).toBe(2);expect(one.rows).toEqual(two.rows);
  });
  it('an empty system reports zero without inventing rows',()=>{
    const report=buildPendingReport([],NOW);
    expect(report.total).toBe(0);expect(report.oldest).toBeNull();expect(report.attention).toEqual([]);
  });
});

describe('readPendingReport',()=>{
  it('lists every non-terminal row even when future rows outnumber the page size',async()=>{
    const intents:Doc[]=[];
    for(let i=0;i<130;i++)intents.push({id:'f'+String(i).padStart(4,'0'),data:{state:'release_pending',createdAtMs:5000+i,nextAttemptAt:NOW+86_400_000}});
    intents.push({id:'due-1',data:{state:'reserve_pending',createdAtMs:10,nextAttemptAt:NOW-1}},{id:'zdone',data:{state:'closed',createdAtMs:1}});
    const report=await readPendingReport(stubRoot({billingIntents:intents}) as never,NOW,{pageSize:25});
    expect(report.total).toBe(131);expect(report.rows[0].id).toBe('due-1');
    expect(report.rows.some(r=>r.id==='zdone')).toBe(false);
  });
  it('is strictly read-only and queries only non-terminal states',async()=>{
    const log:string[]=[];
    await readPendingReport(stubRoot({billingOutbox:[{id:'j1',data:{state:'settled',createdAtMs:1}},{id:'j2',data:{state:'retry_wait',createdAtMs:2}}]},log) as never,NOW,{pageSize:10});
    expect(log.every(l=>/^(where|orderBy|startAfter|limit|get):/.test(l))).toBe(true);
    // Only equality queries, each on one field (served by the automatic single-field index, no composite index): never `in`.
    // The D-4 guard is the one source without a `state`, so it is the only allowed exception.
    expect(log.filter(l=>l.startsWith('where:')).every(l=>{const[,name,field,op]=l.split(':');return field==='state'&&op==='=='||name==='billingGuards'&&field==='blocked'&&op==='==';})).toBe(true);
    expect(log.filter(l=>l.startsWith('where:billingGuards:')).every(l=>l==='where:billingGuards:blocked:==:true')).toBe(true);
    const states=log.filter(l=>l.startsWith('where:')).flatMap(l=>l.split(':')[4].split('|'));
    for(const terminal of ['settled','applied','closed','job_created','insufficient','succeeded','failed','cancelled','running'])expect(states).not.toContain(terminal);
    expect(states).toEqual(expect.arrayContaining(['reserve_pending','release_pending','needs_review','retry_wait','pending','unknown']));
  });
  it('covers every declared source and survives a duplicated boundary row',async()=>{
    const outbox:Doc[]=[];for(let i=0;i<7;i++)outbox.push({id:'o'+i,data:{state:'pending',createdAtMs:100+i}});
    const report=await readPendingReport(stubRoot({billingOutbox:outbox,jobs:[{id:'jx',data:{state:'unknown',createdAtMs:50}}]},[],true) as never,NOW,{pageSize:3});
    expect(report.total).toBe(8);expect(report.byKind.outbox).toBe(7);expect(report.byKind.job_unknown).toBe(1);
    expect(new Set(PENDING_SOURCES.map(s=>s.kind)).size).toBe(PENDING_SOURCES.length);
  });
  it('default mode cannot see a row without a usable state (documented limit); audit mode reports it as malformed',async()=>{
    const intents:Doc[]=[{id:'ok',data:{state:'reserve_pending',createdAtMs:5}},{id:'nostate',data:{createdAtMs:6}},{id:'num',data:{state:42,createdAtMs:7}},
      {id:'newstate',data:{state:'brand_new',createdAtMs:8}},{id:'done',data:{state:'closed',createdAtMs:1}},{id:'done2',data:{state:'job_created',createdAtMs:1}}];
    const fast=await readPendingReport(stubRoot({billingIntents:intents}) as never,NOW,{pageSize:2});
    expect(fast.rows.map(r=>r.id)).toEqual(['ok']);
    const audited=await readPendingReport(stubRoot({billingIntents:intents}) as never,NOW,{pageSize:2,audit:true});
    expect(audited.rows.map(r=>r.id).sort()).toEqual(['newstate','nostate','num','ok']);
    expect(audited.rows.find(r=>r.id==='ok')?.attention).toBe('pending');
    for(const id of ['nostate','num','newstate'])expect(audited.rows.find(r=>r.id===id)?.attention).toBe('malformed');
  });
  it('audit mode treats any recovery row that is not pending as unexpected and never audits jobs',async()=>{
    const log:string[]=[];
    const report=await readPendingReport(stubRoot({billingIntentTerminalRecovery:[{id:'r1',data:{state:'pending',createdAtMs:3}},{id:'r2',data:{state:'resolved',createdAtMs:4}}],
      jobs:[{id:'j1',data:{state:'running',createdAtMs:1}},{id:'j2',data:{state:'unknown',createdAtMs:2}}]},log) as never,NOW,{audit:true});
    expect(report.rows.map(r=>r.id).sort()).toEqual(['j2','r1','r2']);
    expect(report.rows.find(r=>r.id==='r2')?.attention).toBe('malformed');
    expect(log.some(l=>l.startsWith('where:jobs:state:==:unknown'))).toBe(true);
  });
  it('rejects an invalid page size instead of guessing',async()=>{
    await expect(readPendingReport(stubRoot({}) as never,NOW,{pageSize:0})).rejects.toThrow();
    await expect(readPendingReport(stubRoot({}) as never,NOW,{pageSize:501})).rejects.toThrow();
  });
});
