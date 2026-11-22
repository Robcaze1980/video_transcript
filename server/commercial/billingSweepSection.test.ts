// LV-019.B phase 3 (plan step 3.4, A2): the isolated sweep section run inside the maintenance pass.
// Tests first: these pin the contract (outcomes, in-flight guard, budget, always-on heartbeat with an EXACT key set,
// stage allow-list, no sensitive data, import fence, wiring order) before the changes exist.
import {describe,expect,it,vi} from 'vitest';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join,relative,resolve} from 'node:path';
import {preProcessFile,createSourceFile,isCallExpression,isIdentifier,isStringLiteralLike,forEachChild,SyntaxKind,ScriptTarget,type Node} from 'typescript';
import {runBillingSweepSection} from './billingSweepSection';

const NOW=9_000_000;
const okSummary={ok:true,generatedAtMs:NOW,reported:3,byKind:{intent:2,terminal_recovery:0,hold:1,outbox:0,job_unknown:0,guard:0},attention:1,created:1,seen:0,cleared:0,superseded:0,kept:0,unverified:0,raced:0,corrupt:0,failures:[]};
const base=()=>({db:{} as never,root:{} as never,now:NOW,budgetMs:1000,log:vi.fn()});
const deferred=()=>{let resolve:(v:unknown)=>void=()=>{},reject:(e:unknown)=>void=()=>{};const promise=new Promise<unknown>((res,rej)=>{resolve=res;reject=rej;});return {promise,resolve,reject};};
/** The heartbeat is exactly one line with a fixed key set: event, timestamps, outcome and counts. */
const HEARTBEAT_KEYS=['attention','byKind','cleared','corrupt','created','durationMs','event','kept','outcome','raced','reported','seen','startedAtMs','superseded','unverified'];
const STAGES=['read','raise','clear','review','alert'] as const;

describe('runBillingSweepSection',()=>{
  it('is off by default: disabled never calls the sweep and still emits a heartbeat',async()=>{
    const sweep=vi.fn();
    const log=vi.fn();
    const result=await runBillingSweepSection({...base(),log,enabled:false,sweep});
    expect(sweep).not.toHaveBeenCalled();
    expect(result).toMatchObject({outcome:'disabled',reported:0,created:0});
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({event:'billing-sweep',outcome:'disabled',reported:0,created:0});
  });
  it('reports ok with only counts from the summary and logs one heartbeat with those counts',async()=>{
    const sweep=vi.fn(async()=>okSummary);
    const log=vi.fn();
    const result=await runBillingSweepSection({...base(),log,enabled:true,sweep});
    expect(sweep).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({outcome:'ok',reported:3,attention:1,created:1});
    expect(log).toHaveBeenCalledTimes(1);
    const line=JSON.parse(log.mock.calls[0][0]);
    expect(line.event).toBe('billing-sweep');
    expect(line.outcome).toBe('ok');
    expect(line.reported).toBe(3);
    expect(line.created).toBe(1);
    expect(line.byKind).toEqual(okSummary.byKind);
  });
  it('a resolved summary that is not ok is partial, never a hard failure',async()=>{
    const sweep=vi.fn(async()=>({...okSummary,ok:false,corrupt:1}));
    const result=await runBillingSweepSection({...base(),enabled:true,sweep});
    expect(result).toMatchObject({outcome:'partial',corrupt:1});
  });
  it('a thrown sweep becomes outcome error with its stage and never propagates',async()=>{
    const sweep=vi.fn(async()=>{throw Object.assign(new Error('boom with SECRET detail'),{stage:'read',summary:{...okSummary,ok:false,reported:2}});});
    const log=vi.fn();
    const result=await runBillingSweepSection({...base(),log,enabled:true,sweep});
    expect(result).toMatchObject({outcome:'error',stage:'read',reported:2});
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/boom|SECRET/);
  });
  it('stage is a closed allow-list: only the five known steps survive, anything else is dropped',async()=>{
    for(const stage of STAGES)expect((await runBillingSweepSection({...base(),enabled:true,sweep:async()=>{throw Object.assign(new Error('x'),{stage});}})).stage).toBe(stage);
    for(const stage of ['summary','config','nonsense','',5,{},null,undefined])expect((await runBillingSweepSection({...base(),enabled:true,sweep:async()=>{throw Object.assign(new Error('x'),{stage});}})).stage).toBeUndefined();
  });
  it('an error without a stage is still an error and carries no invented stage',async()=>{
    const sweep=vi.fn(async()=>{throw new Error('opaque');});
    const result=await runBillingSweepSection({...base(),enabled:true,sweep});
    expect(result).toMatchObject({outcome:'error'});
    expect(result.stage).toBeUndefined();
  });
  it('a non-object rejection never breaks the handler',async()=>{
    const sweep=vi.fn(async()=>{throw undefined;});
    const result=await runBillingSweepSection({...base(),enabled:true,sweep});
    expect(result).toMatchObject({outcome:'error',reported:0});
  });
  it('an exhausted budget returns timeout without throwing and leaves no live timer',async()=>{
    const sweep=vi.fn(()=>new Promise(()=>{}));
    const setSpy=vi.spyOn(globalThis,'setTimeout');
    const clearSpy=vi.spyOn(globalThis,'clearTimeout');
    try{
      const result=await runBillingSweepSection({...base(),budgetMs:20,enabled:true,sweep});
      expect(result).toMatchObject({outcome:'timeout',reported:0});
      const handle=(setSpy.mock.results.at(-1) as {value:unknown}).value;
      expect(clearSpy).toHaveBeenCalledWith(handle);
    }finally{setSpy.mockRestore();clearSpy.mockRestore();}
  });
  it('clears the budget timer on a successful run',async()=>{
    const clearSpy=vi.spyOn(globalThis,'clearTimeout');
    try{
      await runBillingSweepSection({...base(),budgetMs:1000,enabled:true,sweep:async()=>okSummary});
      expect(clearSpy).toHaveBeenCalled();
    }finally{clearSpy.mockRestore();}
  });
  it('a sweep that rejects after the budget already expired does not surface as an unhandled rejection',async()=>{
    const d=deferred();
    const result=await runBillingSweepSection({...base(),budgetMs:20,enabled:true,sweep:()=>d.promise});
    expect(result.outcome).toBe('timeout');
    expect(()=>d.reject(Object.assign(new Error('late SECRET'),{stage:'clear'}))).not.toThrow();
    await new Promise(r=>setTimeout(r,10));
  });
  it('logs a heartbeat on every outcome and never leaks ids or content from the summary',async()=>{
    const poisoned={...okSummary,accountId:'SECRET-ACCOUNT',rowId:'SECRET-ROW',uid:'SECRET-UID',generatedAtMs:12345,failures:['read']};
    for(const [enabled,sweep,expected] of [
      [true,vi.fn(async()=>poisoned),'ok'],
      [true,vi.fn(async()=>{throw new Error('x');}),'error'],
      [false,vi.fn(),'disabled'],
    ] as const){
      const log=vi.fn();
      const result=await runBillingSweepSection({...base(),log,enabled,sweep});
      expect(result.outcome).toBe(expected);
      expect(log).toHaveBeenCalledTimes(1);
      const raw=log.mock.calls[0][0];
      expect(JSON.parse(raw).event).toBe('billing-sweep');
      expect(raw).not.toMatch(/SECRET|12345/);
    }
  });
  it('fixes the EXACT heartbeat key set on every outcome (nothing extra, nothing missing)',async()=>{
    for(const [enabled,sweep,outcome] of [
      [true,async()=>okSummary,'ok'],
      [true,async()=>({...okSummary,ok:false}),'partial'],
      [true,async()=>{throw new Error('x');},'error'],
      [true,()=>new Promise(()=>{}),'timeout'],
      [false,()=>new Promise(()=>{}),'disabled'],
    ] as const){
      const log=vi.fn();
      await runBillingSweepSection({...base(),log,enabled,budgetMs:15,sweep:sweep as never});
      const parsed=JSON.parse(log.mock.calls[0][0]);
      expect(Object.keys(parsed).sort()).toEqual(HEARTBEAT_KEYS);
      expect(parsed.outcome).toBe(outcome);
      expect(parsed).not.toHaveProperty('stage');
    }
  });
  it('sanitizes counts: a negative, fractional, non-finite or non-numeric value becomes 0 and only known kinds survive',async()=>{
    const sweep=vi.fn(async()=>({...okSummary,reported:-5,created:2.9,cleared:Number.POSITIVE_INFINITY,corrupt:'7',byKind:{...okSummary.byKind,intent:-1,rogue:9}}));
    const log=vi.fn();
    const result=await runBillingSweepSection({...base(),log,enabled:true,sweep});
    expect(result).toMatchObject({reported:0,created:2,cleared:0,corrupt:0});
    expect(result.byKind).toEqual({intent:0,terminal_recovery:0,hold:1,outbox:0,job_unknown:0,guard:0});
    expect(JSON.parse(log.mock.calls[0][0]).byKind).toEqual(result.byKind);
  });
  it('an unusable budget is refused as a config error without calling the sweep and still logs',async()=>{
    const sweep=vi.fn(async()=>okSummary);
    for(const budgetMs of [0,-1,1.5,60_001,Number.NaN]){
      const log=vi.fn();
      const result=await runBillingSweepSection({...base(),log,budgetMs,enabled:true,sweep});
      expect(result).toMatchObject({outcome:'error'});
      expect(result.stage).toBeUndefined();
      expect(log).toHaveBeenCalledTimes(1);
    }
    expect(sweep).not.toHaveBeenCalled();
  });
  it('a resolved value that is not a summary is an error, never a fake ok',async()=>{
    for(const value of [undefined,null,{},'ok',42,[]] as const){
      const log=vi.fn();
      const result=await runBillingSweepSection({...base(),log,enabled:true,sweep:vi.fn(async()=>value)});
      expect(result).toMatchObject({outcome:'error',reported:0});
      expect(result.stage).toBeUndefined();
      expect(log).toHaveBeenCalledTimes(1);
    }
  });
  it('a logger that throws never breaks the pass or the returned outcome',async()=>{
    const log=vi.fn(()=>{throw new Error('logger broke');});
    const result=await runBillingSweepSection({...base(),log,enabled:true,sweep:async()=>okSummary});
    expect(result).toMatchObject({outcome:'ok',reported:3});
    expect(log).toHaveBeenCalledTimes(1);
  });
  it('the default sweep is wired: an invalid clock is caught as error instead of throwing',async()=>{
    const result=await runBillingSweepSection({db:{} as never,root:{} as never,now:-1,enabled:true,budgetMs:100,log:vi.fn()});
    expect(result.outcome).toBe('error');
  });
});

describe('in-flight guard (one sweep per root at a time)',()=>{
  it('a second pass on the same root while the first is still running is skipped, and runs again once it finishes',async()=>{
    const d=deferred();
    const sweep=vi.fn(()=>d.promise);
    const first=runBillingSweepSection({db:{} as never,root:{path:'guard-a'} as never,now:NOW,budgetMs:1000,log:vi.fn(),enabled:true,sweep});
    const second=await runBillingSweepSection({db:{} as never,root:{path:'guard-a'} as never,now:NOW,budgetMs:1000,log:vi.fn(),enabled:true,sweep});
    expect(second).toMatchObject({outcome:'skipped',reported:0,created:0});
    expect(sweep).toHaveBeenCalledTimes(1);
    d.resolve(okSummary);
    expect(await first).toMatchObject({outcome:'ok'});
    expect(await runBillingSweepSection({db:{} as never,root:{path:'guard-a'} as never,now:NOW,budgetMs:1000,log:vi.fn(),enabled:true,sweep:async()=>okSummary})).toMatchObject({outcome:'ok'});
  });
  it('the guard is released when the REAL sweep finishes, not when the budget expires',async()=>{
    const d=deferred();
    const sweep=vi.fn(()=>d.promise);
    const timedOut=await runBillingSweepSection({db:{} as never,root:{path:'guard-b'} as never,now:NOW,budgetMs:5,log:vi.fn(),enabled:true,sweep});
    expect(timedOut).toMatchObject({outcome:'timeout'});
    expect(await runBillingSweepSection({db:{} as never,root:{path:'guard-b'} as never,now:NOW,budgetMs:1000,log:vi.fn(),enabled:true,sweep})).toMatchObject({outcome:'skipped'});
    expect(sweep).toHaveBeenCalledTimes(1);
    d.resolve(okSummary);
    await new Promise(r=>setTimeout(r,0));
    expect(await runBillingSweepSection({db:{} as never,root:{path:'guard-b'} as never,now:NOW,budgetMs:1000,log:vi.fn(),enabled:true,sweep:async()=>okSummary})).toMatchObject({outcome:'ok'});
  });
  it('never stays locked after an exception',async()=>{
    const sweep=vi.fn(async()=>{throw Object.assign(new Error('x'),{stage:'read'});});
    expect(await runBillingSweepSection({db:{} as never,root:{path:'guard-c'} as never,now:NOW,budgetMs:1000,log:vi.fn(),enabled:true,sweep})).toMatchObject({outcome:'error'});
    expect(await runBillingSweepSection({db:{} as never,root:{path:'guard-c'} as never,now:NOW,budgetMs:1000,log:vi.fn(),enabled:true,sweep:async()=>okSummary})).toMatchObject({outcome:'ok'});
  });
  it('keeps the guard per root: two different roots never block each other',async()=>{
    const a=deferred(),b=deferred();
    const first=runBillingSweepSection({db:{} as never,root:{path:'guard-d'} as never,now:NOW,budgetMs:1000,log:vi.fn(),enabled:true,sweep:()=>a.promise});
    const second=runBillingSweepSection({db:{} as never,root:{path:'guard-e'} as never,now:NOW,budgetMs:1000,log:vi.fn(),enabled:true,sweep:()=>b.promise});
    a.resolve(okSummary);b.resolve(okSummary);
    expect(await first).toMatchObject({outcome:'ok'});
    expect(await second).toMatchObject({outcome:'ok'});
  });
  it('skipped still emits its heartbeat with the exact key set',async()=>{
    const d=deferred();
    const log=vi.fn();
    void runBillingSweepSection({db:{} as never,root:{path:'guard-f'} as never,now:NOW,budgetMs:1000,log:vi.fn(),enabled:true,sweep:()=>d.promise});
    await runBillingSweepSection({db:{} as never,root:{path:'guard-f'} as never,now:NOW,budgetMs:1000,log,enabled:true,sweep:()=>d.promise});
    const parsed=JSON.parse(log.mock.calls[0][0]);
    expect(parsed.outcome).toBe('skipped');
    expect(Object.keys(parsed).sort()).toEqual(HEARTBEAT_KEYS);
    d.resolve(okSummary);
  });
});

describe('the sweep section keeps its import fence',()=>{
  const serverRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const commercialRoot=join(serverRoot,'commercial');
  const entry=join(commercialRoot,'billingSweepSection.ts');
  // Fed from parts so this test file itself does not name the operator modules (another fence forbids that mention).
  const FORBIDDEN=new Set(['firestore'+'Backend','firestore'+'Ai','accountBilling'+'Client','billingFairQueue','billingNextAttemptMigration',...['Http','Config','Local'].map(s=>'billing'+'Operator'+s),'billing'+'SweepSection','cloudFiles'+'Runtime']);
  const ALLOWED_BARE=/^(node:|firebase-admin($|\/))/;
  const EXT=['.ts','.tsx','.mts','.cts','.js','.mjs','.cjs','.jsx'];

  /** TypeScript-level scan: literal import/export-from/import type/import()/require() plus a flag for non-literal dynamic ones. */
  const scan=(text:string)=>{
    const specifiers=preProcessFile(text,true,false).importedFiles.map(f=>f.fileName);
    const sf=createSourceFile('scan.ts',text,ScriptTarget.Latest,true);
    let nonLiteralDynamic=false;
    const visit=(node:Node)=>{
      if(isCallExpression(node)){
        const isRequire=isIdentifier(node.expression)&&node.expression.text==='require';
        const isImportCall=node.expression.kind===SyntaxKind.ImportKeyword;
        if((isRequire||isImportCall)&&!(node.arguments.length>0&&isStringLiteralLike(node.arguments[0])))nonLiteralDynamic=true;
      }
      forEachChild(node,visit);
    };
    forEachChild(sf,visit);
    return {specifiers,nonLiteralDynamic};
  };
  /** Canonicalizes a relative specifier against its file: both with and without extension resolve to the same real path. */
  const canonical=(fromFile:string,spec:string)=>{
    const base=resolve(dirname(fromFile),spec);
    if(EXT.some(e=>base.endsWith(e)))return base;
    for(const e of EXT)if(existsSync(base+e))return base+e;
    if(existsSync(base))return base;
    return base+'.ts';
  };
  const closure=()=>{
    const seen=new Set<string>(),queue=[entry],nonLiteral:string[]=[];
    while(queue.length){
      const file=queue.shift()!;
      if(seen.has(file))continue;
      seen.add(file);
      const {specifiers,nonLiteralDynamic}=scan(readFileSync(file,'utf8'));
      if(nonLiteralDynamic)nonLiteral.push(relative(commercialRoot,file));
      for(const spec of specifiers)if(spec.startsWith('./')||spec.startsWith('../'))queue.push(canonical(file,spec));
    }
    return {seen,nonLiteral};
  };

  it('walks every transitive import and stays inside server/commercial with an exact, frozen set',()=>{
    expect(existsSync(entry)).toBe(true);
    const names=[...closure().seen].map(f=>relative(commercialRoot,f).split('\\').join('/')).sort();
    expect(names).toEqual(['billingPendingAlerts.ts','billingPendingReport.ts','billingPendingSweep.ts','billingSweepSection.ts']);
    for(const file of closure().seen)expect(file.startsWith(commercialRoot)).toBe(true);
  });
  it('no module reachable from the section imports a write path, the billing mode or anything outside its fence',()=>{
    for(const file of closure().seen){
      const {specifiers}=scan(readFileSync(file,'utf8'));
      for(const spec of specifiers){
        if(spec.startsWith('./')||spec.startsWith('../')){
          const target=canonical(file,spec);
          const name=relative(commercialRoot,target).split('\\').join('/').replace(/\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/,'');
          expect(FORBIDDEN.has(name),spec+' from '+relative(commercialRoot,file)+' resolves to '+name).toBe(false);
        }else{
          // Non-relative specifiers are only the two allowed bare packages; an alias or an unknown bare import is a leak.
          expect(ALLOWED_BARE.test(spec),'unexpected bare specifier '+spec+' in '+relative(commercialRoot,file)).toBe(true);
        }
      }
    }
  });
  it('rejects non-literal import()/require() specifiers that could hide a forbidden module',()=>{
    const hostile=[
      "const name='./'+'firestoreBackend';const m=await import(name);",
      "const m=require(process.env.M);",
      "const part='firestoreBackend';const m=await import('./'+part);",
    ];
    const clean=[
      "import {a} from './billingPendingSweep';",
      "const m=await import('./billingPendingReport');",
      "const m=require('./billingPendingAlerts');",
    ];
    for(const text of hostile)expect(scan(text).nonLiteralDynamic,text).toBe(true);
    for(const text of clean)expect(scan(text).nonLiteralDynamic,text).toBe(false);
  });
  it('catches hostile literal spellings: parent hop, concatenation, re-export and import type',()=>{
    // Each hostile source names a forbidden module in a way a naive regex could miss; the fence must resolve it.
    const hostile=[
      "import {a} from '../commercial/firestoreBackend';",
      "export {x} from '../commercial/firestoreBackend';"+";",
      "import type {A} from './firestoreAi';",
      "import {b} from './accountBillingClient';",
      "const m=await import('./billingFairQueue');",
    ];
    const analyze=(text:string)=>{
      const {specifiers}=scan(text);
      return specifiers.map(spec=>({spec,forbidden:FORBIDDEN.has(relative(commercialRoot,canonical(entry,spec)).split('\\').join('/').replace(/\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/,''))}));
    };
    for(const text of hostile)expect(analyze(text).some(r=>r.forbidden),text).toBe(true);
    // The canonicalization is stable whether the specifier carries the extension or not.
    expect(canonical(entry,'./billingPendingSweep')).toBe(canonical(entry,'./billingPendingSweep.ts'));
    // An extensionless specifier that resolves to a NON-`.ts` sibling must not be forced to `.ts` (a real file exists).
    expect(canonical(entry,'./billingSweepSection.emulator').endsWith('.mjs')).toBe(true);
    expect(relative(commercialRoot,canonical(entry,'../commercial/firestoreBackend'))).toBe('firestoreBackend.ts');
  });
  it('the closure itself declares no non-literal dynamic import',()=>{
    expect(closure().nonLiteral).toEqual([]);
  });
  it('the maintenance entry starts the sweep before the file/AI sections and awaits it after, behind its own flag',()=>{
    const runtime=readFileSync(join(commercialRoot,'cloudFilesRuntime.ts'),'utf8');
    // Enabled ONLY on the exact flag value; its own 20 s budget; started (not awaited) before the drains.
    expect(runtime).toMatch(/const sweepPromise=runBillingSweepSection\(\{[\s\S]*?budgetMs:20000/);
    expect(runtime).toMatch(/enabled:process\.env\.VISTAVO_BILLING_SWEEP==='1'/);
    const start=runtime.indexOf('const sweepPromise=runBillingSweepSection(');
    const fileDrain=runtime.indexOf('const fileDrain=await drainCloudFiles(');
    const aiDrain=runtime.indexOf('const aiDrain=await runtime.nudgeAi(');
    const awaited=runtime.indexOf('await sweepPromise');
    expect(start).toBeGreaterThan(-1);
    expect(start).toBeLessThan(fileDrain);
    expect(fileDrain).toBeLessThan(aiDrain);
    expect(aiDrain).toBeLessThan(awaited);
    // The status code and `failed` count depend only on the file and AI sections.
    expect(runtime).toMatch(/const failed=fileDrain\.failed\+\(aiDrain\?\.failures\.length\?\?0\);res\.writeHead\(failed\?503:200/);
    // The static import is a deliberate decision, documented in a comment in the entry.
    expect(runtime).toMatch(/import \{runBillingSweepSection\} from '\.\/billingSweepSection';/);
    expect(runtime).toMatch(/static import/);
  });
});