import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';

export interface CloudObject {key: string; generation: string; size: number; marker?:true}
export interface ObjectSource {key: string; generation: string}
export interface CloudObjects {
  metadata(key: string): Promise<CloudObject | null>;
  putOnce(key: string, bytes: Buffer): Promise<CloudObject>;
  // Optional for original-upload test doubles; AI runtimes must require this capability.
  putArtifactOnce?(key: string, bytes: Buffer): Promise<CloudObject>;
  composeOnce(key: string, sources: readonly ObjectSource[], size: number): Promise<CloudObject>;
  read(object: CloudObject, range?: {start: number; end: number}): Promise<Readable>;
  barrier(key: string): Promise<CloudObject>;
}
export class ObjectFault extends Error {
  constructor(readonly code: 'invalid' | 'conflict' | 'missing' | 'remote', readonly status?: number) {super(code);}
}
const idPattern = '[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';
export const objectPrefix = 'candidate-files-v1/';
const originalKeyPattern=new RegExp('^'+objectPrefix+idPattern+'/(?:chunks/\\d{4}|groups/\\d{4}|video\\.mp4)$');
const artifactKeyPattern=new RegExp('^'+objectPrefix+idPattern+'/results/'+idPattern+'/(?:transcript-es\\.txt|transcript-es\\.srt|translation-en\\.txt|translation-en\\.srt|cues\\.json|narration-en\\.wav)$');
function key(value: string) {
  if (typeof value !== 'string' || !originalKeyPattern.test(value)&&!artifactKeyPattern.test(value)) throw new ObjectFault('invalid');
}
function generation(value: string) {if (typeof value !== 'string' || !/^[1-9]\d{0,30}$/.test(value)) throw new ObjectFault('invalid');}
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** Fixed private bucket and namespace. Tokens are supplied by managed identity/isolated ADC. */
export class GcsObjects implements CloudObjects {
  constructor(private readonly options: {accessToken: () => Promise<string>; request?: typeof fetch;
    bucket: 'vistavo-prod-107404655346-media'; projectId: 'vistavo-prod'}) {
    if (options.bucket !== 'vistavo-prod-107404655346-media' || options.projectId !== 'vistavo-prod') throw new ObjectFault('invalid');
  }
  private url(name: string, upload = false) {
    key(name);return new URL(`https://storage.googleapis.com/${upload?'upload/':''}storage/v1/b/${this.options.bucket}/o${upload?'':'/'+encodeURIComponent(name)}`);
  }
  private async call(url: URL, init: RequestInit = {}, timeoutMs=120000) {
    if (url.origin !== 'https://storage.googleapis.com') throw new ObjectFault('invalid');
    let timer:ReturnType<typeof setTimeout>|undefined;
    try {
      const token = await Promise.race([this.options.accessToken(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new ObjectFault('remote')),20000);timer.unref();})]);
      clearTimeout(timer);
      return await (this.options.request??fetch)(url,{...init,headers:{...init.headers,Authorization:'Bearer '+token,
        'x-goog-user-project':this.options.projectId},signal:AbortSignal.timeout(timeoutMs)});
    } catch {throw new ObjectFault('remote');}finally{clearTimeout(timer);}
  }
  private decode(data: Record<string,unknown>, expected: string): CloudObject {
    if (data.name !== expected || data.bucket !== this.options.bucket || typeof data.generation !== 'string') throw new ObjectFault('remote');
    generation(data.generation);const size=Number(data.size);
    if (!Number.isSafeInteger(size)||size<0)throw new ObjectFault('remote');
    const marker=(data.metadata as Record<string,unknown>|undefined)?.vistavoMarker==='v1'&&data.contentType==='application/x-vistavo-tombstone';
    return {key:expected,generation:data.generation,size,...(marker?{marker:true as const}:{})};
  }
  async metadata(name: string) {
    const response=await this.call(this.url(name));
    if(response.status===404)return null;
    if(!response.ok)throw new ObjectFault('remote',response.status);
    return this.decode(await response.json(),name);
  }
  async read(object: CloudObject, range?: {start:number;end:number}) {
    generation(object.generation);
    if(range&&(!Number.isSafeInteger(range.start)||!Number.isSafeInteger(range.end)||range.start<0||range.end<range.start||range.end>=object.size))throw new ObjectFault('invalid');
    const url=this.url(object.key);url.searchParams.set('alt','media');url.searchParams.set('generation',object.generation);
    const response=await this.call(url,{headers:{'Accept-Encoding':'identity',...(range?{Range:`bytes=${range.start}-${range.end}`}:{})}},290000);
    if(response.status===404)throw new ObjectFault('missing');
    if(response.status!==(range?206:200)||!response.body)throw new ObjectFault('remote',response.status);
    const length=range?range.end-range.start+1:object.size;
    if(response.headers.get('content-length')!==String(length))throw new ObjectFault('remote');
    if(range&&response.headers.get('content-range')!==`bytes ${range.start}-${range.end}/${object.size}`)throw new ObjectFault('remote');
    return Readable.fromWeb(response.body as unknown as Parameters<typeof Readable.fromWeb>[0]);
  }
  async putOnce(name:string,bytes:Buffer) {
    if(typeof name!=='string'||!originalKeyPattern.test(name)||!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>8*1024*1024)throw new ObjectFault('invalid');
    return this.putImmutable(name,bytes);
  }
  async putArtifactOnce(name:string,bytes:Buffer) {
    if(typeof name!=='string'||!artifactKeyPattern.test(name))throw new ObjectFault('invalid');
    const max=name.endsWith('/narration-en.wav')?32*1024*1024:256*1024;
    if(!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>max)throw new ObjectFault('invalid');
    return this.putImmutable(name,bytes);
  }
  private async putImmutable(name:string,bytes:Buffer) {
    const previous=await this.metadata(name);
    if(previous){await this.verifyBytes(previous,bytes);return previous;}
    const url=this.url(name,true);url.searchParams.set('uploadType','media');url.searchParams.set('name',name);url.searchParams.set('ifGenerationMatch','0');
    const response=await this.call(url,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:bytes as unknown as BodyInit});
    let object:CloudObject;
    if(response.ok)object=this.decode(await response.json(),name);
    else if(response.status===412){const previous=await this.metadata(name);if(!previous)throw new ObjectFault('remote');object=previous;}
    else throw new ObjectFault('remote',response.status);
    await this.verifyBytes(object,bytes);return object;
  }
  private async verifyBytes(object:CloudObject,bytes:Buffer){
    if(object.size!==bytes.length||object.marker)throw new ObjectFault('conflict');
    const hash=createHash('sha256');let size=0;
    for await(const part of await this.read(object)){size+=part.length;if(size>bytes.length)throw new ObjectFault('conflict');hash.update(part);}
    if(size!==bytes.length||hash.digest('hex')!==sha(bytes))throw new ObjectFault('conflict');
  }
  async composeOnce(name:string,sources:readonly ObjectSource[],size:number){
    if(typeof name!=='string'||!originalKeyPattern.test(name)||!sources.length||sources.length>32||!Number.isSafeInteger(size)||size<1)throw new ObjectFault('invalid');
    for(const source of sources){if(typeof source.key!=='string'||!originalKeyPattern.test(source.key))throw new ObjectFault('invalid');generation(source.generation);}
    const previous=await this.metadata(name);if(previous){if(previous.size!==size||previous.marker)throw new ObjectFault('conflict');return previous;}
    const url=this.url(name);url.pathname+='/compose';url.searchParams.set('ifGenerationMatch','0');
    const response=await this.call(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      sourceObjects:sources.map(source=>({name:source.key,generation:source.generation})),destination:{contentType:'video/mp4'}})});
    let result:CloudObject|null;
    if(response.ok)result=this.decode(await response.json(),name);
    else if(response.status===412)result=await this.metadata(name);
    else throw new ObjectFault('remote',response.status);
    if(!result||result.size!==size)throw new ObjectFault('conflict');return result;
  }
  /** A live zero-byte marker fences all old ifGenerationMatch=0 writers. Never delete it. */
  async barrier(name:string){
    for(let attempt=0;attempt<4;attempt++){
      const current=await this.metadata(name);if(current?.size===0&&current.marker)return current;
      const url=this.url(name,true);url.searchParams.set('uploadType','multipart');url.searchParams.set('name',name);
      url.searchParams.set('ifGenerationMatch',current?.generation??'0');
      const boundary='vistavo-marker-boundary';
      const metadata={name,contentType:'application/x-vistavo-tombstone',metadata:{vistavoMarker:'v1'}};
      const body=`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/x-vistavo-tombstone\r\n\r\n\r\n--${boundary}--\r\n`;
      const response=await this.call(url,{method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body});
      if(response.status===412)continue;
      if(!response.ok)throw new ObjectFault('remote',response.status);
      const result=this.decode(await response.json(),name);if(result.size!==0)throw new ObjectFault('remote');
      const verified=await this.metadata(name);if(verified?.size===0&&verified.marker&&verified.generation===result.generation)return verified;
    }
    throw new ObjectFault('conflict');
  }
}
