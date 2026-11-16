import {describe,it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,unlink,rmdir} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';import type {AddressInfo} from 'node:net';
import {request as httpRequest} from 'node:http';
import {createCloudCandidateServer,existingPilotAuthorization,publicCandidateConfig,validateLocalCloudEnvironment} from './cloudCandidateLocal';
import type {DocumentReference} from 'firebase-admin/firestore';import type {FirebaseWebConfig} from './firebaseAccess';
const web={apiKey:'public-client-config-only',appId:'1:107404655346:web:abcd',authDomain:'vistavo-prod.firebaseapp.com',projectId:'vistavo-prod'};
const statusWithHost=(origin:string,host:string)=>new Promise<number>((resolve,reject)=>{const req=httpRequest(origin+'/api/cloud/me',{headers:{Host:host,Authorization:'Bearer fixture'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode!));});req.on('error',reject);req.end();});
async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'vistavo-candidate-')),assets=join(dir,'assets'),brand=join(dir,'brand');await mkdir(assets);await mkdir(join(assets,'.vite'));await mkdir(brand);
 const paths=[join(dir,'page.html'),join(assets,'cloudCandidate.js'),join(assets,'main.css'),join(assets,'.vite','manifest.json'),join(brand,'vistavo-symbol.svg')];
 await Promise.all(paths.map((p,i)=>writeFile(p,[`<div id="cloud-candidate"></div><link rel="stylesheet" href="/candidate-assets/cloudCandidate.css">`,'export const publicClient=true;','body{color:green}',JSON.stringify({'server/commercial/web/cloudCandidate.tsx':{css:['assets/main.css']}}),'<svg/>'][i])));
 await mkdir(join(assets,'assets'));await writeFile(join(assets,'assets','main.css'),'body{color:green}');paths.push(join(assets,'assets','main.css'));
 let calls=0;const server=createCloudCandidateServer({web:{...web,serverSecret:'DO-NOT-EXPOSE'} as FirebaseWebConfig,assetsDirectory:assets,brandDirectory:brand,htmlPath:paths[0],apiForOrigin:()=>async(req,res)=>{calls++;res.writeHead(req.headers.authorization==='Bearer fixture'?200:401,{'Content-Type':'application/json'}).end(JSON.stringify({private:req.headers.authorization==='Bearer fixture'}));}});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+(server.address() as AddressInfo).port;
 return {server,origin,calls:()=>calls,async close(){server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));for(const p of paths)await unlink(p);for(const p of [join(assets,'.vite'),join(assets,'assets'),assets,brand,dir])await rmdir(p);}};
}
describe('private loopback cloud candidate',()=>{
 it('requires explicit isolated local mode and rejects ambient emulators or server JSON variables',()=>{
  expect(()=>validateLocalCloudEnvironment({LOCALAPPDATA:'C:/example'})).toThrow();
  for(const key of ['GOOGLE_APPLICATION_CREDENTIALS','FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST'])expect(()=>validateLocalCloudEnvironment({LOCALAPPDATA:'C:/example',VISTAVO_LOCAL_CLOUD:'1',[key]:'unexpected'})).toThrow();
  expect(()=>validateLocalCloudEnvironment({LOCALAPPDATA:'C:/example',VISTAVO_LOCAL_CLOUD:'1'})).not.toThrow();expect(()=>publicCandidateConfig({...web,projectId:'other-project'})).toThrow();
 });
 it('serves only public Firebase fields and built UI with private CSP',async()=>{const f=await fixture();try{
  const r=await fetch(f.origin+'/api/cloud/config'),text=await r.text();expect(r.status).toBe(200);expect(text).not.toContain('DO-NOT-EXPOSE');expect(JSON.parse(text).limits.maxSeconds).toBe(30);expect(r.headers.get('access-control-allow-origin')).toBeNull();
  const page=await fetch(f.origin),html=await page.text();expect(html).toContain('/candidate-assets/assets/main.css');expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");expect(page.headers.get('cache-control')).toBe('no-store');expect((await fetch(f.origin+'/candidate-assets/cloudCandidate.js')).status).toBe(200);expect(f.calls()).toBe(0);
 }finally{await f.close();}});
 it('rejects DNS-rebinding Host and cross-origin or originless mutations before API work',async()=>{const f=await fixture();try{
  for(const host of ['localhost:'+new URL(f.origin).port,'127.0.0.1','evil.example','127.0.0.1.evil.example:'+new URL(f.origin).port])expect(await statusWithHost(f.origin,host)).toBe(403);
  for(const origin of [undefined,'null','http://evil.example','http://localhost:'+new URL(f.origin).port])expect((await fetch(f.origin+'/api/cloud/ai/jobs',{method:'POST',headers:{Authorization:'Bearer fixture',...(origin?{Origin:origin}:{})},body:'{}'})).status).toBe(403);
  expect(f.calls()).toBe(0);expect((await fetch(f.origin+'/api/cloud/me')).status).toBe(401);expect((await fetch(f.origin+'/api/cloud/ai/jobs',{method:'POST',headers:{Origin:f.origin,Authorization:'Bearer fixture'},body:'{}'})).status).toBe(200);
 }finally{await f.close();}});
 it('does not serve private paths, manifest or operator routes',async()=>{const f=await fixture();try{
  for(const path of ['/candidate-assets/.vite/manifest.json','/candidate-assets/../../package.json','/candidate-assets/%2e%2e/package.json','/internal/maintenance','/operator/credit','/brand/anything.env'])expect((await fetch(f.origin+path)).status).toBe(404);
  expect(f.calls()).toBe(0);
 }finally{await f.close();}});
 it('only authorizes an existing explicitly enabled simulation account without writes',async()=>{
  const reads:string[]=[],uid='verified-fixture',accountId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';let exists=false,enabled=false,simulation=false;
  const root={collection:(col:string)=>({doc:(_id:string)=>({get:async()=>{reads.push(col);return {exists:col==='identities'?exists:true,get:(key:string)=>col==='identities'?({uid,accountId} as Record<string,unknown>)[key]:({aiPilot:enabled,simulationOnly:simulation} as Record<string,unknown>)[key]};}})})} as unknown as DocumentReference;
  const authorize=existingPilotAuthorization(root);expect(await authorize(uid)).toBe(false);expect(reads).toEqual(['identities']);exists=true;expect(await authorize(uid)).toBe(false);enabled=true;expect(await authorize(uid)).toBe(false);simulation=true;expect(await authorize(uid)).toBe(true);
 });
});
