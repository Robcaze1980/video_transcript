import {describe,it,expect,vi,afterEach} from 'vitest';
import {readFile} from 'node:fs/promises';
import {threeFixesPlan,assertThreeFixesBoundary,recordedProofMutation,threeFixesSummary,assertDigitalZeroObservation} from './cloudThreeFixesProbe';
import {digitalSilenceProofHash} from './digitalSilence';

const runId='11111111-1111-4111-8111-111111111111';
const env={VISTAVO_PROJECT_ID:'vistavo-prod',CLOUD_RUN_JOB:'vistavo-files-validate',VISTAVO_FILES_MODE:'validate',VISTAVO_CLOSE_PROOF_ID:runId};
afterEach(()=>{vi.unstubAllGlobals();vi.resetAllMocks();vi.doUnmock('./cloudFilesRuntime');});
describe('controlled three-fixes operational probe',()=>{
 it('is inert when imported and never creates managed runtime or fetches metadata',async()=>{
  vi.resetModules();const runtime=vi.fn(()=>{throw Error('Unexpected runtime creation');}),fetch=vi.fn(()=>{throw Error('Unexpected network request');});
  vi.doMock('./cloudFilesRuntime',()=>({cloudFilesRuntime:runtime}));vi.stubGlobal('fetch',fetch);
  await import('./cloudThreeFixesProbe');expect(runtime).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
 });
 it('fixes the project/job/mode and refuses credential-file or emulator escape routes',()=>{
  expect(assertThreeFixesBoundary(env)).toEqual(threeFixesPlan(runId));
  for(const change of [{VISTAVO_PROJECT_ID:'linguistvision-dev'},{CLOUD_RUN_JOB:'vistavo-ai-process'},{CLOUD_RUN_JOB:'vistavo-files-cleanup'},{VISTAVO_FILES_MODE:'ai'},{VISTAVO_FILES_MODE:'api'},{FIRESTORE_EMULATOR_HOST:'127.0.0.1:8185'},{FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099'},{GOOGLE_APPLICATION_CREDENTIALS:'synthetic.json'},{VISTAVO_CLOSE_PROOF_ID:'not-a-uuid'}])expect(()=>assertThreeFixesBoundary({...env,...change})).toThrow();
 });
 it('uses an existing validator identity whose plan grants original-prefix create/read while AI creation remains results-only',async()=>{
  const files=JSON.parse(await readFile(new URL('../../deploy/google-cloud/files.plan.json',import.meta.url),'utf8')),ai=JSON.parse(await readFile(new URL('../../deploy/google-cloud/ai.plan.json',import.meta.url),'utf8'));
  const prefix='projects/_/buckets/vistavo-prod-107404655346-media/objects/candidate-files-v1/',chunk=prefix+runId+'/chunks/0000',result=prefix+runId+'/results/'+runId+'/translation-en.txt',validator='serviceAccount:'+files.jobs.validate.account,runtime='serviceAccount:'+ai.identity.email;
  expect(files.project).toBe(env.VISTAVO_PROJECT_ID);expect(files.jobs.validate.name).toBe(env.CLOUD_RUN_JOB);expect(files.jobs.validate.role).toBe(env.VISTAVO_FILES_MODE);expect(files.jobs.validate.account).toBe('vistavo-files-validator@vistavo-prod.iam.gserviceaccount.com');
  // Test-only parser for the exact existing CEL subset; no eval or remote IAM call.
  const allowed=(plan:any,member:string,role:string,resource:string)=>plan.mediaBindings.filter((b:any)=>b.role===role&&b.members.includes(member)).some((b:any)=>{
   const expression=b.condition?.expression,starts=/^resource\.name\.startsWith\("([^"]+)"\)/.exec(expression??'');if(!starts||!resource.startsWith(starts[1]))return false;
   const rest=expression.slice(starts[0].length);if(rest==='')return true;
   const extract=/^ && resource\.name\.extract\("([^"]+)\{input\}\/results\/"\) != "" && \((.+)\)$/.exec(rest);if(!extract)throw Error('Unsupported IAM expression requires review');
   if(!resource.startsWith(extract[1])||!resource.slice(extract[1].length).match(/^[^/]+\/results\//))return false;
   const suffixes=extract[2].split(' || ').map(term=>{const value=/^resource\.name\.endsWith\("([^"]+)"\)$/.exec(term);if(!value)throw Error('Unsupported suffix condition');return value[1];});return suffixes.some(suffix=>resource.endsWith(suffix));
  });
  expect(allowed(files,validator,'roles/storage.objectCreator',chunk)).toBe(true);expect(allowed(files,validator,'roles/storage.objectViewer',chunk)).toBe(true);
  expect(allowed(ai,runtime,'roles/storage.objectCreator',chunk)).toBe(false);expect(allowed(ai,runtime,'roles/storage.objectCreator',result)).toBe(true);
  const source=await readFile(new URL('./cloudThreeFixesProbe.ts',import.meta.url),'utf8');expect(source).toContain("runtime=await cloudFilesRuntime('validate')");expect(source).not.toContain("runtime=await cloudFilesRuntime('ai')");
  expect(threeFixesPlan(runId).kind).toBe('vistavo-three-fixes-proof-v3');
 });
 it('builds exactly two stable synthetic upload/job identities with no caller scope expansion',()=>{
  const plan=threeFixesPlan(runId);expect(plan.maxJobs).toBe(2);expect(plan.maxProviderCalls).toBe(1);expect(new Set(Object.values(plan.jobKeys)).size).toBe(2);expect(plan).toEqual(threeFixesPlan(runId));
  expect(plan.ownerUid).not.toBe(plan.otherUid);expect(plan.ownerUid.length).toBeLessThanOrEqual(128);
  for(const invalid of ['../candidate-v1','11111111-1111-4111-8111-11111111111A','',undefined])expect(()=>threeFixesPlan(invalid as string)).toThrow();
 });
 it('observes a durable digital_zero release only with full proof/hash/source and its own local attempt, never a provider attempt',()=>{
  const inputId='22222222-2222-4222-8222-222222222222',proof={version:'digital-zero-pcm-f64le-v1',sourceBucket:'vistavo-prod-107404655346-media',sourceKey:'candidate-files-v1/'+inputId+'/video.mp4',sourceGeneration:'1',sourceSize:3787,sourceSha256:'a'.repeat(64),audioTracks:1,channels:1,sampleRate:16000,frameCount:32000,sampleCount:32000,byteCount:256000,pcmSha256:'b'.repeat(64),format:'pcm_f64le',decodeComplete:true},hash=digitalSilenceProofHash(proof),job={state:'failed',failureCode:'no_speech',noSpeechSubtype:'digital_zero',invocationPhase:'local_check',attemptId:null,leaseUntil:null,digitalSilenceAttemptId:runId,digitalSilenceProof:proof,digitalSilenceProofHash:hash,reconciliationRef:'digital-zero:'+hash,inputStorage:{bucket:proof.sourceBucket,key:proof.sourceKey,generation:proof.sourceGeneration,size:proof.sourceSize,sha256:proof.sourceSha256},inputSha256:proof.sourceSha256};
  expect(assertDigitalZeroObservation(job,inputId)).toMatchObject({proofHash:hash,attemptId:runId});
  for(const change of [{state:'succeeded'},{digitalSilenceProofHash:'c'.repeat(64)},{digitalSilenceAttemptId:null},{noSpeechReceiptHash:'fabricated-provider-receipt'},{invocationPhase:'invoking'},{inputStorage:{...job.inputStorage,generation:'2'}}])expect(()=>assertDigitalZeroObservation({...job,...change},inputId)).toThrow();
 });
 function journal(options:{failCreate?:boolean;failAck?:boolean}={}){
  const intents=new Map<string,unknown>(),events:string[]=[];
  const control={collection:(name:string)=>{expect(name).toBe('intents');return {doc:(label:string)=>({create:async(value:unknown)=>{events.push('intent:'+label);if(options.failCreate||intents.has(label))throw Error('Exclusive intent rejected');intents.set(label,value);},update:async()=>{events.push('ack:'+label);if(options.failAck)throw Error('Synthetic acknowledgement loss');}})};}};
  return {control:control as unknown as Parameters<typeof recordedProofMutation>[0],events,intents};
 }
 it('commits an exclusive intent before a mutation and refuses duplicate execution',async()=>{
  const c=journal(),work=vi.fn(async()=>{c.events.push('mutation');return 'created-id';});
  await expect(recordedProofMutation(c.control,'enqueue-speech',work)).resolves.toBe('created-id');expect(c.events).toEqual(['intent:enqueue-speech','mutation','ack:enqueue-speech']);
  await expect(recordedProofMutation(c.control,'enqueue-speech',work)).rejects.toThrow('Exclusive intent rejected');expect(work).toHaveBeenCalledTimes(1);
 });
 it('never starts mutation if intent persistence fails and never retries an ambiguous mutation',async()=>{
  const c=journal({failCreate:true}),work=vi.fn(async()=>true);await expect(recordedProofMutation(c.control,'upload-speech-begin',work)).rejects.toThrow();expect(work).not.toHaveBeenCalled();
  const d=journal(),ambiguous=vi.fn(async()=>{throw Error('Synthetic commit acknowledgement lost');});await expect(recordedProofMutation(d.control,'enqueue-silent',ambiguous)).rejects.toThrow();
  expect(d.events).toEqual(['intent:enqueue-silent']);await expect(recordedProofMutation(d.control,'enqueue-silent',ambiguous)).rejects.toThrow();expect(ambiguous).toHaveBeenCalledTimes(1);
 });
 it('preserves a completed mutation with lost journal acknowledgement and prohibits another paid attempt',async()=>{
  const c=journal({failAck:true}),work=vi.fn(async()=>true);await expect(recordedProofMutation(c.control,'enqueue-speech',work)).rejects.toThrow('Synthetic acknowledgement loss');
  await expect(recordedProofMutation(c.control,'enqueue-speech',work)).rejects.toThrow('Exclusive intent rejected');expect(work).toHaveBeenCalledTimes(1);
 });
 it('rejects mutation labels outside the fixed relative journal namespace',async()=>{
  const c=journal(),work=vi.fn(async()=>true);for(const label of ['../other','source/other','A','x'.repeat(81)])await expect(recordedProofMutation(c.control,label,work)).rejects.toThrow();expect(c.events).toEqual([]);expect(work).not.toHaveBeenCalled();
 });
 it('emits only whitelisted operational counts and never error bodies, credentials or transcript text',()=>{
  const sentinel='DO_NOT_LOG_SYNTHETIC_BODY_OR_CREDENTIAL',summary=threeFixesSummary({runId,result:'PASS',stage:'done',checks:['sources-ready',sentinel],providerCalls:1,oldGenerations404:9,markers:14,downloadCount:5,deniedGcsReads:0,errorCode:sentinel,...{token:sentinel,body:sentinel,stack:sentinel}});
  expect(JSON.stringify(summary)).not.toContain(sentinel);expect(summary.checks).toEqual(['sources-ready']);expect(summary.errorCode).toBe('UNCLASSIFIED');expect(summary.directProviderRequests).toBe(0);expect(summary.nativeAuth).toBe('loopback-stub-not-human-login');
  expect(threeFixesSummary({runId:'malformed',providerCalls:-1,errorCode:NaN}).runId).toBe(null);expect(threeFixesSummary({errorCode:NaN}).errorCode).toBe('UNCLASSIFIED');
 });
});
