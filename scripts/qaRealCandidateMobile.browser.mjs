// Local browser check of the actual Vite candidate bundle. The remote Firebase
// responses and all application data are synthetic; no Firebase project is used.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { existsSync } from 'node:fs';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cdpPipe, captureChromeStderr } from '../server/commercial/web/reviewBrowserCdp.mjs';
import { assertHeadlessBrowserProduct, readPinnedBrowserIdentity } from '../server/commercial/web/reviewBrowserBinaryIdentity.mjs';

const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
assert.equal((await realpath(process.cwd())).toLowerCase(), root.toLowerCase());
assert.equal(process.platform, 'win32');
assert.equal(process.version, 'v24.13.0');
const allowedEnv = new Set(['systemroot','windir','path','userprofile','appdata','localappdata','temp','tmp',
  'homedrive','homepath','systemdrive','username','userdomain','logonserver','lv_real_candidate_task']);
assert.deepEqual(Object.keys(process.env).filter(key=>!allowedEnv.has(key.toLowerCase())),[],
  'Launch from an explicitly clean environment before Node starts');
const task = resolve(process.env.LV_REAL_CANDIDATE_TASK ?? '');
const outputRoot = resolve(root, 'outputs');
assert.equal(dirname(task).toLowerCase(), outputRoot.toLowerCase());
assert.match(task.slice(outputRoot.length + 1), /^browser-real-build-[a-f0-9-]{36}$/);
assert.equal((await realpath(task)).toLowerCase(), task.toLowerCase());
const bundle = await realpath(join(task, 'bundle'));
assert.equal(bundle.toLowerCase(), join(task, 'bundle').toLowerCase());
const manifestBytes = await readFile(join(bundle, '.vite/manifest.json'));
const manifest = JSON.parse(manifestBytes);
const candidate = manifest['server/commercial/web/cloudCandidate.tsx'];
assert.equal(candidate?.file, 'cloudCandidate.js');
assert.ok(candidate.css?.length);
assert.equal(process.env.USERPROFILE, join(task, 'profile'));
assert.equal(process.env.APPDATA, join(task, 'profile'));
assert.equal(process.env.LOCALAPPDATA, join(task, 'profile'));
assert.equal(process.env.TEMP, join(task, 'temp'));
assert.equal(process.env.TMP, join(task, 'temp'));
assert.equal(process.env.HOMEDRIVE, process.env.USERPROFILE.slice(0,2));
assert.equal(process.env.HOMEPATH, process.env.USERPROFILE.slice(2));
assert.equal(process.env.USERNAME,'synthetic-review');
assert.equal(process.env.USERDOMAIN,'SYNTHETIC');
assert.equal(process.env.LOGONSERVER,'SYNTHETIC');
for(const name of ['profile','temp']){
  const folder=join(task,name);
  assert.equal((await lstat(folder)).isSymbolicLink(),false);
  assert.equal((await realpath(folder)).toLowerCase(),folder.toLowerCase());
}
assert.equal(existsSync(join(task,'profile','gcloud','application_default_credentials.json')),false);
const sha = value => createHash('sha256').update(value).digest('hex');
async function bundleSnapshot(folder=bundle,prefix='') {
  const entries=[];
  for(const item of await readdir(folder,{withFileTypes:true})){
    const file=join(folder,item.name),name=prefix+item.name;
    assert.equal(item.isSymbolicLink(),false);
    if(item.isDirectory())entries.push(...await bundleSnapshot(file,name+'/'));
    else {assert.ok(item.isFile());entries.push([name,sha(await readFile(file))]);}
  }
  return entries.sort((a,b)=>a[0].localeCompare(b[0]));
}
const beforeBundle=await bundleSnapshot(),beforeBundleSha=sha(JSON.stringify(beforeBundle));
const run = join(task, `browser-${randomUUID()}`);
await mkdir(run);
const chromeProfile = join(run, 'chrome');
const downloads = join(run, 'downloads');
await mkdir(chromeProfile);
await mkdir(downloads);

const account = '10000000-0000-4000-8000-000000000001';
const input = '20000000-0000-4000-8000-000000000001';
const job = '30000000-0000-4000-8000-000000000001';
const uid = 'synthetic-user';
const email = 'synthetic@example.invalid';
const apiKey = 'synthetic-key-with-no-external-access';
const now = Math.floor(Date.now() / 1000);
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const idToken = `${b64({alg:'none',typ:'JWT'})}.${b64({iss:'https://securetoken.google.com/vistavo-prod',aud:'vistavo-prod',auth_time:now,iat:now,exp:now+3600,sub:uid,user_id:uid,email,email_verified:true,firebase:{sign_in_provider:'password'}})}.synthetic`;
const cues = [
  {id:'a'.repeat(64),index:0,startMs:0,endMs:1200,es:'La bomba mide 5 cm.',en:'The pump measures 5 cm.'},
  {id:'b'.repeat(64),index:1,startMs:1500,endMs:3500,es:'Sin fugas.',en:'No leaks.'},
];
let review = {projectRevision:3,jobRevision:3,durationMs:3500,status:'original',cues};
const requests = [], authRequests = [], blocked = [], exceptions = [];
const staticTypes = {'.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
  '.wasm':'application/wasm','.svg':'image/svg+xml'};
const original = Buffer.from('The pump measures 5 cm.\nNo leaks.\n');
const result = {name:'translation-en.txt',mimeType:'text/plain; charset=utf-8',size:original.length,sha256:sha(original)};
let server, proxy, browser, cdp, sessionId, origin, cleanup = {server:false,proxy:false,chrome:false};
let testResult, testError;
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
const localHost = req => req.socket.remoteAddress === '127.0.0.1' || req.socket.remoteAddress === '::ffff:127.0.0.1';

try {
  server = createServer(async (req,res) => {
    const reply = (status,data) => res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}).end(JSON.stringify(data));
    try {
      const address = server.address();
      if (!localHost(req) || !address || typeof address === 'string' || req.headers.host !== `127.0.0.1:${address.port}`) return reply(403,{error:'denied'});
      const url = new URL(req.url ?? '/',origin); const path = url.pathname;
      if (url.origin !== origin) return reply(400,{error:'denied'});
      if (path === '/' && req.method === 'GET') {
        let html = await readFile(join(root,'server/commercial/web/cloudCandidate.html'),'utf8');
        html = html.replace('<link rel="stylesheet" href="/candidate-assets/cloudCandidate.css">',candidate.css.map(p=>`<link rel="stylesheet" href="/candidate-assets/${p}">`).join(''));
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
          'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src blob:; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com; frame-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});
        return res.end(html);
      }
      if (path === '/brand/vistavo-symbol.svg') return res.writeHead(200,{'Content-Type':'image/svg+xml'}).end('<svg xmlns="http://www.w3.org/2000/svg"/>');
      if (path === '/favicon.ico') return res.writeHead(404).end();
      if (path.startsWith('/candidate-assets/') && req.method === 'GET') {
        const relative = path.slice('/candidate-assets/'.length);
        if (!/^[A-Za-z0-9_./-]+$/.test(relative) || relative.split('/').some(p=>!p || p.startsWith('.')) || !staticTypes[extname(relative)]) return reply(404,{error:'missing'});
        const file = await realpath(resolve(bundle,relative));
        if (!file.toLowerCase().startsWith(bundle.toLowerCase()+sep)) return reply(404,{error:'missing'});
        const bytes = await readFile(file);
        return res.writeHead(200,{'Content-Type':staticTypes[extname(file)],'Cache-Control':'no-store'}).end(bytes);
      }
      if (path === '/api/cloud/config' && req.method === 'GET') return reply(200,{web:{projectId:'vistavo-prod',authDomain:'vistavo-prod.firebaseapp.com',apiKey,appId:'synthetic-app'},environment:'synthetic',limits:{maxBytes:500000000,maxSeconds:30,chunkBytes:8388608},queueIntervalSeconds:300});
      requests.push({method:req.method,path});
      if (req.headers.authorization !== `Bearer ${idToken}` || req.headers.cookie !== undefined) return reply(401,{error:'not_found'});
      if (path === '/api/cloud/me' && req.method === 'GET') return reply(200,{id:account,balance:{available:60,reserved:0,unit:'video_seconds'}});
      if (path === `/api/cloud/uploads/${input}` && req.method === 'GET') return reply(200,{id:input,name:'synthetic.mp4',state:'ready',offset:10,size:10,metadata:{duration:3.5,audioTracks:1}});
      if (path === `/api/cloud/projects/${input}` && req.method === 'GET') return reply(200,{revision:review.projectRevision,draft:review.status==='reviewed'?review.cues.map(c=>c.en).join('\n')+'\n':''});
      if (path === `/api/cloud/ai/jobs/${job}` && req.method === 'GET') return reply(200,{id:job,inputId:input,operation:'translation:en',state:'succeeded',billingState:'settled',revision:3,stale:false,units:4,results:[result]});
      if (path === `/api/cloud/ai/jobs/${job}/results/translation-en.txt` && req.method === 'GET') return res.writeHead(200,{'Content-Type':result.mimeType,'Cache-Control':'no-store'}).end(original);
      if (path === `/api/cloud/ai/jobs/${job}/review` && req.method === 'GET') return reply(200,review);
      if (path === `/api/cloud/ai/jobs/${job}/review` && req.method === 'PUT') {
        let text=''; for await (const chunk of req) { text += chunk; if (text.length > 8192) return reply(413,{error:'too_large'}); }
        const body=JSON.parse(text);
        assert.equal(body.inputId,input); assert.equal(body.expectedRevision,3); assert.equal(body.edits.length,2);
        review={...review,projectRevision:4,status:'reviewed',cues:review.cues.map((cue,index)=>({...cue,en:body.edits[index].en}))};
        return reply(200,{committedRevision:4});
      }
      if (path === `/api/cloud/ai/jobs/${job}/review/download` && req.method === 'GET') {
        assert.equal(url.searchParams.get('revision'),'4');
        const format=url.searchParams.get('format');
        if (!['txt','srt'].includes(format)) return reply(400,{error:'invalid'});
        const body=format==='txt'?review.cues.map(c=>c.en).join('\n')+'\n':`1\n00:00:00,000 --> 00:00:01,200\n${review.cues[0].en}\n\n2\n00:00:01,500 --> 00:00:03,500\n${review.cues[1].en}\n`;
        return res.writeHead(200,{'Content-Type':format==='txt'?'text/plain; charset=utf-8':'application/x-subrip; charset=utf-8','Cache-Control':'no-store','X-Vistavo-Revision':'4'}).end(body);
      }
      return reply(404,{error:'synthetic_not_found'});
    } catch { if (!res.headersSent) reply(500,{error:'synthetic_failure'}); else res.destroy(); }
  });
  await new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok);});
  const address=server.address(); assert.ok(address && typeof address!=='string' && address.address==='127.0.0.1');
  origin=`http://127.0.0.1:${address.port}`;
  proxy=createTcpServer(socket=>socket.destroy());
  await new Promise((ok,fail)=>{proxy.once('error',fail);proxy.listen(0,'127.0.0.1',ok);});
  const proxyAddress=proxy.address(); assert.ok(proxyAddress && typeof proxyAddress!=='string' && proxyAddress.address==='127.0.0.1');
  const chrome=readPinnedBrowserIdentity().path;
  browser=spawn(chrome,['--headless=new','--no-first-run','--disable-background-networking','--disable-sync','--disable-extensions','--disable-quic','--disable-component-update','--disable-domain-reliability',
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',`--proxy-server=http://127.0.0.1:${proxyAddress.port}`,'--proxy-bypass-list=127.0.0.1',
    '--remote-debugging-pipe',`--user-data-dir=${chromeProfile}`,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe','pipe','pipe'],env:process.env});
  const chromeLog=captureChromeStderr(browser.stderr);
  cdp=cdpPipe(browser);
  assert.ok(browser.pid>0);
  await writeFile(join(run,'chrome-owned.json'),JSON.stringify({pid:browser.pid,profile:chromeProfile},null,2));
  assertHeadlessBrowserProduct(await cdp.send('Browser.getVersion'));
  await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads,eventsEnabled:true});
  const target=await cdp.send('Target.createTarget',{url:'about:blank'});
  sessionId=(await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;
  const inflight=new Set(), downloaded=new Map(), finished=new Set();
  cdp.on(event=>{
    if(event.method==='Browser.downloadWillBegin')downloaded.set(event.params.guid,event.params.suggestedFilename);
    if(event.method==='Browser.downloadProgress'&&event.params.state==='completed')finished.add(event.params.guid);
    if(event.sessionId===sessionId&&event.method==='Runtime.exceptionThrown')exceptions.push('runtime_exception');
    if(event.sessionId!==sessionId||event.method!=='Fetch.requestPaused')return;
    const req=event.params.request,id=event.params.requestId; let action;
    try {
      const u=new URL(req.url);
      if(u.origin===origin && !u.username && !u.password)action=cdp.send('Fetch.continueRequest',{requestId:id},sessionId);
      else if(u.origin==='https://identitytoolkit.googleapis.com' && u.searchParams.get('key')===apiKey && ['/v1/accounts:signInWithPassword','/v1/accounts:lookup'].includes(u.pathname) && ['POST','OPTIONS'].includes(req.method)) {
        authRequests.push({method:req.method,path:u.pathname});
        let body={};
        if(req.method==='POST'&&u.pathname.endsWith(':signInWithPassword'))body={kind:'identitytoolkit#VerifyPasswordResponse',localId:uid,email,idToken,refreshToken:'synthetic-refresh-token',expiresIn:'3600',registered:true};
        if(req.method==='POST'&&u.pathname.endsWith(':lookup'))body={kind:'identitytoolkit#GetAccountInfoResponse',users:[{localId:uid,email,emailVerified:true,providerUserInfo:[],lastLoginAt:String(now*1000),createdAt:String(now*1000)}]};
        action=cdp.send('Fetch.fulfillRequest',{requestId:id,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:origin},{name:'Access-Control-Allow-Methods',value:'POST, OPTIONS'},{name:'Access-Control-Allow-Headers',value:'*'},{name:'Cache-Control',value:'no-store'}],body:Buffer.from(JSON.stringify(body)).toString('base64')},sessionId);
      } else {blocked.push({host:u.hostname,path:u.pathname});action=cdp.send('Fetch.failRequest',{requestId:id,errorReason:'BlockedByClient'},sessionId);}
    } catch {blocked.push({host:'invalid',path:'invalid'});action=cdp.send('Fetch.failRequest',{requestId:id,errorReason:'BlockedByClient'},sessionId);}
    inflight.add(action);action.catch(()=>blocked.push({host:'interceptor',path:'error'})).finally(()=>inflight.delete(action));
  });
  await cdp.send('Page.enable',{},sessionId);await cdp.send('Runtime.enable',{},sessionId);await cdp.send('Network.enable',{},sessionId);
  await cdp.send('Network.setCacheDisabled',{cacheDisabled:true},sessionId);await cdp.send('Network.setBypassServiceWorker',{bypass:true},sessionId);
  await cdp.send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]},sessionId);
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true},sessionId);
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true},sessionId);
  const prefix=`vistavo-candidate-v1:${account}:`;
  await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem(${JSON.stringify(prefix+'input')},${JSON.stringify(input)});localStorage.setItem(${JSON.stringify(prefix+'job:'+input+':translation:en')},${JSON.stringify(job)});window.confirm=()=>true;`},sessionId);
  const evaluate=async expression=>{const value=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);if(value.exceptionDetails)throw Error('Synthetic browser evaluation failed');return value.result.value;};
  const wait=async (expression,label)=>{for(let i=0;i<200;i++){if(await evaluate(expression))return;await sleep(100);}throw Error(`Synthetic browser timed out: ${label}`);};
  const touch=async label=>{
    const rect=await evaluate(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>x.textContent.trim()===${JSON.stringify(label)});if(!b||b.disabled)return null;b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    assert.ok(rect,`Synthetic control missing: ${label}`);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[rect]},sessionId);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]},sessionId);
  };
  await cdp.send('Page.navigate',{url:origin+'/'},sessionId);
  await wait("document.querySelector('input[name=email]')!==null",'login form');
  await wait("Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Entrar con correo'&&!b.disabled)",'authentication initialization');
  await evaluate(`document.querySelector('input[name=email]').value=${JSON.stringify(email)};document.querySelector('input[name=password]').value='synthetic-password';void 0`);
  await touch('Entrar con correo');
  await wait("document.body.innerText.includes('Tu espacio privado')",'synthetic login');
  await wait("document.body.innerText.includes('Recuperamos el último archivo')",'synthetic project');
  await touch('Cargar frases');
  await wait("document.querySelector('#cv-cue-0')!==null",'review editor');
  await evaluate(`(()=>{const e=document.querySelector('#cv-cue-0');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'The technician checks the pump.');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await touch('Guardar revisión');
  await wait("document.body.innerText.includes('Revisión guardada y reabierta')",'save review');
  for (const [label,name] of [['Descargar inglés TXT revisado','vistavo-translation.txt'],['Descargar inglés SRT revisado','vistavo-translation.srt']]) {
    await touch(label);
    let completed=false;
    for(let i=0;i<200;i++) {
      if([...downloaded].some(([guid,filename])=>filename===name&&finished.has(guid))){completed=true;break;}
      await sleep(100);
    }
    assert.ok(completed,`Synthetic download not completed: ${name}`);
  }
  assert.equal(await readFile(join(downloads,'vistavo-translation.txt'),'utf8'),'The technician checks the pump.\nNo leaks.\n');
  assert.equal(await readFile(join(downloads,'vistavo-translation.srt'),'utf8'),'1\n00:00:00,000 --> 00:00:01,200\nThe technician checks the pump.\n\n2\n00:00:01,500 --> 00:00:03,500\nNo leaks.\n');
  const widths=[];
  for(const width of [320,390,428]){
    await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true},sessionId);
    const metric=await evaluate('({viewport:innerWidth,document:document.documentElement.scrollWidth})');
    assert.ok(metric.document<=metric.viewport,`Horizontal overflow at ${width}`);widths.push(metric);
  }
  assert.equal(await evaluate("document.querySelector('input[name=cv-voice-choice][value=yes]')?.matches(':disabled')"),true,'Voice selection must inherit the disabled fieldset');
  assert.equal(await evaluate("document.querySelector('input[name=cv-voice-choice][value=no]')?.checked"),true,'Text-only must remain selected');
  assert.equal(requests.filter(r=>r.path==='/api/cloud/ai/jobs'&&r.method==='POST').length,0,'No processing may start');
  assert.ok(authRequests.some(r=>r.path.endsWith(':signInWithPassword')&&r.method==='POST'),'Synthetic sign-in request missing');
  assert.ok(authRequests.some(r=>r.path.endsWith(':lookup')&&r.method==='POST'),'Synthetic lookup request missing');
  await Promise.all([...inflight]);
  assert.deepEqual(blocked,[]);assert.deepEqual(exceptions,[]);
  testResult={result:'PASS',environment:'real Vite candidate bundle; mocked Firebase HTTPS responses and local synthetic API; desktop Chromium mobile emulation',physicalPhoneTested:false,
    syntheticLogin:true,reviewSaved:true,exactTxtAndSrtDownloads:true,voiceUnavailable:true,jobPosts:0,widths};
  testResult.chromeDiagnostics=chromeLog.snapshot();
} catch(error) {testError=String(error);}
finally {
  if(cdp){try{await cdp.send('Browser.close');}catch{}}
  if(browser){if(browser.exitCode===null&&browser.signalCode===null){await Promise.race([new Promise(ok=>browser.once('exit',ok)),sleep(3000)]);if(browser.exitCode===null&&browser.signalCode===null){browser.kill();await Promise.race([new Promise(ok=>browser.once('exit',ok)),sleep(3000)]);}}cleanup.chrome=browser.exitCode!==null||browser.signalCode!==null;}
  if(server){server.closeAllConnections();await new Promise(ok=>server.close(ok));cleanup.server=true;}
  if(proxy){proxy.closeAllConnections?.();await new Promise(ok=>proxy.close(ok));cleanup.proxy=true;}
  let afterBundle=[],afterBundleSha=null;
  try{afterBundle=await bundleSnapshot();afterBundleSha=sha(JSON.stringify(afterBundle));}catch{testError??='Post-run bundle snapshot unavailable';}
  const confirmed=Boolean(testResult)&&Object.values(cleanup).every(Boolean)&&beforeBundleSha===afterBundleSha&&blocked.length===0&&exceptions.length===0;
  const evidence={...(testResult??{}),result:confirmed?'PASS':'INCONCLUSIVE',error:testError??null,manifestSha256:sha(manifestBytes),candidateSha256:sha(await readFile(join(bundle,'cloudCandidate.js'))),
    bundleFiles:beforeBundle.length,bundleSha256Before:beforeBundleSha,bundleSha256After:afterBundleSha,cleanup,authRequests,requests,blocked,exceptions,
    limitations:'Synthetic auth and API responses; no real Google, provider, real balance, actual phone, or system-level network firewall. Browser profile retained only in the isolated task directory.'};
  await writeFile(join(run,'result.json'),JSON.stringify(evidence,null,2));
  console.log(JSON.stringify({run,...evidence}));
  if(!confirmed)process.exitCode=1;
}
