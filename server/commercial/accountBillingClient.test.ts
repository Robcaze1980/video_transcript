import {describe,it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {AccountBillingClient,AccountBillingFault,accountIdentityKey} from './accountBillingClient';

const uid='firebase-user-fixture',identityKey=createHash('sha256').update(JSON.stringify(['firebase',uid])).digest('hex'),reservationId='00000000-0000-4000-8000-000000000001';
describe('Account API balance bridge',()=>{
 it('derives the same pseudonymous key as the account service',()=>expect(accountIdentityKey(uid)).toBe(identityKey));
 it('pins transport to the deployed Account API origin and validates calls before sending',async()=>{
  const request=vi.fn(async(value:any)=>({data:{reservationId:value.data.reservationId,state:'reserved',seconds:value.data.seconds}})),client=new AccountBillingClient(undefined,{request});
  expect(()=>new AccountBillingClient('https://example.com')).toThrow(AccountBillingFault);
  await expect(client.reserve('bad',reservationId,5)).rejects.toMatchObject({code:'invalid'});
  await expect(client.reserve(identityKey,reservationId,601)).rejects.toMatchObject({code:'invalid'});
  const result=await client.reserve(identityKey,reservationId,60);expect(result).toMatchObject({state:'reserved',seconds:60});
  expect(request).toHaveBeenCalledWith(expect.objectContaining({url:'https://vistavo-account-api-v5lc7z6dyq-uc.a.run.app/api/internal/video/reservations',method:'POST',timeout:10000,data:{identityKey,reservationId,seconds:60}}));
 });
 it('maps insufficient funds separately and hides transport/provider detail',async()=>{
  const client=new AccountBillingClient(undefined,{request:async()=>{throw Object.assign(Error('secret SDK detail'),{response:{status:402}});}});
  await expect(client.reserve(identityKey,reservationId,10)).rejects.toBeInstanceOf(AccountBillingFault);
  await expect(client.reserve(identityKey,reservationId,10)).rejects.toMatchObject({code:'insufficient'});
 });
 it('validates reservation identities and distinguishes IAM and active-reservation limits',async()=>{
  const denied=new AccountBillingClient(undefined,{request:async()=>{throw Object.assign(Error('hidden'),{response:{status:403}});}});
  await expect(denied.reserve(identityKey,reservationId,1)).rejects.toMatchObject({code:'forbidden'});
  const limited=new AccountBillingClient(undefined,{request:async()=>{throw Object.assign(Error('hidden'),{response:{status:429}});}});
  await expect(limited.reserve(identityKey,reservationId,1)).rejects.toMatchObject({code:'quota'});
  const malformed=new AccountBillingClient(undefined,{request:async()=>({data:{reservationId:'00000000-0000-4000-8000-000000000002',state:'reserved',seconds:1}})});
  await expect(malformed.reserve(identityKey,reservationId,1)).rejects.toMatchObject({code:'unavailable'});
 });
 it('validates the server-owned video seconds balance invariant',async()=>{
  const client=new AccountBillingClient(undefined,{request:async()=>({data:{unit:'video_seconds',credited:90,available:30,reserved:60,consumed:0,active:1}})});
  await expect(client.balance(identityKey)).resolves.toMatchObject({available:30,reserved:60,unit:'video_seconds'});
  const corrupt=new AccountBillingClient(undefined,{request:async()=>({data:{unit:'video_seconds',credited:90,available:31,reserved:60,consumed:0,active:1}})});
  await expect(corrupt.balance(identityKey)).rejects.toMatchObject({code:'unavailable'});
 });
 it('sends authorized seconds with settlement and rejects a mismatched response',async()=>{
  const jobId='00000000-0000-4000-8000-000000000002',attemptId='00000000-0000-4000-8000-000000000003',request=vi.fn(async()=>({data:{reservationId,state:'captured',seconds:61}})),client=new AccountBillingClient(undefined,{request});
  await expect(client.settle(identityKey,reservationId,'capture',60)).rejects.toMatchObject({code:'invalid'});expect(request).not.toHaveBeenCalled();
  await expect(client.settle(identityKey,reservationId,'capture',60,{jobId,attemptId})).rejects.toMatchObject({code:'unavailable'});
  expect(request).toHaveBeenCalledWith(expect.objectContaining({data:{identityKey,seconds:60,jobId,attemptId}}));
 });
 it('requires an Account hold receipt and does not mistake a different incident for confirmation',async()=>{
  const incidentId='b'.repeat(64),request=vi.fn(async({url}:any)=>({data:url.endsWith('/status')?{blocked:true,recorded:false}:{blocked:true,recorded:true,created:true}})),client=new AccountBillingClient(undefined,{request});
  await expect(client.block(identityKey,'invalid')).rejects.toMatchObject({code:'invalid'});expect(request).not.toHaveBeenCalled();
  await expect(client.block(identityKey,incidentId)).resolves.toEqual({blocked:true,recorded:true,created:true});
  await expect(client.holdStatus(identityKey,incidentId)).resolves.toEqual({blocked:true,recorded:false});
  const corrupt=new AccountBillingClient(undefined,{request:async()=>({data:{blocked:false,recorded:true}})});
  await expect(corrupt.holdStatus(identityKey,incidentId)).rejects.toMatchObject({code:'unavailable'});
 });
 it('requires a correlated tombstone receipt and preserves an already existing reservation for reconciliation',async()=>{
  const request=vi.fn(async()=>({data:{reservationId,seconds:60,state:'sealed',created:true}})),client=new AccountBillingClient(undefined,{request});
  await expect(client.seal(identityKey,reservationId,60)).resolves.toMatchObject({state:'sealed',created:true});
  const found=new AccountBillingClient(undefined,{request:async()=>({data:{reservationId,seconds:60,state:'reserved',created:false}})});
  await expect(found.seal(identityKey,reservationId,60)).resolves.toMatchObject({state:'reserved'});
  const wrong=new AccountBillingClient(undefined,{request:async()=>({data:{reservationId,seconds:61,state:'sealed',created:true}})});
  await expect(wrong.seal(identityKey,reservationId,60)).rejects.toMatchObject({code:'unavailable'});
  const contradiction=new AccountBillingClient(undefined,{request:async()=>({data:{reservationId,seconds:60,state:'reserved',created:true}})});
  await expect(contradiction.seal(identityKey,reservationId,60)).rejects.toMatchObject({code:'unavailable'});
 });
 it('reads a matching resolution receipt without sending a sealing request',async()=>{
  const request=vi.fn(async()=>({data:{reservationId,seconds:60,state:'sealed'}})),client=new AccountBillingClient(undefined,{request});
  await expect(client.resolution(identityKey,reservationId,60)).resolves.toEqual({reservationId,seconds:60,state:'sealed'});
  expect(request).toHaveBeenCalledWith(expect.objectContaining({url:expect.stringMatching(/\/resolution$/),data:{identityKey,seconds:60}}));
  await expect(client.resolution(identityKey,reservationId,0)).rejects.toMatchObject({code:'invalid'});
  const wrong=new AccountBillingClient(undefined,{request:async()=>({data:{reservationId,seconds:61,state:'sealed'}})});
  await expect(wrong.resolution(identityKey,reservationId,60)).rejects.toMatchObject({code:'unavailable'});
  const unexpected=new AccountBillingClient(undefined,{request:async()=>({data:{reservationId,seconds:60,state:'sealed',created:true}})});
  await expect(unexpected.resolution(identityKey,reservationId,60)).rejects.toMatchObject({code:'unavailable'});
  const absentRequest=vi.fn(async()=>{throw Object.assign(Error('missing'),{response:{status:404}});});
  const absent=new AccountBillingClient(undefined,{request:absentRequest});
  await expect(absent.resolution(identityKey,reservationId,60)).rejects.toMatchObject({code:'not_found'});
  expect(absentRequest).toHaveBeenCalledTimes(1);
 });
 it('distinguishes a first provider admission from an ACK-recovery receipt and rejects altered tuples',async()=>{
  const jobId='00000000-0000-4000-8000-000000000002',attemptId='00000000-0000-4000-8000-000000000003',callKey='text-window:0000',model='gemini-3.8-flash',requestSha256='c'.repeat(64),tuple={reservationId,seconds:60,jobId,attemptId,callKey,model,requestSha256};
  const request=vi.fn(async()=>({data:{...tuple,created:true,receiptOnly:false}})),client=new AccountBillingClient(undefined,{request});
  await expect(client.admit(identityKey,reservationId,60,jobId,'bad',callKey,model,requestSha256)).rejects.toMatchObject({code:'invalid'});expect(request).not.toHaveBeenCalled();
  await expect(client.admit(identityKey,reservationId,60,jobId,attemptId,callKey+'\n',model,requestSha256)).rejects.toMatchObject({code:'invalid'});
  await expect(client.admit(identityKey,reservationId,60,jobId,attemptId,callKey,model,requestSha256+'\n')).rejects.toMatchObject({code:'invalid'});expect(request).not.toHaveBeenCalled();
  await expect(client.admit(identityKey,reservationId,60,jobId,attemptId,callKey,model,requestSha256)).resolves.toMatchObject({created:true,receiptOnly:false});
  const replay=new AccountBillingClient(undefined,{request:async()=>({data:{...tuple,created:false,receiptOnly:true}})});
  await expect(replay.admit(identityKey,reservationId,60,jobId,attemptId,callKey,model,requestSha256)).resolves.toMatchObject({created:false,receiptOnly:true});
  const forged=new AccountBillingClient(undefined,{request:async()=>({data:{...tuple,attemptId:'00000000-0000-4000-8000-000000000004',created:true,receiptOnly:false}})});
  await expect(forged.admit(identityKey,reservationId,60,jobId,attemptId,callKey,model,requestSha256)).rejects.toMatchObject({code:'unavailable'});
  const alteredHash=new AccountBillingClient(undefined,{request:async()=>({data:{...tuple,requestSha256:'d'.repeat(64),created:true,receiptOnly:false}})});
  await expect(alteredHash.admit(identityKey,reservationId,60,jobId,attemptId,callKey,model,requestSha256)).rejects.toMatchObject({code:'unavailable'});
  const unclear=new AccountBillingClient(undefined,{request:async()=>({data:{...tuple,created:false,receiptOnly:false}})});
  await expect(unclear.admit(identityKey,reservationId,60,jobId,attemptId,callKey,model,requestSha256)).rejects.toMatchObject({code:'unavailable'});
 });
});
