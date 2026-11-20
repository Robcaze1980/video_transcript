// P0 read-only readback of the real `vistavo-prod` project (authorized by the owner in chat on 2026-11-19, scope: scheduler, Cloud Run
// services and jobs, service accounts and Firestore indexes; NO business data and NO other project).
// Hard guarantees: only GET requests, only the hosts below, only paths under projects/vistavo-prod, no request body, the access token is
// never printed or stored, redirects are refused, and the output keeps metadata only (IAM members other than service accounts are redacted).
// Usage: node scripts/p0CloudReadback.mjs <output.json>
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {GoogleAuth} from 'google-auth-library';

const PROJECT='vistavo-prod',REGION='us-central1';
const HOSTS=new Set(['cloudresourcemanager.googleapis.com','cloudbilling.googleapis.com','cloudscheduler.googleapis.com','run.googleapis.com','firestore.googleapis.com','iam.googleapis.com']);
const out=process.argv[2];if(!out)throw Error('usage: node scripts/p0CloudReadback.mjs <output.json>');
const credentialPath=path.join(process.env.LOCALAPPDATA??'','LinguistVision/gcloud/application_default_credentials.json');
const client=await new GoogleAuth({keyFilename:credentialPath,scopes:['https://www.googleapis.com/auth/cloud-platform.read-only']}).getClient();
const journal=[];

async function get(url){
  const parsed=new URL(url);
  if(parsed.protocol!=='https:'||!HOSTS.has(parsed.hostname))throw Error('host refused');
  let p;try{p=decodeURIComponent(parsed.pathname);}catch{throw Error('path was not canonical');}
  // The project segment must be EXACTLY the project (a substring check would also accept `vistavo-prod-other`).
  if(!new RegExp('^/v[12]/projects/'+PROJECT.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:[/:]|$)').test(p))throw Error('foreign project path refused');
  if(/%2e|%2f|%5c|%25|\.\./i.test(parsed.pathname)||parsed.username||parsed.password)throw Error('path was not canonical');
  for(const key of parsed.searchParams.keys())if(!['pageSize','pageToken','filter'].includes(key))throw Error('query parameter refused');
  const {token}=await client.getAccessToken();
  const response=await fetch(parsed,{method:'GET',headers:{Authorization:'Bearer '+token,'x-goog-user-project':PROJECT},redirect:'error',signal:AbortSignal.timeout(60000)});
  let data;try{data=await response.json();}catch{data=undefined;}
  journal.push({host:parsed.hostname,path:p,status:response.status});
  return {status:response.status,data};
}
const failure=r=>({readable:false,httpStatus:r.status,error:r.data?.error?.status??'unknown'});
async function listAll(base,key){
  const rows=[];let token;
  for(let page=0;page<20;page++){
    const r=await get(base+(token?(base.includes('?')?'&':'?')+'pageToken='+encodeURIComponent(token):''));
    if(r.status!==200)return {readable:false,httpStatus:r.status,error:r.data?.error?.status??'unknown'};
    rows.push(...(r.data[key]??[]));token=r.data.nextPageToken;if(!token)break;
  }
  return {readable:true,rows};
}
const short=name=>typeof name==='string'?name.split('/').pop():null;
/** Keeps roles and member kinds; person e-mails are redacted, service account names are kept (they are not personal). */
function bindings(policy){
  // Positive list: only service accounts and the two public principals are kept; every other member (people, groups, deleted or federated
  // principals) is replaced by a fixed label, so no personal address can reach the output.
  const keep=m=>/^serviceAccount:[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.gserviceaccount\.com$/.test(m)||m==='allUsers'||m==='allAuthenticatedUsers';
  return (policy?.bindings??[]).map(b=>({role:b.role,members:(b.members??[]).map(m=>keep(m)?m:'<other member redacted>')}));
}

/** Environment variable NAMES only; the value is kept just for the few non-secret feature flags below. Secret references are marked, never read. */
const FLAGS=new Set(['VISTAVO_AI_ENABLED','VISTAVO_FILES_MODE','VISTAVO_PROJECT_ID']);
const envSummary=env=>({names:(env??[]).map(e=>e.name).sort(),fromSecret:(env??[]).filter(e=>e.valueSource).map(e=>e.name).sort(),flags:Object.fromEntries((env??[]).filter(e=>FLAGS.has(e.name)&&typeof e.value==='string').map(e=>[e.name,e.value]))});

const result={project:PROJECT,region:REGION,generatedAt:new Date().toISOString(),mode:'GET only; read-only scope; no business data'};

const proj=await get(`https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT}`);
result.project_state=proj.status===200?{readable:true,lifecycleState:proj.data.lifecycleState}:failure(proj);
const bill=await get(`https://cloudbilling.googleapis.com/v1/projects/${PROJECT}/billingInfo`);
result.billing=bill.status===200?{readable:true,billingEnabled:bill.data.billingEnabled===true}:failure(bill);

const jobs=await listAll(`https://cloudscheduler.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/jobs`,'jobs');
result.scheduler=jobs.readable?{readable:true,count:jobs.rows.length,jobs:jobs.rows.map(j=>({name:short(j.name),state:j.state,schedule:j.schedule,timeZone:j.timeZone,target:j.httpTarget?{method:j.httpTarget.httpMethod,host:j.httpTarget.uri?new URL(j.httpTarget.uri).hostname:null,path:j.httpTarget.uri?new URL(j.httpTarget.uri).pathname:null,oidcServiceAccount:j.httpTarget.oidcToken?.serviceAccountEmail??null}:null,lastAttemptTime:j.lastAttemptTime??null,scheduleTime:j.scheduleTime??null,lastStatusCode:j.status?.code??null,attemptDeadline:j.attemptDeadline,retryCount:j.retryConfig?.retryCount??null}))}:jobs;

const services=await listAll(`https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services`,'services');
if(services.readable){
  const rows=[];
  for(const s of services.rows){
    const policy=await get(`https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${short(s.name)}:getIamPolicy`);
    const iam=policy.status===200?{readable:true,bindings:bindings(policy.data)}:failure(policy);
    const all=iam.readable?iam.bindings.flatMap(b=>b.members):[];
    rows.push({name:short(s.name),ingress:s.ingress,invokerIamCheck:s.invokerIamDisabled===true?'DISABLED':'enabled',minInstances:s.scaling?.minInstanceCount??s.template?.scaling?.minInstanceCount??null,maxInstances:s.template?.scaling?.maxInstanceCount??null,timeout:s.template?.timeout,serviceAccount:s.template?.serviceAccount,image:s.template?.containers?.[0]?.image??null,env:envSummary(s.template?.containers?.[0]?.env),latestReadyRevision:short(s.latestReadyRevision),conditionState:s.terminalCondition?.state??null,iam,publicInvoker:iam.readable?all.some(m=>m==='allUsers'||m==='allAuthenticatedUsers'):null});
  }
  result.cloud_run_services={readable:true,count:rows.length,services:rows};
}else result.cloud_run_services=services;

const rjobs=await listAll(`https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/jobs`,'jobs');
result.cloud_run_jobs=rjobs.readable?{readable:true,count:rjobs.rows.length,jobs:rjobs.rows.map(j=>({name:short(j.name),image:j.template?.template?.containers?.[0]?.image??null,serviceAccount:j.template?.template?.serviceAccount,maxRetries:j.template?.template?.maxRetries??null,timeout:j.template?.template?.timeout,taskCount:j.template?.taskCount??null,env:envSummary(j.template?.template?.containers?.[0]?.env),latestExecution:short(j.latestCreatedExecution?.name),conditionState:j.terminalCondition?.state??null,generation:j.generation}))}:rjobs;

const sas=await listAll(`https://iam.googleapis.com/v1/projects/${PROJECT}/serviceAccounts?pageSize=100`,'accounts');
result.service_accounts=sas.readable?{readable:true,count:sas.rows.length,disabled:sas.rows.filter(a=>a.disabled).length,accounts:sas.rows.map(a=>({email:a.email,disabled:a.disabled===true}))}:sas;

const dbs=await listAll(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases`,'databases');
if(dbs.readable){
  const rows=[];
  for(const d of dbs.rows){
    const name=short(d.name);
    const idx=await listAll(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${encodeURIComponent(name)}/collectionGroups/-/indexes`,'indexes');
    // Explicit single-field index settings only (exemptions would break equality queries that rely on automatic indexes).
    const overrides=await listAll(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${encodeURIComponent(name)}/collectionGroups/-/fields?filter=${encodeURIComponent('indexConfig.usesAncestorConfig=false')}`,'fields');
    rows.push({name,fieldOverrides:overrides.readable?{readable:true,count:overrides.rows.length,list:overrides.rows.map(f=>({field:String(f.name).split('/collectionGroups/')[1],indexes:(f.indexConfig?.indexes??[]).map(i=>`${i.queryScope}:${(i.fields??[]).map(x=>x.fieldPath+':'+(x.order??x.arrayConfig)).join(',')}`)}))}:overrides,type:d.type,locationId:d.locationId,concurrencyMode:d.concurrencyMode,indexes:idx.readable?{readable:true,count:idx.rows.length,list:idx.rows.map(i=>({collectionGroup:String(i.name).split('/collectionGroups/')[1]?.split('/')[0],queryScope:i.queryScope,state:i.state,fields:(i.fields??[]).map(f=>`${f.fieldPath}:${f.order??f.arrayConfig}`)}))}:idx});
  }
  result.firestore={readable:true,databases:rows};
}else result.firestore=dbs;

result.requests=journal.length;result.methods=[...new Set(journal.map(()=>'GET'))];
writeFileSync(out,JSON.stringify(result,null,2));
writeFileSync(out.replace(/\.json$/,'.journal.json'),JSON.stringify({project:PROJECT,note:'GET requests only; paths and HTTP status; no tokens or bodies',requests:journal},null,2));
console.log(JSON.stringify({ok:true,requests:journal.length,nonOk:journal.filter(j=>j.status!==200).map(j=>({path:j.path,status:j.status}))}));
