/** Offline playback of two synthesized tones through the existing read-only candidate client. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {lstat,mkdir,readFile,realpath,rm,unlink,writeFile} from 'node:fs/promises';
import {isAbsolute,join,relative,resolve,sep} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {GeminiVoiceProvider,VOICE_MODEL,VOICE_SAMPLE_MIME} from '../pipelineVoiceProvider.ts';
import {buildWavRiff,validateWavRiff,VOICE_SAMPLE_RATE} from '../pipelineVoiceWav.ts';
import {reviewTranslation} from '../reviewedTranslation.ts';
import {ReviewedVoiceCanonicalError,validateReviewedVoiceCall} from '../reviewedVoiceCanonical.ts';
import {captureChromeStderr,cdpPipe} from './reviewBrowserCdp.mjs';
import {assertHeadlessBrowserProduct,readPinnedBrowserIdentity} from './reviewBrowserBinaryIdentity.mjs';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const mime='audio/wav';
const fileName='narration-en.wav';
const vectorFile=new URL('../reviewedVoiceCanonical.vectors.json',import.meta.url);
const {vectors}=JSON.parse(await readFile(vectorFile,'utf8'));
const vector=vectors.find(item=>item.name==='unicode-two-cues');
assert.equal(vector.calls.length,1);
const {evidence}=vector,source=JSON.parse(evidence.review.payload);
const reviewed=reviewTranslation(evidence.textJobId,source,source.cues.map(({id,en})=>({id,en})));
assert.equal(digest(reviewed.voiceText),evidence.review.voiceSha256);

function tone(frequency,seconds){
  const samples=Math.round(seconds*VOICE_SAMPLE_RATE),pcm=Buffer.alloc(samples*2);
  for(let index=0;index<samples;index++){
    pcm.writeInt16LE(Math.round(5500*Math.sin(2*Math.PI*frequency*index/VOICE_SAMPLE_RATE)),index*2);
  }
  return pcm;
}

const choices=[
  {voiceId:'Kore',sex:'female',jobId:'44444444-4444-4444-8444-444444444444',frequency:440,seconds:0.85},
  {voiceId:'Charon',sex:'male',jobId:'55555555-5555-4555-8555-555555555555',frequency:660,seconds:1.15},
];
assert.ok(choices.every(choice=>choice.jobId!==evidence.textJobId));
const results=[],sent=[];
for(const {voiceId,sex,jobId,frequency,seconds} of choices){
  const operation='narration:en:'+sex,prepared=JSON.parse(vector.calls[0].body);
  prepared.generationConfig.speechConfig.voiceConfig.voice=voiceId;
  const candidate={evidence,operation,model:VOICE_MODEL,callKey:vector.calls[0].callKey,body:JSON.stringify(prepared)};
  const verified=validateReviewedVoiceCall(candidate);
  assert.equal(verified.voiceId,voiceId);

  const wrongVoice=structuredClone(prepared);
  wrongVoice.generationConfig.speechConfig.voiceConfig.voice=voiceId==='Kore'?'Charon':'Kore';
  assert.throws(()=>validateReviewedVoiceCall({...candidate,body:JSON.stringify(wrongVoice)}),ReviewedVoiceCanonicalError);
  const edited=structuredClone(prepared);
  edited.contents[0].parts[0].text='Different unsaved fixture text.';
  assert.throws(()=>validateReviewedVoiceCall({...candidate,body:JSON.stringify(edited)}),ReviewedVoiceCanonicalError);

  const pcm=tone(frequency,seconds),providerWav=voiceId==='Charon';
  const returned=providerWav?buildWavRiff(pcm):pcm;
  const provider=new GeminiVoiceProvider({
    apiKey:'fixture-only',
    baseUrl:'https://voice-fixture.invalid',
    fetchImpl:async(url,init)=>{
      assert.equal(url,'https://voice-fixture.invalid/v1beta/models/'+VOICE_MODEL+':generateContent');
      assert.equal(init.method,'POST');
      assert.equal(init.body,verified.body);
      sent.push({voiceId,requestSha256:digest(init.body)});
      return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{
        inlineData:{mimeType:providerWav?mime:VOICE_SAMPLE_MIME,data:returned.toString('base64')},
      }]}}]}),{status:200,headers:{'content-type':'application/json'}});
    },
  });
  const synthesis=await provider.synthesize({jobId,text:reviewed.voiceText,voiceId,signal:new AbortController().signal});
  assert.deepEqual(synthesis.l16,pcm);
  const wav=buildWavRiff(synthesis.l16),stats=validateWavRiff(wav),sha256=digest(wav);
  assert.equal(stats.durationMs,Math.round(seconds*1000));
  assert.equal(stats.samples,pcm.length/2);
  assert.equal(stats.clippedRatio,0);
  results.push({id:jobId,operation,voiceId,seconds,sha256,size:wav.length,base64:wav.toString('base64')});
}
assert.deepEqual(sent.map(call=>call.voiceId),['Kore','Charon']);
assert.notEqual(sent[0].requestSha256,sent[1].requestSha256);
assert.notEqual(results[0].sha256,results[1].sha256);

function browserFixture(fixture){
  const {accountId,inputId,revision,voiceText,results,fileName,mime,token}=fixture;
  const prefix='vistavo-candidate-v1:'+accountId+':';
  localStorage.setItem(prefix+'input',inputId);
  for(const result of results)localStorage.setItem(prefix+'job:'+inputId+':'+result.operation,result.id);
  window.fixtureReads=[];
  window.fixtureDenied=[];
  window.fixtureBlobs=[];
  window.fixtureDownloads=[];
  window.fixtureRevocations=[];
  window.fixtureTamper=null;
  const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
  URL.createObjectURL=blob=>{
    const url=create(blob);
    window.fixtureBlobs.push({blob,url});
    return url;
  };
  URL.revokeObjectURL=url=>{window.fixtureRevocations.push(url);revoke(url);};
  HTMLAnchorElement.prototype.click=function(){
    if(this.download)window.fixtureDownloads.push({url:this.href,name:this.download});
  };
  const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  window.fetch=async(request,init={})=>{
    const method=String(init.method??'GET').toUpperCase();
    const key=String(request);
    if(!key.startsWith('/api/cloud/')||method!=='GET'||new Headers(init.headers).get('Authorization')!=='Bearer '+token){
      window.fixtureDenied.push(method);
      return json({error:'synthetic_denied'},403);
    }
    window.fixtureReads.push(key);
    if(key==='/api/cloud/me')return json({id:accountId,balance:{available:0,reserved:0,unit:'test-unit'}});
    if(key==='/api/cloud/uploads/'+inputId)return json({id:inputId,name:'fixture.mp4',state:'ready',offset:10,size:10,metadata:{duration:5,audioTracks:1}});
    if(key==='/api/cloud/projects/'+inputId)return json({revision,draft:voiceText});
    for(const result of results){
      const job='/api/cloud/ai/jobs/'+result.id;
      if(key===job)return json({id:result.id,inputId,operation:result.operation,state:'succeeded',billingState:'settled',revision,stale:false,units:1,
        results:[{name:fileName,mimeType:mime,size:result.size,sha256:result.sha256}]});
      if(key===job+'/results/'+fileName){
        const bytes=Uint8Array.from(atob(result.base64),value=>value.charCodeAt(0));
        if(window.fixtureTamper===result.id)bytes[bytes.length-1]^=1;
        return new Response(bytes,{headers:{'Content-Type':mime,'Content-Length':String(bytes.length),'Cache-Control':'no-store'}});
      }
    }
    window.fixtureDenied.push(method);
    return json({error:'synthetic_not_found'},404);
  };
}

const token='fixture-only';
const authPlugin={name:'synthetic-auth',setup(builder){
  builder.onResolve({filter:/^\.\/cloudCandidateAuth$/},()=>({path:'fixture-auth',namespace:'fixture'}));
  builder.onLoad({filter:/./,namespace:'fixture'},()=>({loader:'js',contents:
    "export async function candidateAuth(){return {observe(fn){window.fixtureSignOut=()=>fn(null);queueMicrotask(()=>fn({uid:'fixture-user',email:'fixture@example.invalid',emailVerified:true}));return ()=>{}},token:async()=>"+JSON.stringify(token)+",logout:async()=>window.fixtureSignOut()}}"}));
}};
const bundled=await build({entryPoints:['server/commercial/web/cloudCandidate.tsx'],bundle:true,format:'iife',platform:'browser',write:false,outdir:'synthetic-voice-client',plugins:[authPlugin]});
const byExtension=extension=>bundled.outputFiles.find(file=>file.path.endsWith(extension))?.text;
const client=byExtension('.js'),styles=byExtension('.css');
assert.ok(client&&styles);
const root=resolve('outputs/lv019-b-voice-playback-'+randomUUID()),profile=join(root,'chrome-profile'),page=join(root,'fixture.html');
await mkdir(profile,{recursive:true});
const config={accountId:evidence.accountId,inputId:evidence.inputId,revision:evidence.revision,voiceText:reviewed.voiceText,results,fileName,mime,token};
const script=text=>text.replace(/<\/script/gi,'<\\/script');
await writeFile(page,'<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src file: data:; media-src blob:; connect-src 'none'">`+
  '<style>'+styles+'</style><div id="cloud-candidate"></div><script>'+script('('+browserFixture.toString()+')('+JSON.stringify(config)+');')+'</script>'+
  '<script>'+script(client)+'</script>');

const browserIdentity=readPinnedBrowserIdentity();
const windows=process.env.SystemRoot;
if(!windows||!isAbsolute(windows))throw Error('Windows system directory is required');
const sandboxEnv={SystemRoot:windows,WINDIR:windows,PATH:join(windows,'System32'),USERPROFILE:profile,LOCALAPPDATA:profile,APPDATA:profile,TEMP:profile,TMP:profile};
const browser=spawn(browserIdentity.path,['--headless=new','--no-first-run','--disable-background-networking','--disable-sync','--disable-extensions',
  '--disable-component-update','--disable-domain-reliability','--disable-quic','--disable-default-apps','--no-default-browser-check',
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp','--host-resolver-rules=MAP * ~NOTFOUND',
  '--mute-audio','--remote-debugging-pipe','--user-data-dir='+profile,'about:blank'],
  {cwd:root,env:sandboxEnv,windowsHide:true,stdio:['ignore','ignore','pipe','pipe','pipe']});
const closed=new Promise(resolve=>browser.once('close',resolve));
const chromeStderr=captureChromeStderr(browser.stderr),cdp=cdpPipe(browser);
const exceptions=[],external=[],playback=[];
let playbackResult;
try{
  const version=await cdp.send('Browser.getVersion');
  assertHeadlessBrowserProduct(version);
  const target=await cdp.send('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
  const send=(method,params={})=>cdp.send(method,params,sessionId);
  cdp.on(event=>{
    if(event.sessionId!==sessionId)return;
    if(event.method==='Runtime.exceptionThrown')exceptions.push(event.params.exceptionDetails.text);
    if(event.method==='Network.requestWillBeSent'){
      const protocol=new URL(event.params.request.url).protocol;
      if(!['file:','about:','blob:','data:'].includes(protocol))external.push(protocol);
    }
  });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  await send('Network.setBlockedURLs',{urls:['http://*','https://*','ws://*','wss://*']});
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  const evaluate=async expression=>{
    const value=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});
    if(value.exceptionDetails)throw Error('Synthetic browser evaluation failed: '+(value.exceptionDetails.exception?.description??value.exceptionDetails.text));
    return value.result.value;
  };
  const wait=async (expression,label)=>{
    for(let attempt=0;attempt<160;attempt++){
      if(await evaluate(expression))return;
      await delay(50);
    }
    throw Error('Synthetic condition did not resolve: '+label);
  };
  const button=(card,label)=>"Array.from("+card+".querySelectorAll('button')).find(button=>button.textContent.replace('↗','').trim()==="+JSON.stringify(label)+")";

  await send('Page.navigate',{url:pathToFileURL(page).href});
  await wait("document.body?.innerText.includes('Recuperamos el último archivo')", 'recover saved project');
  assert.equal(await evaluate('window.isSecureContext'),true);

  assert.equal(await evaluate("document.querySelector('input[name=cv-voice-choice][value=yes]').matches(':disabled')"),true);
  assert.equal(await evaluate('innerWidth'),390);
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);

  for(const [index,result] of results.entries()){
    const card="document.querySelectorAll('.cv-voice')["+index+"]",audio=card+".querySelector('audio')";
    await evaluate(button(card,'Consultar estado')+'.click()');
    await wait(button(card,'Preparar audio para escuchar')+'?.disabled===false','prepare control for '+result.voiceId);
    assert.equal(await evaluate(card+'.innerText.includes('+JSON.stringify(result.voiceId)+')'),true);
    if(index===0){
      const before=await evaluate('window.fixtureBlobs.length');
      await evaluate('window.fixtureTamper='+JSON.stringify(result.id));
      await evaluate(button(card,'Preparar audio para escuchar')+'.click()');
      await wait("!!document.querySelector('[role=alert]')",'digest mismatch alert');
      assert.equal(await evaluate(audio+'===null'),true);
      assert.equal(await evaluate('window.fixtureBlobs.length'),before);
      await evaluate('window.fixtureTamper=null');
      await wait(button(card,'Preparar audio para escuchar')+'?.disabled===false','recover prepare control');
    }
    await evaluate(button(card,'Preparar audio para escuchar')+'.click()');
    await wait(audio+'?.readyState>=2','decode WAV for '+result.voiceId);
    const duration=await evaluate(audio+'.duration');
    assert.ok(Math.abs(duration-result.seconds)<0.02);
    assert.equal(await evaluate(audio+'.error===null'),true);
    const audioUrl=await evaluate(audio+'.src');
    const blobDigest=async url=>evaluate("(async()=>{const item=window.fixtureBlobs.find(entry=>entry.url==="+JSON.stringify(url)+");const b=await item.blob.arrayBuffer();return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),value=>value.toString(16).padStart(2,'0')).join('')})()");
    const byteDigest=await blobDigest(audioUrl);
    assert.equal(byteDigest,result.sha256);
    await evaluate("(async()=>{const player="+audio+";player.muted=true;await player.play()})()");
    await wait(audio+'.currentTime>0.12','media clock advances for '+result.voiceId);
    const mediaTime=await evaluate(audio+'.currentTime');
    await evaluate(audio+'.pause()');
    const downloads=await evaluate('window.fixtureDownloads.length');
    await evaluate(button(card,'Descargar WAV')+'.click()');
    await wait('window.fixtureDownloads.length==='+String(downloads+1),'prepare download for '+result.voiceId);
    const download=await evaluate('window.fixtureDownloads.at(-1)');
    assert.equal(download.name,fileName);
    assert.equal(await blobDigest(download.url),result.sha256);
    playback.push({voiceId:result.voiceId,wavSha256:byteDigest,duration,advancedSeconds:mediaTime,downloadName:fileName});
  }
  const reads=await evaluate('window.fixtureReads');
  assert.ok(reads.includes('/api/cloud/ai/jobs/'+results[0].id+'/results/'+fileName));
  assert.ok(reads.includes('/api/cloud/ai/jobs/'+results[1].id+'/results/'+fileName));
  assert.deepEqual(await evaluate('window.fixtureDenied'),[]);
  const playingUrls=await evaluate("Array.from(document.querySelectorAll('.cv-voice audio'),player=>player.src)");
  assert.equal(playingUrls.length,2);
  await evaluate('window.fixtureSignOut()');
  await wait("!document.querySelector('.cv-voices')",'revoke browser media on sign-out');
  assert.equal(await evaluate(JSON.stringify(playingUrls)+'.every(url=>window.fixtureRevocations.includes(url))'),true);
  assert.deepEqual(external,[]);
  assert.deepEqual(exceptions,[]);
  playbackResult={browser:version.product,browserSha256:browserIdentity.sha256,viewport:390,network:'CDP blocks HTTP(S) and WS(S), all API responses in memory',
    reviewedRevision:evidence.revision,voiceTextSha256:evidence.review.voiceSha256,providerCalls:sent,
    playback,tamperedWavRejected:true,verifiedDownloadBytes:true,noGenerationInClient:true,signOutRevokedUrls:true,externalRequests:external.length};
}catch(error){
  await writeFile(join(root,'browser-failure.json'),JSON.stringify({error:String(error),stderr:chromeStderr.snapshot()},null,2)+'\n');
  throw error;
}finally{
  try{
    if(browser.exitCode===null&&browser.signalCode===null)browser.kill();
    await closed;
    const workspace=await realpath(resolve('outputs')),actual=await realpath(root),actualProfile=await realpath(profile);
    const inside=relative(workspace,actual);
    assert.ok(inside.startsWith('lv019-b-voice-playback-')&&!isAbsolute(inside)&&!inside.includes(sep));
    assert.equal(relative(actual,actualProfile),'chrome-profile');
    await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});
    await unlink(page);
    await assert.rejects(lstat(profile),{code:'ENOENT'});
    await assert.rejects(lstat(page),{code:'ENOENT'});
  }catch(error){
    await writeFile(join(root,'cleanup-failure.json'),JSON.stringify({error:String(error),stderr:chromeStderr.snapshot()},null,2)+'\n');
    throw error;
  }
}

const result={result:'PASS',...playbackResult,browserClosed:true,temporaryFilesRemoved:true};
await writeFile(join(root,'browser-result.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({root,...result}));
