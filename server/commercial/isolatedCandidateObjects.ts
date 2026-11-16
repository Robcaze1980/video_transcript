import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {ObjectFault,type CloudObject,type CloudObjects,type ObjectSource} from './gcsObjects';
import {objectPrefix} from './gcsObjects';

type Entry={bytes:Buffer;generation:string;marker:boolean};
const keyPattern=new RegExp('^'+objectPrefix+'([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})/(?:chunks/\\d{4}|groups/\\d{4}|video\\.mp4)$');
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');

/** Ephemeral object adapter for synthetic files in the demo Firebase emulator only. */
export class IsolatedCandidateObjects implements CloudObjects {
  private readonly entries=new Map<string,Entry>();
  private generation=0n;
  private nextGeneration(){this.generation++;return this.generation.toString();}
  private validKey(key:string){if(typeof key!=='string'||!keyPattern.test(key))throw new ObjectFault('invalid');}
  private dto(key:string,value:Entry):CloudObject{return {key,generation:value.generation,size:value.bytes.length,...(value.marker?{marker:true as const}:{})};}
  private object(key:string){this.validKey(key);return this.entries.get(key);}
  async metadata(key:string){const value=this.object(key);return value?this.dto(key,value):null;}
  async putOnce(key:string,bytes:Buffer){
    this.validKey(key);if(!key.includes('/chunks/')||!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>8*1024*1024)throw new ObjectFault('invalid');
    const existing=this.entries.get(key);
    if(existing){if(existing.marker||!existing.bytes.equals(bytes))throw new ObjectFault('conflict');return this.dto(key,existing);}
    const value={bytes:Buffer.from(bytes),generation:this.nextGeneration(),marker:false};this.entries.set(key,value);return this.dto(key,value);
  }
  async composeOnce(key:string,sources:readonly ObjectSource[],size:number){
    this.validKey(key);if(!sources.length||sources.length>32||!Number.isSafeInteger(size)||size<1)throw new ObjectFault('invalid');
    const uploadId=key.slice(objectPrefix.length).split('/')[0];
    const prior=this.entries.get(key);if(prior){if(prior.marker||prior.bytes.length!==size)throw new ObjectFault('conflict');return this.dto(key,prior);}
    const parts:Buffer[]=[];let total=0;
    for(const source of sources){
      this.validKey(source.key);const sourceId=source.key.slice(objectPrefix.length).split('/')[0],entry=this.entries.get(source.key);
      if(sourceId!==uploadId||!entry||entry.marker||entry.generation!==source.generation)throw new ObjectFault('missing');
      total+=entry.bytes.length;if(total>size)throw new ObjectFault('conflict');parts.push(entry.bytes);
    }
    if(total!==size)throw new ObjectFault('conflict');
    const value={bytes:Buffer.concat(parts,total),generation:this.nextGeneration(),marker:false};this.entries.set(key,value);return this.dto(key,value);
  }
  async read(object:CloudObject,range?:{start:number;end:number}){
    const entry=this.object(object.key);if(!entry||entry.marker||entry.generation!==object.generation||entry.bytes.length!==object.size)throw new ObjectFault('missing');
    if(range&&(!Number.isSafeInteger(range.start)||!Number.isSafeInteger(range.end)||range.start<0||range.end<range.start||range.end>=entry.bytes.length))throw new ObjectFault('invalid');
    const bytes=range?entry.bytes.subarray(range.start,range.end+1):entry.bytes;
    return Readable.from([Buffer.from(bytes)]);
  }
  async barrier(key:string){
    this.validKey(key);const current=this.entries.get(key),value={bytes:Buffer.alloc(0),generation:this.nextGeneration(),marker:true};
    if(current?.marker)return this.dto(key,current);
    this.entries.set(key,value);return this.dto(key,value);
  }
  async digest(key:string){this.validKey(key);const value=this.entries.get(key);return value?sha(value.bytes):null;}
}
