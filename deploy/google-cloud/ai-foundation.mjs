import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {cloudClient,project,projectNumber,region} from './cloudClient.mjs';
import {indexFor} from './indexContract.mjs';

// Operator-only foundation. No key/secret/SA creation or Job/service deployment here.
const plan=JSON.parse(await fs.readFile(new URL('./ai.plan.json',import.meta.url),'utf8'));
const apply=process.argv.includes('--apply'),output='outputs/vistavo-ai-cloud';let stage='plan';
const worker='vistavo-runtime@vistavo-prod.iam.gserviceaccount.com',member='serviceAccount:'+worker;
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
function assert(ok,code){if(!ok){const error=new Error(code);error.name='AiFoundationFault';throw error;}}
async function main(){
 assert(process.argv.slice(2).every(v=>v==='--apply'),'unknown-option');
 assert(plan.project===project&&plan.projectNumber===projectNumber&&plan.region===region&&plan.cloudSqlForbidden===true&&
  plan.identity.email===worker&&plan.identity.create===false&&plan.firestore.databaseId==='(default)'&&plan.firestore.root==='vistavo/candidate-v1'&&
  plan.secret.resource==='projects/vistavo-prod/secrets/vistavo-gemini-provider'&&plan.secret.create===false,'plan-boundary');
 assert(plan.storage.directWriteCopies===1&&plan.storage.textTotalBytes===1048576&&plan.storage.voiceTotalBytes===33554432,'output-profile-drift');
 assert(plan.projectBindings.every(b=>['roles/datastore.user','roles/serviceusage.serviceUsageConsumer'].includes(b.role))&&
  plan.mediaBindings.every(b=>['roles/storage.objectCreator','roles/storage.objectViewer'].includes(b.role))&&
  plan.secret.bindings.every(b=>b.role==='roles/secretmanager.secretAccessor')&&
  [...plan.projectBindings,...plan.mediaBindings,...plan.secret.bindings].every(b=>same(b.members,[member])),'iam-plan-boundary');
 assert(plan.projectBindings.find(b=>b.role==='roles/datastore.user')?.condition?.expression==='resource.name == "projects/vistavo-prod/databases/(default)"','database-condition');
 assert(plan.mediaBucket==='vistavo-prod-107404655346-media'&&plan.firestore.indexes.every(i=>i.collectionGroup==='artifacts'&&i.queryScope==='COLLECTION'),'storage-index-boundary');
 if(!apply){console.log(JSON.stringify({apply:false,project,region,worker,roles:plan.projectBindings.map(b=>b.role),mediaRoles:plan.mediaBindings.map(b=>b.role),secret:plan.secret.resource,indexes:plan.firestore.indexes,createSa:false,createSecret:false,createApiKey:false,deployJob:false,updateServices:false,cloudSql:false,notes:'Job image/env/secret mount and API/maintenance changes require a separate reviewed deployment'}));return;}
 assert(await fs.realpath(process.cwd())===await fs.realpath(fileURLToPath(new URL('../../',import.meta.url))),'workspace-boundary');
 await fs.mkdir(output,{recursive:true});const receiptFile=output+'/ai-foundation.json';
 let receipt={project,worker,startedAt:new Date().toISOString(),baseline:{},previousPolicies:[],indexes:{},operations:[],nativeQueries:[],complete:false};
 try{receipt=JSON.parse(await fs.readFile(receiptFile,'utf8'));assert(receipt.project===project&&receipt.worker===worker,'receipt-boundary');}catch(error){if(error.code!=='ENOENT')throw error;}
 const save=()=>fs.writeFile(receiptFile,JSON.stringify({...receipt,updatedAt:new Date().toISOString()},null,2));
 receipt.complete=false;receipt.lastAttemptStartedAt=new Date().toISOString();await save();
 stage='client-project-billing';const cloud=await cloudClient(output+'/ai-foundation-journal.json');
 async function required(url,method='GET',body,label=stage){stage=label;return cloud.required(url,method,body,label);}
 for(const api of ['firestore.googleapis.com','run.googleapis.com','secretmanager.googleapis.com','generativelanguage.googleapis.com']){
  const value=await required('https://serviceusage.googleapis.com/v1/projects/'+projectNumber+'/services/'+api,'GET',undefined,'api-read-'+api);assert(value.state==='ENABLED','api-not-enabled');
 }
 const dbName='projects/'+project+'/databases/(default)',database=await required('https://firestore.googleapis.com/v1/'+dbName,'GET',undefined,'database-read');
 assert(database.name===dbName&&database.type==='FIRESTORE_NATIVE'&&database.locationId===region&&database.deleteProtectionState==='DELETE_PROTECTION_ENABLED'&&database.pointInTimeRecoveryEnablement==='POINT_IN_TIME_RECOVERY_ENABLED','existing-database-invariant');
 const sa='https://iam.googleapis.com/v1/projects/'+project+'/serviceAccounts/'+worker;
 const identity=await required(sa,'GET',undefined,'worker-identity-read');
 assert(identity.email===worker&&identity.projectId===project&&!identity.disabled&&identity.description===plan.identity.expectedDescription,'existing-worker-ownership');
 if(receipt.baseline.identityUniqueId)assert(receipt.baseline.identityUniqueId===identity.uniqueId,'worker-identity-replaced');
 const keys=await required(sa+'/keys?keyTypes=USER_MANAGED','GET',undefined,'worker-user-keys-read');assert(!keys.keys?.length,'unexpected-worker-user-key');
 receipt.baseline.identityUniqueId=identity.uniqueId;receipt.baseline.userManagedKeys=0;await save();
 const secretUrl='https://secretmanager.googleapis.com/v1/'+plan.secret.resource;
 const secret=await required(secretUrl,'GET',undefined,'existing-secret-metadata-read');
 assert([plan.secret.resource,plan.secret.canonicalResource].includes(secret.name)&&secret.labels?.app==='vistavo'&&!!secret.replication,'existing-secret-ownership');
 receipt.secret={name:secret.name,labels:secret.labels,replication:secret.replication,readSecretValue:false};await save();
 const bucketUrl='https://storage.googleapis.com/storage/v1/b/'+plan.mediaBucket;
 const bucket=await required(bucketUrl,'GET',undefined,'media-invariants-read');
 assert(String(bucket.projectNumber)===projectNumber&&bucket.iamConfiguration?.uniformBucketLevelAccess?.enabled===true&&bucket.iamConfiguration?.publicAccessPrevention==='enforced'&&
  bucket.versioning?.enabled!==true&&Number(bucket.softDeletePolicy?.retentionDurationSeconds??0)===0&&!bucket.retentionPolicy&&!bucket.lifecycle?.rule?.length,'private-bucket-invariants');

 // Inspect every baseline before the first grant; preserve exact old etags/member sets.
 const crm='https://cloudresourcemanager.googleapis.com/v1/projects/'+project;
 const resources=[
  {id:'project',url:crm,getUrl:crm+':getIamPolicy',getMethod:'POST',getBody:{options:{requestedPolicyVersion:3}},setUrl:crm+':setIamPolicy',setMethod:'POST',wrap:policy=>({policy}),bindings:plan.projectBindings},
  {id:'media',url:bucketUrl,getUrl:bucketUrl+'/iam?optionsRequestedPolicyVersion=3',getMethod:'GET',setUrl:bucketUrl+'/iam',setMethod:'PUT',wrap:policy=>policy,bindings:plan.mediaBindings},
  {id:'secret',url:secretUrl,getUrl:secretUrl+':getIamPolicy?options.requestedPolicyVersion=3',getMethod:'GET',setUrl:secretUrl+':setIamPolicy',setMethod:'POST',wrap:policy=>({policy}),bindings:plan.secret.bindings},
 ];
 function bindingMatches(b,wanted){return b.role===wanted.role&&same(b.condition??null,wanted.condition??null);}
 for(const resource of resources){
  const policy=await required(resource.getUrl,resource.getMethod,resource.getBody,resource.id+'-iam-baseline');assert(policy.etag,'iam-etag-missing');
  if(resource.id==='secret')assert(!(policy.bindings??[]).some(b=>b.role==='roles/secretmanager.secretAccessor'&&b.members?.some(m=>m!==member)),'secret-accessor-not-exclusive');
  if(!receipt.baseline[resource.id]){assert(!(policy.bindings??[]).some(b=>b.members?.includes(member)),'worker-baseline-not-empty');receipt.baseline[resource.id]={at:new Date().toISOString(),policy};await save();}
  else assert(!(receipt.baseline[resource.id].policy.bindings??[]).some(b=>b.members?.includes(member)),'saved-baseline-has-worker-grants');
  const unplanned=(policy.bindings??[]).filter(b=>b.members?.includes(member)&&!resource.bindings.some(w=>bindingMatches(b,w)));
  assert(!unplanned.length,'worker-has-unplanned-grant');
  assert(!(policy.bindings??[]).some(b=>b.members?.some(m=>m==='allUsers'||m==='allAuthenticatedUsers')),'public-direct-iam');
 }
 for(const resource of resources){
  const before=await required(resource.getUrl,resource.getMethod,resource.getBody,resource.id+'-iam-before'),next=structuredClone(before);next.version=3;next.bindings??=[];let changed=false;
  for(const desired of resource.bindings){let binding=next.bindings.find(b=>bindingMatches(b,desired));
   assert(!next.bindings.some(b=>b.role===desired.role&&b.condition?.title===desired.condition?.title&&!bindingMatches(b,desired)),'same-title-condition-drift');
   if(!binding){binding={role:desired.role,members:[],...(desired.condition?{condition:desired.condition}:{})};next.bindings.push(binding);}
   if(!binding.members.includes(member)){binding.members.push(member);changed=true;}
  }
  if(changed){receipt.previousPolicies.push({resource:resource.id,at:new Date().toISOString(),policy:before});await save();await required(resource.setUrl,resource.setMethod,resource.wrap(next),resource.id+'-iam-add');}
  const actual=await required(resource.getUrl,resource.getMethod,resource.getBody,resource.id+'-iam-readback');
  assert(resource.bindings.every(desired=>actual.bindings?.some(b=>bindingMatches(b,desired)&&b.members.includes(member))),'new-iam-not-confirmed');
  for(const prior of before.bindings??[])assert(actual.bindings?.some(b=>b.role===prior.role&&same(b.condition??null,prior.condition??null)&&prior.members.every(m=>b.members.includes(m))),'old-iam-dropped');
 }

 // A prior mutation is inspected before any possible new submission. No blind index retry.
 for(const operation of receipt.operations.filter(x=>!x.done)){
  const actual=await required('https://firestore.googleapis.com/v1/'+operation.name,'GET',undefined,'index-operation-inspect');
  if(actual.done){assert(!actual.error,'index-operation-failed');operation.done=true;await save();}
 }
 let ready=true;
 for(const desired of plan.firestore.indexes){
  const id=desired.fields.map(f=>f.fieldPath).join('+'),base='https://firestore.googleapis.com/v1/'+dbName+'/collectionGroups/'+desired.collectionGroup+'/indexes';
  const list=await required(base,'GET',undefined,'artifact-indexes-list');assert(!list.nextPageToken,'index-list-paginated');let existing=indexFor(list.indexes,dbName,desired);
  if(!existing){
   assert(!receipt.indexes[id]?.intent,'index-submission-ambiguous');receipt.indexes[id]={intent:true,desired,at:new Date().toISOString()};await save();
   const op=await required(base,'POST',{queryScope:desired.queryScope,fields:desired.fields},'artifact-index-create');
   assert(op.name?.startsWith(dbName+'/operations/'),'index-operation-boundary');receipt.operations.push({name:op.name,index:id,done:op.done===true});await save();
   if(op.done)assert(!op.error,'index-operation-failed');
   const confirm=await required(base,'GET',undefined,'artifact-index-create-readback');assert(!confirm.nextPageToken,'index-list-paginated');existing=indexFor(confirm.indexes,dbName,desired);
   assert(existing,'artifact-index-submission-unconfirmed');
  }
  assert(existing.state!=='NEEDS_REPAIR','artifact-index-needs-repair');
  receipt.indexes[id]={...receipt.indexes[id],name:existing.name,state:existing.state};if(existing.state!=='READY')ready=false;await save();
 }
 if(ready){
  const parent='https://firestore.googleapis.com/v1/'+dbName+'/documents/'+plan.firestore.root;
  const queries=[
   {id:'artifacts-owner-input',structuredQuery:{from:[{collectionId:'artifacts'}],where:{compositeFilter:{op:'AND',filters:[{fieldFilter:{field:{fieldPath:'inputId'},op:'EQUAL',value:{stringValue:'00000000-0000-0000-0000-000000000000'}}},{fieldFilter:{field:{fieldPath:'accountId'},op:'EQUAL',value:{stringValue:'00000000-0000-0000-0000-000000000000'}}}]}}}},
   {id:'artifacts-pending-purge',structuredQuery:{from:[{collectionId:'artifacts'}],where:{compositeFilter:{op:'AND',filters:[{fieldFilter:{field:{fieldPath:'state'},op:'EQUAL',value:{stringValue:'pending'}}},{fieldFilter:{field:{fieldPath:'nextAttemptAt'},op:'LESS_THAN_OR_EQUAL',value:{integerValue:String(Date.now())}}}]}},orderBy:[{field:{fieldPath:'nextAttemptAt'},direction:'ASCENDING'}],limit:1}},
  ];
  for(const query of queries){const result=await required(parent+':runQuery','POST',{structuredQuery:query.structuredQuery},'native-'+query.id);assert(Array.isArray(result),'native-query-response');receipt.nativeQueries.push({at:new Date().toISOString(),id:query.id,success:true,returnedDocuments:result.filter(r=>r.document).length});await save();}
 }
 receipt.complete=ready;receipt.scope='Existing worker IAM, existing secret metadata/access policy, artifact indexes and native queries only; no provider call/deployment/SQL';await save();
 console.log(JSON.stringify({project,complete:ready,indexes:Object.values(receipt.indexes).map(i=>({name:i.name,state:i.state})),nativeQueries:ready?'PASS':'pending; reenter --apply inspects operation',worker,secretValueRead:false,jobDeployment:'separate step',noSql:true}));
}
await main().catch(error=>{console.error(JSON.stringify({event:'ai-foundation-failed',stage,type:error?.name,code:typeof error?.code==='string'||typeof error?.code==='number'?error.code:undefined,reason:error?.name==='AiFoundationFault'?error.message:undefined}));process.exitCode=1;});
