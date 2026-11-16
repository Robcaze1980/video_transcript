import {createHash} from 'node:crypto';
import {privateUuid,privateSha} from './privateObjectPlan';

export const AI_CATALOG_VERSION='ai-candidate-v1' as const;
export const AI_BILLING_PROFILE=Object.freeze({mode:'simulation' as const,unit:'test-unit' as const});
export const AI_TEXT_BUDGET=1024*1024;
export const AI_TEXT_FILE_MAX=256*1024;
export const AI_TEXT_WINDOW_MS=30_000;
export const AI_TEXT_MAX_DURATION_MS=600_000;
export const AI_TEXT_MAX_WINDOWS=Math.ceil(AI_TEXT_MAX_DURATION_MS/AI_TEXT_WINDOW_MS);
export const AI_VOICE_BUDGET=32*1024*1024;
export const AI_STORAGE_LIMIT=2*1024*1024*1024;
export type AiOperation='translation:en'|'narration:en:female'|'narration:en:male';
export type AiArtifactName='transcript-es.txt'|'transcript-es.srt'|'translation-en.txt'|'translation-en.srt'|'cues.json'|'narration-en.wav';
export type AiArtifactMime='text/plain; charset=utf-8'|'application/x-subrip; charset=utf-8'|'application/json; charset=utf-8'|'audio/wav';
export interface AiArtifactSpec {name:AiArtifactName;key:string;mimeType:AiArtifactMime;maxBytes:number}
export interface AiArtifactPlan {version:typeof AI_CATALOG_VERSION;jobId:string;inputId:string;operation:AiOperation;budgetBytes:number;artifacts:AiArtifactSpec[]}
export interface AiArtifactReceipt {name:AiArtifactName;key:string;mimeType:AiArtifactMime;generation:string;size:number;sha256:string}
export class AiContractFault extends Error {constructor(readonly code:'invalid'|'invariant'|'quota'){super(code);}}
export function aiOperation(value:unknown):AiOperation {
 if(value!=='translation:en'&&value!=='narration:en:female'&&value!=='narration:en:male')throw new AiContractFault('invalid');return value;
}
const textSpecs:readonly [AiArtifactName,AiArtifactMime][]=[
 ['transcript-es.txt','text/plain; charset=utf-8'],['transcript-es.srt','application/x-subrip; charset=utf-8'],
 ['translation-en.txt','text/plain; charset=utf-8'],['translation-en.srt','application/x-subrip; charset=utf-8'],
 ['cues.json','application/json; charset=utf-8'],
];
/** No attempts or client paths in names: all destinations exist in the plan before provider invocation. */
export function artifactPlan(jobId:string,inputId:string,operation:AiOperation):AiArtifactPlan {
 if(typeof jobId!=='string'||!privateUuid.test(jobId)||typeof inputId!=='string'||!privateUuid.test(inputId))throw new AiContractFault('invalid');
 aiOperation(operation);const text=operation==='translation:en',base='candidate-files-v1/'+inputId.toLowerCase()+'/results/'+jobId.toLowerCase()+'/';
 const specs:readonly [AiArtifactName,AiArtifactMime][]=text?textSpecs:[['narration-en.wav','audio/wav']];
 return {version:AI_CATALOG_VERSION,jobId:jobId.toLowerCase(),inputId:inputId.toLowerCase(),operation,budgetBytes:text?AI_TEXT_BUDGET:AI_VOICE_BUDGET,
  artifacts:specs.map(([name,mimeType])=>({name,key:base+name,mimeType,maxBytes:text?AI_TEXT_FILE_MAX:AI_VOICE_BUDGET}))};
}
function plain(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value)&&
 (Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);}
function fields(value:unknown,names:readonly string[]):asserts value is Record<string,unknown>{
 if(!plain(value)||Object.keys(value).length!==names.length||Object.keys(value).some(k=>!names.includes(k)))throw new AiContractFault('invalid');
}
/** Reconstruct the trusted plan so persisted/injected limits cannot weaken the profile. */
export function validateArtifactPlan(value:unknown):AiArtifactPlan {
 fields(value,['version','jobId','inputId','operation','budgetBytes','artifacts']);
 const expected=artifactPlan(value.jobId as string,value.inputId as string,aiOperation(value.operation));
 if(value.version!==expected.version||value.jobId!==expected.jobId||value.inputId!==expected.inputId||value.budgetBytes!==expected.budgetBytes||
  !Array.isArray(value.artifacts)||value.artifacts.length!==expected.artifacts.length)throw new AiContractFault('invalid');
 value.artifacts.forEach((item:unknown,index:number)=>{fields(item,['name','key','mimeType','maxBytes']);const e=expected.artifacts[index];
  if(item.name!==e.name||item.key!==e.key||item.mimeType!==e.mimeType||item.maxBytes!==e.maxBytes)throw new AiContractFault('invalid');});
 return expected;
}
export function artifactPlanHash(value:unknown){return createHash('sha256').update(JSON.stringify(validateArtifactPlan(value))).digest('hex');}
/** Candidate fixture units only. This does not define commercial narration pricing. */
export function simulatedAiPrice(operation:AiOperation,verifiedDurationSeconds:number):number {
 aiOperation(operation);if(!Number.isFinite(verifiedDurationSeconds)||verifiedDurationSeconds<=0||verifiedDurationSeconds>600)throw new AiContractFault('invalid');
 return operation==='translation:en'?Math.ceil(verifiedDurationSeconds):1;
}
/** All and only planned files, normalized to plan order, bounded individually and in aggregate. */
export function validateArtifactManifest(plan:AiArtifactPlan,value:unknown):AiArtifactReceipt[]{
 const trusted=validateArtifactPlan(plan);
 if(!Array.isArray(value)||value.length!==trusted.artifacts.length)throw new AiContractFault('invalid');
 const byName=new Map<string,AiArtifactReceipt>();let total=0;
 for(const item of value){fields(item,['name','key','mimeType','generation','size','sha256']);
  const spec=trusted.artifacts.find(s=>s.name===item.name);
  if(!spec||byName.has(spec.name)||item.key!==spec.key||item.mimeType!==spec.mimeType||typeof item.generation!=='string'||!/^[1-9]\d{0,30}$/.test(item.generation)||
   typeof item.size!=='number'||!Number.isSafeInteger(item.size)||item.size<1||item.size>spec.maxBytes||typeof item.sha256!=='string'||!privateSha.test(item.sha256))throw new AiContractFault('invalid');
  total+=item.size;if(!Number.isSafeInteger(total)||total>trusted.budgetBytes)throw new AiContractFault('quota');
  byName.set(spec.name,{name:spec.name,key:spec.key,mimeType:spec.mimeType,generation:item.generation,size:item.size,sha256:item.sha256});
 }
 return trusted.artifacts.map(spec=>byName.get(spec.name)!);
}
/** Return quota fields only; callers merge them with financial updates in the same transaction. */
export function storageQuota(account:unknown,reservedDelta:number,committedDelta:number,limit=AI_STORAGE_LIMIT){
 if(!plain(account)||![reservedDelta,committedDelta,limit].every(Number.isSafeInteger)||limit<1)throw new AiContractFault('invariant');
 const priorReserved=account.storageReservedBytes===undefined?0:account.storageReservedBytes,priorCommitted=account.storageCommittedBytes===undefined?0:account.storageCommittedBytes;
 if(typeof priorReserved!=='number'||typeof priorCommitted!=='number'||![priorReserved,priorCommitted].every(v=>Number.isSafeInteger(v)&&v>=0))throw new AiContractFault('invariant');
 const storageReservedBytes=priorReserved+reservedDelta,storageCommittedBytes=priorCommitted+committedDelta;
 if(![storageReservedBytes,storageCommittedBytes].every(v=>Number.isSafeInteger(v)&&v>=0)||!Number.isSafeInteger(storageReservedBytes+storageCommittedBytes))throw new AiContractFault('invariant');
 if(storageReservedBytes+storageCommittedBytes>limit)throw new AiContractFault('quota');return {storageReservedBytes,storageCommittedBytes};
}
