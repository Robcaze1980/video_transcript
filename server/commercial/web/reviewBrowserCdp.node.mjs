import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import test from 'node:test';
import {captureChromeStderr,cdpPipe} from './reviewBrowserCdp.mjs';

class SyntheticChild extends EventEmitter {
  constructor(){super();this.stdio=[null,null,new PassThrough(),new PassThrough(),new PassThrough()];this.stderr=this.stdio[2];this.exitCode=null;this.signalCode=null;this.killed=false;}
  kill(){this.killed=true;}
}

test('CDP answers framed synthetic requests',async()=>{
  const child=new SyntheticChild(),cdp=cdpPipe(child,{timeoutMs:500});
  let request='';child.stdio[3].on('data',chunk=>{request+=chunk.toString();});
  const pending=cdp.send('Browser.getVersion');
  assert.equal(JSON.parse(request.replace(/\0$/,'')).method,'Browser.getVersion');
  child.stdio[4].write('{"id":1,"result":{"synthetic":true}}\0');
  assert.deepEqual(await pending,{synthetic:true});
});

test('early child exit and already-exited child reject without waiting for timeout',async()=>{
  const child=new SyntheticChild(),cdp=cdpPipe(child,{timeoutMs:5000}),pending=cdp.send('Browser.getVersion');
  child.exitCode=1;child.emit('exit',1,null);await assert.rejects(pending,/Synthetic Chrome pipe closed/);
  await assert.rejects(cdp.send('Browser.getVersion'),/Synthetic Chrome pipe closed/);
  const exited=new SyntheticChild();exited.exitCode=1;
  await assert.rejects(cdpPipe(exited,{timeoutMs:5000}).send('Browser.getVersion'),/Synthetic Chrome pipe closed/);
  const closed=new SyntheticChild();closed.stdio[4].destroy();
  await assert.rejects(cdpPipe(closed,{timeoutMs:5000}).send('Browser.getVersion'),/Synthetic Chrome pipe closed/);
});

test('CDP output closes or input errors reject outstanding requests',async()=>{
  const a=new SyntheticChild(),first=cdpPipe(a,{timeoutMs:5000}).send('Browser.getVersion');
  a.stdio[4].emit('close');await assert.rejects(first,/Synthetic Chrome pipe closed/);
  const b=new SyntheticChild(),second=cdpPipe(b,{timeoutMs:5000}).send('Browser.getVersion');
  b.stdio[3].emit('error',Error('synthetic pipe error'));await assert.rejects(second,/Synthetic Chrome pipe closed/);
});

test('invalid CDP frames stop the synthetic child and do not expose the frame',async()=>{
  const child=new SyntheticChild(),pending=cdpPipe(child,{timeoutMs:5000}).send('Browser.getVersion');
  child.stdio[4].write('secret-synthetic-frame\0');
  await assert.rejects(pending,error=>error.message==='Synthetic Chrome pipe closed');assert.equal(child.killed,true);
});

test('Chrome stderr capture is bounded and reports categories without raw content',()=>{
  const stream=new PassThrough(),capture=captureChromeStderr(stream,64);
  stream.write('synthetic-private-marker ENOSPC no space left ');stream.write('x'.repeat(1000));
  const summary=capture.snapshot();assert.equal(summary.stderrBytesCaptured,64);assert.ok(summary.stderrBytesSeen>64);
  assert.equal(summary.stderrTruncated,true);assert.equal(summary.stderrStreamFailed,false);assert.deepEqual(summary.categories,['disk_space']);
  assert.doesNotMatch(JSON.stringify(summary),/synthetic-private-marker|ENOSPC|no space left|xxx/);
});

test('unknown stderr is classified without echoing messages',()=>{
  const stream=new PassThrough(),capture=captureChromeStderr(stream);stream.write('synthetic-private-marker');
  assert.deepEqual(capture.snapshot().categories,['unclassified']);assert.doesNotMatch(JSON.stringify(capture.snapshot()),/synthetic-private-marker/);
});
