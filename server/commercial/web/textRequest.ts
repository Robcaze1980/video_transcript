import type { TextPipelineApi } from './TextPipelineControls';
/** Rotate only after a response has been recovered and installed. A lost POST/GET keeps its identity. */
export async function recoverTextRequest(api:Pick<TextPipelineApi,'start'|'get'>,revision:number,key:{current:string},install:(data:any)=>void){
 const job=await api.start(revision,key.current);
 const data=await api.get(job.id);
 install(data);
 key.current=crypto.randomUUID();
}
