import{it,expect}from'vitest';import{recoverTextRequest}from'./textRequest';
it('recovers lost POST and GET with one identity while an older terminal job stays visible',async()=>{
 const key={current:'request-1'};const jobs=new Map<string,{id:string}>();const seen:string[]=[];
 let losePost=true,loseGet=true;let visible:any={job:{id:'old-job',state:'cancelled'}};
 const api={async start(_revision:number,requestKey:string){seen.push(requestKey);if(!jobs.has(requestKey))jobs.set(requestKey,{id:'new-job'});
  if(losePost){losePost=false;throw new Error('POST response lost after creation');}return jobs.get(requestKey)!;},
  async get(id:string){if(loseGet){loseGet=false;throw new Error('GET unavailable');}return {job:{id,state:'running'}};}};
 const install=(data:any)=>{expect(key.current).toBe('request-1');visible=data;};
 await expect(recoverTextRequest(api,4,key,install)).rejects.toThrow();expect(key.current).toBe('request-1');expect(visible.job.id).toBe('old-job');
 await expect(recoverTextRequest(api,4,key,install)).rejects.toThrow();expect(key.current).toBe('request-1');expect(visible.job.id).toBe('old-job');
 await recoverTextRequest(api,4,key,install);
 expect(seen).toEqual(['request-1','request-1','request-1']);expect(jobs.size).toBe(1);expect(visible.job.id).toBe('new-job');expect(key.current).not.toBe('request-1');
});
