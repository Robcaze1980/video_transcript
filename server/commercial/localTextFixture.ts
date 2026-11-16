import type {Firestore,DocumentReference} from 'firebase-admin/firestore';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {privateUuid} from './privateObjectPlan';

const sampleEs='El técnico revisa la bomba de agua y confirma que no hay fugas.';
const sampleEn='The technician checks the water pump and confirms there are no leaks.';
const filename=/^(transcript-es\.txt|transcript-es\.srt|translation-en\.txt|translation-en\.srt)$/;
type Fixture={accountId:string;inputId:string;revision:number;phase:'transcribed'|'reviewed'|'translated';transcriptEs:string;transcriptSrt:string;reviewedEs?:string;translationEn?:string;translationSrt?:string;updatedAtMs:number};
type Send=(status:number,data:unknown)=>void;
type ReadBody=(req:IncomingMessage,allowed:readonly string[])=>Promise<any>;

/** Emulator-only deterministic copy fixture. It never reads media bytes or calls a provider. */
export class LocalTextFixture {
 constructor(private readonly db:Firestore,private readonly root:DocumentReference){}
 private ref(inputId:string){return this.root.collection('textFixtures').doc(inputId);}
 private inputRef(inputId:string){return this.root.collection('inputs').doc(inputId);}
 private ready(value:any,accountId:string,inputId:string){
  return !!value&&value.accountId===accountId&&!value.deleted&&value.ready===true&&value.expiresAtMs>Date.now()&&
   Number.isFinite(value.metadata?.duration)&&value.metadata.duration>0&&value.metadata.duration<=600&&
   !!value.storage&&value.storage.key&&value.storage.generation;
 }
 private srt(text:string,duration:number){
  const ms=Math.max(1,Math.min(600000,Math.floor(duration*1000))),hours=Math.floor(ms/3600000),minutes=Math.floor(ms%3600000/60000),seconds=Math.floor(ms%60000/1000),tail=ms%1000;
  const stamp=`${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')},${String(tail).padStart(3,'0')}`;
  return `1\n00:00:00,000 --> ${stamp}\n${text}\n`;
 }
 async purge(accountId:string,inputId:string){
  if(!privateUuid.test(inputId))return;
  const ref=this.ref(inputId);
  await this.db.runTransaction(async tx=>{const doc=await tx.get(ref);if(!doc.exists)return;if(doc.get('accountId')!==accountId||doc.get('inputId')!==inputId)throw Error('Local fixture ownership mismatch');tx.delete(ref);});
 }
 async handle(req:IncomingMessage,res:ServerResponse,accountId:string,body:ReadBody,send:Send){
  const url=new URL(req.url??'/','http://127.0.0.1:3005'),path=url.pathname;
  if(path==='/api/cloud/text-fixture/transcribe'&&req.method==='POST'){
   const data=await body(req,['inputId']);if(typeof data.inputId!=='string'||!privateUuid.test(data.inputId)){send(404,{error:'not_found'});return true;}
   const inputRef=this.inputRef(data.inputId),ref=this.ref(data.inputId),result=await this.db.runTransaction(async tx=>{
    const [inputDoc,priorDoc]=await tx.getAll(inputRef,ref),input=inputDoc.data(),prior=priorDoc.data() as Fixture|undefined;
    if(!this.ready(input,accountId,data.inputId))return null;
    if(prior){if(prior.accountId!==accountId||prior.inputId!==data.inputId)return null;return prior;}
    const value:Fixture={accountId,inputId:data.inputId,revision:1,phase:'transcribed',transcriptEs:sampleEs,transcriptSrt:this.srt(sampleEs,input.metadata.duration),updatedAtMs:Date.now()};tx.create(ref,value);return value;
   });
   if(!result){send(404,{error:'not_found'});return true;}
   send(200,{revision:result.revision,phase:result.phase,transcriptEs:result.transcriptEs,transcriptSrt:result.transcriptSrt,source:'local-deterministic-fixture'});return true;
  }
  const route=/^\/api\/cloud\/text-fixture\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})(?:\/review|\/translate|\/results\/([a-z.-]+))?$/.exec(path);
  if(!route)return false;
  const inputId=route[1],inputRef=this.inputRef(inputId),ref=this.ref(inputId),action=path.slice(`/api/cloud/text-fixture/${inputId}`.length);
  const snapshot=()=>this.db.runTransaction(async tx=>{const [inputDoc,fixtureDoc]=await tx.getAll(inputRef,ref),input=inputDoc.data(),fixture=fixtureDoc.data() as Fixture|undefined;
   if(!this.ready(input,accountId,inputId)||!fixture||fixture.accountId!==accountId||fixture.inputId!==inputId)return null;return {input,fixture};});
  if(!action&&req.method==='GET'){
   const current=await snapshot();if(!current){send(404,{error:'not_found'});return true;}const f=current.fixture;
   send(200,{revision:f.revision,phase:f.phase,transcriptEs:f.transcriptEs,reviewedEs:f.reviewedEs??null,translationEn:f.translationEn??null,source:'local-deterministic-fixture'});return true;
  }
  if(action==='/review'&&req.method==='PUT'){
   const data=await body(req,['reviewedEs','expectedRevision']);if(typeof data.reviewedEs!=='string'||!data.reviewedEs.trim()||data.reviewedEs.length>4000||!Number.isSafeInteger(data.expectedRevision)||data.expectedRevision<1){send(400,{error:'invalid'});return true;}
   const result=await this.db.runTransaction(async tx=>{const [inputDoc,doc]=await tx.getAll(inputRef,ref),input=inputDoc.data(),f=doc.data() as Fixture|undefined;
    if(!this.ready(input,accountId,inputId)||!f||f.accountId!==accountId||f.inputId!==inputId)return {kind:'not_found' as const};
    if(f.revision!==data.expectedRevision)return {kind:'conflict' as const};
    const value={...f,revision:f.revision+1,phase:'reviewed' as const,reviewedEs:data.reviewedEs.trim(),translationEn:null,translationSrt:null,updatedAtMs:Date.now()};tx.set(ref,value);return {kind:'ok' as const,value};});
   if(result.kind!=='ok'){send(result.kind==='conflict'?409:404,{error:result.kind==='conflict'?'revision_conflict':'not_found'});return true;}
   send(200,{revision:result.value.revision,phase:result.value.phase,reviewedEs:result.value.reviewedEs});return true;
  }
  if(action==='/translate'&&req.method==='POST'){
   const data=await body(req,['expectedRevision']);if(!Number.isSafeInteger(data.expectedRevision)||data.expectedRevision<1){send(400,{error:'invalid'});return true;}
   const result=await this.db.runTransaction(async tx=>{const [inputDoc,doc]=await tx.getAll(inputRef,ref),input=inputDoc.data(),f=doc.data() as Fixture|undefined;
    if(!this.ready(input,accountId,inputId)||!f||f.accountId!==accountId||f.inputId!==inputId)return {kind:'not_found' as const};
    if(f.revision!==data.expectedRevision)return {kind:'conflict' as const};if(f.phase!=='reviewed'||!f.reviewedEs)return {kind:'review_required' as const};
    const text=f.reviewedEs===sampleEs?sampleEn:`Local translation fixture for reviewed Spanish text: ${f.reviewedEs}`;
    const value={...f,revision:f.revision+1,phase:'translated' as const,translationEn:text,translationSrt:this.srt(text,input.metadata.duration),updatedAtMs:Date.now()};tx.set(ref,value);return {kind:'ok' as const,value};});
   if(result.kind!=='ok'){const status=result.kind==='not_found'?404:result.kind==='conflict'?409:409;send(status,{error:result.kind});return true;}
   send(200,{revision:result.value.revision,phase:result.value.phase,translationEn:result.value.translationEn,source:'local-deterministic-fixture'});return true;
  }
  if(route[2]&&['GET','HEAD'].includes(req.method??'')){
   if(!filename.test(route[2])){send(404,{error:'not_found'});return true;}const current=await snapshot();if(!current){send(404,{error:'not_found'});return true;}
   const f=current.fixture,contents:Record<string,string>={'transcript-es.txt':f.transcriptEs+'\n','transcript-es.srt':f.transcriptSrt};
   if(f.phase==='translated'&&f.translationEn&&f.translationSrt){contents['translation-en.txt']=f.translationEn+'\n';contents['translation-en.srt']=f.translationSrt;}
   const value=contents[route[2]];if(!value){send(404,{error:'not_found'});return true;}
   const bytes=Buffer.from(value,'utf8');res.writeHead(200,{'Content-Type':route[2].endsWith('.srt')?'application/x-subrip; charset=utf-8':'text/plain; charset=utf-8','Content-Length':String(bytes.length),'Content-Disposition':`attachment; filename="${route[2]}"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Vistavo-Fixture':'local-deterministic-fixture'});res.end(req.method==='HEAD'?undefined:bytes);return true;
  }
  send(404,{error:'not_found'});return true;
 }
}
