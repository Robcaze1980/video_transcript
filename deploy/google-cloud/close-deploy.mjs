import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {cloudClient,project,projectNumber,region} from './cloudClient.mjs';
import {assertDeploymentQuiescent} from './stabilizationQuiescence.mjs';
import {verifyCloseBaseline,closeBaselinePaths} from './closeReleaseBaseline.mjs';

// Operator-only deployment of this private candidate. No credentials/API calls without --apply.
const apply=process.argv.includes('--apply');
if(process.argv.slice(2).some(v=>v!=='--apply'))throw Error('Only --apply is supported');
const plan=JSON.parse(await fs.readFile(new URL('./ai.plan.json',import.meta.url),'utf8'));
const filesPlan=JSON.parse(await fs.readFile(new URL('./files.plan.json',import.meta.url),'utf8'));
const out='outputs/vistavo-three-fixes-20261114',location=`projects/${project}/locations/${region}`,run='https://run.googleapis.com/v2/';
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
if(!apply){console.log(JSON.stringify({apply:false,project,region,update:existing.map(x=>({resource:x.id,image:'verified build-ready immutable digest',preserveIdentityLabelsIamAndLimits:true,aiEnabled:['api','maintenance'].includes(x.role)})),updateExistingJob:{name:workerName,preserveTemplate:true,createForbidden:true,secretEnv:'unchanged pinned Secret Manager reference only on AI worker'},requires:['foundation complete and native queries','queue sourceContract/plan hash exact, READY outbox index and native query, completed error-free backfill','credentials complete with pinned version1','verified own Artifact Registry digest','old resource UID/labels'],schedulerChange:false,publicInvoker:false,noSql:true}));process.exit(0);}


// Import only a completely accepted five-resource baseline, never adopt an unknown deployment.
async function importBaseline(){
 const source=closeBaselinePaths.state,target=out+'/ai-deploy-state.json';
 const bytes=await fs.readFile(source),verified=verifyCloseBaseline({stateBytes:bytes,readyBytes:await fs.readFile(closeBaselinePaths.ready),readbackBytes:await fs.readFile(closeBaselinePaths.readback),acceptanceBytes:await fs.readFile(closeBaselinePaths.acceptance)});
 const old=verified.state,baselineImage=verified.baselineImage;
 const names=[...existing.map(x=>location+'/'+x.kind+'/'+x.id),workerName].sort();
 if(!same(verified.resources.map(row=>row.name).sort(),names))throw Error('Previous accepted baseline resource-set mismatch');
 const sourceSha256=verified.sourceSha256;
 try{
  const saved=JSON.parse(await fs.readFile(target,'utf8')),imported=JSON.parse(await fs.readFile(out+'/deploy-baseline-import.json','utf8'));
  if(saved.project!==project||!same(saved.labels,newLabels)||!same(Object.keys(saved.resources??{}).sort(),names)||imported.sourceSha256!==sourceSha256||imported.baselineImage!==baselineImage||imported.readySha256!==verified.readySha256||imported.readbackSha256!==verified.readbackSha256||imported.acceptanceSha256!==verified.acceptanceSha256||names.some(name=>saved.resources[name].uid!==old.resources[name].uid))throw Error('Existing close receipt/import boundary');
  return;
 }catch(e){if(e.code!=='ENOENT')throw e;try{await fs.access(target);throw Error('Existing state has no import receipt');}catch(missing){if(missing.code!=='ENOENT')throw missing;}}

 const receipt={source,sourceSha256,readySha256:verified.readySha256,readbackSha256:verified.readbackSha256,acceptanceSha256:verified.acceptanceSha256,baselineImage,project,resources:names.map(name=>({name,uid:old.resources[name].uid})),at:new Date().toISOString()};
 await fs.mkdir(out,{recursive:true});
 try{await fs.writeFile(out+'/deploy-baseline-import.json',JSON.stringify(receipt,null,2),{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;const saved=JSON.parse(await fs.readFile(out+'/deploy-baseline-import.json','utf8'));if(saved.sourceSha256!==sourceSha256||saved.baselineImage!==baselineImage||saved.readySha256!==verified.readySha256||saved.readbackSha256!==verified.readbackSha256||saved.acceptanceSha256!==verified.acceptanceSha256||!same(saved.resources,receipt.resources))throw Error('Previous import receipt differs');}
 await fs.writeFile(target,bytes,{flag:'wx'});
}

let stage='input-validation';
try{
 const build=JSON.parse(await fs.readFile(out+'/build-ready.json','utf8'));
 const foundation=JSON.parse(await fs.readFile('outputs/vistavo-ai-cloud/ai-foundation.json','utf8'));
 const credential=JSON.parse(await fs.readFile('outputs/vistavo-ai-cloud/credentials-receipt.json','utf8'));
 const oldDeploy=JSON.parse(await fs.readFile('outputs/vistavo-gcs-cloud/deploy-state.json','utf8'));
 const queue=JSON.parse(await fs.readFile(out+'/queue-foundation.json','utf8')),queuePlanBytes=await fs.readFile(new URL('./stabilization-queue.plan.json',import.meta.url)),queuePlan=JSON.parse(queuePlanBytes);
 const queueIndex={collectionGroup:'outbox',queryScope:'COLLECTION',fields:[{fieldPath:'aiProfile',order:'ASCENDING'},{fieldPath:'state',order:'ASCENDING'},{fieldPath:'nextAttemptAt',order:'ASCENDING'}]};
 const queueIndexPrefix=`projects/${project}/databases/(default)/collectionGroups/outbox/indexes/`;
 if(queuePlan.project!==project||queuePlan.projectNumber!==projectNumber||queuePlan.root!=='vistavo/candidate-v1'||queuePlan.databaseId!=='(default)'||queuePlan.profile!=='ai-candidate-v1'||!same(queuePlan.index,queueIndex)||queuePlan.cloudSqlForbidden!==true||
  queuePlan.backfill?.existingPendingOnly!==true||queuePlan.backfill.createForbidden!==true||queuePlan.backfill.claimForbidden!==true||queuePlan.backfill.pageSize!==100||queuePlan.backfill.maxPagesPerRun!==10||
  queue.project!==project||queue.sourceContract!=='ai-outbox-profile-v1'||queue.profile!==queuePlan.profile||queue.root!==queuePlan.root||queue.planSha256!==createHash('sha256').update(queuePlanBytes).digest('hex')||
  queue.complete!==true||queue.index?.state!=='READY'||typeof queue.index.name!=='string'||!queue.index.name.startsWith(queueIndexPrefix)||! /^[A-Za-z0-9_-]+$/.test(queue.index.name.slice(queueIndexPrefix.length))||queue.nativeQuery?.success!==true||
  queue.backfill?.algorithm!=='owned-ai-classification-v2'||queue.backfill.complete!==true||!Array.isArray(queue.backfill.failures)||queue.backfill.failures.length!==0||!Number.isSafeInteger(queue.backfill.checked)||!Number.isSafeInteger(queue.backfill.updated)||queue.backfill.updated<0||queue.backfill.checked<queue.backfill.updated)throw Error('Queue discriminator/index/backfill prerequisite incomplete');
 if(typeof build.image!=='string'||!imagePattern.test(build.image))throw Error('Pinned build image boundary');
 if(foundation.project!==project||foundation.worker!==workerAccount||foundation.complete!==true||
  !['artifacts-owner-input','artifacts-pending-purge'].every(id=>foundation.nativeQueries?.some(q=>q.id===id&&q.success===true))||
  !Array.isArray(foundation.operations)||foundation.operations.some(op=>!op.done)||
  Object.values(foundation.indexes??{}).length!==2||Object.values(foundation.indexes).some(i=>i.state!=='READY'||!i.name?.startsWith(`projects/${project}/databases/(default)/collectionGroups/artifacts/indexes/`)))throw Error('AI foundation/native index prerequisites incomplete');
 if(credential.project!==project||credential.projectNumber!==projectNumber||credential.complete!==true||credential.serviceAccountKeyFiles!==false||
  credential.key?.name!==`projects/${projectNumber}/locations/global/keys/vistavo-gemini-provider`||credential.key.serviceAccountBound!==false||
  ![`projects/${project}/secrets/vistavo-gemini-provider/versions/1`,`projects/${projectNumber}/secrets/vistavo-gemini-provider/versions/1`].includes(credential.secret?.version))throw Error('Owned restricted credentials/pinned version prerequisite');
 if(oldDeploy.project!==project||!same(oldDeploy.labels,oldLabels)||!oldDeploy.resources)throw Error('Old deployment baseline missing');
 // Verify the previously accepted private baseline before any credentials or cloud operation.
 await importBaseline();
 const image=build.image,c=await cloudClient(out+'/ai-deploy-journal.json');
 stage='queue-fresh-readback';const liveQueueIndex=await c.required('https://firestore.googleapis.com/v1/'+queue.index.name,'GET',undefined,'queue-index-fresh-readback');
 const expectedLiveQueueFields=[...queueIndex.fields,{fieldPath:'__name__',order:'ASCENDING'}];
 if(liveQueueIndex.name!==queue.index.name||liveQueueIndex.state!=='READY'||liveQueueIndex.queryScope!=='COLLECTION'||!same(liveQueueIndex.fields,expectedLiveQueueFields))throw Error('Queue index resource/fields drift');
 const queueQuery={from:[{collectionId:'outbox'}],where:{compositeFilter:{op:'AND',filters:[{fieldFilter:{field:{fieldPath:'aiProfile'},op:'EQUAL',value:{stringValue:queuePlan.profile}}},{fieldFilter:{field:{fieldPath:'state'},op:'EQUAL',value:{stringValue:'pending'}}},{fieldFilter:{field:{fieldPath:'nextAttemptAt'},op:'LESS_THAN_OR_EQUAL',value:{integerValue:String(Date.now())}}}]}},orderBy:[{field:{fieldPath:'nextAttemptAt'},direction:'ASCENDING'}],limit:1};
 const queueNative=await c.required(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/${queuePlan.root}:runQuery`,'POST',{structuredQuery:queueQuery},'queue-query-fresh-readback');if(!Array.isArray(queueNative))throw Error('Queue native query unavailable');
 async function assertQuiescent(phase){
  return assertDeploymentQuiescent({project,root:queuePlan.root,image,phase,required:c.required,record:async event=>{
  const receiptPath=out+'/deployment-quiescence.json';let receipt={project,events:[]};try{receipt=JSON.parse(await fs.readFile(receiptPath,'utf8'));if(receipt.project!==project||!Array.isArray(receipt.events))throw Error('Existing quiescence receipt boundary');}catch(error){if(error.code!=='ENOENT')throw error;}
  receipt.events.push(event);await fs.writeFile(receiptPath,JSON.stringify(receipt,null,2));
  }});
 }
 stage='quiescent-before-runtime-update';await assertQuiescent('before-runtime-update');
 const stateFile=out+'/ai-deploy-state.json';let state={project,labels:newLabels,image,resources:{},previousPolicies:[],complete:false};
 try{const saved=JSON.parse(await fs.readFile(stateFile,'utf8'));if(saved.project!==project||!same(saved.labels,newLabels)||!saved.resources||!Array.isArray(saved.previousPolicies))throw Error('AI deployment receipt boundary');state=saved;}catch(error){if(error.code!=='ENOENT')throw error;}
 const save=()=>fs.writeFile(stateFile,JSON.stringify({...state,image,updatedAt:new Date().toISOString()},null,2));
 state.complete=false;await save();
 stage='verify-image';const artifact=await c.required('https://artifactregistry.googleapis.com/v1/'+location+'/repositories/vistavo/dockerImages/'+encodeURIComponent(image.split('/').at(-1)),'GET',undefined,'ai-image-digest');if(artifact.uri!==image)throw Error('Artifact digest unconfirmed');
 const labelsMatch=(value,expected)=>Object.entries(expected).every(([k,v])=>value.labels?.[k]===v);
 async function policy(name,additions=[]){
  const url=run+name,prior=await c.required(url+':getIamPolicy?options.requestedPolicyVersion=3','GET',undefined,'ai-run-iam-read');
  if(prior.bindings?.some(b=>b.members?.some(m=>m==='allUsers'||m==='allAuthenticatedUsers')))throw Error('Public invoker drift refused');
  for(const addition of additions)if(!addition.members.every(member=>prior.bindings?.some(b=>b.role===addition.role&&!b.condition&&b.members.includes(member))))throw Error('Existing AI invoker binding missing; no IAM mutation authorized');
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
  if(method!=='PATCH')throw Error('Only updates of the five tracked runtimes are authorized');
  const item=state.resources[name];if(item?.intent&&!item.operation&&!item.operationDone)throw Error('Ambiguous earlier AI deployment; inspect operation before retry');
  state.resources[name]={...item,intent:'update',operationDone:false,desiredHash:hash(desired),image,submittedAt:new Date().toISOString()};await save();
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
  const saved=state.resources[name];if(saved?.uid&&container.image!==saved.image&&container.image!==image)throw Error('Existing tracked runtime image drift');if(!saved?.uid){if(container.image!==baseline.image)throw Error('Old image differs from proven baseline');state.resources[name]={...saved,uid:current.uid,baselineImage:container.image,baseline:{labels:current.labels,template:current.template,...(item.kind==='services'?{ingress:current.ingress,invokerIamDisabled:current.invokerIamDisabled,scaling:current.scaling}:{})}};await save();}else if(saved.uid!==current.uid)throw Error('AI receipt identity drift');
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
  if(item.role==='api'){stage='quiescent-after-api-before-maintenance';await assertQuiescent('after-api-before-maintenance');}
 }
 stage='ai-job';if(state.resources[workerName]?.failed)throw Error('Previous AI job deployment failed');if(!await operation(workerName))process.exit(0);
 let response=await c.request(run+workerName,'GET',undefined,'ai-job-read');if(response.status!==200)throw Error('Existing AI job missing or unreadable; creation forbidden');
 const workerEnv=[{name:'VISTAVO_PROJECT_ID',value:project},{name:'VISTAVO_FILES_MODE',value:'ai'},{name:'VISTAVO_AI_ENABLED',value:'1'},{name:'VISTAVO_GEMINI_KEY',valueSource:{secretKeyRef:{secret:'vistavo-gemini-provider',version:'1'}}}];
 function verifyWorker(value,expectedImage=image){
  if(value.name!==workerName||value.deleteTime||!labelsMatch(value,newLabels)||value.template?.taskCount!==1||value.template?.parallelism!==1)throw Error('AI job ownership/task drift');
  const t=value.template.template,c=oneContainer(t);if(t.serviceAccount!==workerAccount||t.timeout!=='1800s'||(t.maxRetries??0)!==0||t.executionEnvironment!=='EXECUTION_ENVIRONMENT_GEN2'||c.image!==expectedImage||c.resources?.limits?.cpu!=='2'||c.resources?.limits?.memory!=='4Gi'||!same(c.command,['node'])||!same(c.args,['--no-network-family-autoselection','cloud-dist/filesEntry.js']))throw Error('AI task configuration drift');
  if(!same([...c.env].sort((a,b)=>a.name.localeCompare(b.name)),[...workerEnv].sort((a,b)=>a.name.localeCompare(b.name))))throw Error('AI secret/env drift');
 }
 const ownedState=state.resources[workerName];if(!ownedState?.uid||ownedState.uid!==response.data.uid)throw Error('Existing AI job identity changed');
 const currentWorkerImage=oneContainer(response.data.template?.template).image;
 if(currentWorkerImage!==ownedState.image&&currentWorkerImage!==image)throw Error('Existing AI worker image drift');
 verifyWorker(response.data,currentWorkerImage);await policy(workerName,[{role:'roles/run.jobsExecutorWithOverrides',members:callers}]);
 if(currentWorkerImage!==image){
  const template=structuredClone(response.data.template);oneContainer(template.template).image=image;
  const body={name:workerName,etag:response.data.etag,labels:response.data.labels,template};
  if(!await submit(workerName,run+workerName,'PATCH',body,body))process.exit(0);
  response={status:200,data:await c.required(run+workerName,'GET',undefined,'ai-job-updated-readback')};
 }

 verifyWorker(response.data);ready(response.data);
 state.resources[workerName]={...state.resources[workerName],uid:response.data.uid,image,verified:true,labels:response.data.labels};await save();
 await policy(workerName,[{role:'roles/run.jobsExecutorWithOverrides',members:callers}]);
 state.complete=true;state.image=image;state.finishedAt=new Date().toISOString();await save();
 const result={project,image,resources:Object.entries(state.resources).map(([name,value])=>({name,uid:value.uid,image:value.image,verified:value.verified,uri:value.uri})),aiWorker:{name:workerName,serviceAccount:workerAccount,secretReference:credential.secret.version,secretValueRead:false},schedulerChanged:false,noSql:true,publicInvoker:false};
 await fs.writeFile(out+'/ai-deploy-ready.json',JSON.stringify(result,null,2));console.log(JSON.stringify({complete:true,project,image,resources:result.resources.map(r=>r.name),secretOnlyOnWorker:true,schedulerChanged:false,noSql:true,publicInvoker:false}));
}catch(error){console.error(JSON.stringify({event:'ai-deploy-failed',stage,type:error?.name??'Error',code:typeof error?.code==='string'||typeof error?.code==='number'?error.code:undefined,reason:typeof error?.message==='string'&&/^(AI |Pinned |Owned |Old |Private |Public |Previous |Recorded |Earlier |Unowned |Unexpected |Unplanned |Existing |Artifact |Cloud Run |Ambiguous |Refuse )/.test(error.message)?error.message:undefined}));process.exitCode=1;}
