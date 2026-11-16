import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {cloudClient,project,region} from './cloudClient.mjs';

// Candidate resources only. The default path neither initializes ADC nor calls Google.
const out='outputs/vistavo-gcs-cloud',stateFile=out+'/deploy-state.json';
const plan=JSON.parse(await fs.readFile(new URL('./files.plan.json',import.meta.url),'utf8'));
if(plan.project!==project||plan.projectNumber!=='107404655346'||plan.region!==region||plan.cloudSqlForbidden!==true)throw Error('Deployment plan boundary');
const location=`projects/${project}/locations/${region}`,run='https://run.googleapis.com/v2/';
const scheduler='https://cloudscheduler.googleapis.com/v1/';
const labels=plan.labels,description='Managed candidate LV-007.GCS; no public access or AI execution';
const marker=JSON.stringify(labels),hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
if(!process.argv.includes('--apply')){
 console.log(JSON.stringify({apply:false,project,region,services:Object.values(plan.services).map(x=>x.name),jobs:Object.values(plan.jobs).map(x=>x.name),scheduler:{name:plan.scheduler.name,initial:'inert schedule six months ahead; immediately pause, verify, then set five-minute schedule while paused'},image:'required pinned digest from build-ready.json',noSql:true,noPublicIam:true}));
 process.exit(0);
}
if(process.argv.some(x=>x.startsWith('--')&&x!=='--apply'))throw Error('Unknown deployment option');
const ready=JSON.parse(await fs.readFile(out+'/build-ready.json','utf8'));
const imagePattern=/^us-central1-docker\.pkg\.dev\/vistavo-prod\/vistavo\/files@sha256:[a-f0-9]{64}$/;
if(typeof ready.image!=='string'||!imagePattern.test(ready.image))throw Error('Image must be own repository and immutable digest');
const image=ready.image,c=await cloudClient(out+'/deploy-journal.json');
// Never trust a free-form image tag or merely local build receipt.
const imageName=location+'/repositories/vistavo/dockerImages/'+encodeURIComponent(image.split('/').at(-1));
const remoteImage=await c.required('https://artifactregistry.googleapis.com/v1/'+imageName,'GET',undefined,'verify-image-digest');
if(remoteImage.uri!==image)throw Error('Artifact image URI mismatch');
let state={project,labels,resources:{}};
try{state=JSON.parse(await fs.readFile(stateFile,'utf8'));if(state.project!==project||JSON.stringify(state.labels)!==marker||!state.resources)throw Error('Deployment receipt boundary');}catch(e){if(e.code!=='ENOENT')throw e;}
async function save(){await fs.writeFile(stateFile,JSON.stringify({...state,at:new Date().toISOString()},null,2));}
function owned(value,name){
 if(value.name!==name||Object.entries(labels).some(([k,v])=>value.labels?.[k]!==v)||value.deleteTime)throw Error('Refuse unowned or deleted Cloud Run resource '+name);
 const old=state.resources[name];if(old?.uid&&old.uid!==value.uid)throw Error('Resource identity changed '+name);
}
function subset(expected,actual,path='resource'){
 if(expected&&typeof expected==='object'){
  if(Array.isArray(expected)){if(!Array.isArray(actual)||expected.length!==actual.length)throw Error('Configuration drift '+path);for(let n=0;n<expected.length;n++)subset(expected[n],actual[n],path+'.'+n);}
  else for(const [k,v]of Object.entries(expected))subset(v,actual?.[k],path+'.'+k);
 }else if(expected!==actual&&!(expected===false&&actual===undefined)&&!(expected===0&&actual===undefined))throw Error('Configuration drift '+path);
}
async function policy(url,additions,kind='run'){
 const read=kind==='sa'?await c.required(url+':getIamPolicy','POST',{options:{requestedPolicyVersion:3}},'read-private-iam'):await c.required(url+':getIamPolicy?options.requestedPolicyVersion=3','GET',undefined,'read-private-iam');
 if(read.bindings?.some(b=>b.members?.some(m=>m==='allUsers'||m==='allAuthenticatedUsers')))throw Error('Public binding found; stop rather than adopt');
 const next=structuredClone(read);next.version=3;next.bindings??=[];let changed=false;
 for(const addition of additions){
  if(!addition.members?.every(m=>m.startsWith('serviceAccount:')&&m.endsWith('@'+project+'.iam.gserviceaccount.com')))throw Error('Foreign IAM principal');
  let binding=next.bindings.find(b=>b.role===addition.role&&!b.condition);
  if(!binding){binding={role:addition.role,members:[]};next.bindings.push(binding);}
  for(const member of addition.members)if(!binding.members.includes(member)){binding.members.push(member);changed=true;}
 }
 if(changed){
  state.previousPolicies??=[];
  if(!state.previousPolicies.some(p=>p.url===url)){state.previousPolicies.push({url,kind,policy:read,at:new Date().toISOString()});await save();}
  await c.required(url+':setIamPolicy','POST',{policy:next},'add-private-iam');
 }
 const verified=kind==='sa'?await c.required(url+':getIamPolicy','POST',{options:{requestedPolicyVersion:3}},'verify-private-iam'):await c.required(url+':getIamPolicy?options.requestedPolicyVersion=3','GET',undefined,'verify-private-iam');
 if(verified.bindings?.some(b=>b.members?.some(m=>m==='allUsers'||m==='allAuthenticatedUsers')))throw Error('Unexpected public IAM readback');
 for(const addition of additions)if(!addition.members.every(m=>verified.bindings?.some(b=>b.role===addition.role&&!b.condition&&b.members.includes(m))))throw Error('IAM readback missing grant');
}
async function inspectOperation(name){
 const item=state.resources[name];if(!item?.operation)return true;
 const op=await c.required(run+item.operation,'GET',undefined,'inspect-deploy-operation');
 if(!op.done){console.log(JSON.stringify({pending:true,resource:name,operation:item.operation,reenter:'--apply inspects saved operation; no resubmit'}));return false;}
 if(op.error){item.failed={code:op.error.code,message:op.error.message};await save();throw Error('Recorded deployment operation failed for '+name);}
 delete item.operation;item.completed=true;await save();return true;
}
async function ensureRun(kind,id,body){
 const name=location+'/'+kind+'/'+id,url=run+name,old=state.resources[name];
 if(old?.failed)throw Error('Inspect previous failed deployment receipt before editing '+name);
 if(!await inspectOperation(name))return null;
 let current=await c.request(url,'GET',undefined,'read-'+id);
 if(current.status!==200&&current.status!==404)throw Error('Cloud Run read HTTP '+current.status);
 if(current.status===200){
  owned(current.data,name);
  await policy(url,[]);
  // Drift on resources labelled by this candidate is explicit, never silently ignored.
  try{subset(body,current.data);}catch(error){
   if(!old?.uid||old.uid!==current.data.uid)throw error;
   state.resources[name]={...old,intent:'update',desiredHash:hash(body),image};await save();
   const update=await c.required(url+(kind==='services'?'?updateMask=labels,template,ingress,invokerIamDisabled,scaling':''),'PATCH',{...body,name,etag:current.data.etag},'update-'+id);
   if(!update.name?.startsWith(location+'/operations/'))throw Error('Unexpected Cloud Run operation path');
   state.resources[name].operation=update.name;await save();
   if(!await inspectOperation(name))return null;
   current={status:200,data:await c.required(url,'GET',undefined,'verify-'+id)};
  }
 }else{
  if(old?.intent)throw Error('Ambiguous earlier submission; inspect Cloud Run operations before retrying '+id);
  state.resources[name]={intent:'create',desiredHash:hash(body),image};await save();
  const op=await c.required(run+location+'/'+kind+'?'+(kind==='services'?'serviceId':'jobId')+'='+id,'POST',body,'create-'+id);
  if(!op.name?.startsWith(location+'/operations/'))throw Error('Unexpected Cloud Run operation path');
  state.resources[name].operation=op.name;await save();
  if(!await inspectOperation(name))return null;
  current={status:200,data:await c.required(url,'GET',undefined,'verify-'+id)};
 }
 owned(current.data,name);subset(body,current.data);
 if(current.data.reconciling||current.data.terminalCondition?.state!=='CONDITION_SUCCEEDED')throw Error('Cloud Run not ready '+id);
 state.resources[name]={...state.resources[name],uid:current.data.uid,image,verified:true,uri:current.data.uri};await save();return current.data;
}
const baseEnv=mode=>[{name:'VISTAVO_PROJECT_ID',value:project},{name:'VISTAVO_FILES_MODE',value:mode}];
const container=(item,mode,proof=false)=>({name:'files',image,command:['node'],args:['--no-network-family-autoselection','cloud-dist/'+(proof?'filesProof':'filesEntry')+'.js'],env:baseEnv(mode),resources:{limits:{cpu:item.cpu,memory:item.memory}}});
const services={};
for(const [mode,item]of Object.entries(plan.services)){
 if(item.ingress!=='INGRESS_TRAFFIC_INTERNAL_ONLY'||item.name!=='vistavo-files-'+mode)throw Error('Service plan boundary');
 const body={labels,description,ingress:item.ingress,invokerIamDisabled:false,scaling:{minInstanceCount:0,maxInstanceCount:item.maxInstances},template:{labels,serviceAccount:item.account,executionEnvironment:'EXECUTION_ENVIRONMENT_GEN2',timeout:item.timeout,scaling:{minInstanceCount:0,maxInstanceCount:item.maxInstances},maxInstanceRequestConcurrency:item.concurrency,containers:[{...container(item,mode),ports:[{containerPort:8080}],resources:{...container(item,mode).resources,cpuIdle:true,startupCpuBoost:false}}]}};
 const value=await ensureRun('services',item.name,body);if(!value)process.exit(0);
 if(!/^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.run\.app$/.test(value.uri??''))throw Error('Unexpected private service URI');
 services[mode]=value;
 await policy(run+value.name,[{role:'roles/run.invoker',members:item.invokers}]);
}
for(const [mode,item]of Object.entries(plan.jobs)){
 const proof=mode==='proof';if(item.maxRetries!==0||item.name!=='vistavo-files-'+(mode==='validate'?'validate':mode))throw Error('Job plan boundary');
 const task={serviceAccount:item.account,timeout:item.timeout,maxRetries:0,executionEnvironment:'EXECUTION_ENVIRONMENT_GEN2',containers:[container(item,proof?'proof':item.role,proof)]};
 if(proof){if(item.vpcAccess?.egress!=='ALL_TRAFFIC'||item.vpcAccess.networkInterfaces?.[0]?.network!=='vistavo-private'||item.vpcAccess.networkInterfaces?.[0]?.subnetwork!=='vistavo-us-central1')throw Error('Proof network boundary');task.vpcAccess={egress:item.vpcAccess.egress,networkInterfaces:[{network:"projects/"+project+"/global/networks/vistavo-private",subnetwork:"projects/"+project+"/regions/"+region+"/subnetworks/vistavo-us-central1"}]};task.containers[0].env.push({name:'VISTAVO_PROOF_API',value:services.api.uri});}
 const value=await ensureRun('jobs',item.name,{labels,template:{labels,taskCount:1,parallelism:1,template:task}});if(!value)process.exit(0);
 await policy(run+value.name,item.invokersWithOverrides.length?[{role:'roles/run.jobsExecutorWithOverrides',members:item.invokersWithOverrides}]:[]);
}
const signer=plan.proofSelfSigner;
if(signer.account!==plan.jobs.proof.account||!['vistavo-files-proof','vistavo-bootstrap'].some(id=>signer.account===id+'@'+project+'.iam.gserviceaccount.com')||signer.member!=='serviceAccount:'+signer.account||signer.role!=='roles/iam.serviceAccountTokenCreator')throw Error('Signer boundary');
await policy('https://iam.googleapis.com/v1/projects/'+project+'/serviceAccounts/'+signer.account,[{role:signer.role,members:[signer.member]}],'sa');

const scheduleName=location+'/jobs/'+plan.scheduler.name,descriptionMarker='LV-007.GCS '+marker;
const scheduleUrl=scheduler+scheduleName;let schedule=await c.request(scheduleUrl,'GET',undefined,'read-scheduler');
if(schedule.status!==200&&schedule.status!==404)throw Error('Scheduler read HTTP '+schedule.status);
if(schedule.status===404){
 // Job.state is output-only. Stage a date six months away, pause, then set real cron.
 // Never stage the five-minute cron while the scheduler could still be enabled.
 const inertMonth=(new Date().getUTCMonth()+6)%12+1;
 const body={name:scheduleName,description:descriptionMarker,schedule:`0 0 1 ${inertMonth} *`,timeZone:'Etc/UTC',attemptDeadline:'120s',retryConfig:{retryCount:0},httpTarget:{uri:services.maintenance.uri+'/internal/maintenance',httpMethod:'POST',headers:{'Content-Type':'application/json'},body:Buffer.from('{}').toString('base64'),oidcToken:{serviceAccountEmail:plan.scheduler.account,audience:services.maintenance.uri}}};
 schedule={status:200,data:await c.required(scheduler+location+'/jobs','POST',body,'create-inert-scheduler')};
 state.scheduler={name:scheduleName,stage:'inert-created'};await save();
}
if(schedule.data.name!==scheduleName||schedule.data.description!==descriptionMarker||schedule.data.httpTarget?.oidcToken?.serviceAccountEmail!==plan.scheduler.account||schedule.data.httpTarget?.oidcToken?.audience!==services.maintenance.uri||schedule.data.httpTarget?.uri!==services.maintenance.uri+'/internal/maintenance')throw Error('Refuse unowned or changed Scheduler');
if(schedule.data.state==='ENABLED')await c.required(scheduleUrl+':pause','POST',{},'pause-scheduler');
const paused=await c.required(scheduleUrl,'GET',undefined,'verify-paused-scheduler');if(paused.state!=='PAUSED')throw Error('Scheduler is not paused');
if(paused.schedule!==plan.scheduler.schedule)await c.required(scheduleUrl+'?updateMask=schedule,timeZone','PATCH',{name:scheduleName,schedule:plan.scheduler.schedule,timeZone:plan.scheduler.timeZone},'configure-paused-schedule');
const checked=await c.required(scheduleUrl,'GET',undefined,'readback-scheduler');
if(checked.state!=='PAUSED'||checked.schedule!==plan.scheduler.schedule||checked.timeZone!==plan.scheduler.timeZone)throw Error('Scheduler readback mismatch');
state.scheduler={name:scheduleName,state:'PAUSED',schedule:checked.schedule};state.complete=true;await save();
await fs.writeFile(out+'/deploy-ready.json',JSON.stringify({project,image,services:Object.fromEntries(Object.entries(services).map(([k,v])=>[k,{name:v.name,uri:v.uri,uid:v.uid}])),jobs:Object.values(plan.jobs).map(j=>j.name),scheduler:state.scheduler,noSql:true,noPublicIam:true},null,2));
console.log(JSON.stringify({ready:true,image,services:Object.keys(services),scheduler:'PAUSED',proofRequired:true}));
