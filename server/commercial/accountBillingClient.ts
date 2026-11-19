import {createHash} from 'node:crypto';
import {GoogleAuth, type IdTokenClient} from 'google-auth-library';

const accountApiUrl='https://vistavo-account-api-v5lc7z6dyq-uc.a.run.app';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?![\s\S])/i;
const hex64=/^[a-f0-9]{64}(?![\s\S])/;
export type VideoReservation={reservationId:string;seconds:number;state:'reserved'|'captured'|'released'};
export type VideoAdmission={reservationId:string;seconds:number;jobId:string;attemptId:string;callKey:string;model:string;requestSha256:string;created:boolean;receiptOnly:boolean};
export type VideoReservationSeal={reservationId:string;seconds:number;state:'sealed'|'reserved'|'captured'|'released';created:boolean};
export type VideoReservationResolution={reservationId:string;seconds:number;state:'sealed'|'reserved'|'captured'|'released'};
export type VideoSecondsBalance={unit:'video_seconds';credited:number;available:number;reserved:number;consumed:number;active:number};
export class AccountBillingFault extends Error {constructor(readonly code:'unavailable'|'insufficient'|'conflict'|'invalid'|'quota'|'not_found'|'forbidden'){super(code);}}
export function accountIdentityKey(uid:string){
 if(typeof uid!=='string'||!uid||uid.length>128)throw new AccountBillingFault('invalid');
 return createHash('sha256').update(JSON.stringify(['firebase',uid])).digest('hex');
}
function endpoint(value:string){
 let url:URL;try{url=new URL(value);}catch{throw new AccountBillingFault('invalid');}
 if(url.origin!==accountApiUrl||url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new AccountBillingFault('invalid');
 return url.origin;
}
function reservation(value:unknown,id:string,states:readonly string[],seconds?:number){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new AccountBillingFault('unavailable');const row=value as Record<string,unknown>;
 if(row.reservationId!==id||typeof row.state!=='string'||!states.includes(row.state)||!Number.isSafeInteger(row.seconds)||Number(row.seconds)<1||seconds!==undefined&&row.seconds!==seconds)throw new AccountBillingFault('unavailable');
 return row as {reservationId:string;state:'reserved'|'captured'|'released';seconds:number};
}
function incident(value:string){return typeof value==='string'&&(uuid.test(value)||hex64.test(value));}
function validVideoTuple(identityKey:string,reservationId:string,seconds:number){return hex64.test(identityKey)&&uuid.test(reservationId)&&Number.isSafeInteger(seconds)&&seconds>=1&&seconds<=600;}
type IdClient={request:(request:{url:string;method:'POST';data:Record<string,unknown>;timeout:number;headers:{'content-type':'application/json'}})=>Promise<{data:unknown}>};
/** All account writes go through Account API; this service never reads or copies its Firestore. */
export class AccountBillingClient {
 private readonly base:string;
 constructor(baseUrl=accountApiUrl,private readonly client?:IdClient){this.base=endpoint(baseUrl);}
 private async post(path:string,data:Record<string,unknown>){
  try{
   const client=this.client??await new GoogleAuth().getIdTokenClient(this.base) as IdTokenClient as unknown as IdClient;
   const response=await client.request({url:this.base+path,method:'POST',data,timeout:10000,headers:{'content-type':'application/json'}});
   return response.data;
  }catch(error){
   const status=(error as {response?:{status?:number}})?.response?.status;
   if(status===402)throw new AccountBillingFault('insufficient');
   if(status===400)throw new AccountBillingFault('invalid');
   if(status===409)throw new AccountBillingFault('conflict');
   if(status===429)throw new AccountBillingFault('quota');
   if(status===404)throw new AccountBillingFault('not_found');
   if(status===403)throw new AccountBillingFault('forbidden');
   throw new AccountBillingFault('unavailable');
  }
 }
 async reserve(identityKey:string,reservationId:string,seconds:number){
  if(!validVideoTuple(identityKey,reservationId,seconds))throw new AccountBillingFault('invalid');
  return reservation(await this.post('/api/internal/video/reservations',{identityKey,reservationId,seconds}),reservationId,['reserved'],seconds);
 }
 async status(identityKey:string,reservationId:string){
  if(!hex64.test(identityKey)||!uuid.test(reservationId))throw new AccountBillingFault('invalid');
  return reservation(await this.post('/api/internal/video/reservations/'+reservationId+'/status',{identityKey}),reservationId,['reserved','captured','released']);
 }
 /** A resolution read never creates a seal; not_found remains an ambiguous observation. */
 async resolution(identityKey:string,reservationId:string,seconds:number):Promise<VideoReservationResolution>{
  if(!validVideoTuple(identityKey,reservationId,seconds))throw new AccountBillingFault('invalid');
  const value=await this.post('/api/internal/video/reservations/'+reservationId+'/resolution',{identityKey,seconds});
  if(!value||typeof value!=='object'||Array.isArray(value))throw new AccountBillingFault('unavailable');const row=value as Record<string,unknown>;
  if(Object.keys(row).sort().join(',')!=='reservationId,seconds,state'||row.reservationId!==reservationId||row.seconds!==seconds||typeof row.state!=='string'||!['sealed','reserved','captured','released'].includes(row.state))throw new AccountBillingFault('unavailable');
  return row as VideoReservationResolution;
 }
 /** Account is the authority: a local incident is not a confirmed hold until this receipt arrives. */
 async block(identityKey:string,incidentId:string){
  if(!hex64.test(identityKey)||!incident(incidentId))throw new AccountBillingFault('invalid');
  const value=await this.post('/api/internal/video/billing-holds',{identityKey,incidentId});
  if(!value||typeof value!=='object'||Array.isArray(value))throw new AccountBillingFault('unavailable');const row=value as Record<string,unknown>;
  if(row.blocked!==true||row.recorded!==true||typeof row.created!=='boolean')throw new AccountBillingFault('unavailable');
  return {blocked:true as const,recorded:true as const,created:row.created};
 }
 async holdStatus(identityKey:string,incidentId:string){
  if(!hex64.test(identityKey)||!incident(incidentId))throw new AccountBillingFault('invalid');
  const value=await this.post('/api/internal/video/billing-holds/status',{identityKey,incidentId});
  if(!value||typeof value!=='object'||Array.isArray(value))throw new AccountBillingFault('unavailable');const row=value as Record<string,unknown>;
  if(typeof row.blocked!=='boolean'||typeof row.recorded!=='boolean'||row.recorded&&!row.blocked)throw new AccountBillingFault('unavailable');
  return {blocked:row.blocked,recorded:row.recorded};
 }
 /** A 404 is ambiguous; only a matching Account tombstone closes an absent reservation. */
 async seal(identityKey:string,reservationId:string,seconds:number):Promise<VideoReservationSeal>{
  if(!validVideoTuple(identityKey,reservationId,seconds))throw new AccountBillingFault('invalid');
  const value=await this.post('/api/internal/video/reservations/'+reservationId+'/seal',{identityKey,seconds});
  if(!value||typeof value!=='object'||Array.isArray(value))throw new AccountBillingFault('unavailable');const row=value as Record<string,unknown>;
  if(row.reservationId!==reservationId||row.seconds!==seconds||typeof row.state!=='string'||!['sealed','reserved','captured','released'].includes(row.state)||typeof row.created!=='boolean'||row.created&&row.state!=='sealed')throw new AccountBillingFault('unavailable');
  return row as VideoReservationSeal;
 }
 /** A replay is only a receipt and never permission to invoke an AI provider again. */
 async admit(identityKey:string,reservationId:string,seconds:number,jobId:string,attemptId:string,callKey:string,model:string,requestSha256:string):Promise<VideoAdmission>{
  if(!validVideoTuple(identityKey,reservationId,seconds)||!uuid.test(jobId)||!uuid.test(attemptId)||typeof callKey!=='string'||!/^(text-window|voice-chunk):\d{4}(?![\s\S])/.test(callKey)||model!==(callKey.startsWith('text-window:')?'gemini-3.8-flash':'gemini-3.8-flash-tts')||typeof requestSha256!=='string'||!hex64.test(requestSha256))throw new AccountBillingFault('invalid');
  const value=await this.post('/api/internal/video/reservations/'+reservationId+'/admit',{identityKey,seconds,jobId,attemptId,callKey,model,requestSha256});
  if(!value||typeof value!=='object'||Array.isArray(value))throw new AccountBillingFault('unavailable');const row=value as Record<string,unknown>;
  if(row.reservationId!==reservationId||row.seconds!==seconds||row.jobId!==jobId||row.attemptId!==attemptId||row.callKey!==callKey||row.model!==model||row.requestSha256!==requestSha256||typeof row.created!=='boolean'||typeof row.receiptOnly!=='boolean'||row.receiptOnly===row.created)throw new AccountBillingFault('unavailable');
  return row as VideoAdmission;
 }
 async settle(identityKey:string,reservationId:string,action:'capture'|'release',seconds:number,admission?:{jobId:string;attemptId:string}){
  if(!validVideoTuple(identityKey,reservationId,seconds)||!['capture','release'].includes(action))throw new AccountBillingFault('invalid');
  if(action==='capture'&&(!admission||!uuid.test(admission.jobId)||!uuid.test(admission.attemptId))||action==='release'&&admission)throw new AccountBillingFault('invalid');
  return reservation(await this.post('/api/internal/video/reservations/'+reservationId+'/'+action,{identityKey,seconds,...(admission??{})}),reservationId,[action==='capture'?'captured':'released'],seconds);
 }
 async balance(identityKey:string):Promise<VideoSecondsBalance>{
  if(!hex64.test(identityKey))throw new AccountBillingFault('invalid');const value=await this.post('/api/internal/video/balance',{identityKey});
  if(!value||typeof value!=='object'||Array.isArray(value))throw new AccountBillingFault('unavailable');const row=value as Record<string,unknown>;
  if(row.unit!=='video_seconds'||!['credited','available','reserved','consumed','active'].every(k=>Number.isSafeInteger(row[k])&&Number(row[k])>=0)||Number(row.credited)!==Number(row.available)+Number(row.reserved)+Number(row.consumed))throw new AccountBillingFault('unavailable');
  return row as VideoSecondsBalance;
 }
}
