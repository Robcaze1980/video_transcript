import {describe,expect,it} from 'vitest';
import {GcsObjects} from './gcsObjects';
import type {CloudObject} from './gcsObjects';

const bucket='vistavo-prod-107404655346-media' as const;
const prefix='candidate-files-v1/11111111-2222-3333-4444-555555555555/';
const chunk=prefix+'chunks/0000',final=prefix+'video.mp4';
// Object generations are opaque decimal strings, including values beyond JS integer precision.
const gen='900719925474099312345';
function metadata(name=chunk,generation=gen,size=4,marker=false){return {name,bucket,generation,size:String(size),
  ...(marker?{contentType:'application/x-vistavo-tombstone',metadata:{vistavoMarker:'v1'}}:{})};}
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const missing=()=>json({error:{code:404}},404);
function media(value='abcd',status=200,headers:Record<string,string>={}){return new Response(value,{status,headers:{'Content-Length':String(Buffer.byteLength(value)),...headers}});}
type Step=Response|((url:URL,init:RequestInit)=>Response|Promise<Response>);
function client(...steps:Step[]){
  const calls:{url:URL;init:RequestInit}[]=[];
  const request=(async(input:URL|string|Request,init:RequestInit={})=>{
    const url=new URL(String(input));calls.push({url,init});const step=steps.shift();
    if(!step)throw Error('Unexpected HTTP call');return typeof step==='function'?step(url,init):step;
  }) as typeof fetch;
  const objects=new GcsObjects({accessToken:async()=>'synthetic-test-token',bucket,projectId:'vistavo-prod',request});
  return {objects,calls,remaining:()=>steps.length};
}
async function bytes(stream:AsyncIterable<Uint8Array>){const parts=[];for await(const part of stream)parts.push(Buffer.from(part));return Buffer.concat(parts).toString();}

describe('GCS immutable private object HTTP protocol',()=>{
  it('creates only with generation zero, reads the exact generation and verifies actual bytes',async()=>{
    const c=client(missing(),json(metadata()),media());
    await expect(c.objects.putOnce(chunk,Buffer.from('abcd'))).resolves.toEqual({key:chunk,generation:gen,size:4});
    expect(c.calls[1].url.pathname).toBe('/upload/storage/v1/b/'+bucket+'/o');
    expect(c.calls[1].url.searchParams.get('uploadType')).toBe('media');
    expect(c.calls[1].url.searchParams.get('name')).toBe(chunk);
    expect(c.calls[1].url.searchParams.get('ifGenerationMatch')).toBe('0');
    expect(c.calls[1].init.method).toBe('POST');expect(c.calls[1].init.body).toEqual(Buffer.from('abcd'));
    expect(c.calls[2].url.searchParams.get('generation')).toBe(gen);
    expect(c.calls[2].url.searchParams.get('alt')).toBe('media');
    for(const call of c.calls){const h=new Headers(call.init.headers);expect(h.get('authorization')).toBe('Bearer synthetic-test-token');expect(h.get('x-goog-user-project')).toBe('vistavo-prod');}
    expect(c.remaining()).toBe(0);
  });

  it('replays an existing object using GETs only, compatible with creator plus viewer IAM',async()=>{
    const c=client(json(metadata()),media());
    await expect(c.objects.putOnce(chunk,Buffer.from('abcd'))).resolves.toMatchObject({generation:gen});
    expect(c.calls).toHaveLength(2);expect(c.calls.every(x=>!x.init.method||x.init.method==='GET')).toBe(true);
  });

  it('recovers a generation-zero creation race only after reading and hashing the winner',async()=>{
    const c=client(missing(),json({},412),json(metadata()),media());
    await expect(c.objects.putOnce(chunk,Buffer.from('abcd'))).resolves.toMatchObject({generation:gen});
    expect(c.calls).toHaveLength(4);
    const changed=client(missing(),json({},412),json(metadata()),media('abce'));
    await expect(changed.objects.putOnce(chunk,Buffer.from('abcd'))).rejects.toMatchObject({code:'conflict'});
  });

  it('rejects a same-size object with different bytes and never overwrites it',async()=>{
    const c=client(json(metadata()),media('abce'));
    await expect(c.objects.putOnce(chunk,Buffer.from('abcd'))).rejects.toMatchObject({code:'conflict'});
    expect(c.calls).toHaveLength(2);expect(c.calls.every(x=>!x.init.method)).toBe(true);
  });

  it('never mistakes a deletion marker for a resumable chunk',async()=>{
    const c=client(json(metadata(chunk,gen,0,true)));
    await expect(c.objects.putOnce(chunk,Buffer.from('abcd'))).rejects.toMatchObject({code:'conflict'});
    expect(c.calls).toHaveLength(1);
  });

  it('composes at the slash endpoint, with generation zero and exact source generations',async()=>{
    const c=client(missing(),json(metadata(final,gen,8)));
    const sources=[{key:chunk,generation:gen},{key:prefix+'chunks/0001',generation:'900719925474099312346'}];
    await expect(c.objects.composeOnce(final,sources,8)).resolves.toEqual({key:final,generation:gen,size:8});
    expect(c.calls[1].url.pathname).toBe('/storage/v1/b/'+bucket+'/o/'+encodeURIComponent(final)+'/compose');
    expect(c.calls[1].url.searchParams.get('ifGenerationMatch')).toBe('0');
    expect(JSON.parse(String(c.calls[1].init.body))).toEqual({sourceObjects:sources.map(s=>({name:s.key,generation:s.generation})),destination:{contentType:'video/mp4'}});
  });

  it('rejects more than32 compose sources and foreign namespaces before any network call',async()=>{
    const c=client();const source={key:chunk,generation:gen};
    await expect(c.objects.composeOnce(final,Array(33).fill(source),132)).rejects.toMatchObject({code:'invalid'});
    await expect(c.objects.metadata('../other-account/file')).rejects.toMatchObject({code:'invalid'});
    await expect(c.objects.composeOnce(final,[{...source,key:'another-prefix/'+chunk}],4)).rejects.toMatchObject({code:'invalid'});
    expect(c.calls).toHaveLength(0);
  });

  it('replaces an existing generation with an explicitly zero-byte multipart deletion marker',async()=>{
    const next='900719925474099312346';const c=client(json(metadata()),json(metadata(chunk,next,0,true)),json(metadata(chunk,next,0,true)));
    await expect(c.objects.barrier(chunk)).resolves.toEqual({key:chunk,generation:next,size:0,marker:true});
    const write=c.calls[1];expect(write.url.searchParams.get('uploadType')).toBe('multipart');expect(write.url.searchParams.get('ifGenerationMatch')).toBe(gen);
    expect(write.init.method).toBe('POST');expect(new Headers(write.init.headers).get('Content-Type')).toBe('multipart/related; boundary=vistavo-marker-boundary');
    const multipart=String(write.init.body);expect(multipart).toContain('"contentType":"application/x-vistavo-tombstone"');expect(multipart).toContain('"vistavoMarker":"v1"');
    expect(multipart.split('Content-Type: application/x-vistavo-tombstone\r\n\r\n')[1]).toBe('\r\n--vistavo-marker-boundary--\r\n');
    expect(c.calls.every(x=>x.init.method!=='DELETE')).toBe(true);
  });

  it('fences even an absent key and retries a CAS race using the newly observed generation',async()=>{
    const next='900719925474099312346';
    const c=client(missing(),json({},412),json(metadata()),json(metadata(chunk,next,0,true)),json(metadata(chunk,next,0,true)));
    await expect(c.objects.barrier(chunk)).resolves.toMatchObject({generation:next,size:0,marker:true});
    expect(c.calls[1].url.searchParams.get('ifGenerationMatch')).toBe('0');expect(c.calls[3].url.searchParams.get('ifGenerationMatch')).toBe(gen);
  });

  it('does not acknowledge deletion when marker readback is absent, different, or unmarked',async()=>{
    const steps:Step[]=[];
    for(let n=0;n<4;n++)steps.push(json(metadata()),json(metadata(chunk,'55',0,true)),json(metadata(chunk,'55',0,false)));
    const c=client(...steps);await expect(c.objects.barrier(chunk)).rejects.toMatchObject({code:'conflict'});
    expect(c.calls).toHaveLength(12);
  });

  it('accepts an existing verified marker without any rewrite or delete',async()=>{
    const c=client(json(metadata(chunk,gen,0,true)));
    await expect(c.objects.barrier(chunk)).resolves.toMatchObject({marker:true,size:0,generation:gen});expect(c.calls).toHaveLength(1);
  });

  it('uses an exact generation and Range, and requires exact length and Content-Range',async()=>{
    const object:CloudObject={key:final,generation:gen,size:10};
    const c=client(media('cde',206,{'Content-Range':'bytes 2-4/10'}));
    expect(await bytes(await c.objects.read(object,{start:2,end:4}))).toBe('cde');
    expect(c.calls[0].url.searchParams.get('generation')).toBe(gen);expect(new Headers(c.calls[0].init.headers).get('Range')).toBe('bytes=2-4');
    for(const response of [media('cde',200),media('cde',206,{'Content-Range':'bytes 3-5/10'}),media('cd',206,{'Content-Range':'bytes 2-4/10'})]){
      const bad=client(response);await expect(bad.objects.read(object,{start:2,end:4})).rejects.toMatchObject({code:'remote'});
    }
  });

  it('fails closed on malformed identity, numeric generation, unsafe size, denied IAM and unavailable credentials',async()=>{
    for(const value of [{...metadata(),bucket:'foreign-bucket'},{...metadata(),name:final},{...metadata(),generation:9007199254740992},{...metadata(),size:'9007199254740992'}]){
      const c=client(json(value));await expect(c.objects.metadata(chunk)).rejects.toMatchObject({code:'remote'});
    }
    const denied=client(json({error:{code:403}},403));await expect(denied.objects.metadata(chunk)).rejects.toMatchObject({code:'remote',status:403});
    const objects=new GcsObjects({bucket,projectId:'vistavo-prod',accessToken:async()=>{throw Error('SENSITIVE CREDENTIAL DETAILS');},request:async()=>{throw Error('must not call');}});
    await expect(objects.metadata(chunk)).rejects.toMatchObject({code:'remote',message:'remote'});
  });
});


describe('GCS private AI artifacts keep independent write bounds',()=>{
 const result=prefix+'results/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/';
 const text=result+'translation-en.txt',wav=result+'narration-en.wav';
 it('creates a generation-bound artifact once and verifies actual returned bytes',async()=>{
  const c=client(missing(),json(metadata(text,gen,4)),media('abcd'));
  await expect(c.objects.putArtifactOnce(text,Buffer.from('abcd'))).resolves.toEqual({key:text,generation:gen,size:4});
  expect(c.calls[1].url.searchParams.get('ifGenerationMatch')).toBe('0');expect(c.calls[2].url.searchParams.get('generation')).toBe(gen);
  const replay=client(json(metadata(text,gen,4)),media('abcd'));await replay.objects.putArtifactOnce(text,Buffer.from('abcd'));expect(replay.calls.every(call=>!call.init.method)).toBe(true);
 });
 it('supports a bounded WAV larger than8MiB without increasing the original upload limit',async()=>{
  const data=Buffer.alloc(8*1024*1024+1,7),c=client(missing(),json(metadata(wav,gen,data.length)),new Response(data,{headers:{'Content-Length':String(data.length)}}));
  await expect(c.objects.putArtifactOnce(wav,data)).resolves.toMatchObject({size:data.length,generation:gen});
  const original=client();await expect(original.objects.putOnce(chunk,data)).rejects.toMatchObject({code:'invalid'});expect(original.calls).toHaveLength(0);
 });
 it('rejects arbitrary result keys, traversal and writes through the wrong API before IO',async()=>{
  const c=client();for(const bad of [result+'unknown.txt',result+'../../video.mp4',result+'narration-en.mp4','candidate-files-v1/'+gen+'/results/x/narration-en.wav'])await expect(c.objects.putArtifactOnce(bad,Buffer.from('abcd'))).rejects.toMatchObject({code:'invalid'});
  await expect(c.objects.putArtifactOnce(chunk,Buffer.from('abcd'))).rejects.toMatchObject({code:'invalid'});
  await expect(c.objects.putOnce(text,Buffer.from('abcd'))).rejects.toMatchObject({code:'invalid'});
  await expect(c.objects.composeOnce(wav,[{key:chunk,generation:gen}],4)).rejects.toMatchObject({code:'invalid'});
  await expect(c.objects.composeOnce(final,[{key:text,generation:gen}],4)).rejects.toMatchObject({code:'invalid'});expect(c.calls).toHaveLength(0);
 });
 it('enforces per-artifact text/WAV bounds and never accepts a tombstone or changed replay',async()=>{
  const c=client();await expect(c.objects.putArtifactOnce(text,Buffer.alloc(256*1024+1))).rejects.toMatchObject({code:'invalid'});
  await expect(c.objects.putArtifactOnce(wav,Buffer.alloc(32*1024*1024+1))).rejects.toMatchObject({code:'invalid'});expect(c.calls).toHaveLength(0);
  const tombstone=client(json(metadata(text,gen,0,true)));await expect(tombstone.objects.putArtifactOnce(text,Buffer.from('abcd'))).rejects.toMatchObject({code:'conflict'});
  const altered=client(json(metadata(text,gen,4)),media('abce'));await expect(altered.objects.putArtifactOnce(text,Buffer.from('abcd'))).rejects.toMatchObject({code:'conflict'});
 });
 it('reads exact artifact generation/range and fences even an artifact never created',async()=>{
  const range=client(media('bc',206,{'Content-Range':'bytes 1-2/4'}));expect(await bytes(await range.objects.read({key:wav,size:4,generation:gen},{start:1,end:2}))).toBe('bc');
  const marker=client(missing(),json(metadata(text,gen,0,true)),json(metadata(text,gen,0,true)));await expect(marker.objects.barrier(text)).resolves.toMatchObject({key:text,marker:true,size:0});
  expect(marker.calls[1].url.searchParams.get('ifGenerationMatch')).toBe('0');expect(marker.calls.every(x=>x.init.method!=='DELETE')).toBe(true);
 });
});
