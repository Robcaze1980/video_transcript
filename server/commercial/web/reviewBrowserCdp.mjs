// Synthetic-browser CDP transport and bounded, non-content diagnostics.
import {Buffer} from 'node:buffer';

export function cdpPipe(child,{timeoutMs=20_000}={}) {
  const input=child.stdio?.[3],output=child.stdio?.[4];
  if(!input||!output||!Number.isSafeInteger(timeoutMs)||timeoutMs<1)throw Error('Synthetic Chrome pipe unavailable');
  let nextId=0,buffer=Buffer.alloc(0),closed=false;const pending=new Map(),listeners=new Set();
  function failAll(){
    if(closed)return;closed=true;
    for(const request of pending.values()){clearTimeout(request.timer);request.reject(Error('Synthetic Chrome pipe closed'));}
    pending.clear();
  }
  // Install synchronously at spawn, including pipes that close before the child exit.
  child.once('exit',failAll);child.once('error',failAll);child.once('close',failAll);
  input.once('error',failAll);input.once('close',failAll);
  output.once('error',failAll);output.once('end',failAll);output.once('close',failAll);
  output.on('data',chunk=>{
    if(closed)return;
    buffer=Buffer.concat([buffer,chunk]);if(buffer.length>8*1024*1024){failAll();child.kill();return;}
    for(;;){
      const end=buffer.indexOf(0);if(end<0)break;
      const frame=buffer.subarray(0,end);buffer=buffer.subarray(end+1);let message;
      try{message=JSON.parse(frame.toString('utf8'));}catch{failAll();child.kill();return;}
      if(message.id){
        const request=pending.get(message.id);if(!request)continue;
        pending.delete(message.id);clearTimeout(request.timer);
        if(message.error)request.reject(Error(`Synthetic CDP command failed: ${message.error.code}`));else request.resolve(message.result);
      }else for(const listener of listeners)listener(message);
    }
  });
  if(child.exitCode!=null||child.signalCode!=null||input.destroyed||output.destroyed||input.writableEnded||output.readableEnded)failAll();
  return {
    on(fn){listeners.add(fn);return()=>listeners.delete(fn);},
    send(method,params={},sessionId){
      if(closed)return Promise.reject(Error('Synthetic Chrome pipe closed'));
      const id=++nextId;return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{pending.delete(id);reject(Error(`Synthetic CDP timeout: ${method}`));},timeoutMs);
        pending.set(id,{resolve,reject,timer});
        try{input.write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0',error=>{if(error)failAll();});}catch{failAll();}
      });
    },
  };
}

export function captureChromeStderr(stream,limit=8*1024){
  if(!stream||!Number.isSafeInteger(limit)||limit<1||limit>8*1024)throw Error('Invalid bounded Chrome diagnostic stream');
  const parts=[];let captured=0,total=0,streamFailed=false;
  stream.on('data',chunk=>{
    const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);total=Math.min(Number.MAX_SAFE_INTEGER,total+bytes.length);
    const take=Math.min(bytes.length,limit-captured);if(take>0){parts.push(Buffer.from(bytes.subarray(0,take)));captured+=take;}
  });
  stream.on('error',()=>{streamFailed=true;});
  return {snapshot(){
    const text=Buffer.concat(parts,captured).toString('utf8'),categories=[];
    if(/ENOSPC|no space left|disk full|not enough (?:free )?space|insufficient disk/i.test(text))categories.push('disk_space');
    if(/EACCES|access is denied|permission denied/i.test(text))categories.push('access_denied');
    if(/profile.*in use|processsingleton|singletonlock/i.test(text))categories.push('profile_in_use');
    if(/sandbox/i.test(text))categories.push('sandbox');
    if(total>0&&!categories.length)categories.push('unclassified');
    return {stderrBytesSeen:total,stderrBytesCaptured:captured,stderrTruncated:total>captured,stderrStreamFailed:streamFailed,categories};
  }};
}
