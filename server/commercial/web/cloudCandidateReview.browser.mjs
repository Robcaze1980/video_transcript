// Synthetic local browser coverage; no Firebase, provider or real account access.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {build} from 'esbuild';

const root=resolve('outputs/lv019-b-review-mobile-'+randomUUID());await mkdir(root,{recursive:false});
await build({entryPoints:['server/commercial/web/cloudCandidate.tsx'],bundle:true,format:'esm',platform:'browser',outdir:root,entryNames:'candidate',plugins:[{
 name:'synthetic-auth',setup(builder){
  builder.onResolve({filter:/^\.\/cloudCandidateAuth$/},()=>({path:'auth',namespace:'synthetic'}));
  builder.onLoad({filter:/.*/,namespace:'synthetic'},()=>({loader:'js',contents:`
   const user={uid:'synthetic-user',email:'synthetic@example.invalid',emailVerified:true};let observer;
   window.testSignOut=()=>observer?.(null);window.testSignIn=()=>observer?.(user);
   export async function candidateAuth(){return {observe(fn){observer=fn;queueMicrotask(()=>fn(user));return ()=>{observer=undefined}},token:async()=>'synthetic-token',logout:async()=>observer?.(null)}}
  `}));
 },
}]});
const account='10000000-0000-4000-8000-000000000001',input='20000000-0000-4000-8000-000000000001';
const translationId='30000000-0000-4000-8000-000000000001',voiceId='30000000-0000-4000-8000-000000000002';
const content={
 'translation-en.txt':{bytes:Buffer.from('Synthetic English text.'),mimeType:'text/plain; charset=utf-8'},
 'narration-en.wav':{bytes:Buffer.from('RIFFsynthetic-WAVE'),mimeType:'audio/wav'},
};
for(const [name,item] of Object.entries(content)){item.name=name;item.size=item.bytes.length;item.sha256=createHash('sha256').update(item.bytes).digest('hex');}
const manifest=name=>{const {bytes,...entry}=content[name];return entry;};
const requests=[];let voiceBilling='settled',holdNextVoice=true,heldVoice,failRecovery=false;
const dto=(voice,billing=voiceBilling)=>({id:voice?voiceId:translationId,inputId:input,operation:voice?'narration:en:female':'translation:en',state:'succeeded',billingState:voice?billing:'settled',revision:1,stale:false,units:10,results:[manifest(voice?'narration-en.wav':'translation-en.txt')]});
const server=createServer(async(req,res)=>{
 const url=new URL(req.url??'/','http://127.0.0.1');requests.push({method:req.method,path:url.pathname});
 const reply=(code,data)=>res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(data));
 if(url.pathname==='/')return res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/candidate.css"><div id="cloud-candidate"></div><script type="module" src="/candidate.js"></script>');
 if(url.pathname==='/blank')return res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end('<!doctype html><title>Synthetic same-origin document</title>');
 if(url.pathname==='/candidate.js'||url.pathname==='/candidate.css')return res.writeHead(200,{'Content-Type':url.pathname.endsWith('.js')?'text/javascript':'text/css'}).end(await readFile(join(root,url.pathname.slice(1))));
 if(url.pathname==='/brand/vistavo-symbol.svg')return res.writeHead(200,{'Content-Type':'image/svg+xml'}).end('<svg xmlns="http://www.w3.org/2000/svg"/>');
 if(url.pathname==='/api/cloud/me')return reply(200,{id:account,balance:{available:10,reserved:1,unit:'video_seconds'}});
 if(url.pathname==='/api/cloud/uploads/'+input){if(req.method==='DELETE')return reply(202,{id:input,state:'deleting'});return reply(200,{id:input,name:'synthetic.mp4',state:'ready',offset:100,size:100,metadata:{duration:10,audioTracks:1}});}
 if(url.pathname==='/api/cloud/projects/'+input)return reply(200,{revision:1,draft:'Synthetic English text.'});
 if(url.pathname==='/api/cloud/ai/jobs/'+translationId)return reply(200,dto(false));
 if(url.pathname==='/api/cloud/ai/jobs/'+voiceId){
  if(failRecovery)return reply(503,{error:'synthetic_unavailable'});
  if(holdNextVoice){holdNextVoice=false;const saved=dto(true);res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.flushHeaders();heldVoice=()=>res.end(JSON.stringify(saved));return;}
  return reply(200,dto(true));
 }
 for(const [name,item] of Object.entries(content))if(url.pathname===`/api/cloud/ai/jobs/${name.endsWith('.wav')?voiceId:translationId}/results/${name}`)return res.writeHead(200,{'Content-Type':item.mimeType,'Cache-Control':'no-store'}).end(item.bytes);
 if(url.pathname==='/api/cloud/ai/quote')return reply(200,{inputId:input,operation:url.searchParams.get('operation'),revision:1,units:10,billing:{mode:'account_seconds',unit:'video_seconds',priceUsd:0.02,rateUsdPerMinute:0.10}});
 if(url.pathname==='/api/cloud/ai/jobs'&&req.method==='POST')return reply(202,{id:voiceId});
 return reply(404,{error:'synthetic_not_found'});
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
const origin='http://127.0.0.1:'+address.port,profile=await mkdtemp(join(root,'chrome-'));let browser,ws;
try{
 browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--disable-background-networking','--disable-sync','--disable-extensions','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
 let port;for(let i=0;i<100;i++){try{port=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await new Promise(resolve=>setTimeout(resolve,100));}}assert.ok(port,'Chrome did not start');
 const target=await(await fetch('http://127.0.0.1:'+port+'/json/new?about:blank',{method:'PUT'})).json();ws=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 let nextId=0;const pending=new Map(),exceptions=[];
 ws.onmessage=event=>{const message=JSON.parse(String(event.data));if(message.id){pending.get(message.id)?.(message);pending.delete(message.id);}if(message.method==='Runtime.exceptionThrown')exceptions.push(message.params.exceptionDetails.text);};
 const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,result=>result.error?reject(Error(JSON.stringify(result.error))):resolve(result.result));ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.text);return result.result.value;};
 const wait=async expression=>{for(let i=0;i<120;i++){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Timed out waiting for '+expression+'; '+await evaluate('document.body.innerText.slice(0,2500)'));};
 const prefix='vistavo-candidate-v1:'+account+':',voice="document.querySelector('.cv-voice-grid .cv-voice')",textSection="document.querySelector('.cv-grid > section:nth-child(2)')";
 await call('Page.enable');await call('Runtime.enable');await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await call('Page.addScriptToEvaluateOnNewDocument',{source:`
  localStorage.setItem(${JSON.stringify(prefix+'input')},${JSON.stringify(input)});
  localStorage.setItem(${JSON.stringify(prefix+'job:'+input+':translation:en')},${JSON.stringify(translationId)});
  localStorage.setItem(${JSON.stringify(prefix+'job:'+input+':narration:en:female')},${JSON.stringify(voiceId)});
  window.syntheticUrls=[];window.syntheticRevoked=[];window.syntheticDownloads=[];
  const make=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
  URL.createObjectURL=blob=>{const url=make(blob);window.syntheticUrls.push(url);return url};
  URL.revokeObjectURL=url=>{window.syntheticRevoked.push(url);return revoke(url)};
  HTMLAnchorElement.prototype.click=function(){if(this.download)window.syntheticDownloads.push(this.download)};
  window.confirm=()=>true;
  window.failReviewSave=false;const write=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(window.failReviewSave&&key.includes(':review-mark:'))throw Error('synthetic storage failure');return write.call(this,key,value)};
 `});
 await call('Page.navigate',{url:origin+'/'});await wait("document.body?.innerText.includes('Buscando tu subida anterior')");
 for(let i=0;i<100&&!heldVoice;i++)await new Promise(resolve=>setTimeout(resolve,100));assert.ok(heldVoice,'recovery did not reach the controlled barrier');
 await wait(textSection+".querySelector('.cv-download')!==null");assert.equal(await evaluate(textSection+".querySelector('.cv-download').disabled"),true);assert.equal(await evaluate(textSection+".querySelector('.cv-actions button').disabled"),true);
 heldVoice();heldVoice=undefined;await wait("document.body.innerText.includes('Recuperamos el último archivo')");
 await wait(voice+".innerText.includes('Descargar WAV')");
 await evaluate(`Array.from(${voice}.querySelectorAll('button')).find(b=>b.textContent.includes('Preparar audio')).click()`);
 await wait(voice+".querySelector('audio')!==null");const previousAudio=await evaluate(voice+".querySelector('audio').getAttribute('src')");
 await evaluate(`new Promise(resolve=>{const frame=document.createElement('iframe');frame.src='/blank';frame.onload=()=>{window.syntheticFrame=frame;resolve(true)};document.body.append(frame)})`);
 await evaluate(`window.syntheticFrame.contentWindow.localStorage.setItem(${JSON.stringify(prefix+'review-mark:'+voiceId)},JSON.stringify({inputId:${JSON.stringify(input)},version:'40000000-0000-4000-8000-000000000001'}))`);
 await wait(voice+".innerText.includes('Necesita revisión')");assert.equal(await evaluate(voice+".querySelector('audio')===null"),true);assert.equal(await evaluate(`window.syntheticRevoked.includes(${JSON.stringify(previousAudio)})`),true);await evaluate('window.syntheticFrame.remove()');
 await evaluate(`Array.from(${voice}.querySelectorAll('button')).find(b=>b.textContent==='Consultar estado').click()`);await wait(voice+".querySelector('.cv-status').innerText.includes('Listo')");
 await evaluate(`Array.from(${voice}.querySelectorAll('button')).find(b=>b.textContent.includes('Preparar audio')).click()`);await wait(voice+".querySelector('audio')!==null");const audioUrl=await evaluate(voice+".querySelector('audio').getAttribute('src')");
 holdNextVoice=true;for(let i=0;i<100&&!heldVoice;i++)await new Promise(resolve=>setTimeout(resolve,100));assert.ok(heldVoice,'poll did not reach the controlled barrier');
 voiceBilling='review';assert.equal(await evaluate(`Array.from(${voice}.querySelectorAll('button')).find(b=>b.textContent==='Consultar estado').disabled`),false);await evaluate(`Array.from(${voice}.querySelectorAll('button')).find(b=>b.textContent==='Consultar estado').click()`);
 await wait(voice+".innerText.includes('Necesita revisión')");heldVoice();heldVoice=undefined;await new Promise(resolve=>setTimeout(resolve,500));
 assert.equal(await evaluate(voice+".querySelector('audio')===null"),true);assert.equal(await evaluate(`window.syntheticRevoked.includes(${JSON.stringify(audioUrl)})`),true);
 assert.equal(await evaluate(voice+".innerText.includes('Descargar WAV')"),false);assert.equal(await evaluate(voice+".querySelector('.cv-status').innerText.includes('Listo')"),false);
 assert.equal(await evaluate(voice+".innerText.includes('Consultar estado')"),true);
 assert.equal(await evaluate(textSection+".innerText.includes('Inglés · TXT')"),true);
 const priorQuotes=requests.filter(r=>r.path==='/api/cloud/ai/quote').length,priorPosts=requests.filter(r=>r.path==='/api/cloud/ai/jobs'&&r.method==='POST').length;
 assert.equal(await evaluate(textSection+".querySelector('.cv-actions button').disabled"),true);
 assert.equal(await evaluate(voice+".querySelector('.cv-actions button').disabled"),true);
 await evaluate(textSection+".querySelector('.cv-download').click()");await wait("window.syntheticDownloads.includes('translation-en.txt')");
 assert.equal(requests.filter(r=>r.path==='/api/cloud/ai/quote').length,priorQuotes);assert.equal(requests.filter(r=>r.path==='/api/cloud/ai/jobs'&&r.method==='POST').length,priorPosts);
 const widths=[];for(const width of [320,390]){await call('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});const size=await evaluate('({viewport:innerWidth,document:document.documentElement.scrollWidth})');assert.ok(size.document<=size.viewport,JSON.stringify(size));widths.push(size);}
 // A previously observed review survives reload when the server gives an older or unresolved billing state.
 for(const variant of ['pending','simulated','absent']){
  await evaluate('window.testSignOut()');await wait("!document.body.innerText.includes('Tu espacio privado')");voiceBilling=variant==='absent'?undefined:variant;await evaluate('window.testSignIn()');
  await wait(voice+".innerText.includes('Necesita revisión')");assert.equal(await evaluate(textSection+".querySelector('.cv-actions button').disabled"),true);assert.equal(await evaluate(voice+".innerText.includes('Descargar WAV')"),false);
 }
 // If saving the review fails, the current session stays blocked and tells the user.
 await evaluate('window.testSignOut()');await wait("!document.body.innerText.includes('Tu espacio privado')");await evaluate(`localStorage.removeItem(${JSON.stringify(prefix+'review-mark:'+voiceId)});window.failReviewSave=true`);voiceBilling='review';await evaluate('window.testSignIn()');
 await wait(voice+".innerText.includes('No pudimos guardar este aviso')");assert.equal(await evaluate(textSection+".querySelector('.cv-actions button').disabled"),true);
 await evaluate('window.failReviewSave=false');await evaluate(`Array.from(${voice}.querySelectorAll('button')).find(b=>b.textContent==='Consultar estado').click()`);await wait(voice+".innerText.includes('Necesita revisión') && !"+voice+".innerText.includes('No pudimos guardar este aviso')");
 // A later failed status refresh also blocks actions until an explicit retry.
 failRecovery=true;await wait("document.body.innerText.includes('No pudimos consultar todos los trabajos')");assert.equal(await evaluate(textSection+".querySelector('.cv-actions button').disabled"),true);
 failRecovery=false;await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Volver a consultar').click()");await wait("!document.body.innerText.includes('No pudimos consultar todos los trabajos')");
 // A failed remembered-job read keeps actions blocked; explicit retry restores the review state.
 await evaluate('window.testSignOut()');await wait("!document.body.innerText.includes('Tu espacio privado')");await evaluate(`localStorage.setItem(${JSON.stringify(prefix+'cancel:'+input)},${JSON.stringify(voiceId)})`);failRecovery=true;await evaluate('window.testSignIn()');
 await wait("document.body.innerText.includes('No pudimos consultar todos los trabajos')");assert.equal(await evaluate(textSection+".querySelector('.cv-actions button').disabled"),true);
 failRecovery=false;await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Volver a consultar').click()");await wait(voice+".innerText.includes('Necesita revisión')");
 assert.equal(await evaluate(textSection+".querySelector('.cv-actions button').disabled"),true);
 assert.equal(await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Reintentar cancelación').disabled"),true);
 assert.equal(await evaluate("document.querySelector('.cv-danger').disabled"),false);await evaluate("document.querySelector('.cv-danger').click()");
 await wait("document.body.innerText.includes('Guardamos referencias de trabajos en este navegador')");
 assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(prefix+'cancel:'+input)})`),voiceId);
 assert.equal(await evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(prefix+'review-references')})).some(ref=>ref.jobId===${JSON.stringify(voiceId)})`),true);
 assert.equal(requests.filter(r=>r.path==='/api/cloud/ai/jobs/'+voiceId&&r.method==='DELETE').length,0);
 await call('Emulation.setDeviceMetricsOverride',{width:320,height:844,deviceScaleFactor:1,mobile:true});const referenceWidth=await evaluate('({viewport:innerWidth,document:document.documentElement.scrollWidth})');assert.ok(referenceWidth.document<=referenceWidth.viewport,JSON.stringify(referenceWidth));
 await evaluate('window.testSignOut()');await wait("!document.body.innerText.includes('Tu espacio privado')");await evaluate('window.testSignIn()');await wait("document.body.innerText.includes('Guardamos referencias de trabajos en este navegador')");
 // Corrupt local references must not prevent the owner from withdrawing access.
 await evaluate('window.testSignOut()');await wait("!document.body.innerText.includes('Tu espacio privado')");
 await evaluate(`localStorage.setItem(${JSON.stringify(prefix+'input')},${JSON.stringify(input)});localStorage.setItem(${JSON.stringify(prefix+'review-references')},'{invalid')`);await evaluate('window.testSignIn()');
 await wait("document.body.innerText.includes('No pudimos recuperar las referencias guardadas')");await wait("document.querySelector('.cv-danger')!==null");assert.equal(await evaluate("document.querySelector('.cv-danger').disabled"),false);
 await evaluate("document.querySelector('.cv-danger').click()");await wait("document.body.innerText.includes('No pudimos actualizar toda la información')");
 assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(prefix+'review-references')})`),'{invalid');
 assert.deepEqual(exceptions,[]);
 const evidence={result:'PASS',environment:'local headless Chrome with synthetic data; mobile viewport emulation, not physical devices',widths,referenceWidth,reviewedJobVisible:true,reviewedJobResultsHidden:true,staleResponseIgnored:true,capturedOtherJobDownloadable:true,audioHiddenAndBlobRevoked:true,sameOriginStorageEventHidesAudio:true,reviewSurvivesReloadWith:['pending','simulated','absent'],persistenceFailureWarnsAndBlocksCurrentSession:true,pendingRecoveryBlocks:true,recoveryFailureBlocks:true,pollFailureBlocks:true,explicitRetry:true,accessWithdrawalWithUnconfirmedCancellation:true,reviewReferenceSurvivesReload:true,cancellationMarkerPreserved:true,corruptReferenceDoesNotBlockWithdrawal:true,quoteRequestsAfterReview:requests.filter(r=>r.path==='/api/cloud/ai/quote').length-priorQuotes,jobPostsAfterReview:requests.filter(r=>r.path==='/api/cloud/ai/jobs'&&r.method==='POST').length-priorPosts,exceptions};
 await writeFile(join(root,'browser-result.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({root,...evidence}));
}catch(error){await writeFile(join(root,'browser-failure.json'),JSON.stringify({error:String(error),requests},null,2));throw error;
}finally{
 heldVoice?.();ws?.close();if(browser&&browser.exitCode===null){const exited=new Promise(resolve=>browser.once('exit',resolve));browser.kill();await Promise.race([exited,new Promise(resolve=>setTimeout(resolve,3000))]);}
 await new Promise(resolve=>server.close(resolve));const safeRoot=resolve(root)+sep,safeProfile=resolve(profile);if(!safeProfile.startsWith(safeRoot)||!safeProfile.slice(safeRoot.length).startsWith('chrome-'))throw Error('Unsafe profile cleanup');await rm(safeProfile,{recursive:true,force:true,maxRetries:3,retryDelay:200});
}
