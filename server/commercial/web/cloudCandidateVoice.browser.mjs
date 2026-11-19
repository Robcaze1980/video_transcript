// Local synthetic browser test. It never contacts Firebase, providers or a real account.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {build} from 'esbuild';

const root=resolve('outputs/lv019-b-translation-quote-'+randomUUID());await mkdir(root,{recursive:true});
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
const account='10000000-0000-4000-8000-000000000001',input='20000000-0000-4000-8000-000000000001',jobId='30000000-0000-4000-8000-000000000001';
const requests=[],postedBodies=[];let jobState='running',billingScenario='simulation',quoteVariant='valid';
const server=createServer(async(req,res)=>{
 const url=new URL(req.url??'/','http://127.0.0.1');requests.push({method:req.method,path:url.pathname,operation:url.searchParams.get('operation')});
 const reply=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(data));};
 if(url.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/candidate.css"><div id="cloud-candidate"></div><script type="module" src="/candidate.js"></script>');return;}
 if(url.pathname==='/candidate.js'||url.pathname==='/candidate.css'){res.writeHead(200,{'Content-Type':url.pathname.endsWith('.js')?'text/javascript':'text/css'}).end(await readFile(join(root,url.pathname.slice(1))));return;}
 if(url.pathname==='/brand/vistavo-symbol.svg'){res.writeHead(200,{'Content-Type':'image/svg+xml'}).end('<svg xmlns="http://www.w3.org/2000/svg"/>');return;}
 if(url.pathname==='/api/cloud/me')return reply(200,{id:account,balance:{available:10,reserved:0,...(billingScenario==='unknown'?{}:{unit:['account_seconds','conflict'].includes(billingScenario)?'video_seconds':'test-unit'})}});
 if(url.pathname==='/api/cloud/uploads/'+input)return reply(200,{id:input,name:'synthetic.mp4',state:'ready',offset:100,size:100,metadata:{duration:10,audioTracks:1}});
 if(url.pathname==='/api/cloud/projects/'+input)return reply(200,{revision:1,draft:'Synthetic English text.'});
 if(url.pathname==='/api/cloud/ai/quote'){
  if(quoteVariant==='null_response')return reply(200,null);
  const q={inputId:input,operation:url.searchParams.get('operation'),revision:1,units:billingScenario==='account_seconds'?10:1,billing:billingScenario==='account_seconds'?{mode:'account_seconds',unit:'video_seconds',priceUsd:0.02,rateUsdPerMinute:0.10}:{mode:'simulation',unit:'test-unit'}};
  if(quoteVariant==='missing_rate')delete q.billing.rateUsdPerMinute;
  if(quoteVariant==='rate_null')q.billing.rateUsdPerMinute=null;
  if(quoteVariant==='rate_string')q.billing.rateUsdPerMinute='0.10';
  if(quoteVariant==='rate_zero')q.billing.rateUsdPerMinute=0;
  if(quoteVariant==='rate_negative')q.billing.rateUsdPerMinute=-0.10;
  if(quoteVariant==='price_negative')q.billing.priceUsd=-0.02;
  if(quoteVariant==='price_zero')q.billing.priceUsd=0;
  if(quoteVariant==='price_string')q.billing.priceUsd='0.02';
  if(quoteVariant==='price_null')q.billing.priceUsd=null;
  if(quoteVariant==='units_zero')q.units=0;
  if(quoteVariant==='units_negative')q.units=-1;
  if(quoteVariant==='units_fraction')q.units=1.5;
  if(quoteVariant==='units_string')q.units='10';
  if(quoteVariant==='units_unsafe')q.units=Number.MAX_SAFE_INTEGER+1;
  if(quoteVariant==='wrong_input')q.inputId='20000000-0000-4000-8000-000000000002';
  if(quoteVariant==='wrong_operation')q.operation='narration:en:female';
  if(quoteVariant==='wrong_revision')q.revision=2;
  if(quoteVariant==='missing_billing')q.billing=null;
  return reply(200,q);
 }
 if(url.pathname==='/api/cloud/ai/jobs'&&req.method==='POST'){const parts=[];for await(const part of req)parts.push(part);postedBodies.push(JSON.parse(Buffer.concat(parts).toString('utf8')));return reply(202,{id:jobId});}
 if(url.pathname==='/api/cloud/ai/jobs/'+jobId){
  if(req.method==='DELETE')jobState='cancelled';
  return reply(200,{id:jobId,inputId:input,operation:'translation:en',state:jobState,revision:1,stale:false,units:1,results:[]});
 }
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
 const wait=async expression=>{for(let i=0;i<80;i++){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Timed out waiting for '+expression+'; '+await evaluate('document.body.innerText.slice(0,1800)'));};
 const yes="document.querySelector('input[name=cv-voice-choice][value=yes]')",no="document.querySelector('input[name=cv-voice-choice][value=no]')";
 const card="Array.from(document.querySelectorAll('.cv-card')).find(card=>card.querySelector('h2')?.textContent==='Texto y subtítulos')",quote=card+".querySelector('button.cv-secondary')",generate=card+".querySelectorAll('.cv-actions button')[1]";
 const relevant=()=>requests.filter(request=>request.path==='/api/cloud/ai/quote'||request.path.startsWith('/api/cloud/ai/jobs'));
 const posts=()=>requests.filter(request=>request.path==='/api/cloud/ai/jobs'&&request.method==='POST').length;
 await call('Page.enable');await call('Runtime.enable');await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await call('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem(${JSON.stringify('vistavo-candidate-v1:'+account+':input')},${JSON.stringify(input)});`});
 await call('Page.navigate',{url:origin+'/'});await wait("document.body.innerText.includes('Recuperamos el último archivo')");
 assert.equal(await evaluate(no+'.checked'),true);assert.equal(await evaluate(yes+'.checked'),false);
 assert.equal(await evaluate(yes+".matches(':disabled')"),true);await evaluate(yes+'.click()');assert.equal(await evaluate(yes+'.checked'),false);
 const copy=await evaluate("document.querySelector('.cv-voice-option').innerText");
 for(const text of ['US$0.10 por minuto de video','+ US$0.10 por minuto','US$0.20 por minuto','unidades ficticias','todavía no está disponible'])assert.ok(copy.includes(text),text);
 const widths=[];for(const width of [320,390]){await call('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});const metric=await evaluate(`({viewport:innerWidth,document:document.documentElement.scrollWidth,target:document.querySelector('label:has(input[value=yes])').getBoundingClientRect().height})`);assert.ok(metric.document<=metric.viewport,JSON.stringify(metric));assert.ok(metric.target>=44,JSON.stringify(metric));widths.push(metric);}
 assert.equal(relevant().length,0);assert.equal(await evaluate(quote+'.disabled'),false);assert.equal(await evaluate(generate+'.disabled'),true);
 await evaluate(quote+'.click()');await wait(card+".querySelector('.cv-quote')?.textContent.includes('unidades ficticias')");await wait('!'+generate+'.disabled');assert.equal(posts(),0);
 const quoteCount=()=>requests.filter(request=>request.path==='/api/cloud/ai/quote').length;assert.equal(quoteCount(),1);
 await evaluate(generate+'.click()');await wait(card+".innerText.includes('Procesando')");await wait(`Array.from(${card}.querySelectorAll('button')).some(button=>button.textContent==='Cancelar solicitud'&&!button.disabled)`);assert.equal(posts(),1);
 await evaluate(`Array.from(${card}.querySelectorAll('button')).find(button=>button.textContent==='Cancelar solicitud').click()`);await wait(card+".innerText.includes('Cancelado')");assert.equal(requests.filter(request=>request.path==='/api/cloud/ai/jobs/'+jobId&&request.method==='DELETE').length,1);
 await evaluate('window.testSignOut()');await wait("!document.body.innerText.includes('Tu espacio privado')");billingScenario='account_seconds';await evaluate('window.testSignIn()');
 await wait("document.querySelector('.cv-account')?.innerText.includes('segundos de video') && !document.body.innerText.includes('Buscando tu subida anterior')");
 assert.equal(await evaluate("document.querySelector('.cv-notice').innerText.includes('unidades ficticias')"),false);
 assert.equal(await evaluate("document.querySelector('.cv-account').innerText.includes('unidades ficticias')"),false);
 assert.equal(await evaluate("document.querySelector('.cv-voice-option').innerText.includes('unidades ficticias')"),false);
 assert.equal(await evaluate("document.querySelector('.cv-voice-option').innerText.includes('cotización del servidor confirma el importe')"),true);
 await evaluate(quote+'.click()');await wait(card+".querySelector('.cv-quote')?.textContent.includes('US$0.02')");assert.equal(posts(),1);
 quoteVariant='price_zero';await evaluate(quote+'.click()');await wait(card+".querySelector('.cv-quote')?.textContent.includes('US$0.00')");await wait('!'+generate+'.disabled');assert.equal(posts(),1);
 quoteVariant='valid';await evaluate(quote+'.click()');await wait(card+".querySelector('.cv-quote')?.textContent.includes('US$0.02')");await wait('!'+generate+'.disabled');
 const malformed=['missing_rate','rate_null','rate_string','rate_zero','rate_negative','price_negative','price_string','price_null','units_zero','units_negative','units_fraction','units_string','units_unsafe','wrong_input','wrong_operation','wrong_revision','missing_billing','null_response'];
 for(const variant of malformed){
  quoteVariant=variant;await evaluate(quote+'.click()');await wait("document.querySelector('[role=alert]')?.textContent.includes('No pudimos verificar la cotización')");await wait('!'+quote+'.disabled');
  assert.equal(await evaluate("!!document.querySelector('.cv-shell')"),true,variant);assert.equal(await evaluate(card+".querySelector('.cv-quote')===null"),true,variant);
  assert.equal(await evaluate(generate+'.disabled'),true,variant);await evaluate(generate+'.click()');assert.equal(posts(),1,variant);
  quoteVariant='valid';await evaluate(quote+'.click()');await wait(card+".querySelector('.cv-quote')?.textContent.includes('US$0.02')");await wait('!'+generate+'.disabled');
 }
 await evaluate('window.testSignOut()');await wait("!document.body.innerText.includes('Tu espacio privado')");billingScenario='unknown';await evaluate('window.testSignIn()');await wait("document.body.innerText.includes('Recuperamos el último archivo')");
 assert.equal(await evaluate("document.querySelector('.cv-notice').innerText.includes('tipo de saldo se mostrará')"),true);
 assert.equal(await evaluate("document.querySelector('.cv-account').innerText.includes('unidades ficticias')"),false);
 assert.equal(await evaluate("document.querySelector('.cv-voice-option').innerText.includes('unidades ficticias')"),false);
 await evaluate(quote+'.click()');await wait(card+".querySelector('.cv-quote')?.textContent.includes('unidades ficticias')");assert.equal(await evaluate("document.querySelector('.cv-voice-option').innerText.includes('unidades ficticias')"),true);assert.equal(posts(),1);
 await evaluate('window.testSignOut()');await wait("!document.body.innerText.includes('Tu espacio privado')");billingScenario='conflict';await evaluate('window.testSignIn()');
 await wait("document.querySelector('.cv-account')?.innerText.includes('segundos de video') && !document.body.innerText.includes('Buscando tu subida anterior')");
 await evaluate(quote+'.click()');await wait("document.body.innerText.includes('La cotización y el saldo no usan la misma unidad')");assert.equal(await evaluate(generate+'.disabled'),true);await evaluate(generate+'.click()');assert.equal(posts(),1);
 billingScenario='account_seconds';await evaluate(quote+'.click()');await wait("!document.body.innerText.includes('La cotización y el saldo no usan la misma unidad')");await wait('!'+generate+'.disabled');assert.equal(posts(),1);
 await evaluate('window.testSignOut()');await wait("!document.body.innerText.includes('Tu espacio privado')");
 const recoveryKey='40000000-0000-4000-8000-000000000001',prefix='vistavo-candidate-v1:'+account+':';
 await evaluate(`localStorage.setItem(${JSON.stringify(prefix+'pending:'+input+':translation:en')},'1');localStorage.setItem(${JSON.stringify(prefix+'request:'+input+':translation:en:1')},${JSON.stringify(recoveryKey)});`);
 await evaluate('window.testSignIn()');await wait("document.body.innerText.includes('Recuperamos el último archivo')");await wait(generate+".textContent==='Comprobar misma solicitud' && !"+generate+'.disabled');
 const beforeRecoveryQuotes=quoteCount();await evaluate(generate+'.click()');await wait(`localStorage.getItem(${JSON.stringify(prefix+'pending:'+input+':translation:en')})===null`);
 assert.equal(posts(),2);assert.equal(quoteCount(),beforeRecoveryQuotes);assert.equal(postedBodies.at(-1).requestKey,recoveryKey);assert.equal(postedBodies.at(-1).expectedRevision,1);
 assert.deepEqual(exceptions,[]);
 const evidence={result:'PASS',environment:'local Chrome at emulated 320/390 px widths; synthetic account and API',voiceUnavailable:true,billingScenarios:['explicit fictitious units','video seconds with server quote','unknown balance until simulated quote','conflicting units block generation until refreshed'],zeroDollarServerQuoteAccepted:true,malformedQuotesRejected:malformed,malformedRequotesClearEarlierQuote:true,syntheticTranslationPostCount:posts(),noVoicePosts:postedBodies.every(body=>body.operation==='translation:en'),ambiguousRecoveryUsesOriginalKeyAndRevision:true,syntheticTranslationCancellable:true,widths,exceptions};
 await writeFile(join(root,'browser-result.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}finally{
 ws?.close();if(browser&&browser.exitCode===null){const exited=new Promise(resolve=>browser.once('exit',resolve));browser.kill();await Promise.race([exited,new Promise(resolve=>setTimeout(resolve,3000))]);}
 await new Promise(resolve=>server.close(resolve));const safeRoot=resolve(root)+sep,safeProfile=resolve(profile);if(!safeProfile.startsWith(safeRoot)||!safeProfile.slice(safeRoot.length).startsWith('chrome-'))throw Error('Unsafe profile cleanup');await rm(safeProfile,{recursive:true,force:true,maxRetries:3,retryDelay:200});
}
