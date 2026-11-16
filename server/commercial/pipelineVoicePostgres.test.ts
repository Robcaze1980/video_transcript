import {randomUUID} from 'node:crypto';
import {readFile,mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Pool} from 'pg';
import {afterAll,beforeAll,beforeEach,describe,it,expect,vi} from 'vitest';
import {CommercialJobs,JobError,type JobFiles} from './jobs';
import {PipelineVoiceService} from './pipelineVoiceService';
import {PrivateFileStore} from './privateFileStore';
import {VoiceOutcomeUnknown} from './pipelineVoiceProvider';
import {startPilot} from './pilotHttp';
import {createSimulatedPayments} from './pilotPayments';
const database=process.env.LINGUISTVISION_TEST_DATABASE_URL;
const schema='lv_voice_'+randomUUID().replaceAll('-','');
const draft='1\n00:00:00,000 --> 00:00:01,000\nElena Robles checks five centimeters.\n';
const pcm=()=>{const b=Buffer.alloc(48000);for(let i=0;i<24000;i++)b.writeInt16LE(i%1500-750,i*2);return b;};
describe.skipIf(!database)('private English narration PostgreSQL and disk',()=>{
 let admin:Pool,pool:Pool,jobs:CommercialJobs,service:PipelineVoiceService,files:PrivateFileStore,root:string;
 let account:string,other:string,project:string;
 let synthesize=vi.fn();
 beforeAll(async()=>{
  admin=new Pool({connectionString:database});await admin.query('CREATE SCHEMA '+schema);
  pool=new Pool({connectionString:database,options:'-c search_path='+schema});
  for(const name of ['schema.sql','pipelineMigration.sql','pipelineTextMigration.sql','migrations/0016c_voice.sql','migrations/0016c_voice.sql'])await pool.query(await readFile(new URL('./'+name,import.meta.url),'utf8'));
  root=await realpath(await mkdtemp(join(tmpdir(),'lv-voice-')));files=new PrivateFileStore(root);
 });
 beforeEach(async()=>{
  await pool.query('TRUNCATE accounts CASCADE');
  await pool.query('DELETE FROM pipeline_voice_reservations; DELETE FROM pipeline_voice_tombstones');
  jobs=new CommercialJobs(pool,new Map(),{async get(a:string,id:string){
   if(a!==account||id!==project)throw new JobError('not_found','Unavailable');
   return {id,path:'synthetic',size:2000000,name:'fixture.mp4',expiresAt:new Date(Date.now()+3600000),metadata:{duration:120,width:1280,height:720,audioTracks:1}};
  },async getWithClient(_c:any,a:string,id:string){return this.get(a,id);}} as unknown as JobFiles);
  account=await jobs.createAccount();other=await jobs.createAccount();project=await jobs.addInput(account,Buffer.from('fixture'));
  await pool.query('UPDATE inputs SET content=NULL,private_upload_id=id WHERE id=$1',[project]);
  await jobs.createSubtitleProject(account,project,'Synthetic',120,draft);
  synthesize=vi.fn(async()=>({l16:pcm()}));service=new PipelineVoiceService(pool,jobs,files,{synthesize:(...args)=>synthesize(...args)});
 });
 afterAll(async()=>{await pool?.end();if(admin){await admin.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');await admin.end();}if(root)await rm(root,{recursive:true,force:true});});
 const request=(voice='Kore',key=randomUUID())=>service.request(account,project,voice,1,key);
 it.each(['Kore','Charon'])('publishes %s saved English once, serves RIFF, preserves draft and zero ledger',async voice=>{
  const key=randomUUID(),job=await request(voice,key);expect((await request(voice,key)).id).toBe(job.id);
  await service.runOnce();await service.runOnce();expect(synthesize).toHaveBeenCalledTimes(1);
  expect(synthesize.mock.calls[0][0]).toMatchObject({text:'Elena Robles checks five centimeters.',voiceId:voice});
  const view=(await service.get(account,job.id))!;expect(view.job.state).toBe('succeeded');expect(view.narration).toMatchObject({voiceId:voice,current:true,durationMs:1000});
  const audio=await service.audio(account,job.id);const chunks=[];for await(const b of audio.stream)chunks.push(b);expect(Buffer.concat(chunks).toString('ascii',0,4)).toBe('RIFF');
  expect((await jobs.subtitleProject(account,project))?.draft).toBe(draft);
  expect((await pool.query('SELECT count(*)::int n FROM credit_movements')).rows[0].n).toBe(0);
 });
 it('denies foreign ownership and unsupported voice before synthesis',async()=>{
  const job=await request();expect(await service.get(other,job.id)).toBeNull();
  await expect(service.audio(other,job.id)).rejects.toMatchObject({code:'not_found'});
  await expect(service.cancel(other,job.id)).rejects.toMatchObject({code:'not_found'});
  await expect(service.request(other,project,'Kore',1,randomUUID())).rejects.toMatchObject({code:'not_found'});
  await expect(request('Puck')).rejects.toMatchObject({code:'invalid_input'});expect(synthesize).not.toHaveBeenCalled();
 });
 it('invalidates changed revision and never publishes stale audio',async()=>{
  const job=await request();await jobs.saveSubtitleProject(account,project,1,draft.replace('five','six'));
  await service.runOnce();expect((await service.get(account,job.id))?.narration).toBeNull();expect(synthesize).not.toHaveBeenCalled();
 });
 it('keeps historical audio explicitly stale after a later save',async()=>{
  const job=await request();await service.runOnce();await jobs.saveSubtitleProject(account,project,1,draft.replace('five','six'));
  expect((await service.get(account,job.id))?.narration?.current).toBe(false);
 });
 it('cancels an in-flight provider and fences its late result',async()=>{
  let finish:(v:any)=>void=()=>{},signal:AbortSignal|undefined;
  synthesize.mockImplementation(async r=>{signal=r.signal;return new Promise(resolve=>finish=resolve);});
  const job=await request(),running=service.runOnce();for(let n=0;n<100&&!signal;n++)await new Promise(r=>setTimeout(r,5));
  await service.cancel(account,job.id);expect(signal?.aborted).toBe(true);finish({l16:pcm()});await running;
  expect((await service.get(account,job.id))?.job.state).toBe('cancelled');expect((await service.get(account,job.id))?.narration).toBeNull();await service.reconcile();
  expect((await pool.query('SELECT count(*)::int n FROM pipeline_voice_reservations')).rows[0].n).toBe(0);
 });
 it('never retries an uncertain billed request',async()=>{
  synthesize.mockRejectedValue(new VoiceOutcomeUnknown('network'));const job=await request();await service.runOnce();await service.runOnce();
  expect((await service.get(account,job.id))?.job.state).toBe('unknown');expect(synthesize).toHaveBeenCalledTimes(1);await service.reconcile();
 });
 it('bounds quota atomically under three simultaneous 32MiB reservations',async()=>{
  const job=await request();const ids=[randomUUID(),randomUUID(),randomUUID()];
  const results=await Promise.allSettled(ids.map(id=>pool.query('SELECT pipeline_voice_reserve($1,$2,$3,$4,$5)',[account,job.id,id,32*1024*1024,new Date(Date.now()+60000)])));
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(2);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
 });
 it('counts retained committed bytes against account quota',async()=>{
  const job=await request();await service.runOnce();
  await pool.query('SELECT pipeline_voice_reserve($1,$2,$3,$4,$5)',[account,job.id,randomUUID(),33554432,new Date(Date.now()+60000)]);
  await expect(pool.query('SELECT pipeline_voice_reserve($1,$2,$3,$4,$5)',[account,job.id,randomUUID(),33554432,new Date(Date.now()+60000)])).rejects.toMatchObject({code:'23514'});
 });
 it('deletes physical audio after project cascade through durable tombstone',async()=>{
  const job=await request();await service.runOnce();const id=(await pool.query('SELECT storage_id FROM pipeline_narrations WHERE job_id=$1',[job.id])).rows[0].storage_id;
  await pool.query('DELETE FROM subtitle_projects WHERE id=$1',[project]);expect(await files.size(id)).toBeGreaterThan(44);await service.reconcile();await expect(files.size(id)).rejects.toMatchObject({code:'ENOENT'});
 });
 it('retains failed deletion intent and succeeds on next sweep',async()=>{
  await request();await service.runOnce();await pool.query('DELETE FROM pipeline_narrations');
  const remove=vi.spyOn(files,'remove').mockRejectedValueOnce(new Error('busy'));
  await expect(service.reconcile()).rejects.toThrow('busy');expect((await pool.query('SELECT count(*)::int n FROM pipeline_voice_tombstones')).rows[0].n).toBe(1);
  expect((await pool.query('SELECT count(*)::int n FROM pipeline_voice_reservations')).rows[0].n).toBe(1);
  remove.mockRestore();await service.reconcile();expect((await pool.query('SELECT count(*)::int n FROM pipeline_voice_tombstones')).rows[0].n).toBe(0);
 });
 it('does not sweep a live reservation, but removes crash bytes after cancellation',async()=>{
  const job=await request();const attempt=(await service.store.claimNext('narration','gemini-3.8-flash-tts'))!;const id=randomUUID();
  await pool.query('SELECT pipeline_voice_reserve($1,$2,$3,$4,$5)',[account,job.id,id,33554432,attempt.expiresAt]);await files.append(id,0,0,Buffer.from('partial'));
  await service.reconcile();expect(await files.size(id)).toBe(7);await service.cancel(account,job.id);await service.reconcile();await expect(files.size(id)).rejects.toMatchObject({code:'ENOENT'});
 });
 it('expires audio without extending its input TTL',async()=>{
  const job=await request();await service.runOnce();await pool.query("UPDATE pipeline_narrations SET expires_at=clock_timestamp()-interval '1 second'");
  await expect(service.audio(account,job.id)).rejects.toMatchObject({code:'not_found'});await service.reconcile();expect((await pool.query('SELECT count(*)::int n FROM pipeline_narrations')).rows[0].n).toBe(0);
 });
 it('recovers a failed durable write without publishing ready metadata',async()=>{
  const append=vi.spyOn(files,'append').mockRejectedValueOnce(new Error('disk full'));
  const job=await request();await service.runOnce();append.mockRestore();
  expect((await service.get(account,job.id))?.job.state).toBe('failed');
  expect((await pool.query("SELECT count(*)::int n FROM pipeline_artifacts WHERE state='ready'")).rows[0].n).toBe(0);
  await service.reconcile();expect((await pool.query('SELECT count(*)::int n FROM pipeline_voice_reservations')).rows[0].n).toBe(0);
 });
 it('keeps recovery fenced while the writer holds its reservation lock',async()=>{
  const job=await request(),attempt=(await service.store.claimNext('narration','gemini-3.8-flash-tts'))!,id=randomUUID();
  await pool.query('SELECT pipeline_voice_reserve($1,$2,$3,$4,$5)',[account,job.id,id,33554432,attempt.expiresAt]);
  await files.append(id,0,0,Buffer.from('partial'));await service.cancel(account,job.id);
  const writer=await pool.connect();try{await writer.query('BEGIN');await writer.query('SELECT 1 FROM pipeline_voice_reservations WHERE storage_id=$1 FOR UPDATE',[id]);
   await service.reconcile();expect(await files.size(id)).toBe(7);
  }finally{await writer.query('ROLLBACK');writer.release();}
  await service.reconcile();await expect(files.size(id)).rejects.toMatchObject({code:'ENOENT'});
 });
 it('exposes only private routes with origin/body guards and valid audio ranges',async()=>{
  let providerEntered=false,signalEntered!:()=>void,releaseProvider!:()=>void;
  const entered=new Promise<void>(resolve=>{signalEntered=resolve;}),providerGate=new Promise<void>(resolve=>{releaseProvider=resolve;});
  synthesize.mockImplementationOnce(async()=>{providerEntered=true;signalEntered();await providerGate;return {l16:pcm()};});
  const first='a'.repeat(40),second='b'.repeat(40);const pilot=await startPilot({pool,invitations:new Map([[first,account],[second,other]]),services:[],payments:createSimulatedPayments(),port:0,voicePipeline:service,
    editorAssets:new URL('../../dist/pilot-editor/',import.meta.url)});
  try{
   async function login(code:string){const r=await fetch(pilot.origin+'/pilot/api/login',{method:'POST',headers:{Origin:pilot.origin,'Content-Type':'application/json'},body:JSON.stringify({code})});return r.headers.get('set-cookie')!.split(';')[0];}
   const cookie=await login(first),foreign=await login(second);
   const call=(path:string,body?:unknown,session=cookie,origin=pilot.origin,range?:string)=>fetch(pilot.origin+'/pilot/api/'+path,{method:body===undefined?'GET':'POST',headers:{Cookie:session,Origin:origin,'Content-Type':'application/json',...(range?{Range:range}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
   const r=await call('projects/'+project+'/voice/Charon',{revision:1,requestKey:'http',text:'ignored',model:'attacker'});expect(r.status).toBe(202);const job=await r.json();expect(job.config.model).toBe('gemini-3.8-flash-tts');
   for(let n=0;n<100&&!providerEntered;n++){const view=await (await call('voice-jobs/'+job.id)).json();expect(['queued','running']).toContain(view.job.state);await new Promise(resolve=>setTimeout(resolve,10));}
   expect(providerEntered).toBe(true);await entered;
   expect((await call('voice-jobs/'+job.id,undefined,foreign)).status).toBe(404);expect((await call('voice-jobs/'+job.id,undefined,'')).status).toBe(401);
   expect((await call('voice-jobs/'+job.id+'/cancel',{},cookie,'https://invalid.example')).status).toBe(403);
   expect((await call('projects/'+project+'/voice/Kore',{data:'x'.repeat(5000)})).status).toBe(413);
   await service.runOnce();const url='voice-jobs/'+job.id+'/audio.wav';
   expect(synthesize).toHaveBeenCalledTimes(1);expect((await (await call('voice-jobs/'+job.id)).json()).job.state).toBe('running');const pending=await call(url);expect(pending.status).toBe(404);await pending.text();
   releaseProvider();
   let published=false;for(let n=0;n<100;n++){const status=await call('voice-jobs/'+job.id);expect(status.status).toBe(200);const view=await status.json();if(view.job.state==='succeeded'){expect(view.narration).not.toBeNull();published=true;break;}expect(view.job.state).toBe('running');await new Promise(resolve=>setTimeout(resolve,10));}
   expect(published).toBe(true);expect(synthesize).toHaveBeenCalledTimes(1);
   const audio=await call(url);expect(audio.status).toBe(200);expect(audio.headers.get('content-type')).toBe('audio/wav');expect(audio.headers.get('cache-control')).toBe('no-store');
   expect((await call(url,undefined,foreign)).status).toBe(404);
   const part=await call(url,undefined,cookie,pilot.origin,'bytes=0-3');expect(part.status).toBe(206);expect(await part.text()).toBe('RIFF');
   for(const range of ['bytes=999999-','bytes=3-1','bytes=0-1,4-5','bytes=-0'])expect((await call(url,undefined,cookie,pilot.origin,range)).status).toBe(416);
   expect((await call(url,undefined,cookie,pilot.origin,'bytes=-4')).status).toBe(206);
  }finally{releaseProvider();await pilot.close();}
 });
});
