// Local browser check with synthetic media, identity and API responses.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {build} from 'esbuild';

const root=resolve('outputs/lv-video-billing-20261116/mobile-resume');
await mkdir(root,{recursive:true});
const originalPath=join(root,'original.mp4'),differentPath=join(root,'different.mp4');
const chunkSize=8*1024*1024;
const fixture=await readFile(resolve('deploy/google-cloud/probe/ai-es-fixture.mp4'));
assert.ok(fixture.length<chunkSize);
const bytes=Buffer.alloc(chunkSize+32);fixture.copy(bytes);
const other=Buffer.from(bytes);other[other.length-1]=1;
await Promise.all([writeFile(originalPath,bytes),writeFile(differentPath,other)]);
const digest=createHash('sha256').update(bytes).digest('hex');
const account='10000000-0000-4000-8000-000000000001';
const input='20000000-0000-4000-8000-000000000001';
const nextInput='20000000-0000-4000-8000-000000000002';
const jobId='50000000-0000-4000-8000-000000000001';
const requestKey='30000000-0000-4000-8000-000000000001';
const prefix='vistavo-candidate-v1:'+account+':';

await build({
 entryPoints:['server/commercial/web/cloudCandidate.tsx'],
 bundle:true,format:'esm',platform:'browser',outdir:root,entryNames:'candidate',
 plugins:[{
  name:'synthetic-auth',
  setup(builder){
   builder.onResolve({filter:/^\.\/cloudCandidateAuth$/},()=>({path:'auth',namespace:'synthetic'}));
   builder.onLoad({filter:/.*/,namespace:'synthetic'},()=>({
    contents:`export async function candidateAuth(){const user={uid:'synthetic-user',email:'mobile@example.invalid',emailVerified:true};return {observe(callback){queueMicrotask(()=>callback(user));return ()=>{}},token:async()=>'synthetic-token',logout:async()=>{}}}`,
    loader:'js',
   }));
  },
 }],
});

const requests=[];
let state='uploading',offset=chunkSize,expired=false,nextOffset=0,nextState='uploading',nextRequestKey,jobState='running',jobReadUnavailable=false,cancelRequests=0;
const server=createServer(async(req,res)=>{
 const url=new URL(req.url??'/', 'http://127.0.0.1');
 const reply=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 requests.push({method:req.method,path:url.pathname,offset:url.searchParams.get('offset')});
 if(url.pathname==='/'){
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
  res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/candidate.css"><div id="cloud-candidate"></div><script type="module" src="/candidate.js"></script>');return;
 }
 if(url.pathname==='/lock-holder'){
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end('<!doctype html><title>Local coordination test</title>');return;
 }
 if(url.pathname==='/candidate.js'||url.pathname==='/candidate.css'){
  const content=await readFile(join(root,url.pathname.slice(1)));
  res.writeHead(200,{'Content-Type':url.pathname.endsWith('.js')?'text/javascript':'text/css'});res.end(content);return;
 }
 if(url.pathname==='/brand/vistavo-symbol.svg'){res.writeHead(200,{'Content-Type':'image/svg+xml'}).end('<svg xmlns="http://www.w3.org/2000/svg"/>');return;}
 if(url.pathname==='/api/cloud/me')return reply(200,{id:account,balance:{available:0,reserved:0}});
 if(url.pathname==='/api/cloud/ai/jobs/'+jobId){
  const job={id:jobId,inputId:nextInput,operation:'translation:en',state:jobState,revision:1,stale:false,units:3,results:[]};
  if(req.method==='GET')return jobReadUnavailable?reply(503,{error:'unavailable'}):reply(200,job);
  if(req.method==='DELETE'){
   cancelRequests++;
   if(cancelRequests===1){jobReadUnavailable=true;res.writeHead(200,{'Content-Type':'application/json'});res.write('{"id":');setTimeout(()=>res.destroy(),50);return;}
   jobState='cancelled';return reply(200,{...job,state:jobState});
  }
 }
 if(url.pathname==='/api/cloud/projects/'+input)return reply(404,{error:'not_found'});
 if(url.pathname==='/api/cloud/uploads'&&req.method==='POST'){
  const parts=[];for await(const part of req)parts.push(part);
  const data=JSON.parse(Buffer.concat(parts).toString('utf8'));
  if(!expired||state!=='deleting'||data.sha256!==digest||data.size!==bytes.length||data.requestKey===requestKey)return reply(409,{error:'conflict'});
  nextRequestKey=data.requestKey;
  return reply(201,{id:nextInput,name:data.name,size:bytes.length,offset:nextOffset,state:nextState});
 }
 if(url.pathname==='/api/cloud/uploads/'+nextInput&&req.method==='GET')return reply(200,{id:nextInput,name:'original.mp4',size:bytes.length,offset:nextOffset,state:nextState});
 if(url.pathname==='/api/cloud/uploads/'+nextInput+'/chunks'&&req.method==='PUT'){
  const parts=[];for await(const part of req)parts.push(part);
  const received=Buffer.concat(parts),at=Number(url.searchParams.get('offset'));
  if(at!==nextOffset||!received.equals(bytes.subarray(nextOffset,nextOffset+received.length)))return reply(409,{error:'conflict'});
  nextOffset+=received.length;return reply(200,{id:nextInput,offset:nextOffset,state:nextState});
 }
 if(url.pathname==='/api/cloud/uploads/'+nextInput+'/complete'&&req.method==='POST'){
  if(nextOffset!==bytes.length)return reply(409,{error:'conflict'});
  nextState='queued';return reply(202,{id:nextInput,name:'original.mp4',size:bytes.length,offset:nextOffset,state:nextState});
 }
 if(url.pathname==='/api/cloud/uploads/'+input&&req.method==='GET')return expired?reply(410,{error:'expired'}):reply(200,{id:input,name:'original.mp4',size:bytes.length,offset,state});
 if(url.pathname==='/api/cloud/uploads/'+input&&req.method==='DELETE'){
  if(!expired)return reply(409,{error:'conflict'});
  state='deleting';return reply(202,{id:input,state});
 }
 if(url.pathname==='/api/cloud/uploads/'+input+'/chunks'&&req.method==='PUT'){
  const parts=[];for await(const part of req)parts.push(part);
  const received=Buffer.concat(parts),at=Number(url.searchParams.get('offset'));
  if(at!==offset||!received.equals(bytes.subarray(offset)))return reply(409,{error:'conflict'});
  offset+=received.length;return reply(200,{id:input,offset,state});
 }
 if(url.pathname==='/api/cloud/uploads/'+input+'/complete'&&req.method==='POST'){
  if(offset!==bytes.length)return reply(409,{error:'conflict'});
  state='queued';return reply(202,{id:input,name:'original.mp4',size:bytes.length,offset,state});
 }
 return reply(404,{error:'not_found'});
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const address=server.address();
assert.ok(address&&typeof address!=='string');
const origin='http://127.0.0.1:'+address.port;
const profile=await mkdtemp(join(root,'chrome-'));
let browser,ws,secondWs;
try{
 browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',[
  '--headless=new','--no-first-run','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank',
 ],{windowsHide:true,stdio:'ignore'});
 let port;
 for(let i=0;i<100;i++){
  try{port=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await new Promise(r=>setTimeout(r,100));}
 }
 assert.ok(port,'Chrome did not start');
 const target=await(await fetch('http://127.0.0.1:'+port+'/json/new?about:blank',{method:'PUT'})).json();
 ws=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 let nextId=0,acceptDialog=false;
 const pending=new Map(),exceptions=[];
 ws.onmessage=event=>{
  const message=JSON.parse(String(event.data));
  if(message.id){pending.get(message.id)?.(message);pending.delete(message.id);}
  if(message.method==='Runtime.exceptionThrown')exceptions.push(message.params.exceptionDetails.text);
  if(message.method==='Page.javascriptDialogOpening')ws.send(JSON.stringify({id:++nextId,method:'Page.handleJavaScriptDialog',params:{accept:acceptDialog}}));
 };
 const call=(method,params={})=>new Promise((resolve,reject)=>{
  const id=++nextId;
  pending.set(id,result=>result.error?reject(Error(JSON.stringify(result.error))):resolve(result.result));
  ws.send(JSON.stringify({id,method,params}));
 });
 const evaluate=async expression=>{
  const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(result.exceptionDetails)throw Error(result.exceptionDetails.text);
  return result.result.value;
 };
 const wait=async expression=>{
  for(let i=0;i<120;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}
  throw Error('Timed out waiting for '+expression+'; '+await evaluate('document.body.innerText.slice(0,1400)'));
 };
 await call('Page.enable');await call('Runtime.enable');await call('DOM.enable');
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 const preload=await call('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.origin===${JSON.stringify(origin)}){localStorage.setItem(${JSON.stringify(prefix+'input')},${JSON.stringify(input)});localStorage.setItem(${JSON.stringify(prefix+'upload:'+input)},${JSON.stringify(digest)});localStorage.setItem(${JSON.stringify(prefix+'request:'+digest+':upload:0')},${JSON.stringify(requestKey)});localStorage.setItem(${JSON.stringify(prefix+'upload-request:'+input)},${JSON.stringify(requestKey)});}`});
 await call('Page.navigate',{url:origin+'/'});
 await wait("document.body.innerText.includes('Recuperamos la subida pendiente')");
 // A second real tab controls the same-origin browser locks used by the candidate.
 const secondTarget=await(await fetch('http://127.0.0.1:'+port+'/json/new?'+encodeURIComponent(origin+'/lock-holder'),{method:'PUT'})).json();
 secondWs=new WebSocket(secondTarget.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{secondWs.addEventListener('open',resolve,{once:true});secondWs.addEventListener('error',reject,{once:true});});
 let secondId=0;const secondPending=new Map();
 secondWs.onmessage=event=>{const message=JSON.parse(String(event.data));if(message.id){secondPending.get(message.id)?.(message);secondPending.delete(message.id);}};
 const secondCall=(method,params={})=>new Promise((resolve,reject)=>{const id=++secondId;secondPending.set(id,result=>result.error?reject(Error(JSON.stringify(result.error))):resolve(result.result));secondWs.send(JSON.stringify({id,method,params}));});
 const secondEvaluate=async expression=>{const result=await secondCall('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.text);return result.result.value;};
 await secondCall('Runtime.enable');
 for(let i=0;i<100;i++){if(await secondEvaluate('location.origin === '+JSON.stringify(origin)))break;await new Promise(r=>setTimeout(r,50));}
 assert.equal(await secondEvaluate('location.origin'),origin);
 await call('Page.bringToFront');
 const holdLock=async name=>{
  await secondEvaluate(`window.testHeld=false;void navigator.locks.request(${JSON.stringify(name)},async()=>{window.testHeld=true;await new Promise(resolve=>{window.releaseTestLock=resolve;});})`);
  for(let i=0;i<100;i++){if(await secondEvaluate('window.testHeld'))break;await new Promise(r=>setTimeout(r,50));}
  assert.equal(await secondEvaluate('window.testHeld'),true);
 };
 const choose=async path=>{
  const document=await call('DOM.getDocument');
  const node=await call('DOM.querySelector',{nodeId:document.root.nodeId,selector:'input[type=file]'});
  await call('DOM.setFileInputFiles',{nodeId:node.nodeId,files:[path]});
  await wait("document.body.innerText.includes('Video seleccionado. Comprobaremos')");
 };
 const resume=()=>evaluate("Array.from(document.querySelectorAll('button')).find(x=>x.textContent==='Continuar subida').click()");
 await choose(differentPath);await resume();
 await wait("document.body.innerText.includes('no coincide con el video que empezaste')");
 assert.equal(requests.filter(x=>x.method==='PUT').length,0);
 await holdLock('vistavo-candidate-account:'+account+':upload:'+input);
 await choose(originalPath);await resume();
 await wait("document.querySelector('progress')?.value === 1");
 await new Promise(resolve=>setTimeout(resolve,300));
 assert.equal(requests.filter(x=>x.method==='PUT').length,0);
 await secondEvaluate('window.releaseTestLock()');
 await wait("document.body.innerText.includes('Archivo recibido.')");
 assert.equal(requests.filter(x=>x.method==='PUT').length,1);
 assert.equal(requests.find(x=>x.method==='PUT').offset,String(chunkSize));
 assert.equal(requests.filter(x=>x.method==='POST'&&x.path.endsWith('/complete')).length,1);
 assert.equal(requests.filter(x=>x.method==='POST'&&x.path==='/api/cloud/uploads').length,0);
 assert.deepEqual(exceptions,[]);
 const shot=await call('Page.captureScreenshot',{format:'png'});
 await writeFile(join(root,'resume-after.png'),Buffer.from(shot.data,'base64'));
 const widths=[];
 for(const width of [320,390]){
  await call('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});
  const metric=await evaluate('({viewport:innerWidth,document:document.documentElement.scrollWidth})');
  assert.ok(metric.document<=metric.viewport,JSON.stringify(metric));widths.push(metric);
 }
 expired=true;
 await call('Page.navigate',{url:origin+'/'});
 await wait("document.body.innerText.includes('El archivo y sus resultados vencieron')");
 assert.equal(requests.filter(x=>x.method==='DELETE').length,0);
 assert.equal(await evaluate("document.querySelector('input[type=file]').disabled"),true);
 assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(prefix+'request:'+digest+':upload:0')})`),requestKey);
 acceptDialog=true;
 await evaluate("Array.from(document.querySelectorAll('button')).find(x=>x.textContent==='Descartar archivo vencido').click()");
 await wait("document.body.innerText.includes('Archivo vencido descartado')");
 assert.equal(requests.filter(x=>x.method==='DELETE').length,1);
 assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(prefix+'request:'+digest+':upload:0')})`),null);
 assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(prefix+'input')})`),null);
 const document=await call('DOM.getDocument');
 const fileInput=await call('DOM.querySelector',{nodeId:document.root.nodeId,selector:'input[type=file]'});
 await call('DOM.setFileInputFiles',{nodeId:fileInput.nodeId,files:[originalPath]});
 await wait("document.body.innerText.includes('Video listo.')");
 await holdLock('vistavo-candidate-account:'+account);
 await evaluate("Array.from(document.querySelectorAll('button')).find(x=>x.textContent==='Subir a mi espacio privado').click()");
 await wait("document.querySelector('progress')?.value === 1");
 await new Promise(resolve=>setTimeout(resolve,300));
 assert.equal(requests.filter(x=>x.method==='POST'&&x.path==='/api/cloud/uploads').length,0);
 await secondEvaluate('window.releaseTestLock()');
 await wait("document.body.innerText.includes('Archivo recibido.')");
 assert.equal(nextState,'queued');assert.ok(nextRequestKey);assert.notEqual(nextRequestKey,requestKey);
 assert.equal(requests.filter(x=>x.method==='POST'&&x.path==='/api/cloud/uploads').length,1);
 // Lost cancel response and unavailable read: the browser must preserve the marker after reload.
 nextState='ready';
 await call('Page.removeScriptToEvaluateOnNewDocument',{identifier:preload.identifier});
 await evaluate(`localStorage.setItem(${JSON.stringify(prefix+'input')},${JSON.stringify(nextInput)});localStorage.setItem(${JSON.stringify(prefix+'job:'+nextInput+':translation:en')},${JSON.stringify(jobId)});`);
 await call('Page.navigate',{url:origin+'/'});
 await wait("Array.from(document.querySelectorAll('button')).some(x=>x.textContent==='Cancelar solicitud')");
 await evaluate("Array.from(document.querySelectorAll('button')).find(x=>x.textContent==='Cancelar solicitud').click()");
 await wait("document.body.innerText.includes('Hay una cancelación sin confirmar')");
 assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(prefix+'cancel:'+nextInput)})`),jobId);
 assert.equal(cancelRequests,1);
 await call('Page.navigate',{url:origin+'/'});
 await wait("document.body.innerText.includes('Hay una cancelación sin confirmar')");
 await wait("document.body.innerText.includes('El servicio no está disponible en este momento')");
 assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(prefix+'cancel:'+nextInput)})`),jobId);
 assert.equal(await evaluate("Array.from(document.querySelectorAll('button')).find(x=>x.textContent==='Reintentar cancelación').disabled"),true);
 jobReadUnavailable=false;
 await evaluate("Array.from(document.querySelectorAll('button')).find(x=>x.textContent==='Volver a consultar').click()");
 await wait("Array.from(document.querySelectorAll('button')).find(x=>x.textContent==='Reintentar cancelación')?.disabled===false");
 await evaluate("Array.from(document.querySelectorAll('button')).find(x=>x.textContent==='Reintentar cancelación').click()");
 await wait("!document.body.innerText.includes('Hay una cancelación sin confirmar')");
 assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(prefix+'cancel:'+nextInput)})`),null);
 assert.equal(cancelRequests,2);assert.equal(jobState,'cancelled');
 assert.equal(requests.filter(x=>x.method==='POST'&&x.path==='/api/cloud/ai/jobs').length,0);
 const evidence={result:'PASS',environment:'local Chrome emulating mobile viewport; synthetic identity, API and MP4',viewport:'390x844',recoveredOffset:chunkSize,
  differentSameSizeRejected:true,resumePutCount:1,resumeCompleteCount:1,resumeNewUploadCount:0,expiredExplicitCleanup:true,deleteCount:1,expiredReuploadUsesNewKey:true,twoTabsWaitResumeLock:true,twoTabsWaitAccountLock:true,cancelLostResponseSurvivesReload:true,recoveryFailureBlocksCancelRetry:true,cancelSameJobRetry:true,widths,exceptions,requests};
 await writeFile(join(root,'browser-result.json'),JSON.stringify(evidence,null,2));
 console.log(JSON.stringify(evidence));
}finally{
 secondWs?.close();ws?.close();
 if(browser&&browser.exitCode===null){
  const exited=new Promise(resolve=>browser.once('exit',resolve));
  browser.kill();await Promise.race([exited,new Promise(resolve=>setTimeout(resolve,3000))]);
 }
 await new Promise(resolve=>server.close(resolve));
 const safeRoot=resolve(root)+sep,safeProfile=resolve(profile);
 if(!safeProfile.startsWith(safeRoot)||!safeProfile.slice(safeRoot.length).startsWith('chrome-'))throw Error('Unsafe profile cleanup');
 await rm(safeProfile,{recursive:true,force:true,maxRetries:3,retryDelay:200});
}
