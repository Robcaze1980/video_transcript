import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {afterAll,beforeAll,beforeEach,describe,it,expect,vi} from 'vitest';
import {CommercialJobs,type JobAdapter} from './jobs';
import {TestCheckout} from './checkout';
import {createSimulatedPayments} from './pilotPayments';
const database=process.env.LINGUISTVISION_TEST_DATABASE_URL;
const schema='lv_reliability_'+randomUUID().replaceAll('-','');
describe.skipIf(!database)('backend reliability before cloud',()=>{
 let admin:Pool,pool:Pool,jobs:CommercialJobs,account:string,input:string;
 const execute=vi.fn(async()=>Buffer.from('synthetic result'));
 const adapter:JobAdapter={key:'reliability:v1',price:1,validate(){},execute};
 beforeAll(async()=>{admin=new Pool({connectionString:database});await admin.query('CREATE SCHEMA '+schema);pool=new Pool({connectionString:database,options:'-c search_path='+schema});await pool.query(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));jobs=new CommercialJobs(pool,new Map([[adapter.key,adapter]]));});
 beforeEach(async()=>{vi.restoreAllMocks();execute.mockClear();await pool.query('TRUNCATE credit_movements,checkout_orders,purchases,jobs,subtitle_projects,subtitle_presets,pilot_language_requests,inputs,accounts');account=await jobs.createAccount();await jobs.creditConfirmedPurchase(account,'fixture-'+randomUUID(),3);input=await jobs.addInput(account,Buffer.from('synthetic input'));});
 afterAll(async()=>{await pool?.end();if(admin){await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();}});
 it('discards expired queued inputs without calling a provider and releases only once',async()=>{const id=await jobs.enqueue(account,input,'ttl',adapter.key,{});await pool.query("UPDATE inputs SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[input]);await Promise.all([jobs.runOnce(),jobs.runOnce()]);expect(execute).not.toHaveBeenCalled();expect((await jobs.result(account,id))?.state).toBe('failed');expect(await jobs.balance(account)).toMatchObject({available:3,reserved:0,consumed:0});expect((await pool.query("SELECT 1 FROM credit_movements WHERE reference=$1 AND kind='release'",[id])).rowCount).toBe(1);});
 it('quarantines a lost publication instead of repeating provider work',async()=>{const id=await jobs.enqueue(account,input,'publish',adapter.key,{});vi.spyOn(jobs,'publish').mockRejectedValueOnce(new Error('synthetic database failure'));await expect(jobs.runOnce()).resolves.toBe(true);expect(execute).toHaveBeenCalledTimes(1);expect((await jobs.result(account,id))?.state).toBe('unknown');expect(await jobs.balance(account)).toMatchObject({available:2,reserved:1,consumed:0});expect(await jobs.runOnce()).toBe(false);expect(execute).toHaveBeenCalledTimes(1);await expect(jobs.enqueue(account,input,'new-key',adapter.key,{})).rejects.toMatchObject({code:'conflict'});});
 it('never reclaims an expired running lease for a second provider call',async()=>{const id=await jobs.enqueue(account,input,'lease',adapter.key,{});const attempt=await jobs.claim();expect(attempt?.id).toBe(id);await pool.query("UPDATE jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[id]);await Promise.all([jobs.runOnce(),jobs.runOnce()]);expect(execute).not.toHaveBeenCalled();expect((await jobs.result(account,id))?.state).toBe('unknown');expect(await jobs.balance(account)).toMatchObject({reserved:1,consumed:0});expect(await jobs.publish(attempt!,Buffer.from('late'))).toBe(false);});
 it('requires trusted evidence and resolves an unknown reservation exactly once',async()=>{const id=await jobs.enqueue(account,input,'resolve',adapter.key,{});const attempt=(await jobs.claim())!;await jobs.quarantine(attempt);await expect(jobs.reconcileUnknown(account,id,'failed','')).rejects.toMatchObject({code:'invalid_input'});const results=await Promise.all([jobs.reconcileUnknown(account,id,'failed','provider-status:no-operation'),jobs.reconcileUnknown(account,id,'failed','provider-status:no-operation')]);expect(results.sort()).toEqual([false,true]);expect(await jobs.balance(account)).toMatchObject({available:3,reserved:0,consumed:0});expect((await pool.query("SELECT 1 FROM credit_movements WHERE reference=$1 AND kind='release'",[id])).rowCount).toBe(1);});
 it('rejects a non-buffer original during reconciliation without altering the held reservation',async()=>{
   const id=await jobs.enqueue(account,input,'invalid-reconciled-original',adapter.key,{});await jobs.quarantine((await jobs.claim())!);
   await expect(jobs.reconcileUnknown(account,id,'succeeded','synthetic-evidence',{result:Buffer.from('verified'),original:'invalid' as unknown as Buffer})).rejects.toMatchObject({code:'invalid_input'});
   expect((await jobs.result(account,id))?.state).toBe('unknown');expect(await jobs.balance(account)).toMatchObject({available:2,reserved:1,consumed:0});
   expect((await pool.query("SELECT 1 FROM credit_movements WHERE reference=$1 AND kind IN ('capture','release')",[id])).rowCount).toBe(0);
   expect(await jobs.reconcileUnknown(account,id,'succeeded','synthetic-evidence',{result:Buffer.from('verified'),original:Buffer.from('source')})).toBe(true);
   expect(await jobs.reconcileUnknown(account,id,'failed','synthetic-evidence')).toBe(false);
   expect(await jobs.balance(account)).toMatchObject({available:2,reserved:0,consumed:1});
 });
 it('still runs and bills an ordinary successful job once',async()=>{const id=await jobs.enqueue(account,input,'positive',adapter.key,{});await jobs.runOnce();expect(execute).toHaveBeenCalledTimes(1);expect((await jobs.result(account,id))?.state).toBe('succeeded');expect(await jobs.balance(account)).toMatchObject({available:2,reserved:0,consumed:1});});
 it('recovers a lost create response using the same local reference and no capture',async()=>{const base=createSimulatedPayments();const original=base.createOrder.bind(base);const byReference=new Map<string,Awaited<ReturnType<typeof original>>>();let lose=true;let remoteCreates=0;const payments={...base,createOrder:vi.fn(async(reference:string,url:string,amount?:number)=>{let order=byReference.get(reference);if(!order){order=await original(reference,url,amount);byReference.set(reference,order);remoteCreates++;}if(lose){lose=false;throw new Error('synthetic lost create response');}return order;}),capture:vi.fn((id:string,key:string)=>base.capture(id,key))};const checkout=new TestCheckout(pool,jobs,payments);expect(await checkout.createOrder(account,'usd',100,60,'http://127.0.0.1')).toMatchObject({pending:true});const row=(await pool.query('SELECT id FROM checkout_orders')).rows[0];await pool.query("UPDATE checkout_orders SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE id=$1",[row.id]);await Promise.all([checkout.fulfillNext(),checkout.fulfillNext()]);const after=(await pool.query('SELECT provider_order_id FROM checkout_orders WHERE id=$1',[row.id])).rows[0];expect(after.provider_order_id).toBeTruthy();expect(remoteCreates).toBe(1);expect(payments.capture).not.toHaveBeenCalled();expect(await jobs.balance(account)).toMatchObject({available:3,credited:3});expect(await checkout.status(account,row.id)).toBe('approval');});
 it('rechecks expiry after claiming and before starting the provider',async()=>{
   const id=await jobs.enqueue(account,input,'expiry-after-claim',adapter.key,{});const claim=jobs.claim.bind(jobs);
   vi.spyOn(jobs,'claim').mockImplementationOnce(async()=>{const attempt=await claim();await pool.query("UPDATE inputs SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[input]);return attempt;});
   await jobs.runOnce();expect(execute).not.toHaveBeenCalled();expect((await jobs.result(account,id))?.state).toBe('failed');
 });
 it('keeps a committed publication after its response is lost',async()=>{
   const id=await jobs.enqueue(account,input,'commit-lost',adapter.key,{});const publish=jobs.publish.bind(jobs);
   vi.spyOn(jobs,'publish').mockImplementationOnce(async(a,r)=>{await publish(a,r);throw Error('response lost after commit');});
   await jobs.runOnce();expect((await jobs.result(account,id))?.state).toBe('succeeded');expect(await jobs.runOnce()).toBe(false);expect(execute).toHaveBeenCalledTimes(1);expect(await jobs.balance(account)).toMatchObject({consumed:1,reserved:0});
 });
 it('deduplicates concurrent customer retries and rejects changed payload for the same key',async()=>{
   const payments=createSimulatedPayments();const create=vi.spyOn(payments,'createOrder');const checkout=new TestCheckout(pool,jobs,payments);
   const results=await Promise.all([checkout.createOrder(account,'usd',100,60,'http://127.0.0.1',undefined,'stable-key'),checkout.createOrder(account,'usd',100,60,'http://127.0.0.1',undefined,'stable-key')]);
   expect(results[0].id).toBe(results[1].id);expect(create).toHaveBeenCalledTimes(1);
   await expect(checkout.createOrder(account,'usd',500,300,'http://127.0.0.1',undefined,'stable-key')).rejects.toMatchObject({code:'conflict'});
   await expect(checkout.createOrder(account,'usd',100,60,'https://example.invalid',undefined,'stable-key')).rejects.toMatchObject({code:'conflict'});
 });
 it('never replays creation outside its provider idempotency window or recreates legacy orphans',async()=>{
   const base=createSimulatedPayments();const create=vi.fn(async()=>{throw Error('ambiguous network');});const checkout=new TestCheckout(pool,jobs,{...base,createOrder:create});
   const intent=await checkout.createOrder(account,'usd',100,60,'http://127.0.0.1');expect(intent.pending).toBe(true);
   await pool.query("UPDATE checkout_orders SET create_started_at=clock_timestamp()-interval '6 hours',next_attempt_at=clock_timestamp()-interval '1 second' WHERE id=$1",[intent.id]);
   const orphan = randomUUID();
   await pool.query("INSERT INTO checkout_orders(id,account_id,currency,amount,credits,next_attempt_at) VALUES($1,$2,'usd',100,60,clock_timestamp()-interval '1 second')",[orphan,account]);
   expect(await checkout.status(account,orphan)).toBe('unknown');
   expect(await checkout.fulfillNext()).toBe(false);expect(create).toHaveBeenCalledTimes(1);expect(await checkout.status(account,intent.id)).toBe('unknown');
 });
 it('upgrades old columns and constraints twice without changing the ledger',async()=>{
   const legacy=await jobs.enqueue(account,input,'legacy-upgrade',adapter.key,{});await jobs.runOnce();
   const before=await jobs.balance(account);
   await pool.query("ALTER TABLE jobs DROP CONSTRAINT jobs_state_check; ALTER TABLE jobs ADD CONSTRAINT jobs_state_check CHECK (state IN ('queued','running','succeeded','failed','cancelled')); ALTER TABLE jobs DROP COLUMN reconciliation_ref; ALTER TABLE jobs DROP COLUMN input_sha256; ALTER TABLE jobs DROP COLUMN unknown_attempt_id; ALTER TABLE jobs DROP COLUMN quarantined_at; ALTER TABLE checkout_orders DROP COLUMN create_return_url; ALTER TABLE checkout_orders DROP COLUMN create_request_key; ALTER TABLE checkout_orders DROP COLUMN create_started_at; ALTER TABLE checkout_orders DROP COLUMN create_lease; ALTER TABLE checkout_orders DROP COLUMN approval_url;");
   const migration=await readFile(new URL('./migrations/0017_reliability.sql',import.meta.url),'utf8');
   await pool.query('BEGIN');await pool.query(migration);await pool.query(migration);await pool.query('COMMIT');
   expect((await pool.query('SELECT input_sha256 FROM jobs WHERE id=$1',[legacy])).rows[0].input_sha256).toMatch(/^[a-f0-9]{64}$/);
   expect(await jobs.balance(account)).toEqual(before);const id=await jobs.enqueue(account,input,'post-upgrade',adapter.key,{});await jobs.quarantine((await jobs.claim())!);expect((await jobs.result(account,id))?.state).toBe('unknown');
 });

 it('cancels a queued job once without starting its provider',async()=>{
   const id=await jobs.enqueue(account,input,'queued-cancel',adapter.key,{});
   expect(await jobs.cancel(account,id)).toBe(true);expect(await jobs.cancel(account,id)).toBe(false);
   expect(await jobs.runOnce()).toBe(false);expect(execute).not.toHaveBeenCalled();
   expect(await jobs.balance(account)).toMatchObject({available:3,reserved:0,consumed:0});
 });
 it('quarantines a running cancellation without releasing or restarting it',async()=>{
   const id=await jobs.enqueue(account,input,'running-cancel',adapter.key,{});await jobs.claim();
   expect(await jobs.cancel(account,id)).toBe(true);expect((await jobs.result(account,id))?.state).toBe('unknown');
   expect(await jobs.runOnce()).toBe(false);expect(execute).not.toHaveBeenCalled();
   expect(await jobs.balance(account)).toMatchObject({available:2,reserved:1,consumed:0});
 });

 it('reconciles a verified but expired result without charging for an unavailable deliverable',async()=>{
   const id=await jobs.enqueue(account,input,'expired-reconcile',adapter.key,{});await jobs.quarantine((await jobs.claim())!);
   await pool.query("UPDATE inputs SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[input]);
   await Promise.all([jobs.purgeExpiredInputs(),jobs.reconcileUnknown(account,id,'succeeded','provider-result-expired',{result:Buffer.from('verified')})]);
   expect((await jobs.result(account,id))?.state).toBe('failed');expect(await jobs.balance(account)).toMatchObject({available:3,reserved:0,consumed:0});
   const row=(await pool.query('SELECT unknown_attempt_id,quarantined_at,input_sha256,reconciliation_ref FROM jobs WHERE id=$1',[id])).rows[0];
   expect(row.unknown_attempt_id).toBeTruthy();expect(row.input_sha256).toMatch(/^[a-f0-9]{64}$/);expect(row.reconciliation_ref).toBe('provider-result-expired');
 });

});
