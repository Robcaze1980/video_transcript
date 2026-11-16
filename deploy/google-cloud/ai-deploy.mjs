import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {cloudClient,project,projectNumber,region} from './cloudClient.mjs';

// Operator-only deployment of this private candidate. No credentials/API calls without --apply.
const apply=process.argv.includes('--apply');
if(process.argv.slice(2).some(v=>v!=='--apply'))throw Error('Only --apply is supported');
const plan=JSON.parse(await fs.readFile(new URL('./ai.plan.json',import.meta.url),'utf8'));
const filesPlan=JSON.parse(await fs.readFile(new URL('./files.plan.json',import.meta.url),'utf8'));
const out='outputs/vistavo-ai-cloud',location=`projects/${project}/locations/${region}`,run='https://run.googleapis.com/v2/';
const oldLabels={app:'vistavo',phase:'files-candidate',managedby:'codex-lv007-gcs'};
const newLabels={app:'vistavo',phase:'ai-candidate',managedby:'codex-lv007-ai'};
const workerAccount='vistavo-runtime@vistavo-prod.iam.gserviceaccount.com';
const workerName=location+'/jobs/vistavo-ai-process';
const callers=['serviceAccount:vistavo-files-api@vistavo-prod.iam.gserviceaccount.com','serviceAccount:vistavo-files-maintenance@vistavo-prod.iam.gserviceaccount.com'];
const existing=[{kind:'services',id:'vistavo-files-api',role:'api'},{kind:'services',id:'vistavo-files-maintenance',role:'maintenance'},
 {kind:'jobs',id:'vistavo-files-validate',role:'validate'},{kind:'jobs',id:'vistavo-files-cleanup',role:'cleanup'}];
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const imagePattern=/^us-central1-docker\.pkg\.dev\/vistavo-prod\/vistavo\/files@sha256:[a-f0-9]{64}$/;
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
if(project!=='vistavo-prod'||projectNumber!=='107404655346'||region!=='us-central1'||plan.project!==project||plan.projectNumber!==projectNumber||plan.region!==region||!plan.cloudSqlForbidden||
 plan.job?.name!=='vistavo-ai-process'||plan.job.account!==workerAccount||plan.job.cpu!=='2'||plan.job.memory!=='4Gi'||plan.job.timeout!=='1800s'||plan.job.maxRetries!==0||plan.job.taskCount!==1||plan.job.parallelism!==1||
 !same([...plan.job.invokersWithOverrides].sort(),[...callers].sort())||!same(plan.labels,newLabels)||!same(filesPlan.labels,oldLabels))throw Error('AI deployment plan boundary');
if(!apply){console.log(JSON.stringify({apply:false,project,region,update:existing.map(x=>({resource:x.id,image:'verified build-ready immutable digest',preserveIdentityLabelsIamAndLimits:true,aiEnabled:['api','maintenance'].includes(x.role)})),createJob:{name:workerName,account:workerAccount,cpu:'2',memory:'4Gi',timeout:'1800s',maxRetries:0,taskCount:1,secretEnv:'VISTAVO_GEMINI_KEY from vistavo-gemini-provider:1 only on AI worker'},requires:['foundation complete and native queries','credentials complete with pinned version1','verified own Artifact Registry digest','old resource UID/labels'],schedulerChange:false,publicInvoker:false,noSql:true}));process.exit(0);}

let stage='input-validation';
try{
 const build=JSON.parse(await fs.readFile(out+'/build-ready.json','utf8'));
 const foundation=JSON.parse(await fs.readFile(out+'/ai-foundation.json','utf8'));
 const credential=JSON.parse(await fs.readFile(out+'/credentials-receipt.json','utf8'));
 const oldDeploy=JSON.parse(await fs.readFile('outputs/vistavo-gcs-cloud/deploy-state.json','utf8'));
 if(typeof build.image!=='string'||!imagePattern.test(build.image))throw Error('Pinned build image boundary');
 if(foundation.project!==project||foundation.worker!==workerAccount||foundation.complete!==true||
  !['artifacts-owner-input','artifacts-pending-purge'].every(id=>foundation.nativeQueries?.some(q=>q.id===id&&q.success===true))||
  !Array.isArray(foundation.operations)||foundation.operations.some(op=>!op.done)||
  Object.values(foundation.indexes??{}).length!==2||Object.values(foundation.indexes).some(i=>i.state!=='READY'||!i.name?.startsWith(`projects/${project}/databases/(default)/collectionGroups/artifacts/indexes/`)))throw Error('AI foundation/native index prerequisites incomplete');
 if(credential.project!==project||credential.projectNumber!==projectNumber||credential.complete!==true||credential.serviceAccountKeyFiles!==false||
  credential.key?.name!==`projects/${projectNumber}/locations/global/keys/vistavo-gemini-provider`||credential.key.serviceAccountBound!==false||
  ![`projects/${project}/secrets/vistavo-gemini-provider/versions/1`,`projects/${projectNumber}/secrets/vistavo-gemini-provider/versions/1`].includes(credential.secret?.version))throw Error('Owned restricted credentials/pinned version prerequisite');
 if(oldDeploy.project!==project||!same(oldDeploy.labels,oldLabels)||!oldDeploy.resources)throw Error('Old deployment baseline missing');
 const image=build.image,c=await cloudClient(out+'/ai-deploy-journal.json');
 const stateFile=out+'/ai-deploy-state.json';let state={project,labels:newLabels,image,resources:{},previousPolicies:[],complete:false};
 try{const saved=JSON.parse(await fs.readFile(stateFile,'utf8'));if(saved.project!==project||!same(saved.labels,newLabels)||!saved.resources||!Array.isArray(saved.previousPolicies))throw Error('AI deployment receipt boundary');state=saved;}catch(error){if(error.code!=='ENOENT')throw error;}
 const save=()=>fs.writeFile(stateFile,JSON.stringify({...state,image,updatedAt:new Date().toISOString()},null,2));
 state.complete=false;await save();
 stage='verify-image';const artifact=await c.required('https://artifactregistry.googleapis.com/v1/'+location+'/repositories/vistavo/dockerImages/'+encodeURIComponent(image.split('/').at(-1)),'GET',undefined,'ai-image-digest');if(artifact.uri!==image)throw Error('Artifact digest unconfirmed');
 const labelsMatch=(value,expected)=>Object.entries(expected).every(([k,v])=>value.labels?.[k]===v);
 async function policy(name,additions=[]){
  const url=run+name,prior=await c.required(url+':getIamPolicy?options.requestedPolicyVersion=3','GET',undefined,'ai-run-iam-read');
  if(prior.bindings?.some(b=>b.members?.some(m=>m==='allUsers'||m==='allAuthenticatedUsers')))throw Error('Public invoker drift refused');
  const next=structuredClone(prior);next.version=3;next.bindings??=[];let changed=false;
  for(const addition of additions){if(addition.role!=='roles/run.jobsExecutorWithOverrides'||!same([...addition.members].sort(),[...callers].sort()))throw Error('Unplanned AI invoker grant');
   let binding=next.bindings.find(b=>b.role===addition.role&&!b.condition);if(!binding){binding={role:addition.role,members:[]};next.bindings.push(binding);}
   for(const member of addition.members)if(!binding.members.includes(member)){binding.members.push(member);changed=true;}
  }
  if(changed){if(!prior.etag)throw Error('IAM etag missing');if(!state.previousPolicies.some(p=>p.name===name)){state.previousPolicies.push({name,policy:prior,at:new Date().toISOString()});await save();}
   await c.required(url+':setIamPolicy','POST',{policy:next},'ai-add-job-invokers');
   const actual=await c.required(url+':getIamPolicy?options.requestedPolicyVersion=3','GET',undefined,'ai-run-iam-readback');
   if(actual.bindings?.some(b=>b.members?.some(m=>m==='allUsers'||m==='allAuthenticatedUsers'))||!additions.every(a=>a.members.every(m=>actual.bindings?.some(b=>b.role===a.role&&!b.condition&&b.members.includes(m)))))throw Error('AI IAM readback failed');
   for(const old of prior.bindings??[])if(!actual.bindings?.some(b=>b.role===old.role&&same(b.condition??null,old.condition??null)&&old.members.every(m=>b.members.includes(m))))throw Error('Previous IAM grant was dropped');
  }
 }
 async function operation(name){const item=state.resources[name];if(!item?.operation)return true;
  if(!item.operation.startsWith(location+'/operations/'))throw Error('AI operation boundary');
  const op=await c.required(run+item.operation,'GET',undefined,'ai-deploy-operation-inspect');
  if(!op.done){console.log(JSON.stringify({pending:true,resource:name,operation:item.operation,reenter:'--apply inspects receipt without resubmitting'}));return false;}
  if(op.error){item.failed={code:op.error.code};await save();throw Error('Recorded AI deployment operation failed');}
  item.lastOperation=item.operation;delete item.operation;item.operationDone=true;await save();return true;
 }
 function owner(value,name,labels,baselineUid){if(value.name!==name||value.deleteTime||!labelsMatch(value,labels)||!baselineUid||value.uid!==baselineUid)throw Error('Unowned or replaced resource refused');}
 function oneContainer(template){if(!Array.isArray(template.containers)||template.containers.length!==1)throw Error('Unexpected container topology');return template.containers[0];}
 function envValue(container,name){const all=(container.env??[]).filter(e=>e.name===name);if(all.length!==1||all[0].valueSource)return undefined;return all[0].value;}
 function noSecrets(container,template){if((container.env??[]).some(e=>e.valueSource?.secretKeyRef||e.name==='VISTAVO_GEMINI_KEY'||/(?:API_KEY|TOKEN|SECRET|CREDENTIALS|PASSWORD)/i.test(e.name))||template?.volumes?.some(v=>v.secret))throw Error('Secret unexpectedly present in non-AI runtime');}
 function setEnv(container,name,value){container.env??=[];const all=container.env.filter(e=>e.name===name);if(all.length>1||all.some(e=>e.valueSource))throw Error('Environment drift');container.env=container.env.filter(e=>e.name!==name);container.env.push({name,value});}
 function ready(value){if(value.reconciling||value.terminalCondition?.state!=='CONDITION_SUCCEEDED')throw Error('Cloud Run is not conclusively ready');}
 async function submit(name,url,method,body,desired){
  const item=state.resources[name];if(item?.intent&&!item.operation&&!item.operationDone)throw Error('Ambiguous earlier AI deployment; inspect operation before retry');
  state.resources[name]={...item,intent:method==='POST'?'create':'update',operationDone:false,desiredHash:hash(desired),image,submittedAt:new Date().toISOString()};await save();
  const op=await c.required(url,method,body,'ai-deploy-'+name.split('/').at(-1));if(!op.name?.startsWith(location+'/operations/'))throw Error('Unexpected deployment operation');state.resources[name].operation=op.name;await save();return operation(name);
 }
 for(const item of existing){
  const name=location+'/'+item.kind+'/'+item.id,url=run+name;stage='existing-'+item.id;
  if(state.resources[name]?.failed)throw Error('Previous deployment failed; inspect before changing receipt');if(!await operation(name))process.exit(0);
  const current=await c.required(url,'GET',undefined,'ai-existing-resource-read');
  const baseline=oldDeploy.resources[name];owner(current,name,oldLabels,baseline?.uid);await policy(name);
  const task=item.kind==='services'?current.template:current.template?.template;if(!task)throw Error('Old task template unavailable');
  const expectedAccount=item.role==='validate'?'vistavo-files-validator@'+project+'.iam.gserviceaccount.com':item.role==='cleanup'?'vistavo-files-cleaner@'+project+'.iam.gserviceaccount.com':'vistavo-files-'+item.role+'@'+project+'.iam.gserviceaccount.com';
  if(task.serviceAccount!==expectedAccount)throw Error('Old runtime identity drift');
  const container=oneContainer(task);noSecrets(container,task);
  if(envValue(container,'VISTAVO_PROJECT_ID')!==project||envValue(container,'VISTAVO_FILES_MODE')!==item.role)throw Error('Old runtime mode/project drift');
  if(!same(container.command,['node'])||!same(container.args,['--no-network-family-autoselection','cloud-dist/filesEntry.js']))throw Error('Old entrypoint drift');
  if(item.kind==='services'&&(current.ingress!=='INGRESS_TRAFFIC_INTERNAL_ONLY'||current.invokerIamDisabled===true||(current.scaling?.minInstanceCount??0)!==0||(task.scaling?.minInstanceCount??0)!==0||
   current.scaling?.maxInstanceCount!==(item.role==='api'?2:1)||task.scaling?.maxInstanceCount!==(item.role==='api'?2:1)))throw Error('Private service/scaling drift');
  if(item.kind==='jobs'&&((task.maxRetries??0)!==0||current.template.taskCount!==1||current.template.parallelism!==1))throw Error('Old worker retry/task drift');
  const saved=state.resources[name];if(!saved?.uid){if(container.image!==baseline.image)throw Error('Old image differs from proven baseline');state.resources[name]={...saved,uid:current.uid,baselineImage:container.image,baseline:{labels:current.labels,template:current.template,...(item.kind==='services'?{ingress:current.ingress,invokerIamDisabled:current.invokerIamDisabled,scaling:current.scaling}:{})}};await save();}else if(saved.uid!==current.uid)throw Error('AI receipt identity drift');
  const enabled=['api','maintenance'].includes(item.role),hasDesired=container.image===image&&(!enabled||envValue(container,'VISTAVO_AI_ENABLED')==='1');
  if(!hasDesired){
   const template=structuredClone(current.template),changed=item.kind==='services'?template:template.template;oneContainer(changed).image=image;
   if(enabled)setEnv(oneContainer(changed),'VISTAVO_AI_ENABLED','1');if(item.kind==='services')delete template.revision;
   const body={name,etag:current.etag,labels:current.labels,template};
   const okay=await submit(name,url+(item.kind==='services'?'?updateMask=labels,template':''),'PATCH',body,body);if(!okay)process.exit(0);
  }
  const actual=await c.required(url,'GET',undefined,'ai-existing-resource-readback');owner(actual,name,oldLabels,baseline.uid);ready(actual);const verifiedTask=item.kind==='services'?actual.template:actual.template.template,verified=oneContainer(verifiedTask);noSecrets(verified,verifiedTask);
  if(verified.image!==image||verifiedTask.serviceAccount!==expectedAccount||envValue(verified,'VISTAVO_PROJECT_ID')!==project||envValue(verified,'VISTAVO_FILES_MODE')!==item.role||enabled&&envValue(verified,'VISTAVO_AI_ENABLED')!=='1')throw Error('Existing runtime image/env readback failed');
  if(item.kind==='services'&&(actual.ingress!=='INGRESS_TRAFFIC_INTERNAL_ONLY'||actual.invokerIamDisabled===true||(actual.scaling?.minInstanceCount??0)!==0))throw Error('Private service readback drift');await policy(name);
  state.resources[name]={...state.resources[name],verified:true,uid:actual.uid,image,uri:actual.uri,labels:actual.labels};await save();
 }
 stage='ai-job';if(state.resources[workerName]?.failed)throw Error('Previous AI job deployment failed');if(!await operation(workerName))process.exit(0);
 let response=await c.request(run+workerName,'GET',undefined,'ai-job-read');if(response.status!==200&&response.status!==404)throw Error('AI job read failed');
 const workerEnv=[{name:'VISTAVO_PROJECT_ID',value:project},{name:'VISTAVO_FILES_MODE',value:'ai'},{name:'VISTAVO_AI_ENABLED',value:'1'},{name:'VISTAVO_GEMINI_KEY',valueSource:{secretKeyRef:{secret:'vistavo-gemini-provider',version:'1'}}}];
 const task={serviceAccount:workerAccount,timeout:'1800s',maxRetries:0,executionEnvironment:'EXECUTION_ENVIRONMENT_GEN2',containers:[{name:'files',image,command:['node'],args:['--no-network-family-autoselection','cloud-dist/filesEntry.js'],env:workerEnv,resources:{limits:{cpu:'2',memory:'4Gi'}}}]};
 const desired={labels:newLabels,template:{labels:newLabels,taskCount:1,parallelism:1,template:task}};
 function verifyWorker(value){
  if(value.name!==workerName||value.deleteTime||!labelsMatch(value,newLabels)||value.template?.taskCount!==1||value.template?.parallelism!==1)throw Error('AI job ownership/task drift');
  const t=value.template.template,c=oneContainer(t);if(t.serviceAccount!==workerAccount||t.timeout!=='1800s'||(t.maxRetries??0)!==0||t.executionEnvironment!=='EXECUTION_ENVIRONMENT_GEN2'||c.image!==image||c.resources?.limits?.cpu!=='2'||c.resources?.limits?.memory!=='4Gi'||!same(c.command,['node'])||!same(c.args,['--no-network-family-autoselection','cloud-dist/filesEntry.js']))throw Error('AI task configuration drift');
  if(!same([...c.env].sort((a,b)=>a.name.localeCompare(b.name)),[...workerEnv].sort((a,b)=>a.name.localeCompare(b.name))))throw Error('AI secret/env drift');
 }
 if(response.status===404){if(state.resources[workerName]?.intent)throw Error('Earlier AI job creation ambiguous; no resubmission');
  if(!await submit(workerName,run+location+'/jobs?jobId=vistavo-ai-process','POST',desired,desired))process.exit(0);
  response={status:200,data:await c.required(run+workerName,'GET',undefined,'ai-job-created-readback')};
 }else{
  const ownedState=state.resources[workerName];if(!ownedState?.uid&&!ownedState?.operationDone)throw Error('Refuse existing untracked AI job');
  if(ownedState.uid&&ownedState.uid!==response.data.uid)throw Error('AI job identity changed');
  if(!labelsMatch(response.data,newLabels))throw Error('AI labels drift');
  try{verifyWorker(response.data);}catch(error){if(!ownedState.uid)throw error;const body={...desired,name:workerName,etag:response.data.etag};if(!await submit(workerName,run+workerName,'PATCH',body,desired))process.exit(0);response={status:200,data:await c.required(run+workerName,'GET',undefined,'ai-job-updated-readback')};}
 }
 verifyWorker(response.data);ready(response.data);
 state.resources[workerName]={...state.resources[workerName],uid:response.data.uid,image,verified:true,labels:response.data.labels};await save();
 await policy(workerName,[{role:'roles/run.jobsExecutorWithOverrides',members:callers}]);
 state.complete=true;state.image=image;state.finishedAt=new Date().toISOString();await save();
 const result={project,image,resources:Object.entries(state.resources).map(([name,value])=>({name,uid:value.uid,image:value.image,verified:value.verified,uri:value.uri})),aiWorker:{name:workerName,serviceAccount:workerAccount,secretReference:credential.secret.version,secretValueRead:false},schedulerChanged:false,noSql:true,publicInvoker:false};
 await fs.writeFile(out+'/ai-deploy-ready.json',JSON.stringify(result,null,2));console.log(JSON.stringify({complete:true,project,image,resources:result.resources.map(r=>r.name),secretOnlyOnWorker:true,schedulerChanged:false,noSql:true,publicInvoker:false}));
}catch(error){console.error(JSON.stringify({event:'ai-deploy-failed',stage,type:error?.name??'Error',code:typeof error?.code==='string'||typeof error?.code==='number'?error.code:undefined,reason:typeof error?.message==='string'&&/^(AI |Pinned |Owned |Old |Private |Public |Previous |Recorded |Earlier |Unowned |Unexpected |Unplanned |Existing |Artifact |Cloud Run |Ambiguous |Refuse )/.test(error.message)?error.message:undefined}));process.exitCode=1;}
