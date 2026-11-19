import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { describe, expect, it, vi } from 'vitest';
import { firestoreHttp } from './firestoreHttp';
import type { FirestoreBackend } from './firestoreBackend';
import type { FirestoreAi } from './firestoreAi';
import type { ReviewedTranslationHttpService } from './reviewedTranslationHttp';

const accountId=randomUUID(),inputId=randomUUID(),jobId=randomUUID(),cueId='a'.repeat(64),uid='synthetic-user';
const route=`/api/cloud/ai/jobs/${jobId}/review`,caller={accountId,uid};

async function candidate(config:{withAi?:boolean;withReview?:boolean;allowUser?:boolean}={}) {
  const identity={verifyIdToken:vi.fn(async(token:string,revoked:true)=>{
    if(token!=='synthetic-valid'||revoked!==true)throw Error('synthetic token rejected');
    return {uid,email_verified:true} as DecodedIdToken;
  })};
  const backend={accountForUid:vi.fn(async()=>accountId)};
  const ai={enabled:vi.fn(async()=>{})};
  const review={
    readSource:vi.fn(async()=>({status:'original',projectRevision:1,jobRevision:1,durationMs:1000,cues:[{id:cueId,es:'Uno',en:'One'}]})),
    saveReview:vi.fn(async()=>({committedRevision:2})),
    downloadReview:vi.fn(async()=>({revision:2,mime:'text/plain; charset=utf-8',bytes:Buffer.from('One\n')})),
  } satisfies ReviewedTranslationHttpService;
  const handler=firestoreHttp({backend:backend as unknown as FirestoreBackend,identity,origin:'https://vistavo.app',
    ...(config.withAi?{ai:ai as unknown as FirestoreAi}:{}),...(config.withReview?{reviewedTranslation:review}:{}),
    ...(config.allowUser===undefined?{}:{authorizeUser:async()=>config.allowUser!})});
  const server:Server=createServer(handler);
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();if(!address||typeof address==='string')throw Error('synthetic server did not start');
  const origin=`http://127.0.0.1:${address.port}`;
  return {identity,backend,ai,review,request:(path:string,init?:RequestInit)=>fetch(origin+path,init),
    close:async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
const token={authorization:'Bearer synthetic-valid'};
const validBody={inputId,expectedRevision:1,requestKey:'synthetic-request',edits:[{id:cueId,en:'One'}]};

describe('optional reviewed-translation route in the private candidate',()=>{
  it.each([{withAi:true},{withReview:true},{}])('stays disabled unless both AI and the service are explicitly provided: %o',async config=>{
    const c=await candidate(config);try{
      const response=await c.request(`${route}?inputId=${inputId}`,{headers:token});
      expect(response.status).toBe(404);expect(c.review.readSource).not.toHaveBeenCalled();
    }finally{await c.close();}
  });
  it('verifies the Firebase token and passes only its UID and server-resolved account before AI routing',async()=>{
    const c=await candidate({withAi:true,withReview:true});try{
      const response=await c.request(`${route}?inputId=${inputId}`,{headers:token});
      expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');
      expect(c.identity.verifyIdToken).toHaveBeenCalledExactlyOnceWith('synthetic-valid',true);
      expect(c.backend.accountForUid).toHaveBeenCalledExactlyOnceWith(uid);
      expect(c.review.readSource).toHaveBeenCalledExactlyOnceWith(caller,inputId,jobId);
      expect(c.ai.enabled).not.toHaveBeenCalled();
    }finally{await c.close();}
  });
  it.each([undefined,'Bearer invalid'])('rejects missing or invalid credentials before invoking the service: %s',async authorization=>{
    const c=await candidate({withAi:true,withReview:true});try{
      const response=await c.request(`${route}?inputId=${inputId}`,{headers:authorization?{authorization}:{}});
      expect(response.status).toBe(401);expect(c.backend.accountForUid).not.toHaveBeenCalled();expect(c.review.readSource).not.toHaveBeenCalled();
    }finally{await c.close();}
  });
  it('rejects a user denied by the private candidate authorization before calling the service',async()=>{
    const c=await candidate({withAi:true,withReview:true,allowUser:false});try{
      const response=await c.request(`${route}?inputId=${inputId}`,{headers:token});
      expect(response.status).toBe(403);expect(c.backend.accountForUid).not.toHaveBeenCalled();expect(c.review.readSource).not.toHaveBeenCalled();
    }finally{await c.close();}
  });
  it('does not let the request body replace the authenticated UID or account',async()=>{
    const c=await candidate({withAi:true,withReview:true});try{
      const response=await c.request(route,{method:'PUT',headers:{...token,'content-type':'application/json'},
        body:JSON.stringify({...validBody,uid:'other',accountId:randomUUID()})});
      expect(response.status).toBe(400);expect(c.review.saveReview).not.toHaveBeenCalled();
    }finally{await c.close();}
  });
  it('saves and downloads through the injected service with the same verified principal',async()=>{
    const c=await candidate({withAi:true,withReview:true});try{
      const saved=await c.request(route,{method:'PUT',headers:{...token,'content-type':'application/json'},body:JSON.stringify(validBody)});
      expect(saved.status).toBe(200);expect(c.review.saveReview).toHaveBeenCalledExactlyOnceWith(caller,{...validBody,jobId});
      const result=await c.request(`${route}/download?inputId=${inputId}&revision=2&format=txt`,{headers:token});
      expect(result.status).toBe(200);expect(await result.text()).toBe('One\n');
      expect(c.review.downloadReview).toHaveBeenCalledExactlyOnceWith(caller,{inputId,jobId,revision:2,format:'txt'});
    }finally{await c.close();}
  });
});
