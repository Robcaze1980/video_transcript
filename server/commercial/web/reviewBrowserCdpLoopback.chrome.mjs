// Independent about:blank control using a verified loopback debugger endpoint.
// No emulator, account, video or remote application is used.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {existsSync,lstatSync,mkdirSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {basename,dirname,join,parse,resolve} from 'node:path';
import {captureChromeStderr} from './reviewBrowserCdp.mjs';

assert.equal(process.platform,'win32');assert.equal(process.env.NODE_ENV,'test');
assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS,undefined);assert.equal(process.env.NODE_OPTIONS,undefined);
const outputs=realpathSync(resolve('outputs')),base=join(outputs,'lv019-b-cdp-diagnostic');
if(!existsSync(base))mkdirSync(base);assert.equal(lstatSync(base).isSymbolicLink(),false);assert.equal(realpathSync(base).toLowerCase(),base.toLowerCase());
const run=join(base,'run-'+randomUUID()),profile=join(run,'profile'),temp=join(run,'temp'),chromeProfile=join(run,'chrome');
mkdirSync(run);mkdirSync(profile);mkdirSync(temp);mkdirSync(chromeProfile);const owner=randomUUID();writeFileSync(join(run,'.synthetic-owner'),owner,{flag:'wx'});
let proxyAttempts=0;const proxy=createServer(socket=>{proxyAttempts++;socket.destroy();});
await new Promise((resolve,reject)=>{proxy.once('error',reject);proxy.listen(0,'127.0.0.1',resolve);});
const proxyAddress=proxy.address();assert.ok(proxyAddress&&typeof proxyAddress!=='string'&&proxyAddress.address==='127.0.0.1');
const systemRoot=process.env.SystemRoot;assert.ok(systemRoot);
const env={SystemRoot:systemRoot,WINDIR:systemRoot,PATH:join(systemRoot,'System32'),APPDATA:profile,LOCALAPPDATA:profile,USERPROFILE:profile,TEMP:temp,TMP:temp,
  HOMEDRIVE:parse(profile).root.slice(0,2),HOMEPATH:profile.slice(2),SYSTEMDRIVE:parse(systemRoot).root.slice(0,2),USERNAME:'synthetic-review',USERDOMAIN:'SYNTHETIC',LOGONSERVER:'SYNTHETIC'};
const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe',args=['--headless=new','--no-first-run','--disable-background-networking','--disable-sync','--disable-extensions',
  '--disable-quic','--disable-component-update','--disable-domain-reliability','--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',`--proxy-server=http://127.0.0.1:${proxyAddress.port}`,'--proxy-bypass-list=127.0.0.1',
  '--remote-debugging-port=0',`--user-data-dir=${chromeProfile}`,'about:blank'];
const started=Date.now();let child,capture,ws,exitObserved=false,debuggerIdentityVerified=false,outcome='INCONCLUSIVE',failure='';
try{
  child=spawn(chrome,args,{env,cwd:run,windowsHide:true,stdio:['ignore','ignore','pipe','pipe','pipe']});
  child.once('exit',()=>{exitObserved=true;});child.once('error',()=>{exitObserved=true;});capture=captureChromeStderr(child.stderr);
  const end=Date.now()+20_000,discovery=join(chromeProfile,'DevToolsActivePort');let raw;
  while(Date.now()<end&&!exitObserved){if(existsSync(discovery)){raw=readFileSync(discovery,'utf8');break;}await new Promise(resolve=>setTimeout(resolve,100));}
  if(!raw)throw Error('Synthetic Chrome debugger discovery unavailable');
  const [portText,endpoint]=raw.trim().split(/\r?\n/),port=Number(portText);
  assert.ok(Number.isSafeInteger(port)&&port>=1024&&port<=65535);assert.match(endpoint,/^\/devtools\/browser\/[a-f0-9-]+$/i);
  const probe=`$a=@(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction Stop);if($a.Count -ne 1 -or $a[0].LocalAddress -ne '127.0.0.1' -or $a[0].OwningProcess -ne ${child.pid}){exit 1}`;
  execFileSync(join(systemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(probe,'utf16le').toString('base64')],{env,windowsHide:true,timeout:15_000,stdio:'ignore'});
  debuggerIdentityVerified=true;ws=new WebSocket(`ws://127.0.0.1:${port}${endpoint}`);
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Synthetic debugger connection timeout')),5000);ws.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});ws.addEventListener('error',()=>{clearTimeout(timer);reject(Error('Synthetic debugger connection failed'));},{once:true});});
  const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Synthetic debugger response timeout')),5000);ws.addEventListener('message',event=>{
    try{const value=JSON.parse(String(event.data));if(value.id===1){clearTimeout(timer);resolve(value.result);}}catch{clearTimeout(timer);reject(Error('Synthetic debugger response invalid'));}
  });ws.send(JSON.stringify({id:1,method:'Browser.getVersion'}));});
  assert.match(result.product,/^Chrome\//);outcome='PASS';
}catch(error){failure=error instanceof Error&&/^Synthetic [A-Za-z ]+(?:timeout|failed|invalid|unavailable)$/.test(error.message)?error.message:'Synthetic control failed';}
finally{
  if(child&&!exitObserved){
    if(ws?.readyState===WebSocket.OPEN){try{ws.send(JSON.stringify({id:2,method:'Browser.close'}));}catch{}}
    const graceful=Date.now()+2000;while(!exitObserved&&Date.now()<graceful)await new Promise(resolve=>setTimeout(resolve,50));
    if(!exitObserved)child.kill();
    const end=Date.now()+10_000;while(!exitObserved&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,50));
  }
  ws?.close();await new Promise(resolve=>proxy.close(()=>resolve()));let chromeProfileRemoved=false;
  if(!child||exitObserved){const actual=realpathSync(chromeProfile);assert.equal(actual.toLowerCase(),chromeProfile.toLowerCase());assert.equal(dirname(actual).toLowerCase(),run.toLowerCase());
    assert.match(basename(run),/^run-[a-f0-9-]{36}$/i);assert.equal(readFileSync(join(run,'.synthetic-owner'),'utf8'),owner);rmSync(actual,{recursive:true,force:true});chromeProfileRemoved=!existsSync(actual);}
  const report={outcome,failure,elapsedMs:Date.now()-started,syntheticOnly:true,emulatorsUsed:false,physicalPhoneTested:false,cdpTransport:'verified-loopback-websocket',
    debuggerIdentityVerified,proxyAttempts,exitObserved,chromeProfileRemoved,chromeExitCode:child?.exitCode??null,chromeSignal:child?.signalCode??null,stderr:capture?.snapshot()??null,
    networkLimitation:'The proxy and Chrome flags are not an operating-system firewall.'};
  writeFileSync(join(run,'result.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  process.stdout.write(JSON.stringify({run,...report})+'\n');if(outcome!=='PASS'||!chromeProfileRemoved)process.exitCode=1;
}
