// One isolated Microsoft Edge about:blank diagnostic. No emulators, accounts or project data.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {existsSync,lstatSync,mkdirSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {basename,dirname,join,parse,resolve} from 'node:path';
import {captureChromeStderr,cdpPipe} from './reviewBrowserCdp.mjs';

assert.equal(process.platform,'win32');assert.equal(process.env.NODE_ENV,'test');
assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS,undefined);assert.equal(process.env.NODE_OPTIONS,undefined);
assert.deepEqual(process.argv.slice(2),['--wait-55s']);const timeoutMs=55_000;
const outputs=realpathSync(resolve('outputs')),base=join(outputs,'lv019-b-edge-diagnostic');
if(!existsSync(base))mkdirSync(base);assert.equal(lstatSync(base).isSymbolicLink(),false);assert.equal(realpathSync(base).toLowerCase(),base.toLowerCase());
const run=join(base,'run-'+randomUUID()),profile=join(run,'profile'),temp=join(run,'temp'),chromeProfile=join(run,'browser');
mkdirSync(run);mkdirSync(profile);mkdirSync(temp);mkdirSync(chromeProfile);const owner=randomUUID();writeFileSync(join(run,'.synthetic-owner'),owner,{flag:'wx'});
let proxyAttempts=0;const proxy=createServer(socket=>{proxyAttempts++;socket.destroy();});
await new Promise((resolve,reject)=>{proxy.once('error',reject);proxy.listen(0,'127.0.0.1',resolve);});
const proxyAddress=proxy.address();assert.ok(proxyAddress&&typeof proxyAddress!=='string'&&proxyAddress.address==='127.0.0.1');
const systemRoot=process.env.SystemRoot;assert.ok(systemRoot);
const env={SystemRoot:systemRoot,WINDIR:systemRoot,PATH:join(systemRoot,'System32'),APPDATA:profile,LOCALAPPDATA:profile,USERPROFILE:profile,TEMP:temp,TMP:temp,
  HOMEDRIVE:parse(profile).root.slice(0,2),HOMEPATH:profile.slice(2),SYSTEMDRIVE:parse(systemRoot).root.slice(0,2),USERNAME:'synthetic-review',USERDOMAIN:'SYNTHETIC',LOGONSERVER:'SYNTHETIC'};
for(const key of ['HOME','CODEX_HOME','NODE_OPTIONS','GOOGLE_APPLICATION_CREDENTIALS'])assert.equal(key in env,false);
const chrome='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args=['--headless=new','--no-first-run','--disable-background-networking','--disable-sync','--disable-extensions',
  '--disable-quic','--disable-component-update','--disable-domain-reliability','--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',`--proxy-server=http://127.0.0.1:${proxyAddress.port}`,'--proxy-bypass-list=127.0.0.1',
  '--remote-debugging-pipe',`--user-data-dir=${chromeProfile}`,'about:blank'];
const started=Date.now();let child,cdp,capture,exitObserved=false,outcome='INCONCLUSIVE',failure='',reportedProduct=null;
try{
  child=spawn(chrome,args,{env,cwd:run,windowsHide:true,stdio:['ignore','ignore','pipe','pipe','pipe']});
  child.once('exit',()=>{exitObserved=true;});child.once('error',()=>{exitObserved=true;});
  capture=captureChromeStderr(child.stderr);cdp=cdpPipe(child,{timeoutMs});
  const version=await cdp.send('Browser.getVersion');assert.ok(version&&typeof version.product==='string');
  reportedProduct=/^(?:Chrome|Edg|Microsoft Edge)\/[0-9.]{1,40}$/.test(version.product)?version.product:'unrecognized';outcome='PASS';
}catch(error){failure=error instanceof Error&&/^Synthetic Chrome pipe closed$|^Synthetic CDP timeout: Browser\.getVersion$|^Synthetic CDP command failed: -?\d+$/.test(error.message)?error.message:'Synthetic diagnostic failed';}
finally{
  if(child&&!exitObserved){
    if(outcome==='PASS')await Promise.race([cdp.send('Browser.close').catch(()=>undefined),new Promise(resolve=>setTimeout(resolve,2000))]);
    if(!exitObserved)child.kill();
    const end=Date.now()+10_000;while(!exitObserved&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,50));
  }
  await new Promise(resolve=>proxy.close(()=>resolve()));
  let chromeProfileRemoved=false;
  if(!child||exitObserved){
    const actual=realpathSync(chromeProfile);assert.equal(actual.toLowerCase(),chromeProfile.toLowerCase());assert.equal(dirname(actual).toLowerCase(),run.toLowerCase());
    assert.match(basename(run),/^run-[a-f0-9-]{36}$/i);assert.equal(readFileSync(join(run,'.synthetic-owner'),'utf8'),owner);
    rmSync(actual,{recursive:true,force:true});chromeProfileRemoved=!existsSync(actual);
  }
  const result={outcome,failure,timeoutMs,elapsedMs:Date.now()-started,browser:'Microsoft Edge',reportedProduct,syntheticOnly:true,emulatorsUsed:false,physicalPhoneTested:false,
    cdpTransport:'browser-debugging-pipe',proxyAttempts,exitObserved,chromeProfileRemoved,
    chromeExitCode:child?.exitCode??null,chromeSignal:child?.signalCode??null,stderr:capture?.snapshot()??null,
    networkLimitation:'The proxy and Chrome flags are not an operating-system firewall.'};
  writeFileSync(join(run,'result.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  process.stdout.write(JSON.stringify({run,...result})+'\n');if(outcome!=='PASS'||!chromeProfileRemoved)process.exitCode=1;
}
