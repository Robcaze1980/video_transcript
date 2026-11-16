import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {cloudClient,project,projectNumber,region} from './cloudClient.mjs';

// Withdraw only the temporary proof permissions. Never delete the pre-existing bootstrap SA.
const out='outputs/vistavo-gcs-cloud',receiptFile=out+'/proof-cleanup.json';
if(process.argv.slice(2).some(v=>v!=='--apply'))throw Error('Only --apply is supported');
const apply=process.argv.includes('--apply'),member='serviceAccount:vistavo-bootstrap@vistavo-prod.iam.gserviceaccount.com';
const account='vistavo-bootstrap@vistavo-prod.iam.gserviceaccount.com';
const plan=JSON.parse(await fs.readFile(new URL('./files.plan.json',import.meta.url),'utf8'));
if(plan.project!==project||plan.projectNumber!==projectNumber||plan.region!==region||plan.cloudSqlForbidden!==true||plan.jobs.proof.account!==account||plan.proofSelfSigner.account!==account)throw Error('Proof cleanup plan boundary');
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const same=(a,b)=>JSON.stringify(canonical(a??null))===JSON.stringify(canonical(b??null));
const digest=x=>createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
const projectUrl='https://cloudresourcemanager.googleapis.com/v1/projects/'+project;
const mediaUrl='https://storage.googleapis.com/storage/v1/b/'+project+'-'+projectNumber+'-media/iam';
const run='https://run.googleapis.com/v2/',location=`projects/${project}/locations/${region}`;
const apiUrl=run+location+'/services/vistavo-files-api';
const saUrl='https://iam.googleapis.com/v1/projects/'+project+'/serviceAccounts/'+account;
const jobName=location+'/jobs/vistavo-files-proof',jobUrl=run+jobName;
function desired(bindings,role){const candidates=bindings.filter(b=>b.role===role&&b.members.includes(member));if(candidates.length!==1)throw Error('Expected single proof grant in plan: '+role);return {role,condition:candidates[0].condition};}
const targets=[
 {id:'project',url:projectUrl,kind:'project',grants:[desired(plan.projectBindings,'roles/datastore.user'),desired(plan.projectBindings,'roles/serviceusage.serviceUsageConsumer')]},
 {id:'media',url:mediaUrl,kind:'bucket',grants:[desired(plan.mediaBindings,'roles/storage.objectCreator'),desired(plan.mediaBindings,'roles/storage.objectViewer')]},
 {id:'api',url:apiUrl,kind:'run',grants:[{role:'roles/run.invoker'}]},
 {id:'selfSigner',url:saUrl,kind:'sa',grants:[{role:'roles/iam.serviceAccountTokenCreator'}]},
];
if(!apply){console.log(JSON.stringify({apply:false,project,principal:member,withdraw:targets.map(t=>({resource:t.id,roles:t.grants.map(g=>g.role)})),deleteOnly:jobName,preserve:account,baselineRequired:'first saved IAM policies before grants; no pre-existing exact member/role/condition',noUserDeletion:true,noSql:true}));process.exit(0);}
const foundation=JSON.parse(await fs.readFile(out+'/foundation-receipt.json','utf8'));
if(foundation.project!==project||!Array.isArray(foundation.previousPolicies))throw Error('Missing foundation baseline');
let deployment={project,resources:{},previousPolicies:[]};
try{deployment=JSON.parse(await fs.readFile(out+'/deploy-state.json','utf8'));if(deployment.project!==project||!deployment.resources||!Array.isArray(deployment.previousPolicies))throw Error('Invalid deployment baseline');}catch(e){if(e.code!=='ENOENT')throw e;}
let receipt={project,principal:member,startedAt:new Date().toISOString(),policies:{},job:{},identity:{},complete:false};
try{receipt=JSON.parse(await fs.readFile(receiptFile,'utf8'));if(receipt.project!==project||receipt.principal!==member||!receipt.policies||!receipt.job)throw Error('Cleanup receipt boundary');}catch(e){if(e.code!=='ENOENT')throw e;}
const persist=()=>fs.writeFile(receiptFile,JSON.stringify({...receipt,updatedAt:new Date().toISOString()},null,2));
const c=await cloudClient(out+'/proof-cleanup-journal.json');
async function optional(url,stage){const r=await c.request(url,'GET',undefined,stage);if(r.status===404)return null;if(r.status!==200)throw Error(stage+' HTTP '+r.status);return r.data;}
const identity=await c.required(saUrl,'GET',undefined,'proof-identity-before-cleanup');
if(identity.email!==account||identity.projectId!==project||identity.disabled)throw Error('Proof identity mismatch');
if(receipt.identity.uniqueId&&receipt.identity.uniqueId!==identity.uniqueId)throw Error('Proof identity changed');
receipt.identity={email:account,uniqueId:identity.uniqueId,preserve:true};await persist();
const keys=await c.required(saUrl+'/keys?keyTypes=USER_MANAGED','GET',undefined,'proof-user-keys-check');
if(keys.keys?.length)throw Error('Unexpected user-managed proof keys; stop for investigation, never delete keys automatically');

async function idle(job){
 if(job.name!==jobName||Object.entries(plan.labels).some(([k,v])=>job.labels?.[k]!==v)||job.uid!==deployment.resources[jobName]?.uid)throw Error('Refuse deletion of unowned/replaced proof Job');
 const pages=new Set();let token='';const executions=[];
 do{
  if(pages.has(token)||pages.size>100)throw Error('Unexpected execution pagination');pages.add(token);
  const list=await c.required(jobUrl+'/executions?pageSize=100'+(token?'&pageToken='+encodeURIComponent(token):''),'GET',undefined,'proof-executions-idle');
  for(const execution of list.executions??[]){
   if(!execution.name?.startsWith(jobName+'/executions/'))throw Error('Foreign execution in proof list');
   const completed=execution.conditions?.find(x=>x.type==='Completed');
   const counts=['succeededCount','failedCount','cancelledCount'].map(k=>execution[k]??0);
   if(!execution.completionTime||execution.reconciling||Number(execution.runningCount??0)!==0||
    !Number.isSafeInteger(execution.taskCount)||execution.taskCount<1||counts.some(x=>!Number.isSafeInteger(x)||x<0)||
    counts.reduce((a,b)=>a+b,0)<execution.taskCount||!['CONDITION_SUCCEEDED','CONDITION_FAILED'].includes(completed?.state))throw Error('Proof execution is running, pending, or not conclusively terminal');
   executions.push({name:execution.name,uid:execution.uid,completionTime:execution.completionTime,condition:completed.state});
  }
  token=list.nextPageToken??'';
 }while(token);
 receipt.job.executions=executions;receipt.job.uid=job.uid;receipt.job.labels=job.labels;await persist();
}
// A prior delete operation is inspected before any possible repeat of the request.
if(receipt.job.operation&&!receipt.job.operationDone){
 if(!receipt.job.operation.startsWith(location+'/operations/'))throw Error('Delete operation boundary');
 const op=await c.required(run+receipt.job.operation,'GET',undefined,'proof-delete-operation-inspect');
 if(!op.done){console.log(JSON.stringify({pending:true,operation:receipt.job.operation,reenter:'--apply; no repeated delete'}));process.exit(0);}
 if(op.error)throw Error('Saved proof deletion operation failed; inspect before retry');
 receipt.job.operationDone=true;await persist();
}
let job=await optional(jobUrl,'proof-job-before-cleanup');
if(job?.deleteTime&&receipt.job.operationDone){if(job.uid!==receipt.job.uid)throw Error('Deleted proof Job UID changed');job=null;}
if(job){if(job.deleteTime||receipt.job.deleteIntent&&!receipt.job.operation)throw Error('Proof Job deletion ambiguous; inspect operation before retry');await idle(job);}
else{receipt.job.absentBefore=true;await persist();}

for(const target of targets){
 const baseline=target.kind==='project'||target.kind==='bucket'?foundation.previousPolicies.find(p=>p.label===target.id)?.policy:deployment.previousPolicies.find(p=>p.url===target.url)?.policy;
 const read=()=>target.kind==='project'||target.kind==='sa'?c.required(target.url+':getIamPolicy','POST',{options:{requestedPolicyVersion:3}},'proof-'+target.id+'-iam-read'):c.required(target.url+(target.kind==='bucket'?'?optionsRequestedPolicyVersion=3':':getIamPolicy?options.requestedPolicyVersion=3'),'GET',undefined,'proof-'+target.id+'-iam-read');
 // The API may never have been created if deployment failed; an absent resource has no direct grant.
 if(target.kind==='run'&&!await optional(target.url,'proof-api-exists')){receipt.policies[target.id]={absent:true};await persist();continue;}
 const current=await read();if(!current.etag)throw Error('Policy lacks etag: '+target.id);
 const matches=(binding,grant)=>binding.role===grant.role&&same(binding.condition,grant.condition);
 for(const binding of current.bindings??[])if(binding.members?.includes(member)&&target.grants.some(g=>g.role===binding.role&&g.condition?.expression===binding.condition?.expression&&!same(g.condition,binding.condition)))throw Error('Target condition metadata drift; inspect before removal: '+target.id);
 const present=target.grants.filter(grant=>current.bindings?.some(b=>matches(b,grant)&&b.members?.includes(member)));
 if(present.length){
  if(!baseline)throw Error('Cannot prove prior absence without IAM baseline: '+target.id);
  for(const grant of present)if(baseline.bindings?.some(b=>matches(b,grant)&&b.members?.includes(member)))throw Error('Grant pre-existed; refusing removal: '+target.id+'/'+grant.role);
 }
 const next=structuredClone(current);next.version=3;
 next.bindings=(next.bindings??[]).map(binding=>target.grants.some(grant=>matches(binding,grant))?{...binding,members:binding.members.filter(m=>m!==member)}:binding).filter(binding=>binding.members.length);
 receipt.policies[target.id]??={};
 receipt.policies[target.id].before??=current;
 receipt.policies[target.id].baselineHash=baseline?digest(baseline):null;
 receipt.policies[target.id].remove=present;
 receipt.policies[target.id].intent=present.length?'remove-exact-member':'already-absent';await persist();
 if(present.length){
  const url=target.kind==='bucket'?target.url:target.url+':setIamPolicy';
  await c.required(url,target.kind==='bucket'?'PUT':'POST',target.kind==='bucket'?next:{policy:next},'proof-'+target.id+'-remove-only-added');
 }
 const verified=await read();
 for(const grant of target.grants)if(verified.bindings?.some(b=>matches(b,grant)&&b.members?.includes(member)))throw Error('Temporary grant remains: '+target.id);
 // Every prior non-target principal, role and condition must survive the etag-guarded write.
 for(const prior of current.bindings??[]){const keep=prior.members.filter(m=>m!==member||!target.grants.some(g=>matches(prior,g)));
  if(keep.length&&!verified.bindings?.some(b=>b.role===prior.role&&same(b.condition,prior.condition)&&keep.every(m=>b.members.includes(m))))throw Error('Unrelated IAM binding changed: '+target.id);
 }
 receipt.policies[target.id].verifiedHash=digest(verified);receipt.policies[target.id].verifiedAbsent=true;
 receipt.policies[target.id].remainingUnrelatedBootstrapBindings=(verified.bindings??[]).filter(b=>b.members?.includes(member));await persist();
}

job=await optional(jobUrl,'proof-job-recheck-before-delete');
if(job?.deleteTime&&receipt.job.operationDone){if(job.uid!==receipt.job.uid)throw Error('Deleted proof Job UID changed');job=null;}
if(job){
 await idle(job);if(!job.etag)throw Error('Proof Job missing etag');
 receipt.job.deleteIntent=true;receipt.job.previous={name:job.name,uid:job.uid,etag:job.etag,labels:job.labels};await persist();
 const operation=await c.required(jobUrl+'?etag='+encodeURIComponent(job.etag),'DELETE',undefined,'proof-job-delete-owned-only');
 if(!operation.name?.startsWith(location+'/operations/'))throw Error('Unexpected proof deletion operation');
 receipt.job.operation=operation.name;await persist();
 const checked=await c.required(run+operation.name,'GET',undefined,'proof-job-delete-poll-once');
 if(!checked.done){console.log(JSON.stringify({pending:true,operation:operation.name,reenter:'--apply; no repeated delete'}));process.exit(0);}
 if(checked.error)throw Error('Proof deletion failed; inspect receipt');receipt.job.operationDone=true;await persist();
}
const absent=await optional(jobUrl,'proof-job-absence');
if(absent&&!absent.deleteTime)throw Error('Proof Job still active after deletion');
const preserved=await c.required(saUrl,'GET',undefined,'proof-identity-preserved');
if(preserved.uniqueId!==identity.uniqueId||preserved.email!==account||preserved.disabled)throw Error('Bootstrap identity preservation failed');
receipt.job.deletedOrAbsent=true;receipt.identity.preserved=true;receipt.complete=true;await persist();
console.log(JSON.stringify({complete:true,temporaryGrantsRemoved:true,proofJobDeletedOrAbsent:true,preservedIdentity:account,syntheticAuthUsers:'orchestrator cleanup required',noSql:true}));
