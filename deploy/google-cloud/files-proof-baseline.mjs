import fs from 'node:fs/promises';import {cloudClient} from './cloudClient.mjs';
export async function verifyProofBaseline(cloud,receipt){
 const member='serviceAccount:vistavo-bootstrap@vistavo-prod.iam.gserviceaccount.com';
 const sources=[['project','https://cloudresourcemanager.googleapis.com/v1/projects/vistavo-prod:getIamPolicy','POST',{options:{requestedPolicyVersion:3}}],['media','https://storage.googleapis.com/storage/v1/b/vistavo-prod-107404655346-media/iam?optionsRequestedPolicyVersion=3','GET'],['builds','https://storage.googleapis.com/storage/v1/b/vistavo-prod-107404655346-builds/iam?optionsRequestedPolicyVersion=3','GET'],['artifact','https://artifactregistry.googleapis.com/v1/projects/vistavo-prod/locations/us-central1/repositories/vistavo:getIamPolicy?options.requestedPolicyVersion=3','GET']];
 const checks=[];
 for(const [label,url,method,body]of sources){const current=await cloud.required(url,method,body,'proof-baseline-'+label),prior=receipt.previousPolicies?.find(x=>x.label===label)?.policy;
  const baseline=prior??current;if((baseline.bindings??[]).some(b=>b.members?.includes(member)))throw Error('Proof identity has preexisting privileges '+label);checks.push({resource:label,previousGrants:0,source:prior?'pre-mutation IAM snapshot':'current IAM read'});
 }
 const own='https://iam.googleapis.com/v1/projects/vistavo-prod/serviceAccounts/vistavo-bootstrap@vistavo-prod.iam.gserviceaccount.com';
 const keys=await cloud.required(own+'/keys?keyTypes=USER_MANAGED','GET',undefined,'proof-user-key-check');if(keys.keys?.length)throw Error('Proof identity has user-managed keys');
 const self=await cloud.required(own+':getIamPolicy','POST',{options:{requestedPolicyVersion:3}},'proof-self-baseline');
 let saved;try{saved=JSON.parse(await fs.readFile('outputs/vistavo-gcs-cloud/deploy-state.json','utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const old=saved?.previousPolicies?.find(x=>x.url===own)?.policy??self;if(old.bindings?.some(b=>b.members?.includes(member)))throw Error('Proof self privileges preexist');checks.push({resource:'self',previousGrants:0,userManagedKeys:0});
 const api=await cloud.required('https://serviceusage.googleapis.com/v1/projects/107404655346/services/iamcredentials.googleapis.com');if(api.state!=='ENABLED')throw Error('IAM credentials API unavailable');
 await fs.writeFile('outputs/vistavo-gcs-cloud/proof-baseline-verified.json',JSON.stringify({at:new Date().toISOString(),checks,iamCredentials:'ENABLED',retrospectiveSnapshots:checks.some(x=>x.source==='pre-mutation IAM snapshot')},null,2));
}
