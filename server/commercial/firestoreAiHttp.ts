import type {IncomingMessage,ServerResponse} from 'node:http';import {pipeline} from 'node:stream/promises';
import {FirestoreAi,AiFault} from './firestoreAi';
export async function aiHttp(req:IncomingMessage,res:ServerResponse,accountId:string,ai:FirestoreAi,
 body:(req:IncomingMessage,allowed:readonly string[])=>Promise<any>,send:(status:number,data:unknown)=>void){
 const url=new URL(req.url??'/','https://vistavo.app'),path=url.pathname;if(!path.startsWith('/api/cloud/ai/'))return false;
 await ai.enabled(accountId);
 if(path==='/api/cloud/ai/quote'&&req.method==='GET'){
  send(200,await ai.quote(accountId,url.searchParams.get('inputId')!,url.searchParams.get('operation'),Number(url.searchParams.get('revision'))));return true;
 }
 if(path==='/api/cloud/ai/jobs'&&req.method==='POST'){
  const data=await body(req,['inputId','operation','expectedRevision','requestKey']),jobId=await ai.enqueue(accountId,data.inputId,data.operation,data.expectedRevision,data.requestKey);
  // The durable outbox is dispatched by maintenance, never by this user request.
  send(202,{id:jobId});return true;
 }
 const job=/^\/api\/cloud\/ai\/jobs\/([a-f0-9-]{36})(?:\/results\/([a-z.-]+))?$/.exec(path);
 if(job){
  if(!job[2]&&req.method==='GET'){send(200,await ai.status(accountId,job[1]));return true;}
  if(!job[2]&&req.method==='DELETE'){await ai.status(accountId,job[1]);await ai.backend.cancel(accountId,job[1]);send(200,await ai.status(accountId,job[1]));return true;}
  if(job[2]&&['GET','HEAD'].includes(req.method!)){
   const value=await ai.download(accountId,job[1],job[2]),size=value.entry.size,etag='"'+value.entry.generation+'"';let range:{start:number;end:number}|undefined;
   const text=req.headers.range;if(text&&(!req.headers['if-range']||req.headers['if-range']===etag)){
    const match=/^bytes=(\d*)-(\d*)$/.exec(text);let start:number,end:number;
    if(!match||!match[1]&&!match[2]){res.writeHead(416,{'Content-Range':'bytes */'+size,'Cache-Control':'no-store'}).end();return true;}
    if(!match[1]){const count=Number(match[2]);start=Math.max(0,size-count);end=size-1;if(!Number.isSafeInteger(count)||count<1)start=size;}
    else{start=Number(match[1]);end=match[2]?Math.min(size-1,Number(match[2])):size-1;}
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start){res.writeHead(416,{'Content-Range':'bytes */'+size,'Cache-Control':'no-store'}).end();return true;}range={start,end};
   }
   const length=range?range.end-range.start+1:size,headers:Record<string,string>={'Content-Type':value.entry.mimeType,'Content-Disposition':`${url.searchParams.get('download')==='1'?'attachment':'inline'}; filename="${value.entry.name}"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes','ETag':etag,'X-Vistavo-Revision':String(value.revision)};
   if(length<=30*1024*1024||req.method==='HEAD')headers['Content-Length']=String(length);if(range)headers['Content-Range']=`bytes ${range.start}-${range.end}/${size}`;
   if(req.method==='HEAD'){res.writeHead(range?206:200,headers).end();return true;}const stream=await ai.objects.read(value.object,range);res.writeHead(range?206:200,headers);await pipeline(stream,res);return true;
  }
 }
 throw new AiFault('not_found');
}
