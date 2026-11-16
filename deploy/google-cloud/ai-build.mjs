import fs from 'node:fs/promises';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';import {cloudClient,project,region} from './cloudClient.mjs';
const apply=process.argv.includes('--apply'),inspect=process.argv.includes('--inspect'),out='outputs/vistavo-ai-cloud',tag='files-'+new Date().toISOString().replace(/\D/g,'').slice(0,14);
if(process.argv.slice(2).some(v=>!['--apply','--inspect'].includes(v))||apply&&inspect)throw Error('Use --apply or --inspect, never both');
if(inspect){
 const receipt=JSON.parse(await fs.readFile(out+'/build-receipt.json','utf8')),id=receipt.operation?.metadata?.build?.id;
 const prefix=region+'-docker.pkg.dev/'+project+'/vistavo/files';
 if(!/^[a-f0-9-]{36}$/.test(id)||!new RegExp('^'+prefix.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+':files-[0-9]{14}$').test(receipt.image??''))throw Error('Build receipt boundary');
 const c=await cloudClient(out+'/build-inspect-journal.json');
 // Cloud Build's operations/build/... handle is not a globally GET-able operation.
 const build=await c.required('https://cloudbuild.googleapis.com/v1/projects/'+project+'/locations/'+region+'/builds/'+id,'GET',undefined,'build-inspect');
 await fs.writeFile(out+'/build-inspected.json',JSON.stringify(build,null,2));
 if(build.id!==id||build.projectId!==project||build.serviceAccount!=='projects/'+project+'/serviceAccounts/vistavo-builder@'+project+'.iam.gserviceaccount.com'||
   build.source?.storageSource?.bucket!=='vistavo-prod-107404655346-builds'||build.source.storageSource.object!==receipt.operation.metadata.build.source?.storageSource?.object||
   build.source.storageSource.generation!==receipt.operation.metadata.build.source?.storageSource?.generation)throw Error('Remote build differs from submitted source/identity');
 if(build.status!=='SUCCESS'){
  console.log(JSON.stringify({id,status:build.status,ready:false,failureInfo:build.failureInfo}));
  if(['FAILURE','INTERNAL_ERROR','TIMEOUT','CANCELLED','EXPIRED'].includes(build.status))process.exitCode=1;
 }else{
  const result=build.results?.images?.find(v=>v.name===receipt.image);
  if(!result||!/^sha256:[a-f0-9]{64}$/.test(result.digest??''))throw Error('Successful build has no matching immutable image');
  const image=prefix+'@'+result.digest;
  const remote=await c.required('https://artifactregistry.googleapis.com/v1/projects/'+project+'/locations/'+region+'/repositories/vistavo/dockerImages/'+encodeURIComponent('files@'+result.digest),'GET',undefined,'built-image-inspect');
  if(remote.uri!==image)throw Error('Built artifact digest unconfirmed');
  await fs.writeFile(out+'/build-ready.json',JSON.stringify({project,buildId:id,image,sourceSha256:receipt.sourceSha256,source:build.source.storageSource,finishTime:build.finishTime,verifiedAt:new Date().toISOString()},null,2));
  console.log(JSON.stringify({id,status:build.status,ready:true,image}));
 }
 process.exit(process.exitCode??0);
}
if(!apply){console.log(JSON.stringify({apply:false,source:'explicit package+server source+Dockerfile allowlist',destination:region+'-docker.pkg.dev/'+project+'/vistavo/files:'+tag}));process.exit(0);}
let prior;try{prior=JSON.parse(await fs.readFile(out+'/build-receipt.json','utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
const c=await cloudClient(out+'/build-journal.json');if(prior){const id=prior.operation?.metadata?.build?.id;if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Previous build receipt invalid');const old=await c.required('https://cloudbuild.googleapis.com/v1/projects/'+project+'/locations/'+region+'/builds/'+id);if(['QUEUED','WORKING','PENDING','STATUS_UNKNOWN'].includes(old.status))throw Error('Previous build still active; inspect only');await fs.writeFile(out+'/build-'+id+'-receipt.json',JSON.stringify(prior,null,2));try{await fs.rename(out+'/build-ready.json',out+'/build-'+id+'-ready.json');}catch(e){if(e.code!=='ENOENT')throw e;}}
const archive=out+'/'+tag+'.tar.gz';
const codeFiles=(await fs.readdir('server/commercial')).filter(n=>n.endsWith('.ts')&&!n.endsWith('.test.ts')).map(n=>'server/commercial/'+n);
const files=['package.json','package-lock.json','deploy/google-cloud/ai.Dockerfile','deploy/google-cloud/ai-bundle.mjs','deploy/google-cloud/probe/ai-es-fixture.mp4',...codeFiles];
const tar=spawnSync('tar.exe',['-czf',archive,...files],{encoding:'utf8'});if(tar.status!==0)throw Error('Source archive failed');
const bytes=await fs.readFile(archive),digest=createHash('sha256').update(bytes).digest('hex'),source='files-source/'+tag+'-'+digest.slice(0,12)+'.tar.gz';
const {token}=await c.client.getAccessToken();const r=await fetch('https://storage.googleapis.com/upload/storage/v1/b/vistavo-prod-107404655346-builds/o?uploadType=media&ifGenerationMatch=0&name='+encodeURIComponent(source),{method:'POST',headers:{Authorization:'Bearer '+token,'x-goog-user-project':project,'Content-Type':'application/gzip'},body:bytes,signal:AbortSignal.timeout(60000)});
if(!r.ok)throw Error('Source upload HTTP '+r.status);const object=await r.json();
const image=region+'-docker.pkg.dev/'+project+'/vistavo/files:'+tag;
const body={source:{storageSource:{bucket:'vistavo-prod-107404655346-builds',object:source,generation:object.generation}},steps:[{name:'gcr.io/cloud-builders/docker',args:['build','-f','deploy/google-cloud/ai.Dockerfile','-t',image,'.']}],images:[image],serviceAccount:'projects/'+project+'/serviceAccounts/vistavo-builder@'+project+'.iam.gserviceaccount.com',options:{logging:'CLOUD_LOGGING_ONLY'},timeout:'1200s',tags:['vistavo-files-candidate']};
const operation=await c.required('https://cloudbuild.googleapis.com/v1/projects/'+project+'/locations/'+region+'/builds','POST',body,'build-submit');
await fs.writeFile(out+'/build-receipt.json',JSON.stringify({at:new Date().toISOString(),sourceSha256:digest,files,operation,image},null,2));
console.log(JSON.stringify({submitted:true,operation:operation.name,image}));
