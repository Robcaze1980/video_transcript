import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {cloudClient,project,projectNumber,region} from './cloudClient.mjs';
import {verifyProofBaseline} from './files-proof-baseline.mjs';
import {indexFor} from './indexContract.mjs';

// Operator-only, scoped to files.plan.json. Default performs reads/planning only.
const apply=process.argv.includes('--apply');
if(process.argv.slice(2).some(v=>v!=='--apply'))throw Error('Only --apply is supported');
const plan=JSON.parse(await fs.readFile(new URL('./files.plan.json',import.meta.url),'utf8'));
const indexes=JSON.parse(await fs.readFile(new URL('./firestore.indexes.json',import.meta.url),'utf8'));
const rules=await fs.readFile(new URL('./firestore.rules',import.meta.url),'utf8');
if(plan.project!==project||plan.projectNumber!==projectNumber||plan.region!==region||plan.cloudSqlForbidden!==true||
 plan.firestore.databaseId!=='(default)'||plan.firestore.root!=='vistavo/candidate-v1')throw Error('Plan boundary mismatch');
const output='outputs/vistavo-gcs-cloud',receiptPath=output+'/foundation-receipt.json';
await fs.mkdir(output,{recursive:true});
let receipt={project,created:[],operations:[],previousPolicies:[],checks:[]};
try{receipt=JSON.parse(await fs.readFile(receiptPath,'utf8'));if(receipt.project!==project)throw Error('Receipt boundary');}catch(e){if(e.code!=='ENOENT')throw e;}
const persist=()=>fs.writeFile(receiptPath,JSON.stringify(receipt,null,2));
const cloud=await cloudClient(output+'/foundation-journal.json');
const note=(stage,state)=>{console.log(JSON.stringify({stage,state,apply}));};
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
async function read(url,stage){const r=await cloud.request(url,'GET',undefined,stage);if(r.status===404)return null;if(r.status!==200)throw Error(`${stage}: HTTP ${r.status}`);return r.data;}
async function operate(url,method,body,stage,host,version='v1'){
 const result=await cloud.required(url,method,body,stage);
 if(result.name&&(result.name.startsWith('operations/')||result.name.includes('/operations/'))){
  const pending={name:result.name,host,version,stage,done:false};receipt.operations.push(pending);await persist();
  if(!['index-create','field-index-exempt'].includes(stage)){await cloud.wait(pending.name,host,version);pending.done=true;await persist();}
 }
 return result;
}
// A prior long-running mutation is inspected before any possible re-submission.
for(const pending of receipt.operations.filter(v=>!v.done)){
 if(!apply)throw Error('Pending operation; inspect with --apply before continuing');
 const operation=await cloud.required('https://'+pending.host+'/'+pending.version+'/'+pending.name,'GET',undefined,'inspect-pending-foundation');if(operation.done){if(operation.error)throw Error('Recorded foundation operation failed');pending.done=true;await persist();}else note(pending.stage,'pending-no-resubmit');
}

const dbName=`projects/${project}/databases/(default)`,fsBase='https://firestore.googleapis.com/v1/';
const dbUrl=fsBase+dbName;
let database=await read(dbUrl,'database-read');
if(!database){
 const listing=await cloud.required(fsBase+`projects/${project}/databases`,'GET',undefined,'database-list');
 if(listing.nextPageToken)throw Error('Unexpected database pagination');
 if((listing.databases??[]).some(v=>v.name===dbName))throw Error('Database GET/list disagree');
 if(apply){await operate(fsBase+`projects/${project}/databases?databaseId=%28default%29`,'POST',plan.firestore.body,'database-create','firestore.googleapis.com');
  receipt.created.push({kind:'database',name:dbName});await persist();database=await read(dbUrl,'database-confirm');}
 else note('database','would-create');
}
if(database){
 for(const [key,value]of Object.entries(plan.firestore.body))if(database[key]!==value)throw Error('Existing database differs: '+key);
 if(database.name!==dbName)throw Error('Foreign database');note('database','confirmed');
}

const managedDescription='Managed Vistavo LV-007.GCS private files candidate';
const iam='https://iam.googleapis.com/v1/';
for(const [role,id]of Object.entries(plan.identities)){
 if(!/^vistavo-(?:files-[a-z]+|builder|bootstrap)$/.test(id))throw Error('Identity outside plan boundary');
 const email=`${id}@${project}.iam.gserviceaccount.com`,name=`projects/${project}/serviceAccounts/${email}`,url=iam+name;
 let account=await read(url,'identity-read');
 if(!account){
  if(['builder','proof'].includes(role))throw Error('Required existing isolated builder is missing');
  if(apply){account=await cloud.required(iam+`projects/${project}/serviceAccounts`,'POST',{accountId:id,serviceAccount:{displayName:`Vistavo files ${role}`,description:managedDescription}},'identity-create');
   receipt.created.push({kind:'serviceAccount',name:account.name,uniqueId:account.uniqueId});await persist();account=await read(url,'identity-confirm');}
  else note('identity-'+role,'would-create');
 }
 if(account){if(account.email!==email||account.projectId!==project||account.disabled||!['builder','proof'].includes(role)&&account.description!==managedDescription)throw Error('Identity ownership/state mismatch: '+role);note('identity-'+role,'confirmed');}
}
for(const entry of plan.customRoles){
 const name=`projects/${project}/roles/${entry.roleId}`,url=iam+name;let role=await read(url,'custom-role-read');
 if(!role){if(apply){await cloud.required(iam+`projects/${project}/roles`,'POST',entry,'custom-role-create');receipt.created.push({kind:'customRole',name});await persist();role=await read(url,'custom-role-confirm');}else note('custom-role','would-create');}
 if(role&&(role.deleted||role.stage!==entry.role.stage||role.title!==entry.role.title||role.description!==entry.role.description||!same([...role.includedPermissions].sort(),[...entry.role.includedPermissions].sort())))throw Error('Existing custom role differs');
}

function augment(policy,bindings){
 const next=structuredClone(policy);next.version=3;next.bindings??=[];let changed=false;
 for(const desired of bindings){
  if(!desired.members.every(m=>/^serviceAccount:vistavo-(?:files-[a-z]+|builder|bootstrap)@vistavo-prod\.iam\.gserviceaccount\.com$/.test(m)))throw Error('Foreign IAM member');
  if(/(?:owner|editor|admin)$/i.test(desired.role))throw Error('Broad administrative role refused');
  const candidates=next.bindings.filter(b=>b.role===desired.role&&b.condition?.title===desired.condition?.title);
  if(candidates.some(b=>!same(b.condition??null,desired.condition??null)))throw Error('Same-title IAM condition conflict');
  let target=candidates[0];if(candidates.length>1)throw Error('Duplicate IAM condition');
  if(!target){target={role:desired.role,members:[],...(desired.condition?{condition:desired.condition}:{})};next.bindings.push(target);changed=true;}
  for(const member of desired.members)if(!target.members.includes(member)){target.members.push(member);changed=true;}
 }
 return {policy:next,changed};
}
async function mergePolicy(label,getUrl,getMethod,getBody,setUrl,setMethod,wrap,bindings){
 const prior=await cloud.required(getUrl,getMethod,getBody,label+'-iam-read');
 if(!prior.etag)throw Error('IAM policy missing etag: '+label);
 const next=augment(prior,bindings);if(!next.changed){note(label+'-iam','confirmed');return;}
 if(!apply){note(label+'-iam','would-add-bindings');return;}
 receipt.previousPolicies.push({label,at:new Date().toISOString(),policy:prior});await persist();
 await cloud.required(setUrl,setMethod,wrap(next.policy),label+'-iam-set');
 const actual=await cloud.required(getUrl,getMethod,getBody,label+'-iam-confirm');
 if(augment(actual,bindings).changed)throw Error('IAM readback missing new bindings: '+label);
 // Verify no previous member/condition was dropped by the additive write.
 for(const old of prior.bindings??[])if(!actual.bindings?.some(b=>b.role===old.role&&same(b.condition??null,old.condition??null)&&old.members.every(m=>b.members.includes(m))))throw Error('IAM prior binding lost');
 note(label+'-iam','confirmed');
}
await verifyProofBaseline(cloud,receipt);
const crm=`https://cloudresourcemanager.googleapis.com/v1/projects/${project}`;
await mergePolicy('project',crm+':getIamPolicy','POST',{options:{requestedPolicyVersion:3}},crm+':setIamPolicy','POST',policy=>({policy}),plan.projectBindings);
for(const [label,bucket,bindings]of [['media',plan.mediaBucket,plan.mediaBindings],['builds',plan.buildBucket,plan.buildBucketBindings]]){
 if(![`${project}-${projectNumber}-media`,`${project}-${projectNumber}-builds`].includes(bucket))throw Error('Bucket outside plan');
 const bucketUrl='https://storage.googleapis.com/storage/v1/b/'+bucket;
 const metadata=await cloud.required(bucketUrl,'GET',undefined,label+'-bucket-read');
 if(String(metadata.projectNumber)!==projectNumber||metadata.iamConfiguration?.uniformBucketLevelAccess?.enabled!==true||metadata.iamConfiguration?.publicAccessPrevention!=='enforced')throw Error('Private bucket invariant missing');
 if(label==='media'&&(metadata.versioning?.enabled===true||Number(metadata.softDeletePolicy?.retentionDurationSeconds??0)!==0||metadata.retentionPolicy||metadata.lifecycle?.rule?.length))throw Error('Media deletion/fencing invariant missing');
 await mergePolicy(label,bucketUrl+'/iam?optionsRequestedPolicyVersion=3','GET',undefined,bucketUrl+'/iam','PUT',policy=>policy,bindings);
}
const artifact=`https://artifactregistry.googleapis.com/v1/projects/${project}/locations/${region}/repositories/${plan.artifactRepository}`;
if(plan.artifactRepository!=='vistavo')throw Error('Artifact repository boundary');
await cloud.required(artifact,'GET',undefined,'artifact-read');
await mergePolicy('artifact',artifact+':getIamPolicy?options.requestedPolicyVersion=3','GET',undefined,artifact+':setIamPolicy','POST',policy=>({policy}),plan.artifactBindings);

if(database){
 // A new server-only database must not expose client writes or reads.
 const rulesBase=`https://firebaserules.googleapis.com/v1/projects/${project}`;
 const releaseUrl=rulesBase+'/releases/cloud.firestore';const release=await read(releaseUrl,'rules-release-read');
 let already=false;
 if(release){
  if(!release.rulesetName?.startsWith(`projects/${project}/rulesets/`))throw Error('Foreign ruleset');
  const previous=await cloud.required('https://firebaserules.googleapis.com/v1/'+release.rulesetName,'GET',undefined,'ruleset-read');
  const files=previous.source?.files??[];
  const normalize=s=>s.replace(/\/\/[^\n]*/g,'').replace(/\s/g,'');
  if(files.length!==1||normalize(files[0].content)!==normalize(rules))throw Error('Existing Firestore rules are not this deny-all policy; refusing overwrite');
  already=true;
 }
 if(!already&&apply){
  const sourceHash=createHash('sha256').update(rules).digest('hex');
  let existing=receipt.created.find(v=>v.kind==='ruleset'&&v.sourceHash===sourceHash);
  if(!existing){const created=await cloud.required(rulesBase+'/rulesets','POST',{source:{files:[{name:'firestore.rules',content:rules}]}},'ruleset-create');
   existing={kind:'ruleset',name:created.name,sourceHash};receipt.created.push(existing);await persist();}
  await cloud.required(rulesBase+'/releases','POST',{name:`projects/${project}/releases/cloud.firestore`,rulesetName:existing.name},'rules-release-create');
  const current=await read(releaseUrl,'rules-release-confirm');if(current?.rulesetName!==existing.name)throw Error('Rules release unconfirmed');
 }else if(!already)note('rules','would-create-deny-all');

 const normalizeFields=fields=>{const result=fields.map(v=>({fieldPath:v.fieldPath,...(v.order?{order:v.order}:{arrayConfig:v.arrayConfig})}));
  if(result.at(-1)?.fieldPath!=='__name__')result.push({fieldPath:'__name__',order:result.at(-1)?.order??'ASCENDING'});return result;};
 for(const desired of indexes.indexes){
  if(!['outbox','jobs','uploads','fileOutbox'].includes(desired.collectionGroup)||desired.queryScope!=='COLLECTION')throw Error('Index outside candidate boundary');
  const base=dbUrl+'/collectionGroups/'+desired.collectionGroup+'/indexes';
  const listing=await cloud.required(base,'GET',undefined,'indexes-read');if(listing.nextPageToken)throw Error('Unexpected index pagination');
  let existing=indexFor(listing.indexes,dbName,desired);
  if(!existing&&apply){await operate(base,'POST',{queryScope:desired.queryScope,fields:desired.fields},'index-create','firestore.googleapis.com');
   const confirmed=await cloud.required(base,'GET',undefined,'index-confirm');existing=indexFor(confirmed.indexes,dbName,desired);
   receipt.created.push({kind:'index',name:existing?.name});await persist();}
  if(existing?.state==='NEEDS_REPAIR')throw Error('Index needs repair');
  if(apply&&!existing)throw Error('Index submission missing readback');
  note('index-'+desired.collectionGroup,existing?.state??'would-create');
 }
 for(const desired of indexes.fieldOverrides){
  if(!['projects/draft','jobs/snapshot'].includes(desired.collectionGroup+'/'+desired.fieldPath)||desired.indexes.length)throw Error('Field exemption outside boundary');
  const url=dbUrl+'/collectionGroups/'+desired.collectionGroup+'/fields/'+desired.fieldPath;
  let current=await cloud.required(url,'GET',undefined,'field-index-read');
  const localConfig=current.indexConfig&&current.indexConfig.usesAncestorConfig!==true;
  if(localConfig&&(current.indexConfig.indexes??[]).length===0)continue;
  if(localConfig)throw Error('Existing custom field index differs; refusing overwrite');
  if(apply){await operate(url+'?updateMask=indexConfig','PATCH',{name:`${dbName}/collectionGroups/${desired.collectionGroup}/fields/${desired.fieldPath}`,indexConfig:{indexes:[]}},'field-index-exempt','firestore.googleapis.com');
   current=await cloud.required(url,'GET',undefined,'field-index-confirm');if(!current.indexConfig||current.indexConfig.usesAncestorConfig===true||(current.indexConfig.indexes??[]).length)throw Error('Field exemption unconfirmed');}
  else note('field-'+desired.collectionGroup+'-'+desired.fieldPath,'would-exempt');
 }
 const markerUrl=dbUrl+'/documents/'+plan.firestore.root;
 const expected={schemaVersion:{integerValue:'2'},service:{stringValue:'vistavo'},environment:{stringValue:'candidate'},storageProtocol:{stringValue:'immutable-chunks-v1'}};
 let marker=await read(markerUrl,'root-marker-read');
 if(!marker){
  const collections=await cloud.required(markerUrl+':listCollectionIds','POST',{pageSize:100},'root-collections-check');
  if(collections.nextPageToken||collections.collectionIds?.length)throw Error('Candidate root has unowned subcollections');
  if(apply){marker=await cloud.required(dbUrl+'/documents/vistavo?documentId=candidate-v1','POST',{fields:expected},'root-marker-create');receipt.created.push({kind:'document',name:marker.name});await persist();}
  else note('root-marker','would-create');
 }
 if(marker&&(!same(marker.fields,expected)||marker.name!==dbName+'/documents/'+plan.firestore.root))throw Error('Candidate marker differs');
}else note('database-dependent-rules-indexes-marker','would-configure-after-create');
receipt.checks.push({at:new Date().toISOString(),apply,status:receipt.operations.some(x=>!x.done)?'pending':'complete',scope:'private foundation only; no cloud media or Run deployment proof'});await persist();
note('foundation',receipt.operations.some(x=>!x.done)?'pending-inspect-before-deploy':'complete');
