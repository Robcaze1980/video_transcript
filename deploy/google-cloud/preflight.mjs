import fs from 'node:fs/promises';
import path from 'node:path';
import {GoogleAuth} from 'google-auth-library';

// Fixed project boundary; this entrypoint never changes global gcloud or ADC settings.
const project='vistavo-prod', number='107404655346';
const mode=process.argv[2]??'inspect';
if(!['inspect','enable'].includes(mode))throw Error('Expected inspect or enable');
const dir='outputs/vistavo-backend-fixes';
process.on('uncaughtException',error=>{console.error(JSON.stringify({error:error.name,code:error.code??error.cause?.code??'CLOUD_REQUEST_FAILED'}));process.exitCode=1;});
const client=await new GoogleAuth({keyFilename:path.join(process.env.LOCALAPPDATA,'LinguistVision/gcloud/application_default_credentials.json'),scopes:['https://www.googleapis.com/auth/cloud-platform']}).getClient();
async function request(url,method='GET',body){const {token}=await client.getAccessToken();const r=await fetch(url,{method,headers:{Authorization:'Bearer '+token,'x-goog-user-project':project,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();return{status:r.status,data};}
const actual=await request(`https://cloudresourcemanager.googleapis.com/v1/projects/${project}`);
if(actual.status!==200||actual.data.projectId!==project||actual.data.projectNumber!==number||actual.data.lifecycleState!=='ACTIVE')throw Error('Project boundary failed');
const services=['cloudbilling.googleapis.com','compute.googleapis.com','servicenetworking.googleapis.com','sqladmin.googleapis.com','iam.googleapis.com','secretmanager.googleapis.com','artifactregistry.googleapis.com','cloudbuild.googleapis.com','run.googleapis.com'];
if(mode==='enable'){
 const r=await request(`https://serviceusage.googleapis.com/v1/projects/${number}/services:batchEnable`,'POST',{serviceIds:services});
 await fs.writeFile(`${dir}/foundation-enable-submit.json`,JSON.stringify({at:new Date().toISOString(),project,...r},null,2));
 if(r.status!==200)throw Error('API enable rejected; see sanitized receipt');
 const operation=r.data.name;
 if(operation&&!r.data.done){let done=false;for(let i=0;i<36;i++){await new Promise(resolve=>setTimeout(resolve,5000));const p=await request('https://serviceusage.googleapis.com/v1/'+operation);if(p.status!==200||p.data.error)throw Error('API enable operation failed');if(p.data.done){done=true;break;}}if(!done)throw Error('API enable still pending; inspect operation before any resubmission');}
 console.log('API enable operation complete; no compute, SQL, IAM bindings or buckets created.');
}
const targets={billing:`https://cloudbilling.googleapis.com/v1/projects/${project}/billingInfo`,sql:`https://sqladmin.googleapis.com/sql/v1beta4/projects/${project}/instances`,tiers:`https://sqladmin.googleapis.com/sql/v1beta4/projects/${project}/tiers`,networks:`https://compute.googleapis.com/compute/v1/projects/${project}/global/networks`,addresses:`https://compute.googleapis.com/compute/v1/projects/${project}/global/addresses`,buckets:`https://storage.googleapis.com/storage/v1/b?project=${project}`,identities:`https://iam.googleapis.com/v1/projects/${project}/serviceAccounts`,run:`https://run.googleapis.com/v2/projects/${project}/locations/us-central1/services`};
const results={};for(const[k,url]of Object.entries(targets))results[k]=await request(url);
const report={at:new Date().toISOString(),project,mode,results};
await fs.writeFile(`${dir}/foundation-inspect-${mode}.json`,JSON.stringify(report,null,2));
const tier=results.tiers.data.items?.find(t=>t.tier==='db-g1-small');
console.log(JSON.stringify({project,billingEnabled:results.billing.data.billingEnabled,billingAccount:results.billing.data.billingAccountName,status:Object.fromEntries(Object.entries(results).map(([k,v])=>[k,v.status])),candidateTier:tier,resourceCounts:Object.fromEntries(Object.entries(results).filter(([k])=>k!=='billing'&&k!=='tiers').map(([k,v])=>[k,(v.data.items??v.data.accounts??v.data.services??[]).length]))}));
if(mode==='enable'&&(results.billing.status!==200||!results.billing.data.billingEnabled||results.billing.data.billingAccountName!=='billingAccounts/01EA15-CD60DD-2E4270'))throw Error('Approved billing boundary failed; do not create resources');
