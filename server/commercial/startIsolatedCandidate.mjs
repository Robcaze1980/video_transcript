import net from 'node:net';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';

const emulatorEnv={FIRESTORE_EMULATOR_HOST:'127.0.0.1:8185',FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099',VISTAVO_ISOLATED_CANDIDATE:'1'};
for(const [name,value] of Object.entries(emulatorEnv)){
 if(process.env[name]&&process.env[name]!==value)throw Error(`${name} is not the isolated emulator value`);
 process.env[name]=value;
}
for(const name of ['GOOGLE_APPLICATION_CREDENTIALS','VISTAVO_PROJECT_ID','VISTAVO_ACCOUNT_MODE','GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT','FIREBASE_CONFIG'])if(process.env[name])throw Error(`Production environment is forbidden: ${name}`);

async function assertLoopbackPort(port){await new Promise((resolve,reject)=>{const socket=net.createConnection({host:'127.0.0.1',port});socket.once('connect',()=>{socket.destroy();resolve();});socket.once('error',reject);});}
async function assertCandidatePortFree(port){
 try{await assertLoopbackPort(port);throw Error(`Candidate port ${port} is already occupied`);}
 catch(error){if(error.message.includes('already occupied'))throw error;if(error.code!=='ECONNREFUSED')throw Error(`Unable to verify candidate port ${port} is free`);}
}
async function waitForReady(port,path,child){
 const deadline=Date.now()+15000;
 while(Date.now()<deadline){
  if(child.exitCode!==null)throw Error(`Candidate process exited before port ${port} was ready`);
  try{const response=await fetch(`http://127.0.0.1:${port}${path}`,{headers:{Origin:'http://127.0.0.1:3003'},signal:AbortSignal.timeout(1000)});if(response.ok){await response.body?.cancel();return;}await response.body?.cancel();}catch{}
  await new Promise(resolve=>setTimeout(resolve,150));
 }
 throw Error(`Candidate HTTP endpoint ${port}${path} did not become ready`);
}
for(const port of [8185,9099])await assertLoopbackPort(port);
for(const port of [3003,3004,3005,3006])await assertCandidatePortFree(port);

const children=[];
const apiEntry=resolve('server/commercial/isolatedCandidateLocal.ts');
const proxyEntry=resolve('server/commercial/isolatedCandidateProxy.ts');
const gatewayEntry=resolve('server/commercial/isolatedCloudRunBridge.ts');
const gatewayToken=randomBytes(32).toString('hex');
function launch(role){
 const entry=role==='front'?proxyEntry:role==='gateway'?gatewayEntry:apiEntry;
 const env={...process.env};if(role==='gateway'||role==='cloud')env.VISTAVO_LOCAL_GATEWAY_TOKEN=gatewayToken;
 const child=spawn(process.execPath,['--no-network-family-autoselection','--import','tsx',entry,role],{cwd:process.cwd(),env,stdio:'inherit',windowsHide:true});
 children.push(child);
 child.once('error',error=>{console.error(JSON.stringify({event:'isolated-candidate-child-error',role,message:error.message}));stop(1);});
 child.once('exit',(code,signal)=>{if(!shuttingDown){console.error(JSON.stringify({event:'isolated-candidate-child-exit',role,code,signal}));stop(code||1);}});
 return child;
}
let shuttingDown=false;
function stop(code=0){
 if(shuttingDown)return;
 shuttingDown=true;
 for(const child of children)if(child.exitCode===null)child.kill('SIGTERM');
 const hardStop=setTimeout(()=>{for(const child of children)if(child.exitCode===null)child.kill('SIGKILL');process.exit(code||1);},5000);
 hardStop.unref();
 const poll=setInterval(()=>{if(children.every(child=>child.exitCode!==null)){clearInterval(poll);clearTimeout(hardStop);process.exit(code);}},50);
}
process.once('SIGINT',()=>stop(0));process.once('SIGTERM',()=>stop(0));

try{
 const account=launch('account');await waitForReady(3004,'/healthz',account);
 const cloud=launch('cloud');await waitForReady(3005,'/healthz',cloud);
 const gateway=launch('gateway');await waitForReady(3006,'/healthz',gateway);
 const front=launch('front');await waitForReady(3003,'/api/candidate/config',front);
 console.log(JSON.stringify({event:'isolated-candidate-stack-ready',origin:'http://127.0.0.1:3003',accountApi:'separate-local-process',privateBridge:'local-simulation',privateApi:'separate-loopback-process',proxyDatabaseAccess:false,projectId:'demo-vistavo-ledger',videoWorkflow:false,uploads:true,storageAdapter:'ephemeral-memory',ai:false,payments:false,googleIdentityToken:false}));
}catch(error){console.error(JSON.stringify({event:'isolated-candidate-stack-failed',message:error.message}));stop(1);}
