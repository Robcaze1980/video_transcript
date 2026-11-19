import {describe,expect,it,vi} from 'vitest';
import {AiFault} from './firestoreAi';
import {aiHttp} from './firestoreAiHttp';

const account='10000000-0000-4000-8000-000000000001';
const job='20000000-0000-4000-8000-000000000001',uid='synthetic-owner';
const request=(path:string,method='GET')=>({url:path,method,headers:{}});

describe('AI routing does not disclose eligibility before identity is checked',()=>{
 for(const [path,method] of [['/api/cloud/ai/unknown','GET'],[`/api/cloud/ai/jobs/${job}`,'PATCH']] as const){
  it(`rejects ${method} ${path} without reading account flags`,async()=>{
   const ai={enabled:vi.fn(async()=>{throw new AiFault('disabled');})};
   const send=vi.fn();
   await expect(aiHttp(request(path,method) as never,{} as never,account,uid,ai as never,vi.fn() as never,send))
    .rejects.toMatchObject({code:'not_found'});
   expect(ai.enabled).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();
  });
 }
 it('uses the UID-aware status check for an existing job',async()=>{
  const status=vi.fn(async()=>({id:job,state:'queued'})),ai={enabled:vi.fn(async()=>{throw new AiFault('disabled');}),status};
  const send=vi.fn();
  await expect(aiHttp(request(`/api/cloud/ai/jobs/${job}`) as never,{} as never,account,uid,ai as never,vi.fn() as never,send)).resolves.toBe(true);
  expect(status).toHaveBeenCalledExactlyOnceWith(account,job,uid);expect(ai.enabled).not.toHaveBeenCalled();
  expect(send).toHaveBeenCalledExactlyOnceWith(200,{id:job,state:'queued'});
 });
 it('ignores non-AI routes without reading account flags',async()=>{
  const ai={enabled:vi.fn()},send=vi.fn();
  await expect(aiHttp(request('/api/cloud/me') as never,{} as never,account,uid,ai as never,vi.fn() as never,send)).resolves.toBe(false);
  expect(ai.enabled).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();
 });
});
