import {describe,expect,it} from 'vitest';
import {AI_BILLING_PROFILE,AI_CATALOG_VERSION,AI_STORAGE_LIMIT,AI_TEXT_BUDGET,AI_TEXT_FILE_MAX,AI_VOICE_BUDGET,artifactPlan,artifactPlanHash,simulatedAiPrice,storageQuota,validateArtifactManifest,validateArtifactPlan,type AiArtifactPlan,type AiArtifactReceipt} from './aiContracts';
const inputId='11111111-2222-3333-4444-555555555555',jobId='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const plan=()=>artifactPlan(jobId,inputId,'translation:en');
const receipts=(p:AiArtifactPlan):AiArtifactReceipt[]=>p.artifacts.map(a=>({name:a.name,key:a.key,mimeType:a.mimeType,generation:'900719925474099312345',size:4,sha256:'a'.repeat(64)}));
describe('AI private candidate artifact contracts',()=>{
 it('binds every text destination to input and Job before bytes, with no attempt-dependent path',()=>{
  const p=plan();expect(p.version).toBe(AI_CATALOG_VERSION);expect(p.budgetBytes).toBe(AI_TEXT_BUDGET);
  expect(p.artifacts.map(x=>x.name)).toEqual(['transcript-es.txt','transcript-es.srt','translation-en.txt','translation-en.srt','cues.json']);
  expect(new Set(p.artifacts.map(x=>x.key)).size).toBe(5);
  for(const item of p.artifacts){expect(item.key).toBe('candidate-files-v1/'+inputId+'/results/'+jobId+'/'+item.name);expect(item.maxBytes).toBe(AI_TEXT_FILE_MAX);}
  expect(artifactPlan('ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee',inputId,'translation:en').artifacts[0].key).not.toBe(p.artifacts[0].key);
 });
 it('uses one immutable WAV destination and a bounded32MiB budget for either standard voice',()=>{
  for(const op of ['narration:en:female','narration:en:male'] as const){const p=artifactPlan(jobId,inputId,op);expect(p.budgetBytes).toBe(AI_VOICE_BUDGET);expect(p.artifacts).toEqual([{name:'narration-en.wav',key:'candidate-files-v1/'+inputId+'/results/'+jobId+'/narration-en.wav',mimeType:'audio/wav',maxBytes:AI_VOICE_BUDGET}]);}
 });
 it('keeps candidate prices explicitly simulated and rejects non-verified duration or unsupported operation',()=>{
  expect(AI_BILLING_PROFILE).toEqual({mode:'simulation',unit:'test-unit'});expect(simulatedAiPrice('translation:en',20.01)).toBe(21);
  expect(simulatedAiPrice('narration:en:male',600)).toBe(1);
  for(const duration of [0,-1,NaN,Infinity,600.01])expect(()=>simulatedAiPrice('translation:en',duration)).toThrow();
  expect(()=>artifactPlan(jobId,inputId,'render:mp4' as never)).toThrow();expect(()=>artifactPlan('../job',inputId,'translation:en')).toThrow();
 });
 it('rounds the represented source duration up at the whole-second boundary',()=>{
  expect(simulatedAiPrice('translation:en',1.9999999999999998)).toBe(2);
  expect(simulatedAiPrice('translation:en',2)).toBe(2);
  expect(simulatedAiPrice('translation:en',2.0000000000000004)).toBe(3);
  expect(simulatedAiPrice('translation:en',2.0004)).toBe(3);
 });
 it('reconstructs persisted plans, rejecting weakened limits and path/config injection',()=>{
  const p=plan(),reordered={artifacts:p.artifacts.map(x=>({maxBytes:x.maxBytes,mimeType:x.mimeType,key:x.key,name:x.name})),budgetBytes:p.budgetBytes,operation:p.operation,inputId:p.inputId,jobId:p.jobId,version:p.version};
  expect(artifactPlanHash(reordered)).toBe(artifactPlanHash(p));expect(validateArtifactPlan(JSON.parse(JSON.stringify(p)))).toEqual(p);
  for(const changed of [{...p,budgetBytes:2*AI_TEXT_BUDGET},{...p,extra:'untrusted'},{...p,version:'anything'},{...p,artifacts:p.artifacts.map((a,i)=>i? a:{...a,key:a.key+'/../foreign'})}])expect(()=>validateArtifactPlan(changed)).toThrow();
 });
 it('accepts only a complete generation-bound manifest and normalizes order without rounding generation',()=>{
  const p=plan(),r=receipts(p),result=validateArtifactManifest(p,[...r].reverse());expect(result).toEqual(r);expect(result[0].generation).toBe('900719925474099312345');
  result[0].size=99;expect(r[0].size).toBe(4);
  const changed=[r.slice(0,-1),[...r.slice(0,-1),r[0]],r.map((a,i)=>i?a:{...a,key:a.key.replace(inputId,jobId)}),r.map((a,i)=>i?a:{...a,mimeType:'text/html'}),r.map((a,i)=>i?a:{...a,generation:9007199254740992}),r.map((a,i)=>i?a:{...a,sha256:'fake'}),r.map((a,i)=>i?a:{...a,size:0}),r.map((a,i)=>i?a:{...a,extra:'field'})];
  for(const bad of changed)expect(()=>validateArtifactManifest(p,bad)).toThrow();
 });
 it('enforces both per-file and aggregate budgets even when each individual file fits',()=>{
  const p=plan(),r=receipts(p);expect(()=>validateArtifactManifest(p,r.map(a=>({...a,size:220000})))).toThrowError('quota');
  expect(()=>validateArtifactManifest(p,r.map((a,i)=>i?a:{...a,size:AI_TEXT_FILE_MAX+1}))).toThrowError('invalid');
  const voice=artifactPlan(jobId,inputId,'narration:en:female');expect(validateArtifactManifest(voice,receipts(voice).map(a=>({...a,size:AI_VOICE_BUDGET})))[0].size).toBe(AI_VOICE_BUDGET);
 });
 it('accounts storage separately from money and rejects underflow, corruption, overflow and excess quota',()=>{
  const account={storageReservedBytes:100,storageCommittedBytes:50,credited:10,available:6,reserved:4,consumed:0};
  expect(storageQuota(account,-100,20)).toEqual({storageReservedBytes:0,storageCommittedBytes:70});expect(account.storageReservedBytes).toBe(100);
  expect(storageQuota({},1,0)).toEqual({storageReservedBytes:1,storageCommittedBytes:0});
  expect(()=>storageQuota(account,-101,0)).toThrowError('invariant');expect(()=>storageQuota({storageReservedBytes:'1'},0,0)).toThrowError('invariant');
  expect(()=>storageQuota({storageCommittedBytes:Number.MAX_SAFE_INTEGER},1,0,Number.MAX_SAFE_INTEGER)).toThrowError('invariant');
  expect(()=>storageQuota({storageReservedBytes:AI_STORAGE_LIMIT},1,0)).toThrowError('quota');
 });
});
