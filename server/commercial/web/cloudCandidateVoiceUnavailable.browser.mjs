// Isolated browser check: synthetic accounts, API and audio; no providers or cloud.
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {join, resolve, sep} from 'node:path';
import {build} from 'esbuild';

const root = resolve('outputs/lv019-b-voice-unavailable-' + randomUUID());
await mkdir(root, {recursive: false});
const authPlugin = {name:'synthetic-auth',setup(builder){
  builder.onResolve({filter:/^\.\/cloudCandidateAuth$/},()=>({path:'auth',namespace:'synthetic-auth'}));
  builder.onLoad({filter:/.*/,namespace:'synthetic-auth'},()=>({loader:'js',contents:`
    const user={uid:'synthetic-user',email:'synthetic@example.invalid',emailVerified:true};let observer;
    window.testSignOut=()=>observer?.(null);
    export async function candidateAuth(){return {observe(fn){observer=fn;queueMicrotask(()=>fn(user));return ()=>{observer=undefined}},token:async()=>'synthetic-token',logout:async()=>observer?.(null)}}
  `}));
}};
const featurePlugin = {name:'synthetic-review-flag',setup(builder){
  builder.onResolve({filter:/^\.\/reviewedTranslationFeature$/},()=>({path:'flag',namespace:'synthetic-flag'}));
  builder.onLoad({filter:/.*/,namespace:'synthetic-flag'},()=>({loader:'js',contents:'export const REVIEWED_TRANSLATION_CANDIDATE=true;'}));
}};
for(const [name,plugins] of [['off',[authPlugin]],['on',[authPlugin,featurePlugin]]]){
  await build({entryPoints:['server/commercial/web/cloudCandidate.tsx'],bundle:true,format:'esm',platform:'browser',outdir:root,entryNames:name,plugins});
}
const account='10000000-0000-4000-8000-000000000001',input='20000000-0000-4000-8000-000000000001';
const female='30000000-0000-4000-8000-000000000001',male='30000000-0000-4000-8000-000000000002';
const sounds={[female]:Buffer.from('synthetic female audio'),[male]:Buffer.from('synthetic male audio')};
const requests=[];let billing='simulation',revoked=false;
const server=createServer(async(req,res)=>{
  const url=new URL(req.url??'/','http://127.0.0.1');requests.push({method:req.method,path:url.pathname,operation:url.searchParams.get('operation')});
  const reply=(status,data)=>res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(data));
  if(url.pathname==='/off'||url.pathname==='/on'){
    const name=url.pathname.slice(1);return res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/${name}.css"><div id="cloud-candidate"></div><script type="module" src="/${name}.js"></script>`);
  }
  if(/^\/(off|on)\.(js|css)$/.test(url.pathname))return res.writeHead(200,{'Content-Type':url.pathname.endsWith('.js')?'text/javascript':'text/css'}).end(await readFile(join(root,url.pathname.slice(1))));
  if(url.pathname==='/brand/vistavo-symbol.svg')return res.writeHead(200,{'Content-Type':'image/svg+xml'}).end('<svg xmlns="http://www.w3.org/2000/svg"/>');
  if(url.pathname.startsWith('/api/')){assert.equal(req.headers.authorization,'Bearer synthetic-token');assert.equal(req.headers.cookie,undefined);}
  if(url.pathname==='/api/cloud/me')return reply(200,{id:account,balance:{available:60,reserved:0,unit:billing==='simulation'?'test-unit':'video_seconds'}});
  if(url.pathname==='/api/cloud/uploads/'+input)return reply(200,{id:input,name:'synthetic.mp4',state:'ready',offset:10,size:10,metadata:{duration:3.5,audioTracks:1}});
  if(url.pathname==='/api/cloud/projects/'+input)return reply(200,{revision:3,draft:'Synthetic text.'});
  for(const [id,sex] of [[female,'female'],[male,'male']]){
    const bytes=sounds[id],result={name:'narration-en.wav',mimeType:'audio/wav',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
    if(url.pathname==='/api/cloud/ai/jobs/'+id)return reply(200,{id,inputId:input,operation:'narration:en:'+sex,state:'succeeded',billingState:'settled',revision:3,stale:false,units:1,results:[result]});
    if(url.pathname==='/api/cloud/ai/jobs/'+id+'/results/narration-en.wav'){
      if(revoked)return reply(403,{error:'not_found'});
      return res.writeHead(200,{'Content-Type':'audio/wav','Cache-Control':'no-store','Content-Length':bytes.length}).end(bytes);
    }
  }
  return reply(404,{error:'synthetic_not_found'});
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const address=server.address();assert.ok(address&&typeof address!=='string');
const origin='http://127.0.0.1:'+address.port,profile=await mkdtemp(join(root,'chrome-'));let browser,ws;
try{
  browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--disable-background-networking','--disable-sync','--disable-extensions','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
  let port;for(let i=0;i<100;i++){try{port=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await new Promise(resolve=>setTimeout(resolve,100));}}assert.ok(port,'Chrome did not start');
  const target=await(await fetch('http://127.0.0.1:'+port+'/json/new?about:blank',{method:'PUT'})).json();ws=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  let next=0;const pending=new Map(),exceptions=[];
  ws.onmessage=event=>{const value=JSON.parse(String(event.data));if(value.id){pending.get(value.id)?.(value);pending.delete(value.id);}if(value.method==='Runtime.exceptionThrown')exceptions.push(value.params.exceptionDetails.text);};
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,value=>value.error?reject(Error(JSON.stringify(value.error))):resolve(value.result));ws.send(JSON.stringify({id,method,params}));});
  const evalJs=async expression=>{const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.text);return result.result.value;};
  const wait=async expression=>{for(let i=0;i<150;i++){if(await evalJs(expression))return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Timed out: '+expression+'; '+await evalJs('document.body.innerText.slice(0,3000)'));};
  await call('Page.enable');await call('Runtime.enable');
  const prefix='vistavo-candidate-v1:'+account+':';
  await call('Page.addScriptToEvaluateOnNewDocument',{source:`
    localStorage.setItem(${JSON.stringify(prefix+'input')},${JSON.stringify(input)});
    localStorage.setItem(${JSON.stringify(prefix+'job:'+input+':narration:en:female')},${JSON.stringify(female)});
    localStorage.setItem(${JSON.stringify(prefix+'job:'+input+':narration:en:male')},${JSON.stringify(male)});
    window.syntheticDownloads=[];window.syntheticBlobs=[];
    const create=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{window.syntheticBlobs.push(blob);return create(blob)};
    HTMLAnchorElement.prototype.click=function(){if(this.download)window.syntheticDownloads.push(this.download)};
  `});
  const completed=[];
  for(const feature of ['off','on'])for(const scenario of ['simulation','account_seconds']){
    billing=scenario;revoked=false;
    await call('Emulation.setDeviceMetricsOverride',{width:feature==='off'?320:390,height:844,deviceScaleFactor:1,mobile:true});
    await call('Page.navigate',{url:origin+'/'+feature});await wait("document.body.innerText.includes('Recuperamos el último archivo')");
    const yes="document.querySelector('input[name=cv-voice-choice][value=yes]')",no="document.querySelector('input[name=cv-voice-choice][value=no]')";
    assert.equal(await evalJs(yes+".matches(':disabled')"),true);assert.equal(await evalJs(no+".matches(':disabled')"),true);
    assert.equal(await evalJs(no+'.checked'),true);assert.equal(await evalJs(yes+'.checked'),false);
    assert.equal(await evalJs("document.querySelector('#cv-voice-explanation').innerText.includes('todavía no está disponible')"),true);
    assert.equal(await evalJs("document.querySelector('.cv-voices').innerText.includes('Si ya tienes voces')"),true);
    assert.equal(await evalJs("Array.from(document.querySelectorAll('.cv-voices button')).some(b=>/cotización|generar voz|misma solicitud/i.test(b.textContent))"),false);
    assert.equal(await evalJs('document.documentElement.scrollWidth<=innerWidth'),true);
    const forbidden=()=>requests.filter(r=>r.path==='/api/cloud/ai/quote'||r.path==='/api/cloud/ai/jobs'&&r.method==='POST');
    const before=forbidden().length;await evalJs(yes+'.focus();'+yes+'.click()');
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});
    await call('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});
    assert.equal(await evalJs(yes+'.checked'),false);assert.equal(await evalJs('document.activeElement==='+yes),false);assert.equal(forbidden().length,before);
    for(const [index,id] of [[0,female],[1,male]]){
      const card=`document.querySelectorAll('.cv-voice')[${index}]`;
      const count=requests.filter(r=>r.path==='/api/cloud/ai/jobs/'+id).length;
      await evalJs(`Array.from(${card}.querySelectorAll('button')).find(b=>b.textContent.trim()==='Consultar estado').click()`);
      await wait("document.body.innerText.includes('Estado del trabajo actualizado')");
      assert.equal(requests.filter(r=>r.path==='/api/cloud/ai/jobs/'+id).length,count+1);
      const downloaded=await evalJs('window.syntheticDownloads.length');
      await evalJs(`Array.from(${card}.querySelectorAll('button')).find(b=>b.textContent.includes('Descargar WAV')).click()`);
      await wait('window.syntheticDownloads.length==='+String(downloaded+1));
      assert.equal(await evalJs('window.syntheticDownloads.at(-1)'),'narration-en.wav');
      assert.equal(await evalJs('window.syntheticBlobs.at(-1).text()'),sounds[id].toString());
      await evalJs(`Array.from(${card}.querySelectorAll('button')).find(b=>b.textContent.trim()==='Preparar audio para escuchar').click()`);
      await wait(card+".querySelector('audio')!==null");assert.equal(await evalJs('window.syntheticBlobs.at(-1).text()'),sounds[id].toString());
    }
    const priorDownloads=await evalJs('window.syntheticDownloads.length'),priorBlobs=await evalJs('window.syntheticBlobs.length');revoked=true;
    await evalJs("Array.from(document.querySelector('.cv-voice').querySelectorAll('button')).find(b=>b.textContent.includes('Descargar WAV')).click()");
    await wait("document.querySelector('[role=alert]')?.innerText.includes('no tiene acceso')");
    assert.equal(await evalJs('window.syntheticDownloads.length'),priorDownloads);assert.equal(await evalJs('window.syntheticBlobs.length'),priorBlobs);
    assert.equal(forbidden().length,before);
    await evalJs('window.testSignOut()');await wait("!document.body.innerText.includes('Tu espacio privado')");
    assert.equal(await evalJs("document.querySelector('.cv-voices')===null"),true);
    completed.push({feature,scenario,existingFemaleAndMaleConsultedAndDownloaded:true,voiceQuoteAndPostCount:0,deniedDownloadCreatesNoBlob:true});
  }
  assert.deepEqual(exceptions,[]);
  const evidence={result:'PASS',syntheticOnly:true,physicalPhoneTested:false,combinations:completed,downloadedAudioWasSynthetic:true,audioPlaybackNotClaimed:true,exceptions};
  await writeFile(join(root,'browser-result.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({root,...evidence}));
}catch(error){await writeFile(join(root,'browser-failure.json'),JSON.stringify({error:String(error),requests},null,2));throw error;}
finally{
  ws?.close();if(browser&&browser.exitCode===null){const exited=new Promise(resolve=>browser.once('exit',resolve));browser.kill();await Promise.race([exited,new Promise(resolve=>setTimeout(resolve,3000))]);}
  await new Promise(resolve=>server.close(resolve));const safeRoot=resolve(root)+sep,safeProfile=resolve(profile);
  if(!safeProfile.startsWith(safeRoot)||!safeProfile.slice(safeRoot.length).startsWith('chrome-'))throw Error('Unsafe profile cleanup');
  await rm(safeProfile,{recursive:true,force:true,maxRetries:3,retryDelay:200});
}
