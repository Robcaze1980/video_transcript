import{compatible,psaConnection,assertPrivatePolicy}from'./foundation-policy.mjs';
import{createHash}from'node:crypto';
import fs from'node:fs/promises';import path from'node:path';import{GoogleAuth}from'google-auth-library';import{project,region,network,resources as bodies,serviceAccountBody}from'./resources.mjs';
// This first B1 slice creates no SQL server, secrets, keys or application service.
// Every operation is scoped to one verified project and rejects incompatible existing names.
const number='107404655346', evidenceFile='outputs/vistavo-backend-fixes/foundation-base-result.json';
const apply=process.argv.includes('--apply');const events=[];
process.on('uncaughtException',async error=>{
 const failure={error:error.name,code:error.code??error.cause?.code??'CLOUD_REQUEST_FAILED'};
 console.error(JSON.stringify(failure));process.exitCode=1;
 await record({resource:'boundary',action:'failed',...failure}).catch(()=>undefined);
});
const client=await new GoogleAuth({keyFilename:path.join(process.env.LOCALAPPDATA,'LinguistVision/gcloud/application_default_credentials.json'),scopes:['https://www.googleapis.com/auth/cloud-platform']}).getClient();
async function request(url,method='GET',body){const{token}=await client.getAccessToken();const response=await fetch(url,{method,headers:{Authorization:'Bearer '+token,'x-goog-user-project':project,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();return{status:response.status,data};}
async function required(url,method='GET',body){const r=await request(url,method,body);if(r.status<200||r.status>299)throw Error(`Request failed ${r.status} ${new URL(url).hostname}; ${r.data.error?.status??''}`);return r.data;}
async function record(event){events.push({...event,at:new Date().toISOString()});await fs.writeFile(evidenceFile,JSON.stringify({project,apply,events},null,2));console.log(JSON.stringify(event));}
async function waitOperation(operation,api){if(!operation.name)return;if(operation.done||operation.status==='DONE'){if(operation.error)throw Error('Operation returned an error');return;}
 const url=api==='compute'?operation.selfLink:(api==='artifact'?'https://artifactregistry.googleapis.com/v1/':'https://servicenetworking.googleapis.com/v1/')+operation.name;
 if(!url||!['compute.googleapis.com','www.googleapis.com','servicenetworking.googleapis.com','artifactregistry.googleapis.com'].includes(new URL(url).hostname)||
   (api==='compute'&&!new URL(url).pathname.startsWith('/compute/v1/projects/'+project+'/'))||
   (api==='artifact'&&!new URL(url).pathname.startsWith('/v1/projects/'+project+'/locations/'+region+'/operations/')))throw Error('Invalid operation boundary');
 for(let i=0;i<90;i++){await new Promise(resolve=>setTimeout(resolve,5000));const value=await required(url);if(value.done||value.status==='DONE'){if(value.error)throw Error('Operation returned an error');return;}}
 throw Error('Operation pending; inspect before resubmitting');}
async function ensure(name,getUrl,createUrl,body,compatible,api){const existing=await request(getUrl);if(existing.status===200){if(!compatible(existing.data))throw Error('Incompatible existing resource '+name);await record({resource:name,action:'verified-existing'});return existing.data;}
 if(existing.status!==404)throw Error('Cannot establish absence of '+name+' status '+existing.status);
 if(!apply){await record({resource:name,action:'would-create'});return null;}
 const result=await required(createUrl,'POST',body);if(api)await waitOperation(result,api);
 const created=await required(getUrl);if(!compatible(created))throw Error('Created resource failed verification '+name);await record({resource:name,action:'created-verified'});return created;}
const actual=await required('https://cloudresourcemanager.googleapis.com/v1/projects/'+project);
if(actual.projectId!==project||actual.projectNumber!==number||actual.lifecycleState!=='ACTIVE')throw Error('Project boundary failed');
const billing=await required('https://cloudbilling.googleapis.com/v1/projects/'+project+'/billingInfo');
if(!billing.billingEnabled||billing.billingAccountName!=='billingAccounts/01EA15-CD60DD-2E4270')throw Error('Billing boundary failed');
const contracts=JSON.parse(await fs.readFile('outputs/vistavo-backend-fixes/foundation-contracts.json','utf8'));if(contracts.unknownFields.length||!Array.isArray(contracts.outputOnlyFields)||contracts.outputOnlyFields.length||contracts.validations.length!==12||!['sql','network','subnet','peeringAddress','connection','media','builds','artifact','secret','vistavo-runtime','vistavo-bootstrap','vistavo-builder'].every(name=>contracts.validations.some(v=>v.resource===name))||contracts.resourcesSha256!==createHash('sha256').update(await fs.readFile(new URL('./resources.mjs',import.meta.url))).digest('hex'))throw Error('API contracts not validated');
const compute='https://compute.googleapis.com/compute/v1/projects/'+project;
// Fresh probes are mandatory before the first resource POST, not merely a prior log.
const probes={networks:compute+'/global/networks',addresses:compute+'/global/addresses',storage:'https://storage.googleapis.com/storage/v1/b?project='+project,identities:'https://iam.googleapis.com/v1/projects/'+project+'/serviceAccounts',artifact:'https://artifactregistry.googleapis.com/v1/projects/'+project+'/locations/'+region+'/repositories',networking:'https://servicenetworking.googleapis.com/v1/services/servicenetworking.googleapis.com/connections?network='+encodeURIComponent('projects/'+project+'/global/networks/default')};
const before={at:new Date().toISOString(),project,results:{}};
for(const[name,url]of Object.entries(probes))before.results[name]=await required(url);
await fs.writeFile('outputs/vistavo-backend-fixes/foundation-base-before.json',JSON.stringify(before,null,2));
await record({resource:'API-preflight',action:'all-required-probes-200',names:Object.keys(probes)});

await ensure('network',compute+'/global/networks/vistavo-private',compute+'/global/networks',bodies.network,compatible.network,'compute');
await ensure('subnet',compute+'/regions/'+region+'/subnetworks/vistavo-us-central1',compute+'/regions/'+region+'/subnetworks',bodies.subnet,compatible.subnet,'compute');
await ensure('PSA-range',compute+'/global/addresses/vistavo-sql-private',compute+'/global/addresses',bodies.peeringAddress,compatible.peering,'compute');
const connectionUrl='https://servicenetworking.googleapis.com/v1/services/servicenetworking.googleapis.com/connections';
// This API exposes only list/create, not a singleton GET. A complete network-scoped
// empty list establishes absence. Fail closed if pagination ever appears.
const parent=await request(compute+'/global/networks/vistavo-private');
if(parent.status===200){const connections=await required(connectionUrl+'?network='+encodeURIComponent(network));const matching=psaConnection(connections);
 if(matching)await record({resource:'PSA-connection',action:'verified-existing'});
 else if(apply){const op=await required(connectionUrl,'POST',bodies.connection);await waitOperation(op,'networking');if(!psaConnection(await required(connectionUrl+'?network='+encodeURIComponent(network))))throw Error('PSA verification failed');await record({resource:'PSA-connection',action:'created-verified'});}
 else await record({resource:'PSA-connection',action:'would-create-after-complete-empty-list'});
}else if(parent.status===404&&!apply)await record({resource:'PSA-connection',action:'would-create-after-parent-network'});
else throw Error('PSA parent network not verified');
for(const[name,body]of[['media',bodies.media],['builds',bodies.builds]])await ensure(name,'https://storage.googleapis.com/storage/v1/b/'+body.name,'https://storage.googleapis.com/storage/v1/b?project='+project,body,d=>compatible.bucket(name,d));
const repo='https://artifactregistry.googleapis.com/v1/projects/'+project+'/locations/'+region+'/repositories';
await ensure('artifact',repo+'/vistavo',repo+'?repositoryId=vistavo',bodies.artifact,compatible.artifact,'artifact');
for(const accountId of ['vistavo-runtime','vistavo-bootstrap','vistavo-builder']){const root='https://iam.googleapis.com/v1/projects/'+project+'/serviceAccounts';const email=accountId+'@'+project+'.iam.gserviceaccount.com';const description='Vistavo dedicated '+accountId+' candidate identity';await ensure(accountId,root+'/'+email,root,serviceAccountBody(accountId),d=>compatible.identity(accountId,d));}
if(apply){
 for(const bucket of [bodies.media.name,bodies.builds.name]){assertPrivatePolicy(await required('https://storage.googleapis.com/storage/v1/b/'+bucket+'/iam'));await record({resource:bucket,action:'no-public-bindings'});}
 assertPrivatePolicy(await required(repo+'/vistavo:getIamPolicy'));await record({resource:'artifact',action:'no-public-bindings'});
 for(const id of ['vistavo-runtime','vistavo-bootstrap','vistavo-builder']){const keys=await required('https://iam.googleapis.com/v1/projects/'+project+'/serviceAccounts/'+id+'@'+project+'.iam.gserviceaccount.com/keys?keyTypes=USER_MANAGED');if(keys.keys?.length)throw Error('Unexpected user-managed service account key');await record({resource:id,action:'zero-user-managed-keys'});}
}
await record({resource:'boundary',action:apply?'base-created-no-runtime':'dry-run-complete',sqlCreated:false,secretsCreated:false,iamBindingsChanged:false,appDeployed:false});
