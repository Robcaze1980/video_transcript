import {objectPrefix} from './gcsObjects';

export const privateBucket = 'vistavo-prod-107404655346-media' as const;
export const privateChunkBytes = 8*1024*1024;
export interface ObjectPlan {chunks: string[]; groups: string[]; final: string}
export interface PrivateInputBinding {bucket: typeof privateBucket; key: string; generation: string; size: number; sha256: string}
export const privateUuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export const privateSha = /^[a-f0-9]{64}$/;
export function objectPlan(id:string,size:number,chunkBytes=privateChunkBytes):ObjectPlan {
  if(typeof id!=='string'||!privateUuid.test(id)||!Number.isSafeInteger(size)||size<1||size>500000000||
      !Number.isSafeInteger(chunkBytes)||chunkBytes<1||chunkBytes>privateChunkBytes)throw Error('Invalid object plan');
  const count=Math.ceil(size/chunkBytes);if(count>128)throw Error('Object plan too large');
  const root=objectPrefix+id+'/';
  return {chunks:Array.from({length:count},(_,i)=>root+'chunks/'+String(i).padStart(4,'0')),
    groups:count>32?Array.from({length:Math.ceil(count/32)},(_,i)=>root+'groups/'+String(i).padStart(4,'0')):[],final:root+'video.mp4'};
}
export function readyPrivateInput(input:unknown,id:string):input is {ready:true;sha256:string;storage:PrivateInputBinding} {
  const value=input as {ready?:unknown;sha256?:unknown;storage?:PrivateInputBinding};const s=value?.storage;
  return value?.ready===true&&typeof value.sha256==='string'&&privateSha.test(value.sha256)&&!!s&&
    s.bucket===privateBucket&&s.key===objectPrefix+id+'/video.mp4'&&typeof s.generation==='string'&&/^[1-9]\d{0,30}$/.test(s.generation)&&
    Number.isSafeInteger(s.size)&&s.size>0&&s.size<=500000000&&s.sha256===value.sha256;
}
