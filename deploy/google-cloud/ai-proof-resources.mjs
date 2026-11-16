import fs from 'node:fs/promises';
import {cloudClient,project,projectNumber,region} from './cloudClient.mjs';

// Operator-only ephemeral proof infrastructure. Default is an offline plan, never an apply.
const args=process.argv.slice(2);if(args.some(v=>!['--apply','--cleanup'].includes(v)))throw Error('Only --apply and --cleanup are supported');
const apply=args.includes('--apply'),cleanup=args.includes('--cleanup'),out='outputs/vistavo-ai-cloud';
const account='vistavo-bootstrap@vistavo-prod.iam.gserviceaccount.com',member='serviceAccount:'+account;
const location=`projects/${project}/locations/${region}`,jobName=location+'/jobs/vistavo-ai-proof',jobUrl='https://run.googleapis.com/v2/'+jobName;
const labels={app:'vistavo',phase:'ai-proof',managedby:'codex-lv007-ai'};
const apiName=location+'/services/vistavo-files-api',apiUrl='https://run.googleapis.com/v2/'+apiName;
const saUrl='https://iam.googleapis.com/v1/projects/'+project+'/serviceAccounts/'+account;
const targets=[
 {id:'project',kind:'project',url:'https://cloudresourcemanager.googleapis.com/v1/projects/'+project,grants:[
  {role:'roles/datastore.user',condition:{title:'vistavo-ai-proof-default-database',description:'Ephemeral AI proof; default database only',expression:'resource.name == "projects/vistavo-prod/databases/(default)"'}},
  {role:'roles/serviceusage.serviceUsageConsumer'}]},
 {id:'media',kind:'bucket',url:'https://storage.googleapis.com/storage/v1/b/vistavo-prod-107404655346-media/iam',grants:[
  {role:'roles/storage.objectViewer',condition:{title:'vistavo-ai-proof-read-candidate-files',expression:'resource.name.startsWith("projects/_/buckets/vistavo-prod-107404655346-media/objects/candidate-files-v1/")'}}]},
 {id:'api',kind:'run',url:apiUrl,grants:[{role:'roles/run.invoker'}]},
 {id:'self',kind:'sa',url:saUrl,grants:[{role:'roles/iam.serviceAccountTokenCreator'}]},
];
if(!apply){console.log(JSON.stringify({apply:false,mode:cleanup?'cleanup':'prepare',project,job:jobName,identity:account,preserveIdentity:true,grants:targets.map(t=>({resource:t.id,roles:t.grants.map(g=>g.role)})),secretAccess:false,createKey:false,createSql:false,users:'managed separately by proof controller',vpc:'existing private network/subnet ALL_TRAFFIC'}));process.exit(0);}
await fs.mkdir(out,{recursive:true});
const file=out+'/ai-proof-resources-state.json';let state={project,jobName,labels,policies:{},job:{},identity:{},baselineComplete:false};
try{state=JSON.parse(await fs.readFile(file,'utf8'));if(state.project!==project||state.jobName!==jobName||JSON.stringify(state.labels)!==JSON.stringify(labels)||!state.policies||!state.job)throw Error('Proof state boundary');}catch(e){if(e.code!=='ENOENT')throw e;}
if(state.cleanupComplete&&!cleanup)throw Error('Proof already cleaned; refusing to re-grant temporary permissions');
const save=()=>fs.writeFile(file,JSON.stringify({...state,updatedAt:new Date().toISOString()},null,2));
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const same=(a,b)=>JSON.stringify(canonical(a??null))===JSON.stringify(canonical(b??null));
const c=await cloudClient(out+'/ai-proof-resources-journal.json');
async function optional(url,stage){const r=await c.request(url,'GET',undefined,stage);if(r.status===404)return null;if(r.status!==200)throw Error(stage+' HTTP '+r.status);return r.data;}
async function policy(target){
 if(target.kind==='project'||target.kind==='sa')return c.required(target.url+':getIamPolicy','POST',{options:{requestedPolicyVersion:3}},target.id+'-iam-read');
 return c.required(target.url+(target.kind==='bucket'?'?optionsRequestedPolicyVersion=3':':getIamPolicy?options.requestedPolicyVersion=3'),'GET',undefined,target.id+'-iam-read');
}
async function setPolicy(target,next){return c.required(target.url+(target.kind==='bucket'?'':':setIamPolicy'),target.kind==='bucket'?'PUT':'POST',target.kind==='bucket'?next:{policy:next},target.id+'-iam-'+(cleanup?'withdraw':'grant'));}
const matching=(binding,grant)=>binding.role===grant.role&&same(binding.condition,grant.condition);
function preserve(previous,current,removeExpected=false,target){
 for(const old of previous.bindings??[]){const retained=old.members.filter(m=>!(removeExpected&&m===member&&target.grants.some(g=>matching(old,g))));
  if(retained.length&&!current.bindings?.some(b=>b.role===old.role&&same(b.condition,old.condition)&&retained.every(m=>b.members.includes(m))))throw Error('Unrelated IAM member or condition lost');}
}
const identity=await c.required(saUrl,'GET',undefined,'proof-identity');
if(identity.email!==account||identity.projectId!==project||identity.disabled||identity.description!=='Vistavo dedicated vistavo-bootstrap candidate identity')throw Error('Proof identity ownership');
if(state.identity.uniqueId&&state.identity.uniqueId!==identity.uniqueId)throw Error('Proof identity changed');
state.identity={email:account,uniqueId:identity.uniqueId,preserve:true};await save();
const keys=await c.required(saUrl+'/keys?keyTypes=USER_MANAGED','GET',undefined,'proof-no-user-keys');if(keys.keys?.length)throw Error('Unexpected user-managed proof keys; no automatic deletion');
const api=await c.required(apiUrl,'GET',undefined,'proof-api');
if(api.name!==apiName||api.template?.serviceAccount!=='vistavo-files-api@vistavo-prod.iam.gserviceaccount.com'||api.ingress!=='INGRESS_TRAFFIC_INTERNAL_ONLY'||api.invokerIamDisabled===true||!/^https:\/\/vistavo-files-api-[a-z0-9-]+(?:\.[a-z0-9-]+)*\.run\.app$/.test(api.uri??''))throw Error('Private API boundary');
if(state.apiUid&&state.apiUid!==api.uid)throw Error('Private API identity changed');state.apiUid=api.uid;state.apiUri=api.uri;await save();
// A proof must not inherit provider credentials. Only policy metadata is read, never a secret value.
const secret='https://secretmanager.googleapis.com/v1/projects/'+project+'/secrets/vistavo-gemini-provider';
const secretMeta=await optional(secret,'proof-secret-metadata');
if(secretMeta){const p=await c.required(secret+':getIamPolicy?options.requestedPolicyVersion=3','GET',undefined,'proof-no-secret-access');if(p.bindings?.some(b=>b.members?.includes(member)))throw Error('Proof identity unexpectedly has secret access');}

if(!cleanup&&!state.baselineComplete){
 // Save ALL baselines before the first grant; a partial prepare can never invent its own baseline.
 const baselines={};for(const target of targets){const p=await policy(target);if(!p.etag)throw Error('IAM etag missing');if(p.bindings?.some(b=>b.members?.includes(member)))throw Error('Proof identity has preexisting grants: '+target.id);baselines[target.id]={baseline:p};}
 state.policies=baselines;state.baselineComplete=true;state.baselineAt=new Date().toISOString();await save();
}
if(!state.baselineComplete)throw Error('No baseline: cannot remove privileges or adopt resources');

async function inspectSavedOperation(field){
 const name=state.job[field];if(!name)return true;if(!name.startsWith(location+'/operations/'))throw Error('Proof operation boundary');
 const op=await c.required('https://run.googleapis.com/v2/'+name,'GET',undefined,'proof-'+field+'-inspect');
 if(!op.done){console.log(JSON.stringify({pending:true,operation:name,reenter:cleanup?'--cleanup --apply':'--apply',noResubmit:true}));return false;}
 if(op.error){state.job.failure={field,code:op.error.code};await save();throw Error('Recorded proof operation failed; inspect before retry');}
 state.job[field+'Done']=true;await save();return true;
}
if(cleanup&&state.job.createOperation&&!state.job.createOperationDone&&!await inspectSavedOperation('createOperation'))process.exit(0);
if(!await inspectSavedOperation(cleanup?'deleteOperation':'createOperation'))process.exit(0);
let job=await optional(jobUrl,'proof-job-read');
function owned(value){if(!state.job.createOperation&&!state.job.uid)throw Error('Unrecorded proof Job; inspect before adoption');if(value.name!==jobName||Object.entries(labels).some(([k,v])=>value.labels?.[k]!==v)||state.job.uid&&state.job.uid!==value.uid)throw Error('Refuse unowned or replaced proof Job');}
async function idle(value){
 owned(value);let token='';const pages=new Set(),executions=[];
 do{if(pages.has(token)||pages.size>100)throw Error('Unexpected proof pagination');pages.add(token);
  const list=await c.required(jobUrl+'/executions?pageSize=100'+(token?'&pageToken='+encodeURIComponent(token):''),'GET',undefined,'proof-executions-terminal');
  for(const x of list.executions??[]){const complete=x.conditions?.find(y=>y.type==='Completed'),counts=['succeededCount','failedCount','cancelledCount'].map(k=>x[k]??0);
   if(!x.name?.startsWith(jobName+'/executions/')||!x.completionTime||x.reconciling||Number(x.runningCount??0)!==0||!Number.isSafeInteger(x.taskCount)||x.taskCount<1||counts.some(n=>!Number.isSafeInteger(n)||n<0)||counts.reduce((a,b)=>a+b,0)<x.taskCount||!['CONDITION_SUCCEEDED','CONDITION_FAILED'].includes(complete?.state))throw Error('Proof execution active or not conclusively terminal');
   executions.push({name:x.name,uid:x.uid,startedAt:x.startTime,completedAt:x.completionTime,condition:complete.state,succeeded:x.succeededCount??0,failed:x.failedCount??0,cancelled:x.cancelledCount??0});
  }token=list.nextPageToken??'';
 }while(token);state.job.executions=executions;await save();
}
if(job)owned(job);
if(cleanup&&job&&!job.deleteTime)await idle(job);

for(const target of targets){
 const prior=state.policies[target.id]?.baseline;if(!prior?.etag)throw Error('Missing recorded baseline '+target.id);
 if(prior.bindings?.some(b=>b.members?.includes(member)))throw Error('Preexisting proof grants; refusing cleanup');
 const current=await policy(target);if(target.id==='api'&&current.bindings?.some(b=>b.members?.some(m=>m==='allUsers'||m==='allAuthenticatedUsers')))throw Error('API has unexpected public invoker');if(!current.etag)throw Error('IAM etag missing');const next=structuredClone(current);next.version=3;next.bindings??=[];
 for(const binding of current.bindings??[])if(binding.members?.includes(member)&&!target.grants.some(g=>matching(binding,g)))throw Error('Unrelated proof privilege requires inspection: '+target.id);
 if(cleanup){next.bindings=next.bindings.map(b=>target.grants.some(g=>matching(b,g))?{...b,members:b.members.filter(m=>m!==member)}:b).filter(b=>b.members.length);}
 else for(const grant of target.grants){
  if(next.bindings.some(b=>b.role===grant.role&&b.condition?.title===grant.condition?.title&&!same(b.condition,grant.condition)))throw Error('IAM condition conflict');
  let binding=next.bindings.find(b=>matching(b,grant));if(!binding){binding={...grant,members:[]};next.bindings.push(binding);}if(!binding.members.includes(member))binding.members.push(member);
 }
 if(!same(current.bindings??[],next.bindings)){state.policies[target.id].lastBeforeMutation=current;await save();await setPolicy(target,next);}
 const checked=await policy(target);preserve(current,checked,cleanup,target);
 if(cleanup){if(checked.bindings?.some(b=>b.members?.includes(member)))throw Error('Temporary privilege remains '+target.id);state.policies[target.id].withdrawn=true;}
 else for(const grant of target.grants)if(!checked.bindings?.some(b=>matching(b,grant)&&b.members.includes(member)))throw Error('Temporary grant missing '+target.id);
 state.policies[target.id].verifiedAt=new Date().toISOString();await save();
}

if(cleanup){
 if(job?.deleteTime){owned(job);if(!state.job.deleteOperationDone)throw Error('Deletion pending; inspect saved operation');job=null;}
 if(job){
  owned(job);if(!state.job.uid||job.uid!==state.job.uid||!job.etag||state.job.deleteIntent&&!state.job.deleteOperation)throw Error('Ambiguous proof deletion; inspect receipt');
  state.job.deleteIntent=true;state.job.beforeDelete={name:job.name,uid:job.uid,etag:job.etag,labels:job.labels};await save();
  const op=await c.required(jobUrl+'?etag='+encodeURIComponent(job.etag),'DELETE',undefined,'delete-owned-ai-proof-job');
  if(!op.name?.startsWith(location+'/operations/'))throw Error('Unexpected proof delete operation');state.job.deleteOperation=op.name;await save();
  if(!await inspectSavedOperation('deleteOperation'))process.exit(0);
 }
 const absent=await optional(jobUrl,'proof-job-absent');if(absent&&!absent.deleteTime)throw Error('Proof Job remains active');
 const kept=await c.required(saUrl,'GET',undefined,'proof-bootstrap-preserved');if(kept.uniqueId!==identity.uniqueId||kept.disabled)throw Error('Bootstrap was replaced or disabled');
 state.cleanupComplete=true;state.job.deletedOrAbsent=true;state.identity.preserved=true;state.cleanedAt=new Date().toISOString();await save();
 await fs.writeFile(out+'/ai-proof-cleanup.json',JSON.stringify({project,complete:true,temporaryGrantsRemoved:true,proofJobDeletedOrAbsent:true,preservedIdentity:account,identityUniqueId:kept.uniqueId,userManagedKeys:0,executions:state.job.executions??[],syntheticAuthUsers:'controller cleanup required',at:state.cleanedAt},null,2));
 console.log(JSON.stringify({complete:true,proofResourcesRemoved:true,bootstrapPreserved:true,usersCleanupSeparate:true}));process.exit(0);
}
if(state.cleanupComplete)throw Error('Proof already cleaned; do not silently re-grant temporary permissions');
const build=JSON.parse(await fs.readFile(out+'/build-ready.json','utf8'));
if(!/^us-central1-docker\.pkg\.dev\/vistavo-prod\/vistavo\/[a-z0-9-]+@sha256:[a-f0-9]{64}$/.test(build.image??''))throw Error('Proof image must be own pinned digest');
const image=build.image;const imageRemote=await c.required('https://artifactregistry.googleapis.com/v1/'+location+'/repositories/vistavo/dockerImages/'+encodeURIComponent(image.split('/').at(-1)),'GET',undefined,'proof-image-verified');if(imageRemote.uri!==image)throw Error('Pinned image not verified');
const body={labels,template:{labels,taskCount:1,parallelism:1,template:{serviceAccount:account,timeout:'3600s',maxRetries:0,executionEnvironment:'EXECUTION_ENVIRONMENT_GEN2',vpcAccess:{egress:'ALL_TRAFFIC',networkInterfaces:[{network:'projects/'+project+'/global/networks/vistavo-private',subnetwork:'projects/'+project+'/regions/'+region+'/subnetworks/vistavo-us-central1'}]},containers:[{name:'proof',image,command:['node'],args:['--no-network-family-autoselection','cloud-dist/aiProof.js'],env:[{name:'VISTAVO_PROJECT_ID',value:project},{name:'VISTAVO_FILES_MODE',value:'proof'},{name:'VISTAVO_PROOF_API',value:api.uri}],resources:{limits:{cpu:'2',memory:'4Gi'}}}]}}};
if(!job){
 if(state.job.createIntent)throw Error('Earlier proof create submission ambiguous; inspect operations rather than resubmit');state.job.createIntent=true;state.job.image=image;state.job.desired=body;await save();
 const op=await c.required('https://run.googleapis.com/v2/'+location+'/jobs?jobId=vistavo-ai-proof','POST',body,'create-owned-ai-proof-job');
 if(!op.name?.startsWith(location+'/operations/'))throw Error('Unexpected proof create operation');state.job.createOperation=op.name;await save();if(!await inspectSavedOperation('createOperation'))process.exit(0);job=await optional(jobUrl,'proof-job-confirm');
}
if(!job)throw Error('Proof Job missing after create');owned(job);if(!state.job.uid){state.job.uid=job.uid;await save();}if(job.deleteTime)throw Error('Proof Job is deleting');
const task=job.template?.template,container=task?.containers?.[0];
if(task?.serviceAccount!==account||task?.timeout!=='3600s'||Number(task.maxRetries??0)!==0||job.template?.taskCount!==1||job.template?.parallelism!==1||task?.vpcAccess?.egress!=='ALL_TRAFFIC'||task.vpcAccess.networkInterfaces?.[0]?.network!=='projects/'+project+'/global/networks/vistavo-private'||task.vpcAccess.networkInterfaces?.[0]?.subnetwork!=='projects/'+project+'/regions/'+region+'/subnetworks/vistavo-us-central1'||task.containers?.length!==1||container.image!==image||!same(container.command,['node'])||!same(container.args,body.template.template.containers[0].args)||!same(container.env,body.template.template.containers[0].env)||container.resources?.limits?.cpu!=='2'||container.resources?.limits?.memory!=='4Gi'||container.volumeMounts?.length||task.volumes?.length||job.reconciling||job.terminalCondition?.state!=='CONDITION_SUCCEEDED')throw Error('Proof Job configuration differs or is not ready');
const jp=await c.required(jobUrl+':getIamPolicy?options.requestedPolicyVersion=3','GET',undefined,'proof-job-not-public');if(jp.bindings?.some(b=>b.members?.some(m=>m==='allUsers'||m==='allAuthenticatedUsers')))throw Error('Proof Job has public invoker');
state.job.uid=job.uid;state.job.image=image;state.job.ready=true;state.ready=true;await save();
await fs.writeFile(out+'/ai-proof-ready.json',JSON.stringify({project,name:job.name,uid:job.uid,image,apiUri:api.uri,account,vpc:'ALL_TRAFFIC existing private subnet',secretAccess:false,at:new Date().toISOString()},null,2));
console.log(JSON.stringify({ready:true,job:jobName,proofIdentity:account,secretAccess:false,executionOverridesRequired:true}));
