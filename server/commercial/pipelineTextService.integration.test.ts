import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { afterAll,beforeAll,beforeEach,describe,it,expect,vi } from 'vitest';
import { CommercialJobs,JobError,type JobFiles } from './jobs';
import { PipelineTextService } from './pipelineTextService';
import { startPilot } from './pilotHttp';
import { createSimulatedPayments } from './pilotPayments';
import { TextOutcomeUnknown } from './pipelineTextProvider';
const database=process.env.LINGUISTVISION_TEST_DATABASE_URL;
const schema='lv_text_'+randomUUID().replaceAll('-','');
const good=()=>({detectedLanguage:'es',hasSpeech:true,cues:[{startMs:500,endMs:2500,es:'Elena Robles: cinco centímetros.',en:'Elena Robles: five centimeters.'}]});
describe.skipIf(!database)('private bilingual text processing with PostgreSQL',()=>{
 let admin:Pool,pool:Pool,jobs:CommercialJobs,service:PipelineTextService,account:string,other:string,project:string;
 let generate=vi.fn();
 beforeAll(async()=>{admin=new Pool({connectionString:database});await admin.query('CREATE SCHEMA '+schema);
  pool=new Pool({connectionString:database,application_name:schema,options:'-c search_path='+schema});
  for(const file of ['schema.sql','pipelineMigration.sql','pipelineTextMigration.sql','pipelineTextMigration.sql'])await pool.query(await readFile(new URL('./'+file,import.meta.url),'utf8'));
 });
 beforeEach(async()=>{
  await pool.query('TRUNCATE accounts CASCADE');
  const files={async get(a:string,id:string){if(a!==account||id!==project)throw new JobError('not_found','Unavailable');return {id,path:'synthetic-not-read-by-fake-provider',size:2000000,name:'fixture.mp4',expiresAt:new Date(Date.now()+3600000),metadata:{duration:120,width:1280,height:720,audioTracks:1}};},async getWithClient(_c:any,a:string,id:string){return this.get(a,id);}} as unknown as JobFiles;
  jobs=new CommercialJobs(pool,new Map(),files);account=await jobs.createAccount();other=await jobs.createAccount();
  project=await jobs.addInput(account,Buffer.from('fixture'));
  await pool.query('UPDATE inputs SET content=NULL,private_upload_id=id WHERE id=$1',[project]);
  await jobs.createSubtitleProject(account,project,'Fixture',120,'');
  generate=vi.fn(async()=>good());service=new PipelineTextService(pool,jobs,{generate:(...args)=>generate(...args)},async(_file,cues)=>cues);
 });
 afterAll(async()=>{await pool?.end();if(admin){await admin.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');await admin.end();}});
 const request=()=>service.request(account,project,1,randomUUID());
 it('runs once, persists paired IDs/bytes, preserves editor until explicit idempotent apply',async()=>{
  const key=randomUUID();const job=await service.request(account,project,1,key);
  expect((await service.request(account,project,1,key)).id).toBe(job.id);
  await expect(request()).rejects.toMatchObject({code:'conflict'});
  await service.runOnce();await service.runOnce();expect(generate).toHaveBeenCalledTimes(1);
  expect((await jobs.subtitleProject(account,project))?.draft).toBe('');
  const loaded=(await new PipelineTextService(pool,jobs,{generate},async(_file,cues)=>cues).get(account,job.id))!;
  expect(loaded.job.state).toBe('succeeded');expect(loaded.result.cues[0].id).toMatch(/^[a-f0-9]{64}$/);
  for(const [kind,lang,fmt]of [['transcript_es','es','txt'],['translation_en','en','txt'],['subtitle_srt_en','en','srt']]as const){
   const bytes=await service.download(account,job.id,lang,fmt);const meta=loaded.job.artifacts.find(a=>a.kind===kind)!;
   expect(meta.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));expect(meta.byteSize).toBe(bytes.length);
  }
  expect(await service.apply(account,job.id)).toEqual({revision:2,appliedRevision:2});
  expect(await service.apply(account,job.id)).toEqual({revision:2,appliedRevision:2});
  expect((await jobs.subtitleProject(account,project))).toMatchObject({revision:2,segmentIds:{original:[loaded.result.cues[0].id],translated:[loaded.result.cues[0].id]}});
  expect((await service.get(account,job.id))?.job.stale).toBe(true);
  expect(await jobs.balance(account)).toEqual({available:0,reserved:0,consumed:0,credited:0});
  expect((await pool.query('SELECT count(*)::int n FROM credit_movements')).rows[0].n).toBe(0);
 });
 it('rejects foreign status/download/cancel/apply without provider invocation',async()=>{
  const job=await request();await expect(service.request(other,project,1,randomUUID())).rejects.toMatchObject({code:'not_found'});
  expect(await service.get(other,job.id)).toBeNull();
  for(const fn of [()=>service.cancel(other,job.id),()=>service.apply(other,job.id),()=>service.download(other,job.id,'en','srt')])await expect(fn()).rejects.toMatchObject({code:'not_found'});
  expect(generate).not.toHaveBeenCalled();
 });
 it('rolls back both text and ready metadata if content publication fails',async()=>{
  const job=await request();
  await pool.query(`CREATE FUNCTION reject_text_result() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected'; END; $$;
   CREATE TRIGGER reject_text BEFORE INSERT ON pipeline_text_results FOR EACH ROW EXECUTE FUNCTION reject_text_result()`);
  try{await service.runOnce();expect((await service.get(account,job.id))?.job.state).toBe('failed');
   expect((await pool.query("SELECT count(*)::int n FROM pipeline_artifacts WHERE state='ready'")).rows[0].n).toBe(0);
   expect((await pool.query('SELECT count(*)::int n FROM pipeline_text_results')).rows[0].n).toBe(0);
  }finally{await pool.query('DROP TRIGGER reject_text ON pipeline_text_results; DROP FUNCTION reject_text_result()');}
 });
 it.each(['wrong-language','silence','invalid-time','network'])('preserves original on %s',async kind=>{
  generate.mockImplementation(async()=>{if(kind==='network')throw new TextOutcomeUnknown();const r=good();if(kind==='wrong-language')r.detectedLanguage='en';if(kind==='silence')r.hasSpeech=false;if(kind==='invalid-time')r.cues[0].endMs=999999;return r;});
  const job=await request();await service.runOnce();
  expect((await service.get(account,job.id))?.job.state).toBe(kind==='network'?'unknown':'failed');
  await service.runOnce();expect(generate).toHaveBeenCalledTimes(1);
  expect((await jobs.subtitleProject(account,project))?.revision).toBe(1);
 });
 it('aborts cancellation and fences late provider results',async()=>{
  let finish:(value:unknown)=>void=()=>{};let signal:AbortSignal|undefined;
  generate.mockImplementation(async(_input:any,s:AbortSignal)=>{signal=s;return new Promise(resolve=>{finish=resolve;});});
  const job=await request();const running=service.runOnce();
  for(let n=0;n<100&&!signal;n++)await new Promise(r=>setTimeout(r,5));
  await service.cancel(account,job.id);expect(signal?.aborted).toBe(true);finish(good());await running;
  expect((await service.get(account,job.id))?.job.state).toBe('cancelled');expect((await service.get(account,job.id))?.result).toBeNull();
 });
 it('does not overwrite edits made before apply; receipt survives newer edits',async()=>{
  const job=await request();await service.runOnce();await jobs.saveSubtitleProject(account,project,1,'User correction');
  await expect(service.apply(account,job.id)).rejects.toMatchObject({code:'conflict'});
  expect((await jobs.subtitleProject(account,project))?.draft).toBe('User correction');
 });
 it('expires and deletes all derived text with its project',async()=>{
  const job=await request();await service.runOnce();await pool.query("UPDATE inputs SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[project]);
  await expect(service.apply(account,job.id)).rejects.toMatchObject({code:'not_found'});
  await expect(service.download(account,job.id,'en','txt')).rejects.toMatchObject({code:'not_found'});
  // Fake source store intentionally has no disk cleanup: legacy project cascade is the part under test.
  await pool.query('DELETE FROM subtitle_projects WHERE id=$1',[project]);
  expect((await pool.query('SELECT count(*)::int n FROM pipeline_text_results')).rows[0].n).toBe(0);
 });
 it('serves authenticated processing/apply/download routes and rejects origin/account/body attacks',async()=>{
  let providerEntered=false,signalEntered!:()=>void,releaseProvider!:()=>void;
  const entered=new Promise<void>(resolve=>{signalEntered=resolve;}),providerGate=new Promise<void>(resolve=>{releaseProvider=resolve;});
  generate.mockImplementationOnce(async()=>{providerEntered=true;signalEntered();await providerGate;return good();});
  const first='a'.repeat(40),second='b'.repeat(40);
  const pilot=await startPilot({pool,invitations:new Map([[first,account],[second,other]]),services:[],payments:createSimulatedPayments(),port:0,
    editorAssets:new URL('../../dist/pilot-editor/',import.meta.url),textPipeline:service});
  try{
   async function login(invitation:string){const r=await fetch(pilot.origin+'/pilot/api/login',{method:'POST',redirect:'manual',headers:{Origin:pilot.origin,'Content-Type':'application/json'},body:JSON.stringify({code:invitation})});return r.headers.get('set-cookie')!.split(';')[0];}
   const cookie=await login(first),foreign=await login(second);
   const call=(path:string,body?:unknown,session=cookie,origin=pilot.origin)=>fetch(pilot.origin+'/pilot/api/'+path,{method:body===undefined?'GET':'POST',headers:{Cookie:session,Origin:origin,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
   const posted=await call('projects/'+project+'/text',{revision:1,requestKey:'http',config:{model:'attacker'}});
   expect(posted.status).toBe(202);const job=await posted.json();expect(job.config.model).toBe('gemini-3.8-flash');
   for(let n=0;n<100&&!providerEntered;n++){const view=await (await call('text-jobs/'+job.id)).json();expect(['queued','running']).toContain(view.job.state);await new Promise(resolve=>setTimeout(resolve,10));}
   expect(providerEntered).toBe(true);await entered;
   expect((await call('text-jobs/'+job.id,undefined,foreign)).status).toBe(404);
   expect((await call('text-jobs/'+job.id,undefined,'')).status).toBe(401);
   expect((await call('text-jobs/'+job.id+'/cancel',{},cookie,'https://invalid.example')).status).toBe(403);
   expect((await call('projects/'+project+'/text',{data:'x'.repeat(5000)})).status).toBe(413);
   await service.runOnce();
   // The pilot already owns this invocation. A busy runOnce is not a completion barrier.
   expect(generate).toHaveBeenCalledTimes(1);expect((await (await call('text-jobs/'+job.id)).json()).job.state).toBe('running');
   const pending=await call('text-jobs/'+job.id+'/en.srt');expect(pending.status).toBe(404);await pending.text();
   releaseProvider();
   let published=false;for(let n=0;n<100;n++){const status=await call('text-jobs/'+job.id);expect(status.status).toBe(200);const view=await status.json();if(view.job.state==='succeeded'){expect(view.result).not.toBeNull();published=true;break;}expect(view.job.state).toBe('running');await new Promise(resolve=>setTimeout(resolve,10));}
   expect(published).toBe(true);expect(generate).toHaveBeenCalledTimes(1);
   const attachment=await call('text-jobs/'+job.id+'/en.srt');expect(attachment.status).toBe(200);expect(attachment.headers.get('cache-control')).toBe('no-store');expect(attachment.headers.get('x-content-type-options')).toBe('nosniff');
   expect((await call('text-jobs/'+job.id+'/apply',{data:'x'.repeat(5000)})).status).toBe(413);
   expect((await call('text-jobs/'+job.id+'/cancel',{data:'x'.repeat(5000)})).status).toBe(413);
   expect((await call('text-jobs/'+job.id+'/es.txt')).headers.get('content-disposition')).toContain('attachment');
   expect((await call('text-jobs/'+job.id+'/en.txt',undefined,foreign)).status).toBe(404);
   expect((await call('text-jobs/'+job.id+'/apply',{},foreign)).status).toBe(404);
   expect((await call('text-jobs/'+job.id+'/apply',{})).status).toBe(200);
  }finally{releaseProvider();await pilot.close();}
 });

 it('rechecks result and job TTL after waiting to apply without changing the input TTL',async()=>{
  const job=await request();await service.runOnce();const blocker=await pool.connect();let applying:Promise<any>|undefined;
  try{await blocker.query('BEGIN');await blocker.query('SELECT 1 FROM inputs WHERE id=$1 FOR UPDATE',[project]);
   applying=service.apply(account,job.id).then(()=>({unexpected:true}),error=>error);
   let blocked=false;for(let n=0;n<100;n++){const r=await pool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",[schema]);if(r.rowCount){blocked=true;break;}await new Promise(resolve=>setTimeout(resolve,10));}
   expect(blocked).toBe(true);
   await blocker.query("UPDATE pipeline_text_results SET expires_at=clock_timestamp()-interval '1 second' WHERE job_id=$1",[job.id]);
   await blocker.query("UPDATE pipeline_jobs SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[job.id]);
   await blocker.query('COMMIT');expect(await applying).toMatchObject({code:'not_found'});
   expect((await jobs.subtitleProject(account,project))?.revision).toBe(1);
  }finally{await blocker.query('ROLLBACK');blocker.release();await applying;}
 });
 it('does not call provider again when recovering an expired lease after restart',async()=>{
  const job=await request();const attempt=(await service.store.claimNext('translation'))!;
  await pool.query("UPDATE pipeline_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[job.id]);
  const restarted=new PipelineTextService(pool,jobs,{generate},async(_file,cues)=>cues);
  await restarted.runOnce();expect(generate).not.toHaveBeenCalled();expect((await restarted.get(account,job.id))?.job.state).toBe('unknown');
  await expect(service.store.complete(attempt,'succeeded')).rejects.toMatchObject({code:'conflict'});
 });

 it('records failure immediately after concurrent editing and keeps stable IDs across saving',async()=>{
  let finish:(value:unknown)=>void=()=>{};let begun=false;
  generate.mockImplementation(async()=>{begun=true;return new Promise(resolve=>{finish=resolve;});});
  const job=await request();const running=service.runOnce();
  for(let n=0;n<100&&!begun;n++)await new Promise(resolve=>setTimeout(resolve,5));
  await jobs.saveSubtitleProject(account,project,1,'User edit');finish(good());await running;
  expect((await service.get(account,job.id))?.job.state).toBe('failed');
  expect((await jobs.subtitleProject(account,project))?.draft).toBe('User edit');
 });
 it('cancels an unknown outcome explicitly so the user can request a new attempt',async()=>{
  generate.mockRejectedValue(new TextOutcomeUnknown());const job=await request();await service.runOnce();
  expect((await service.get(account,job.id))?.job.state).toBe('unknown');await expect(request()).rejects.toMatchObject({code:'conflict'});
  expect(await service.cancel(account,job.id)).toBe(true);expect((await service.get(account,job.id))?.job.state).toBe('cancelled');
  const next=await request();expect(next.id).not.toBe(job.id);expect(generate).toHaveBeenCalledTimes(1);
 });

 it('claims only its configured model without consuming another translation job',async()=>{
  const foreign=await service.store.createJob(account,{inputId:project,expectedRevision:1,requestKey:'other-model',stage:'translation',config:{stage:'translation',provider:'gemini',model:'other-model',sourceLanguage:'es',targetLanguage:'en'}});
  const own=await request();await service.runOnce();expect((await service.get(account,own.id))?.job.state).toBe('succeeded');
  expect((await service.store.getJob(account,foreign.id))?.state).toBe('queued');expect(generate).toHaveBeenCalledTimes(1);
 });

});
