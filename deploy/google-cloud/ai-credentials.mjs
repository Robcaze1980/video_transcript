import fs from 'node:fs/promises';
import {cloudClient,project,projectNumber} from './cloudClient.mjs';

// Operator-only credential preparation. Default never loads ADC or calls Google.
const apply=process.argv.includes('--apply');
if(process.argv.slice(2).some(arg=>arg!=='--apply'))throw Error('Only --apply is supported');
if(project!=='vistavo-prod'||projectNumber!=='107404655346')throw Error('Credential project boundary');
const id='vistavo-gemini-provider',keyName=`projects/${projectNumber}/locations/global/keys/${id}`;
const keyBase=`https://apikeys.googleapis.com/v2/projects/${projectNumber}/locations/global/keys`;
const secretBase=`https://secretmanager.googleapis.com/v1/projects/${project}/secrets`,secretAlias=`projects/${project}/secrets/${id}`,secretNumber=`projects/${projectNumber}/secrets/${id}`;
const metadata={displayName:'Vistavo private Gemini cloud',annotations:{app:'vistavo'},restrictions:{apiTargets:[{service:'generativelanguage.googleapis.com'}]}};
const models=['gemini-3.8-flash','gemini-3.8-flash-tts'];
if(!apply){console.log(JSON.stringify({apply:false,project,key:{name:keyName,type:'STANDARD (not service-account-bound)',displayName:metadata.displayName,apiTargets:metadata.restrictions.apiTargets},secret:secretAlias,models,paidGeneration:false,serviceAccountKeyFiles:false,foreignExistingKey:'not read, copied, changed or revoked',credentials:'memory only; no value/hash/URL payload logged'}));process.exit(0);}
const out='outputs/vistavo-ai-cloud',receiptFile=out+'/credentials-receipt.json';
await fs.mkdir(out,{recursive:true});
let receipt={project,projectNumber,key:{name:keyName},secret:{name:secretAlias},events:[],models:[],complete:false};
try{const saved=JSON.parse(await fs.readFile(receiptFile,'utf8'));if(saved.project!==project||saved.projectNumber!==projectNumber||saved.key?.name!==keyName||![secretAlias,secretNumber].includes(saved.secret?.name)||!Array.isArray(saved.events))throw Error('Credential receipt boundary');receipt=saved;}catch(error){if(error.code!=='ENOENT')throw error;}
async function save(){await fs.writeFile(receiptFile,JSON.stringify({...receipt,updatedAt:new Date().toISOString()},null,2));}
async function event(stage,method,status,extra={}){receipt.events.push({at:new Date().toISOString(),stage,method,status,...extra});await save();}
const secretNameValid=name=>name===secretAlias||name===secretNumber;
const versionValid=name=>typeof name==='string'&&(name.startsWith(secretAlias+'/versions/')||name.startsWith(secretNumber+'/versions/'))&&/\/versions\/[1-9]\d*$/.test(name);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function assertKey(key){
 if(key.name!==keyName||key.deleteTime||key.displayName!==metadata.displayName||!same(key.annotations??{},metadata.annotations)||key.serviceAccountEmail||
  !same(key.restrictions??{},metadata.restrictions)||typeof key.uid!=='string')throw Error('Existing API key metadata or restrictions differ');
 if(receipt.key.uid&&receipt.key.uid!==key.uid)throw Error('API key identity changed');
}
function assertSecret(secret){
 if(!secretNameValid(secret.name)||secret.labels?.app!=='vistavo'||!secret.replication?.automatic||Object.keys(secret.replication).some(k=>k!=='automatic')||secret.deleteTime)throw Error('Existing secret metadata differs');
 if(receipt.secret.createTime&&receipt.secret.createTime!==secret.createTime)throw Error('Secret identity changed');
}
let c;
async function management(url,method='GET',body,stage='request'){
 const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.hash)throw Error('Credential transport boundary');
 if(u.hostname==='apikeys.googleapis.com'){
  const own=u.pathname==='/v2/'+keyName||u.pathname==='/v2/'+keyName+'/keyString'||u.pathname==='/v2/'+keyName+':getKeyString'||u.pathname==='/v2/projects/'+projectNumber+'/locations/global/keys';
  const op=method==='GET'&&receipt.key.operation&&u.pathname==='/v2/'+receipt.key.operation;
  if(!own&&!op)throw Error('Foreign API key operation refused');
 }else if(u.hostname==='secretmanager.googleapis.com'){
  const prefixes=['/v1/'+secretAlias,'/v1/'+secretNumber];
  if(u.pathname!=='/v1/projects/'+project+'/secrets'&&!prefixes.some(prefix=>u.pathname===prefix||u.pathname===prefix+':addVersion'||u.pathname===prefix+'/versions'||u.pathname.startsWith(prefix+'/versions/')))throw Error('Foreign secret operation refused');
 }else throw Error('Credential management host refused');
 let r,data;try{const {token}=await c.client.getAccessToken();r=await fetch(u,{method,headers:{Authorization:'Bearer '+token,'x-goog-user-project':project,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000)});data=await r.json();}
 catch(error){await event(stage,method,0,{errorType:typeof error?.name==='string'?error.name:'Error'});throw Error('Credential transport failed at '+stage);}
 // Deliberately never persist full metadata/error/operation bodies: they may contain a keyString.
 await event(stage,method,r.status,{errorStatus:typeof data?.error?.status==='string'?data.error.status:undefined});return {status:r.status,data};
}
async function required(url,method='GET',body,stage='required'){const r=await management(url,method,body,stage);if(r.status<200||r.status>=300)throw Error('Credential '+stage+' HTTP '+r.status);return r.data;}
async function inspectKeyOperation(){
 if(!receipt.key.operation)return true;
 if(!/^operations\/[A-Za-z0-9_.-]+$/.test(receipt.key.operation))throw Error('API key operation boundary');
 const operation=await required('https://apikeys.googleapis.com/v2/'+receipt.key.operation,'GET',undefined,'inspect-key-operation');
 if(!operation.done){console.log(JSON.stringify({pending:true,stage:'key-create',operation:receipt.key.operation,reenter:'--apply inspects saved operation without resubmitting'}));return false;}
 if(operation.error){receipt.key.operationFailed={code:operation.error.code};await save();throw Error('Recorded API key creation failed');}
 receipt.key.operationDone=true;await save();return true;
}
try{
 c=await cloudClient(out+'/credentials-boundary-journal.json');
 // API enablement belongs to the foundation, not an implicit credential side effect.
 for(const service of ['apikeys.googleapis.com','generativelanguage.googleapis.com','secretmanager.googleapis.com']){const state=await c.required('https://serviceusage.googleapis.com/v1/projects/'+projectNumber+'/services/'+service,'GET',undefined,'credential-api-'+service);if(state.state!=='ENABLED')throw Error('Required credential API is not enabled');}
 if(receipt.key.operationFailed)throw Error('Prior key operation failed; inspect before changing receipt');
 if(receipt.key.operation&&!receipt.key.operationDone&&!await inspectKeyOperation())process.exit(0);
 let key=await management('https://apikeys.googleapis.com/v2/'+keyName,'GET',undefined,'key-metadata');
 if(key.status===404){
  if(receipt.key.createIntentAt)throw Error('Earlier key submission is ambiguous; inspect the saved operation before retry');
  receipt.key.createIntentAt=new Date().toISOString();await save();
  const operation=await required(keyBase+'?keyId='+id,'POST',metadata,'create-restricted-standard-key');
  if(typeof operation.name!=='string'||!/^operations\/[A-Za-z0-9_.-]+$/.test(operation.name))throw Error('Unexpected API key operation handle');
  receipt.key.operation=operation.name;await save();if(!await inspectKeyOperation())process.exit(0);
  key=await management('https://apikeys.googleapis.com/v2/'+keyName,'GET',undefined,'key-create-readback');
 }
 if(key.status!==200)throw Error('API key metadata not readable');assertKey(key.data);
 receipt.key={...receipt.key,name:keyName,uid:key.data.uid,displayName:key.data.displayName,annotations:key.data.annotations,restrictions:key.data.restrictions,standard:true,serviceAccountBound:false};await save();
 const fetched=await required('https://apikeys.googleapis.com/v2/'+keyName+'/keyString','GET',undefined,'get-owned-key-string');
 let value=fetched.keyString;if(typeof value!=='string'||value.length<20||value.length>512||/\s/.test(value))throw Error('Owned API key unavailable');
 let secret=await management(secretBase+'/'+id,'GET',undefined,'secret-metadata');
 if(secret.status===404){
  if(receipt.secret.createIntentAt)throw Error('Earlier secret creation is ambiguous; inspect before retry');
  receipt.secret.createIntentAt=new Date().toISOString();await save();
  await required(secretBase+'?secretId='+id,'POST',{labels:{app:'vistavo'},replication:{automatic:{}}},'create-provider-secret');
  secret=await management(secretBase+'/'+id,'GET',undefined,'secret-create-readback');
 }
 if(secret.status!==200)throw Error('Secret metadata not readable');assertSecret(secret.data);receipt.secret={...receipt.secret,name:secret.data.name,createTime:secret.data.createTime,replication:'automatic',labels:{app:'vistavo'}};await save();
 const versions=await required('https://secretmanager.googleapis.com/v1/'+receipt.secret.name+'/versions?pageSize=100','GET',undefined,'secret-version-inventory');
 if(versions.nextPageToken)throw Error('Unexpected existing version pagination');
 if(receipt.secret.version){
  if(!versionValid(receipt.secret.version))throw Error('Stored secret version boundary');
  const version=await required('https://secretmanager.googleapis.com/v1/'+receipt.secret.version,'GET',undefined,'secret-version-readback');if(version.name!==receipt.secret.version||version.state!=='ENABLED')throw Error('Recorded secret version is not enabled');
 }else{
  if(receipt.secret.addVersionIntentAt||(versions.versions??[]).length)throw Error('Existing or ambiguous secret version; refusing duplicate addVersion');
  receipt.secret.addVersionIntentAt=new Date().toISOString();await save();
  const version=await required('https://secretmanager.googleapis.com/v1/'+receipt.secret.name+':addVersion','POST',{payload:{data:Buffer.from(value,'utf8').toString('base64')}},'add-provider-secret-version');
  if(!versionValid(version.name)||version.state!=='ENABLED')throw Error('Secret version response not confirmed');receipt.secret.version=version.name;receipt.secret.versionCreatedAt=version.createTime;await save();
 }
 const checks=[];
 for(const model of models){let r,data;try{r=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+model,{headers:{'x-goog-api-key':value},signal:AbortSignal.timeout(20000)});data=await r.json();}catch(error){await event('validate-owned-key-model','GET',0,{model,errorType:error?.name});throw Error('Model metadata transport unavailable');}
  checks.push({model,httpStatus:r.status,name:data.name,supportedGenerationMethods:data.supportedGenerationMethods,inputTokenLimit:data.inputTokenLimit,outputTokenLimit:data.outputTokenLimit});
  receipt.models=checks;await save();if(r.status!==200||data.name!=='models/'+model||!data.supportedGenerationMethods?.includes('generateContent'))throw Error('Owned key model access is not ready');
 }
 value='';receipt.complete=true;receipt.paidGeneration=false;receipt.keyValueStoredLocally=false;receipt.serviceAccountKeyFiles=false;receipt.finishedAt=new Date().toISOString();await save();
 console.log(JSON.stringify({complete:true,project,keyResource:keyName,standard:true,apiRestrictedTo:'generativelanguage.googleapis.com',secretVersion:receipt.secret.version,modelChecks:checks.map(x=>({model:x.model,status:x.httpStatus})),paidGeneration:false,secretValuesLogged:false}));
}catch(error){console.error(JSON.stringify({event:'ai-credentials-failed',type:error?.name??'Error',code:typeof error?.code==='string'||typeof error?.code==='number'?error.code:undefined,detail:typeof error?.message==='string'&&/^(Credential |Recorded |Prior |Required |Owned |Existing |Earlier |Unexpected |Stored |Secret |Model |API key |Foreign )/.test(error.message)?error.message:undefined}));process.exitCode=1;}
