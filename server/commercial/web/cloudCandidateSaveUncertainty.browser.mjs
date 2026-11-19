// Synthetic browser control: a save response is lost after a simulated storage
// event from another tab. This is not a real two-tab or real backend test.
// Uses hash-checked local frontend sources, a mock HTTP server and no real accounts.
// Browser interception/proxy/host rules are NOT an OS firewall.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer as createHttpServer} from 'node:http';
import {createServer as createTcpServer} from 'node:net';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {realpathSync,statfsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

assert.equal(process.env.NODE_ENV,'test');
for(const key of ['HOME','CODEX_HOME','NODE_OPTIONS','GOOGLE_APPLICATION_CREDENTIALS','OPENROUTER_API_KEY','GEMINI_API_KEY'])assert.equal(process.env[key],undefined);
const workspace=realpathSync(process.cwd()),sourceRoot=join(workspace,'server/commercial/web');
const freeBytes=()=>{const value=statfsSync(workspace,{bigint:true});return value.bavail*value.bsize;};
if(freeBytes()<1000000000n)throw Error('Synthetic browser requires at least 1 GB free');
const names=['cloudCandidate.tsx','cloudCandidateApi.ts','reviewedTranslationEditor.tsx','reviewedTranslationClient.ts','cloudCandidate.css'];
const frozen=Object.fromEntries(await Promise.all(names.map(async name=>[name,createHash('sha256').update(await readFile(join(sourceRoot,name))).digest('hex')])));
async function verifyFrozen(){for(const [name,expected] of Object.entries(frozen)){const actual=createHash('sha256').update(await readFile(join(sourceRoot,name))).digest('hex');assert.equal(actual,expected,`changed frozen source: ${name}`);}}
await verifyFrozen();
const root=await mkdtemp(resolve(workspace,'outputs/lv019-b-save-uncertainty-'));
assert.equal(realpathSync(root).toLowerCase(),root.toLowerCase());
await writeFile(join(root,'.synthetic-owner'),'remote-withdrawal-v1',{flag:'wx'});
const {cdpPipe,captureChromeStderr}=await import(pathToFileURL(join(workspace,'server/commercial/web/reviewBrowserCdp.mjs')).href);
const {readPinnedBrowserIdentity,assertHeadlessBrowserProduct}=await import(pathToFileURL(join(workspace,'server/commercial/web/reviewBrowserBinaryIdentity.mjs')).href);
const assets=join(root,'assets'),browserProfile=join(root,'browser-profile');await mkdir(assets);await mkdir(browserProfile);
const authPlugin={name:'synthetic-auth-only',setup(builder){
 builder.onResolve({filter:/^\.\/cloudCandidateAuth$/},()=>({path:'auth',namespace:'synthetic'}));
 builder.onResolve({filter:/^\.\/reviewedTranslationFeature$/},()=>({path:'feature',namespace:'synthetic'}));
 builder.onLoad({filter:/.*/,namespace:'synthetic'},({path})=>path==='feature'?{loader:'js',contents:'export const REVIEWED_TRANSLATION_CANDIDATE=true;'}:
  {loader:'js',contents:`const owner={uid:'synthetic-owner',email:'owner@example.invalid',emailVerified:true};let observer;export async function candidateAuth(){return {observe(fn){observer=fn;queueMicrotask(()=>fn(owner));return ()=>{observer=undefined}},token:async()=> 'synthetic-only',logout:async()=>observer?.(null)}}`});
}};
await build({absWorkingDir:workspace,entryPoints:[join(sourceRoot,'cloudCandidate.tsx')],bundle:true,format:'esm',platform:'browser',outdir:assets,entryNames:'candidate',plugins:[authPlugin],logLevel:'silent'});
await verifyFrozen();
const account='10000000-0000-4000-8000-000000000001',input='20000000-0000-4000-8000-000000000001',job='30000000-0000-4000-8000-000000000001';
const original='Synthetic original.',edit='Synthetic unsaved draft.';
const source={projectRevision:3,jobRevision:3,durationMs:1500,status:'original',cues:[{id:'a'.repeat(64),index:0,startMs:0,endMs:1500,es:'Texto sintético.',en:original}]};
let remotelyWithdrawn=false,inputReads=0,jobReads=0,reviewReads=0,saves=0,commits=0,firstKey='',firstBody='',sameKey=false,sameBody=true,heldSave,pauseJobs=false,forceConflict=false,conflicts=0,unexpected=0,proxyAttempts=0,browser,cdp,exited=false,blocked=0,failure=null,phase='listen',diskLow=false;const heldJobs=[];
const ackMode='lost';
const findings={syntheticOnly:true,realCloud:false,physicalPhone:false,result:'INCONCLUSIVE'};
const server=createHttpServer(async(req,res)=>{
 const path=new URL(req.url??'/','http://127.0.0.1').pathname;
 const reply=(status,data)=>res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}).end(JSON.stringify(data));
 if(path==='/')return res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}).end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/candidate.css"><div id="cloud-candidate"></div><script type="module" src="/candidate.js"></script>');
 if(path==='/candidate.js'||path==='/candidate.css')return res.writeHead(200,{'Content-Type':path.endsWith('.js')?'text/javascript':'text/css','Cache-Control':'no-store'}).end(await readFile(join(assets,path.slice(1))));
 if(path==='/brand/vistavo-symbol.svg')return res.writeHead(200,{'Content-Type':'image/svg+xml'}).end('<svg xmlns="http://www.w3.org/2000/svg"/>');
 if(path==='/favicon.ico')return res.writeHead(404).end();
 if(req.headers.authorization!=='Bearer synthetic-only'){unexpected++;return reply(403,{error:'synthetic_denied'});}
 if(path==='/api/cloud/me')return reply(200,{id:account,balance:{available:60,reserved:0,unit:'video_seconds'}});
 if(path===`/api/cloud/uploads/${input}`&&req.method==='GET'){inputReads++;return reply(200,{id:input,name:'synthetic.mp4',state:remotelyWithdrawn?'deleting':'ready',offset:10,size:10,metadata:{duration:1.5,audioTracks:1}});}
 if(path===`/api/cloud/projects/${input}`&&req.method==='GET')return reply(200,{revision:3,draft:''});
 if(path===`/api/cloud/ai/jobs/${job}`&&req.method==='GET'){jobReads++;const value={id:job,inputId:input,operation:'translation:en',state:'succeeded',billingState:'settled',billing:{mode:'account_seconds',unit:'video_seconds'},revision:3,stale:false,units:2,results:remotelyWithdrawn?[]:[{name:'translation-en.txt',mimeType:'text/plain; charset=utf-8',size:19,sha256:'a'.repeat(64)}]};if(pauseJobs){heldJobs.push(()=>{if(!res.destroyed)reply(200,value);});return;}return reply(200,value);}
 if(path===`/api/cloud/ai/jobs/${job}/review`&&req.method==='PUT'){
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(forceConflict){conflicts++;return reply(409,{error:'synthetic_conflict'});}saves++;
  if(saves===1){commits++;firstKey=body.requestKey;firstBody=JSON.stringify(body);source.status='reviewed';source.projectRevision=4;source.cues[0].en=body.edits[0].en;heldSave=()=>{if(ackMode==='lost')req.socket.destroy();else reply(200,{committedRevision:4});};return;}
  sameKey=body.requestKey===firstKey;sameBody&&=JSON.stringify(body)===firstBody;if(!sameKey||!sameBody)return reply(409,{error:'synthetic_changed_request'});return reply(200,{committedRevision:4});
 }
 if(path===`/api/cloud/ai/jobs/${job}/review`&&req.method==='GET'){reviewReads++;return remotelyWithdrawn?reply(404,{error:'synthetic_withdrawn'}):reply(200,source);}
 unexpected++;return reply(404,{error:'unexpected_synthetic_request'});
});
const proxy=createTcpServer(socket=>{proxyAttempts++;socket.destroy();});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const diskMonitor=setInterval(()=>{try{if(freeBytes()>=1000000000n)return;}catch{}diskLow=true;if(browser&&!exited)browser.kill();},1000);
try{
 if(diskLow||freeBytes()<1000000000n){diskLow=true;throw Error('Synthetic browser requires at least 1 GB free');}
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 await new Promise((resolve,reject)=>{proxy.once('error',reject);proxy.listen(0,'127.0.0.1',resolve);});
 const address=server.address(),proxyAddress=proxy.address();assert.equal(address.address,'127.0.0.1');assert.equal(proxyAddress.address,'127.0.0.1');
 const origin=`http://127.0.0.1:${address.port}`;
 phase='browser_spawn';browser=spawn(readPinnedBrowserIdentity().path,['--headless=new','--no-first-run','--disable-background-networking','--disable-sync','--disable-extensions','--disable-quic','--disable-component-update','--disable-domain-reliability','--force-webrtc-ip-handling-policy=disable_non_proxied_udp','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',`--proxy-server=http://127.0.0.1:${proxyAddress.port}`,'--proxy-bypass-list=127.0.0.1','--remote-debugging-pipe',`--user-data-dir=${browserProfile}`,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe','pipe','pipe']});
 browser.once('exit',()=>{exited=true;});browser.once('error',()=>{exited=true;});const stderr=captureChromeStderr(browser.stderr);cdp=cdpPipe(browser,{timeoutMs:55000});
 assertHeadlessBrowserProduct(await cdp.send('Browser.getVersion'));const target=await cdp.send('Target.createTarget',{url:'about:blank'});const sessionId=(await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;
 cdp.on(event=>{if(event.sessionId!==sessionId||event.method!=='Fetch.requestPaused')return;let allowed=false;try{const url=new URL(event.params.request.url);allowed=url.origin===origin&&!url.username&&!url.password;}catch{}if(!allowed)blocked++;void cdp.send(allowed?'Fetch.continueRequest':'Fetch.failRequest',allowed?{requestId:event.params.requestId}:{requestId:event.params.requestId,errorReason:'BlockedByClient'},sessionId).catch(()=>{blocked++;});});
 await cdp.send('Page.enable',{},sessionId);await cdp.send('Runtime.enable',{},sessionId);await cdp.send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]},sessionId);
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:320,height:844,deviceScaleFactor:1,mobile:true},sessionId);
 const prefix=`vistavo-candidate-v1:${account}:`;
 await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem(${JSON.stringify(prefix+'input')},${JSON.stringify(input)});localStorage.setItem(${JSON.stringify(prefix+'job:'+input+':translation:en')},${JSON.stringify(job)});
  const savedFetch=window.fetch;window.syntheticSaveSettled=0;window.fetch=async(...args)=>{try{const response=await savedFetch(...args);if(args[1]?.method==='PUT')window.syntheticSaveSettled++;return response;}catch(error){if(args[1]?.method==='PUT')window.syntheticSaveSettled++;throw error;}};`},sessionId);
 const evaluate=async expression=>{const result=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);if(result.exceptionDetails)throw Error('Synthetic browser expression failed');return result.result.value;};
 const wait=async(predicate,label)=>{const end=Date.now()+20000;while(Date.now()<end){if(await predicate())return;await sleep(100);}throw Error(`Synthetic timeout: ${label}`);};
 phase='initial_recovery';await cdp.send('Page.navigate',{url:origin+'/'},sessionId);
 await wait(()=>evaluate("document.body?.innerText.includes('Recuperamos el último archivo')===true"),'initial recovery');
 await wait(()=>evaluate("Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Cargar frases')"),'load button');
 await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Cargar frases').click()");
 await wait(()=>evaluate("document.querySelector('#cv-cue-0')!==null"),'loaded cue');
 await evaluate(`(()=>{const e=document.querySelector('#cv-cue-0');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(edit)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 findings.initialDraftVisible=await evaluate(`document.querySelector('#cv-cue-0')?.value===${JSON.stringify(edit)}`);assert.equal(findings.initialDraftVisible,true);
 pauseJobs=true;phase='save_in_flight';await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Guardar revisión').click()");
 await wait(()=>!!heldSave,'synthetic save committed and response held');
 const markKey=prefix+'review-mark:'+job,markValue=JSON.stringify({inputId:input,version:'40000000-0000-4000-8000-000000000001'});
 await evaluate(`localStorage.setItem(${JSON.stringify(markKey)},${JSON.stringify(markValue)});window.dispatchEvent(new StorageEvent('storage',{key:${JSON.stringify(markKey)},newValue:${JSON.stringify(markValue)},storageArea:localStorage,url:location.href}));`);
 await wait(()=>evaluate("document.querySelector('#cv-cue-0')===null"),'review hides draft');heldSave();
 await wait(()=>evaluate('window.syntheticSaveSettled>=1'),'save response settled');await sleep(300);pauseJobs=false;for(const release of heldJobs.splice(0))release();await sleep(100);
 await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Consultar estado').click()");
 await wait(()=>evaluate("document.querySelector('#cv-cue-0')!==null"),'review cleared');await sleep(200);
 findings.ackMode=ackMode;findings.draftPreserved=await evaluate(`document.querySelector('#cv-cue-0')?.value===${JSON.stringify(edit)}`);
 findings.sameAttemptRetry=await evaluate("Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Comprobar mismo guardado'&&!b.disabled)");
 findings.reopenedRevision=await evaluate("document.body.innerText.includes('Revisión 4')");
 findings.draftInStorage=await evaluate(`Object.values(localStorage).some(v=>String(v).includes(${JSON.stringify(edit)}))`);
 if(findings.sameAttemptRetry){await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Comprobar mismo guardado').click()");await wait(()=>evaluate("document.body.innerText.includes('Revisión guardada y reabierta')"),'same attempt recovered');findings.sameAttemptConfirmedAndReopened=await evaluate("document.body.innerText.includes('Revisión 4')");assert.equal(findings.sameAttemptConfirmedAndReopened,true);}
 findings.syntheticSaves=saves;findings.syntheticCommits=commits;findings.sameKeyOnRetry=sameKey;findings.sameBodyOnRetry=sameBody;
 findings.browserDiagnostics=stderr.snapshot();
 assert.equal(findings.draftInStorage,false,'do not persist draft text locally');assert.equal(findings.draftPreserved,true,'keep the synthetic edit during review');
 assert.ok(findings.sameAttemptRetry||findings.reopenedRevision,'keep the same attempt or verify its committed revision');
 assert.equal(commits,1,'the synthetic server applies at most one commit');if(findings.sameAttemptRetry){assert.ok(saves>=2);assert.equal(sameKey,true);assert.equal(sameBody,true);}
 phase='real_conflict';forceConflict=true;const nextEdit='Synthetic second edit.';
 await evaluate(`(()=>{const e=document.querySelector('#cv-cue-0');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(nextEdit)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Guardar revisión').click()");
 await wait(()=>evaluate("document.body.innerText.includes('Otra acción cambió el proyecto')"),'server conflict');
 findings.serverConflictPreservesEdit=await evaluate(`document.querySelector('#cv-cue-0')?.value===${JSON.stringify(nextEdit)}`);
 findings.serverConflictNotPending=await evaluate("!Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Comprobar mismo guardado')");
 assert.equal(findings.serverConflictPreservesEdit,true);assert.equal(findings.serverConflictNotPending,true);assert.equal(conflicts,1);assert.equal(commits,1);
 findings.result='PASS';
}catch(error){
 failure=error?.code==='ERR_ASSERTION'?'assertion_failed':'synthetic_fixture_inconclusive';findings.failurePhase=phase;findings.errorType=error?.name??'unknown';
 if(failure==='assertion_failed')findings.result='FAIL';process.exitCode=1;
}finally{
 clearInterval(diskMonitor);
 if(browser&&!exited){browser.kill();const end=Date.now()+10000;while(!exited&&Date.now()<end)await sleep(50);}
 if(server.listening){server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}if(proxy.listening)await new Promise(resolve=>proxy.close(resolve));
 try{await verifyFrozen();findings.frozenSourcesUnchanged=true;}catch{findings.frozenSourcesUnchanged=false;findings.result='INCONCLUSIVE';process.exitCode=1;}
 if(diskLow){findings.result='INCONCLUSIVE';process.exitCode=1;}
 Object.assign(findings,{browserExited:!browser||exited,unexpectedRequests:unexpected,blockedBrowserRequests:blocked,proxyAttempts,failure,diskLow,sourceHashes:frozen,networkLimitation:'Loopback proxy and browser interception are not an operating-system firewall.'});
 await writeFile(join(root,'result.json'),JSON.stringify(findings,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({root,...findings}));
 if(!findings.browserExited||unexpected||blocked||proxyAttempts)process.exitCode=1;
}
