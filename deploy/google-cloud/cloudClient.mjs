import fs from 'node:fs/promises';import path from 'node:path';import {GoogleAuth} from 'google-auth-library';
export const project='vistavo-prod',projectNumber='107404655346',region='us-central1';
export async function cloudClient(journal){
 const credentialPath=path.join(process.env.LOCALAPPDATA,'LinguistVision/gcloud/application_default_credentials.json');
 const client=await new GoogleAuth({keyFilename:credentialPath,scopes:['https://www.googleapis.com/auth/cloud-platform']}).getClient();
 let events=[];try{const previous=JSON.parse(await fs.readFile(journal,'utf8'));if(!Array.isArray(previous.events))throw Error('Bad journal');events=previous.events;}catch(e){if(e.code!=='ENOENT')throw e;}
 events.push({at:new Date().toISOString(),stage:'attempt-start',method:'LOCAL',status:0});
 async function record(stage,method,status,data){events.push({at:new Date().toISOString(),stage,method,status,operation:data?.name,error:data?.error?{code:data.error.code,status:data.error.status}:undefined});await fs.writeFile(journal,JSON.stringify({project,events},null,2));}
 async function request(url,method='GET',body,stage='request'){
  const parsed=new URL(url);
  if(parsed.protocol!=='https:'||!['cloudresourcemanager.googleapis.com','cloudbilling.googleapis.com','serviceusage.googleapis.com','firestore.googleapis.com','iam.googleapis.com','iamcredentials.googleapis.com','storage.googleapis.com','run.googleapis.com','cloudscheduler.googleapis.com','cloudbuild.googleapis.com','artifactregistry.googleapis.com','firebaserules.googleapis.com','compute.googleapis.com','secretmanager.googleapis.com'].includes(parsed.hostname))throw Error('Cloud API boundary');
  const pathname=decodeURIComponent(parsed.pathname),ownProject=pathname.includes('/projects/'+project+'/')||pathname.endsWith('/projects/'+project)||pathname.startsWith('/v1/projects/'+project+':');
  const globalRead=method==='GET'&&(pathname.startsWith('/v1/operations/')||pathname.startsWith('/v1/roles/'));
  const ownService=parsed.hostname==='serviceusage.googleapis.com'&&pathname.startsWith('/v1/projects/'+projectNumber+'/services/');
  const ownBucket=parsed.hostname==='storage.googleapis.com'&&['/storage/v1/b/vistavo-prod-107404655346-media','/storage/v1/b/vistavo-prod-107404655346-builds'].some(prefix=>pathname===prefix||pathname.startsWith(prefix+'/'));
  const ownIdentity=parsed.hostname==='iamcredentials.googleapis.com'&&pathname.startsWith('/v1/projects/-/serviceAccounts/')&&pathname.includes('@'+project+'.iam.gserviceaccount.com:');
  if(!ownProject&&!globalRead&&!ownService&&!ownBucket&&!ownIdentity)throw Error('Foreign project path refused');
  if(method!=='GET'&&parsed.hostname==='compute.googleapis.com')throw Error('No compute or SQL provisioning in this phase');
  if(method!=='GET'&&/\/keys(?:\/|:|$)/.test(pathname))throw Error('Service account key creation forbidden');
  let response,data;
  try{const {token}=await client.getAccessToken();response=await fetch(parsed,{method,headers:{Authorization:'Bearer '+token,'x-goog-user-project':project,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000)});data=await response.json();}
  catch(e){await record(stage,method,0,{error:{status:e.cause?.code??e.code??e.name}});throw Error('Cloud request failed at '+stage);}
  await record(stage,method,response.status,data);return {status:response.status,data};
 }
 async function required(url,method='GET',body,stage='required'){const r=await request(url,method,body,stage);if(r.status<200||r.status>=300)throw Error(`Cloud ${stage}: HTTP ${r.status} ${r.data.error?.status??''}`);return r.data;}
 async function wait(name,host,version='v1'){if(!name||!name.startsWith('operations/')&&!name.startsWith('projects/'+project+'/'))throw Error('Operation boundary');
  for(let n=0;n<120;n++){const value=await required('https://'+host+'/'+version+'/'+name,'GET',undefined,'operation-read');if(value.done){if(value.error)throw Error('Cloud operation failed');return value.response;}
   await new Promise(resolve=>setTimeout(resolve,2000));}throw Error('Operation still pending; inspect receipt before any retry');}
 const actual=await required('https://cloudresourcemanager.googleapis.com/v1/projects/'+project,'GET',undefined,'project-boundary');
 if(actual.projectId!==project||actual.projectNumber!==projectNumber||actual.lifecycleState!=='ACTIVE')throw Error('Project mismatch');
 const billing=await required('https://cloudbilling.googleapis.com/v1/projects/'+project+'/billingInfo','GET',undefined,'billing-boundary');
 if(!billing.billingEnabled||billing.billingAccountName!=='billingAccounts/01EA15-CD60DD-2E4270')throw Error('Billing mismatch');
 return {client,request,required,wait,events};
}
