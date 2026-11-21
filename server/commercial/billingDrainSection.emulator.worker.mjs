// A second JavaScript context for the drain SECTION, used only by the emulator fixture to produce a REAL concurrent
// pass: it gets its own module instance (so its own per-root in-flight guard) and its own Firestore client, and shares
// only the loopback emulator with the parent. No cloud, credential or HTTP route is touched.
import {parentPort,workerData} from 'node:worker_threads';
import {Firestore} from 'firebase-admin/firestore';
import {FirestoreBackend} from './firestoreBackend.ts';
import {FirestoreAi} from './firestoreAi.ts';
import {AccountBillingClient,accountIdentityKey} from './accountBillingClient.ts';
import {AccountStore} from '../account/backend.ts';
import {privateBucket} from './privateObjectPlan.ts';
import {runBillingDrainSection} from './billingDrainSection.ts';

const accountStatus={invalid:400,not_found:404,account_not_provisioned:404,conflict:409,deleted:410,quota:429,insufficient:402,invariant:503,too_early:409,forbidden:403};
class Transport{
 constructor(store){this.store=store;}
 async request(request){
  const pathname=new URL(request.url).pathname,body=request.data,parts=pathname.split('/'),reservationId=parts.at(-2);
  const httpFault=(status,code)=>Object.assign(Error('Synthetic Account refusal'),{response:{status,data:{error:code}}});
  const guard=async action=>{try{return {data:await action()};}catch(error){if(error?.response)throw error;throw httpFault(accountStatus[error?.code]??503,error?.code??'invariant');}};
  if(pathname==='/api/internal/video/reservations')return guard(async()=>({...await this.store.reserveVideo(body.identityKey,body.reservationId,body.seconds),reservationId:body.reservationId}));
  if(pathname.endsWith('/status'))return guard(()=>this.store.videoReservation(body.identityKey,reservationId));
  if(pathname.endsWith('/admit'))return guard(()=>this.store.admitVideoCall(body.identityKey,reservationId,body.seconds,body.jobId,body.attemptId,body.callKey,body.model,body.requestSha256));
  if(pathname.endsWith('/release')||pathname.endsWith('/capture')){
   const action=pathname.endsWith('/release')?'release':'capture';
   const admission=body.jobId!==undefined?{jobId:body.jobId,attemptId:body.attemptId}:undefined;
   const options=body.resolutionKind!==undefined?{resolution:{kind:body.resolutionKind,evidenceSha256:body.evidenceSha256}}:body.capturedSeconds!==undefined?{capturedSeconds:body.capturedSeconds}:undefined;
   return guard(async()=>({...await this.store.settleVideo(body.identityKey,reservationId,action,body.seconds,admission,options),reservationId}));
  }
  throw httpFault(404,'not_found');
 }
}

const {project,host,videoPath,accountPath,uid,epoch,pause}=workerData;
const db=new Firestore({projectId:project,host,ssl:false,preferRest:false});
const root=db.doc(videoPath),accountRoot=db.doc(accountPath);
try{
 const now={value:epoch};
 const backend=new FirestoreBackend(db,root);
 const store=new AccountStore(db,accountRoot,()=>now.value);
 const transport=new Transport(store);
 const objects={async putArtifactOnce(){throw Error('Unexpected synthetic artifact write');},async read(){throw Error('Unexpected synthetic object read');}};
 const ai=new FirestoreAi(db,root,backend,objects,undefined,new AccountBillingClient(undefined,transport));
 if(pause){
  // The lease is acquired before the first drain, so signalling here means "this context already holds it".
  const holds=ai.drainExternalHolds.bind(ai);
  ai.drainExternalHolds=async(...args)=>{parentPort.postMessage({type:'acquired'});await new Promise(resolve=>parentPort.once('message',resolve));return holds(...args);};
 }
 parentPort.on('message',message=>{if(typeof message?.epoch==='number')now.value=message.epoch;});
 const epochNow=()=>now.value;
 const result=await runBillingDrainSection({db,root,ai,backend,now:epoch,clock:epochNow,enabled:true,budgetMs:60000,log:()=>{},holderId:'worker-'+Math.random().toString(16).slice(2)});
 parentPort.postMessage({type:'done',result});
}finally{await db.terminate().catch(()=>undefined);}
