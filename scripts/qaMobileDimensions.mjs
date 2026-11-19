// Local-only browser check: synthetic videos, account and API. No Google/cloud calls.
import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {copyFile,mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {promisify} from 'node:util';
import {build} from 'esbuild';

const exec=promisify(execFile),root=resolve('outputs/lv019-b-mobile-dimensions-20261117');
await mkdir(root,{recursive:true});
const valid=join(root,'synthetic-1920.mp4'),wide=join(root,'synthetic-1921.mp4'),tall=join(root,'synthetic-tall-1921.mp4'),wrong=join(root,'synthetic.mov');
for(const [path,size,expected] of [[valid,'1920x32','1920x32'],[wide,'1921x32','1921x32'],[tall,'32x1921','32x1921']]){
 await exec('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i',`testsrc=size=${size}:rate=1:duration=1`,'-an','-c:v','libvpx-vp9','-threads','1','-deadline','realtime','-cpu-used','8','-b:v','0','-crf','45','-pix_fmt','yuv420p','-movflags','+faststart',path],{windowsHide:true});
 const {stdout}=await exec('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','csv=s=x:p=0',path],{windowsHide:true});
 assert.equal(stdout.trim(),expected);
}
await copyFile(valid,wrong);
await build({entryPoints:['server/commercial/web/cloudCandidate.tsx'],bundle:true,format:'esm',platform:'browser',outdir:root,entryNames:'candidate',plugins:[{
 name:'synthetic-auth',setup(builder){
  builder.onResolve({filter:/^\.\/cloudCandidateAuth$/},()=>({path:'auth',namespace:'synthetic'}));
  builder.onLoad({filter:/.*/,namespace:'synthetic'},()=>({contents:`
   const user={uid:'synthetic-user',email:'synthetic@example.invalid',emailVerified:true};let listener;
   window.__authOut=()=>listener?.(null);window.__authIn=()=>listener?.(user);
   export async function candidateAuth(){return {observe(fn){listener=fn;queueMicrotask(()=>fn(user));return ()=>{listener=undefined}},token:async()=>'synthetic-token',logout:async()=>listener?.(null)}}
  `,loader:'js'}));
 },
}]});

const account='10000000-0000-4000-8000-000000000001',input='20000000-0000-4000-8000-000000000001';
const requests=[];let offset=0,size=0,state='uploading';
const server=createServer(async(req,res)=>{
 const url=new URL(req.url??'/','http://127.0.0.1');requests.push({method:req.method,path:url.pathname});
 const reply=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 if(url.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/candidate.css"><div id="cloud-candidate"></div><script type="module" src="/candidate.js"></script>');return;}
 if(url.pathname==='/candidate.js'||url.pathname==='/candidate.css'){const data=await readFile(join(root,url.pathname.slice(1)));res.writeHead(200,{'Content-Type':url.pathname.endsWith('.js')?'text/javascript':'text/css'}).end(data);return;}
 if(url.pathname==='/fixture.mp4'){res.writeHead(200,{'Content-Type':'video/mp4'}).end(await readFile(valid));return;}
 const media=new Map([['/media/valid',valid],['/media/wide',wide],['/media/tall',tall],['/media/wrong',wrong]]);
 if(media.has(url.pathname)){res.writeHead(200,{'Content-Type':'application/octet-stream'}).end(await readFile(media.get(url.pathname)));return;}
 if(url.pathname==='/brand/vistavo-symbol.svg'){res.writeHead(200,{'Content-Type':'image/svg+xml'}).end('<svg xmlns="http://www.w3.org/2000/svg"/>');return;}
 if(url.pathname==='/api/cloud/me')return reply(200,{id:account,balance:{available:0,reserved:0}});
 if(url.pathname==='/api/cloud/uploads'&&req.method==='POST'){
  const parts=[];for await(const part of req)parts.push(part);const body=JSON.parse(Buffer.concat(parts).toString('utf8'));
  size=body.size;offset=0;state='uploading';return reply(201,{id:input,name:body.name,size,offset,state});
 }
 if(url.pathname==='/api/cloud/uploads/'+input&&req.method==='GET')return reply(200,{id:input,name:'synthetic-1920.mp4',size,offset,state});
 if(url.pathname==='/api/cloud/uploads/'+input+'/chunks'&&req.method==='PUT'){
  const parts=[];for await(const part of req)parts.push(part);assert.equal(Number(url.searchParams.get('offset')),offset);offset+=Buffer.concat(parts).length;return reply(200,{id:input,size,offset,state});
 }
 if(url.pathname==='/api/cloud/uploads/'+input+'/complete'&&req.method==='POST'){
  assert.equal(offset,size);state='queued';return reply(202,{id:input,size,offset,state});
 }
 return reply(404,{error:'synthetic_not_found'});
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const address=server.address();assert.ok(address&&typeof address!=='string');const origin='http://127.0.0.1:'+address.port;
const profile=await mkdtemp(join(root,'chrome-'));let browser,ws;
try{
 browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--disable-background-networking','--disable-sync','--disable-extensions','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
 let port;for(let i=0;i<100;i++){try{port=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await new Promise(resolve=>setTimeout(resolve,100));}}assert.ok(port,'Chrome did not start');
 const target=await(await fetch('http://127.0.0.1:'+port+'/json/new?about:blank',{method:'PUT'})).json();ws=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 let nextId=0;const pending=new Map(),exceptions=[];
 ws.onmessage=event=>{const message=JSON.parse(String(event.data));if(message.id){pending.get(message.id)?.(message);pending.delete(message.id);}if(message.method==='Runtime.exceptionThrown')exceptions.push(message.params.exceptionDetails.text);};
 const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,result=>result.error?reject(Error(JSON.stringify(result.error))):resolve(result.result));ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);return result.result.value;};
 const wait=async expression=>{for(let i=0;i<120;i++){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Timed out waiting for '+expression+'; '+await evaluate('document.body.innerText.slice(0,1600)')+'; video hooks '+JSON.stringify(await evaluate('window.__debugMedia')));};
 const choose=async(path,{metadata,hold=false}={})=>{
  const fixture=new Map([[valid,['valid','synthetic-1920.mp4']],[wide,['wide','synthetic-1921.mp4']],[tall,['tall','synthetic-tall-1921.mp4']],[wrong,['wrong','synthetic.mov']]]).get(path);
  assert.ok(fixture,'Only the four local synthetic fixtures are permitted');
  await evaluate("{const el=document.querySelector('input[type=file]');el.files=new DataTransfer().files;el.dispatchEvent(new Event('change',{bubbles:true}));}");
  await wait("!document.querySelector('[role=alert]') && !document.querySelector('.cv-message')");
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await evaluate(`(async()=>{window.__nextFixture=await(await fetch('/media/${fixture[0]}')).blob();return true})()`);
  if(metadata)await evaluate('window.__metadataPatch='+metadata);if(hold)await evaluate('window.__holdNextMetadata=true');
  await evaluate(`{const el=document.querySelector('input[type=file]');const transfer=new DataTransfer();transfer.items.add(new File([window.__nextFixture],${JSON.stringify(fixture[1])},{type:'video/mp4'}));el.files=transfer.files;el.dispatchEvent(new Event('change',{bubbles:true}));}`);
 };
 const uploadButton="Array.from(document.querySelectorAll('button')).find(x=>x.textContent==='Subir a mi espacio privado')";
 const noUpload=()=>assert.equal(requests.filter(r=>r.method==='POST'&&r.path==='/api/cloud/uploads').length,0);
 await call('Page.enable');await call('Runtime.enable');await call('DOM.enable');
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await call('Page.addScriptToEvaluateOnNewDocument',{source:`
  window.__heldEvents=[];window.__debugMedia=[];const create=Document.prototype.createElement;
  Document.prototype.createElement=function(name,...args){
   const element=create.call(this,name,...args);
   if(String(name).toLowerCase()==='video'){
    const stack=new Error().stack??'',selector=stack.includes('choose'),debug={selector,hold:!!window.__holdNextMetadata};window.__debugMedia.push(debug);
    if(!selector)return element;
    const forced=window.__metadataPatch;window.__metadataPatch=undefined;
    if(forced)debug.forced=Object.fromEntries(Object.entries(forced).map(([key,value])=>[key,String(value)]));
    if(forced)for(const [key,value] of Object.entries(forced))Object.defineProperty(element,key,{configurable:true,value});
    element.addEventListener('loadedmetadata',()=>{debug.loaded=[String(element.videoWidth),String(element.videoHeight),String(element.duration)]},{once:true});
    if(window.__holdNextMetadata){window.__holdNextMetadata=false;let handler;
     Object.defineProperty(element,'onloadedmetadata',{configurable:true,get(){return handler??null},set(value){handler=value}});
     element.addEventListener('loadedmetadata',event=>window.__heldEvents.push(()=>handler?.call(element,event)),{once:true});
    }
   }
   return element;
  };
 `});
 await call('Page.navigate',{url:origin+'/'});await wait("document.body.innerText.includes('Tu espacio privado')");
 await choose(valid);await wait("document.body.innerText.includes('Video listo.')");assert.equal(await evaluate(uploadButton+'.disabled'),false);
 for(const path of [wide,tall]){
  await choose(path);await wait("document.body.innerText.includes('supera 1920 píxeles')");
  assert.equal(await evaluate(uploadButton+'.disabled'),true);await evaluate(uploadButton+'.click()');noUpload();
 }
 for(const value of ['0','NaN']){
  await choose(valid,{metadata:'{videoWidth:'+value+'}'});
  await wait("document.body.innerText.includes('No pudimos leer las dimensiones')");
  assert.equal(await evaluate(uploadButton+'.disabled'),true);await evaluate(uploadButton+'.click()');noUpload();
 }
 await choose(valid,{metadata:'{duration:31}'});
 await wait("document.querySelector('[role=alert]')?.textContent.includes('Este ensayo admite videos hablados en español de hasta 30 segundos.')");
 assert.equal(await evaluate(uploadButton+'.disabled'),true);noUpload();
 await choose(valid,{metadata:'{duration:30}'});await wait("document.body.innerText.includes('Video listo.')");assert.equal(await evaluate(uploadButton+'.disabled'),false);
 await choose(wrong);await wait("document.body.innerText.includes('Selecciona un MP4')");assert.equal(await evaluate(uploadButton+'.disabled'),true);noUpload();
 // A delayed old selection cannot replace an oversized newer selection.
 await choose(valid,{hold:true});await wait('window.__heldEvents.length===1');
 await choose(wide);await wait("document.body.innerText.includes('supera 1920 píxeles')");
 await evaluate('window.__heldEvents.shift()()');await new Promise(resolve=>setTimeout(resolve,100));
 assert.equal(await evaluate(uploadButton+'.disabled'),true);assert.equal(await evaluate("!!document.querySelector('video[aria-label]')"),false);noUpload();
 // The same File object selected twice also invalidates the first delayed result.
 await evaluate(`(async()=>{window.__sameFile=new File([await(await fetch('/fixture.mp4')).blob()],'same.mp4',{type:'video/mp4'});window.__pickSame=()=>{const d=new DataTransfer();d.items.add(window.__sameFile);const el=document.querySelector('input[type=file]');el.files=d.files;el.dispatchEvent(new Event('change',{bubbles:true}));};return true})()`);
 await evaluate('window.__holdNextMetadata=true;window.__pickSame()');await wait('window.__heldEvents.length===1');
 await evaluate('window.__pickSame()');await wait("document.body.innerText.includes('Video listo.')");await evaluate('window.__heldEvents.shift()()');
 assert.equal(await evaluate(uploadButton+'.disabled'),false);noUpload();
 // Closing the account invalidates a pending selection even when metadata arrives later.
 await choose(valid,{hold:true});await wait('window.__heldEvents.length===1');
 await evaluate('window.__authOut()');await wait("!document.body.innerText.includes('Tu espacio privado')");await evaluate('window.__heldEvents.shift()()');
 await evaluate('window.__authIn()');await wait("document.body.innerText.includes('Tu espacio privado')");
 assert.equal(await evaluate(uploadButton+'.disabled'),true);assert.equal(await evaluate("!!document.querySelector('video[aria-label]')"),false);noUpload();
 await choose(valid);await wait("document.body.innerText.includes('Video listo.')");await evaluate(uploadButton+'.click()');
 await wait("document.body.innerText.includes('Archivo recibido.')");assert.equal(requests.filter(r=>r.method==='POST'&&r.path==='/api/cloud/uploads').length,1);assert.equal(offset,size);assert.equal(state,'queued');
 assert.deepEqual(exceptions,[]);
 const evidence={result:'PASS',environment:'local desktop Chrome, 390x844 emulated viewport; synthetic identity, local API and synthetic VP9 MP4s',browserFileDimensions:['1920x32 accepted','1921x32 rejected','32x1921 rejected'],forcedMetadata:['width 0 rejected','width NaN rejected','duration 31 rejected','duration 30 accepted'],wrongExtensionRejected:true,oldSelectionCannotOverrideNew:true,sameFileSelectionRaceChecked:true,closedSessionDiscardsMetadata:true,rejectedUploadPosts:0,acceptedUploadPosts:1,exceptions,requests};
 await writeFile(join(root,'browser-result.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}finally{
 ws?.close();if(browser&&browser.exitCode===null){const exited=new Promise(resolve=>browser.once('exit',resolve));browser.kill();await Promise.race([exited,new Promise(resolve=>setTimeout(resolve,3000))]);}
 await new Promise(resolve=>server.close(resolve));
 const safeRoot=resolve(root)+sep,safeProfile=resolve(profile);if(!safeProfile.startsWith(safeRoot)||!safeProfile.slice(safeRoot.length).startsWith('chrome-'))throw Error('Unsafe profile cleanup');
 await rm(safeProfile,{recursive:true,force:true,maxRetries:3,retryDelay:200});
}
