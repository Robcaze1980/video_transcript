/**
 * Synthetic, emulator-only experiment. THIS IS NOT A PRODUCTION DRAINER.
 *
 * It cannot connect to Account API, GCS, a provider, or arbitrary Firestore
 * clients/paths. It starts disabled and only accepts its own synthetic rows.
 *
 * Prerequisites before considering any separate production implementation:
 * - Every writer must create a numeric nextAttemptAt. Existing missing fields
 *   require a bounded, resumable ID-ordered migration, a second pass after old
 *   writers stop, and quarantine for malformed data. An inequality/orderBy
 *   query cannot see absent fields; this experiment does not migrate them.
 * - Verify composite indexes and actual query behavior in the target Firestore;
 *   emulator acceptance does not establish their availability or cost.
 * - Adapt all existing intent, outbox, hold, quarantine and guard transitions to
 *   preserve the active lease and due-time invariant. Keep their existing
 *   owner, version, authorization and financial tuple checks.
 * - A local lease cannot prevent an already-sent remote POST completing after
 *   expiry. Account must independently enforce the complete financial tuple,
 *   idempotent transitions, guard and provider admission. Status alone does not
 *   prove a tuple. A late, authenticated remote ACK must be retained/reconciled;
 *   the synthetic observation below is not such proof.
 * - Prove worker fairness, timeouts, recovery without visits, hold propagation,
 *   observability, cost and physical-phone behavior. No scheduler is activated.
 *
 * The single rotation document serializes selection and can be a throughput
 * bottleneck. The experiment neither proves production scale nor guarantees
 * fairness under unbounded arrivals or a continuously backdated due time.
 * Its caller-supplied clock is synthetic and must never be trusted for money.
 */
import {createHash,randomUUID} from 'node:crypto';
import {initializeApp,deleteApp,type App} from 'firebase-admin/app';
import {getFirestore,FieldPath,FieldValue,type DocumentData,type Firestore,type DocumentReference,type QueryDocumentSnapshot,type Transaction} from 'firebase-admin/firestore';

const project='demo-vistavo-ledger',host='127.0.0.1:8185',rootCollection='vistavo_billing_fair_queue_test';
const marker='billing-fair-synthetic-v1',laneNames=['reserve','release','pending','retry','hold'] as const;
const constructionSecret=Symbol('billing-fair-synthetic-construction');
export type FairFixtureLane=typeof laneNames[number];
const lanes:Record<FairFixtureLane,{collection:string;state:string}>={
 reserve:{collection:'intents',state:'reserve_pending'},release:{collection:'intents',state:'release_pending'},
 pending:{collection:'outbox',state:'pending'},retry:{collection:'outbox',state:'retry_wait'},
 hold:{collection:'holds',state:'pending'},
};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export type FairFixtureSeed={lane:FairFixtureLane;ordinal:number;dueAt:number;invalid?:boolean};
export type FairFixtureClaim={kind:'claimed';runId:string;lane:FairFixtureLane;id:string;token:string;generation:number;leaseUntil:number};
export type FairFixtureReview={kind:'needs_review';lane:FairFixtureLane;id:string;incidentId:string};
export type FairFixtureEvent=FairFixtureClaim|FairFixtureReview;

function boundary(){
 if(process.env.VISTAVO_BILLING_FAIR_EMULATOR_ONLY!=='1'||process.env.FIRESTORE_EMULATOR_HOST!==host||process.env.NODE_ENV==='production')throw Error('Synthetic Firestore emulator boundary');
 for(const name of ['GOOGLE_APPLICATION_CREDENTIALS','K_SERVICE','K_JOB','FUNCTION_TARGET','GAE_ENV'])if(process.env[name])throw Error('Synthetic Firestore credential boundary');
 for(const name of ['GOOGLE_CLOUD_PROJECT','GCLOUD_PROJECT'])if(process.env[name]&&process.env[name]!==project)throw Error('Synthetic Firestore project boundary');
}
function validRun(runId:string){if(typeof runId!=='string'||!uuid.test(runId))throw Error('Invalid synthetic run');return runId;}
function validLane(lane:FairFixtureLane){if(!laneNames.includes(lane))throw Error('Invalid synthetic lane');return lanes[lane];}
function nonnegative(value:number){if(!Number.isSafeInteger(value)||value<0)throw Error('Invalid synthetic clock');return value;}
function fixtureId(lane:FairFixtureLane,ordinal:number){validLane(lane);if(!Number.isSafeInteger(ordinal)||ordinal<0||ordinal>999999)throw Error('Invalid synthetic ordinal');return `fixture-${lane}-${String(ordinal).padStart(6,'0')}`;}
function incidentId(kind:string,runId:string,lane:FairFixtureLane,id:string,token=''){return createHash('sha256').update(JSON.stringify([kind,runId,lane,id,token])).digest('hex');}
function validIdForLane(lane:FairFixtureLane,id:string){return /^fixture-(reserve|release|pending|retry|hold)-\d{6}$/.test(id)&&id.startsWith(`fixture-${lane}-`);}
function safeClaim(claim:FairFixtureClaim,runId:string){
 if(!claim||claim.kind!=='claimed'||claim.runId!==runId||!laneNames.includes(claim.lane)||!validIdForLane(claim.lane,claim.id)||!uuid.test(claim.token)||!Number.isSafeInteger(claim.generation)||claim.generation<1||!Number.isSafeInteger(claim.leaseUntil))throw Error('Invalid synthetic claim');
}
function validRow(doc:QueryDocumentSnapshot,lane:FairFixtureLane,now:number){
 const d=doc.data(),hasToken=d.leaseToken!==undefined,hasUntil=d.leaseUntil!==undefined;
 if(d.fixture!==marker||d.lane!==lane||d.state!==lanes[lane].state||!validIdForLane(lane,doc.id)||!Number.isSafeInteger(d.nextAttemptAt)||d.nextAttemptAt<0||d.nextAttemptAt>now||!Number.isSafeInteger(d.generation)||d.generation<0||d.generation>=Number.MAX_SAFE_INTEGER)return false;
 if(hasToken!==hasUntil)return false;
 if(hasToken&&(!uuid.test(d.leaseToken)||!Number.isSafeInteger(d.leaseUntil)||d.leaseUntil<0||d.nextAttemptAt!==d.leaseUntil))return false;
 return true;
}
function validRoot(data:DocumentData|undefined,runId:string){return !!data&&data.fixture===marker&&data.runId===runId;}

/** Isolated test harness only. No function accepts an injected Firestore client. */
export class BillingFairQueueFixture {
 #enabled=false;
 readonly #app:App;
 readonly #db:Firestore;
 readonly #root:DocumentReference;
 readonly #runId:string;
 private constructor(secret:symbol,app:App,db:Firestore,root:DocumentReference,runId:string){
  if(secret!==constructionSecret)throw Error('Synthetic constructor boundary');
  this.#app=app;this.#db=db;this.#root=root;this.#runId=runId;
 }
 get runId(){return this.#runId;}
 static #openClient(runId:string){
  boundary();validRun(runId);
  const app=initializeApp({projectId:project},'lv-fair-queue-fixture-'+randomUUID()),db=getFirestore(app);
  db.settings({preferRest:true});const root=db.collection(rootCollection).doc('run-'+runId);
  if(app.options.projectId!==project||root.path!==rootCollection+'/run-'+runId)throw Error('Synthetic root boundary');
  return {app,db,root};
 }
 static async create(){
  const runId=randomUUID(),client=this.#openClient(runId);
  try{await client.root.create({fixture:marker,runId});return new BillingFairQueueFixture(constructionSecret,client.app,client.db,client.root,runId);}
  catch(error){await client.db.terminate().catch(()=>undefined);await deleteApp(client.app).catch(()=>undefined);throw error;}
 }
 static async attach(runId:string){
  const client=this.#openClient(runId);
  try{const d=await client.root.get();if(!validRoot(d.data(),runId))throw Error('Synthetic root missing');return new BillingFairQueueFixture(constructionSecret,client.app,client.db,client.root,runId);}
  catch(error){await client.db.terminate().catch(()=>undefined);await deleteApp(client.app).catch(()=>undefined);throw error;}
 }
 #guard(){boundary();validRun(this.runId);if(this.#app.options.projectId!==project||this.#root.path!==rootCollection+'/run-'+this.runId)throw Error('Synthetic root boundary');}
 async #rootIn(tx:Transaction){const d=await tx.get(this.#root);if(!validRoot(d.data(),this.runId))throw Error('Synthetic root missing');}
 #row(lane:FairFixtureLane,id:string){const spec=validLane(lane);if(!validIdForLane(lane,id))throw Error('Invalid synthetic row');return this.#root.collection(spec.collection).doc(id);}
 /** Explicit opt-in on each test worker; reopening starts disabled again. */
 enableForSyntheticTests(){this.#guard();this.#enabled=true;}
 async seedSynthetic(rows:readonly FairFixtureSeed[]){
  this.#guard();if(!Array.isArray(rows)||rows.length<1||rows.length>400)throw Error('Invalid synthetic batch');
  const batch=this.#db.batch();for(const item of rows){const spec=validLane(item.lane),id=fixtureId(item.lane,item.ordinal);nonnegative(item.dueAt);
   batch.create(this.#row(item.lane,id),{fixture:item.invalid?'invalid-synthetic-fixture':marker,lane:item.lane,state:spec.state,nextAttemptAt:item.dueAt,generation:0});}
  await batch.commit();
 }
 /** Demonstrates the old missing-field case; it is not a migration routine. */
 async seedLegacySynthetic(lane:FairFixtureLane,ordinal:number){
  this.#guard();const spec=validLane(lane),id=fixtureId(lane,ordinal);
  await this.#row(lane,id).create({fixture:marker,lane,state:spec.state,generation:0});
 }
 /** Claims are synthetic deferrals, not provider calls or financial decisions. */
 async claimSyntheticBatch(worker:string,limit:number,now:number,leaseMs:number):Promise<FairFixtureEvent[]>{
  this.#guard();if(!this.#enabled)throw Error('Synthetic selector disabled');
  if(!/^fixture-worker-[a-z0-9-]{1,40}$/.test(worker)||!Number.isSafeInteger(limit)||limit<1||limit>25||!Number.isSafeInteger(leaseMs)||leaseMs<1||leaseMs>60000)throw Error('Invalid synthetic selector bounds');
  nonnegative(now);if(now>Number.MAX_SAFE_INTEGER-leaseMs)throw Error('Invalid synthetic clock');
  const result:FairFixtureEvent[]=[];
  for(let count=0;count<limit;count++){
   const token=randomUUID(),event=await this.#db.runTransaction(async tx=>{
    this.#guard();await this.#rootIn(tx);
    const control=this.#root.collection('control').doc('rotation'),current=await tx.get(control),data=current.data();
    if(data&&(data.fixture!==marker||!Number.isSafeInteger(data.nextLane)||data.nextLane<0||data.nextLane>=laneNames.length||!Number.isSafeInteger(data.transitions)||data.transitions<0||data.transitions>=Number.MAX_SAFE_INTEGER))throw Error('Invalid synthetic rotation');
    const first=data?.nextLane??0;
    for(let step=0;step<laneNames.length;step++){
     const index=(first+step)%laneNames.length,lane=laneNames[index],spec=lanes[lane];
     const query=this.#root.collection(spec.collection).where('state','==',spec.state).where('nextAttemptAt','<=',now).orderBy('nextAttemptAt').orderBy(FieldPath.documentId()).limit(1);
     const found=await tx.get(query);if(found.empty)continue;
     const doc=found.docs[0],next={fixture:marker,nextLane:(index+1)%laneNames.length,transitions:(data?.transitions??0)+1};
     if(!validRow(doc,lane,now)){
      const id=incidentId('invalid',this.runId,lane,doc.id),ref=this.#root.collection('reviews').doc(id),existing=await tx.get(ref);
      if(existing.exists&&(existing.get('fixture')!==marker||existing.get('lane')!==lane||existing.get('rowId')!==doc.id))throw Error('Invalid synthetic review');
      if(!existing.exists)tx.create(ref,{fixture:marker,lane,rowId:doc.id,reason:'invalid_synthetic_row',observedAtMs:now});
      tx.update(doc.ref,{state:'needs_review',queueStateBeforeReview:spec.state,reviewId:id});tx.set(control,next);
      return {kind:'needs_review',lane,id:doc.id,incidentId:id} as FairFixtureReview;
     }
     const row=doc.data();if(row.leaseUntil!==undefined&&row.leaseUntil>now)throw Error('Synthetic active lease selected');
     const leaseUntil=now+leaseMs,generation=row.generation+1;
     tx.update(doc.ref,{leaseToken:token,leaseOwner:worker,leaseUntil,claimedAtMs:now,nextAttemptAt:leaseUntil,generation});
     tx.set(control,next);
     return {kind:'claimed',runId:this.runId,lane,id:doc.id,token,generation,leaseUntil} as FairFixtureClaim;
    }
    return null;
   });
   if(!event)break;result.push(event);
  }
  return result;
 }
 /** Records only a pretend completion. A stale test ACK is kept, never applied. */
 async acknowledgeSynthetic(claim:FairFixtureClaim,now:number):Promise<'fixture_done'|'late_observation'>{
  this.#guard();if(!this.#enabled)throw Error('Synthetic selector disabled');safeClaim(claim,this.runId);nonnegative(now);
  return this.#db.runTransaction(async tx=>{
   this.#guard();await this.#rootIn(tx);const ref=this.#row(claim.lane,claim.id),doc=await tx.get(ref),row=doc.data();
   const active=!!row&&row.fixture===marker&&row.state===lanes[claim.lane].state&&row.leaseToken===claim.token&&row.generation===claim.generation&&row.leaseUntil===claim.leaseUntil&&Number.isSafeInteger(row.claimedAtMs)&&row.claimedAtMs<=now&&now<claim.leaseUntil;
   if(!active){
    const id=incidentId('late-fixture-ack',this.runId,claim.lane,claim.id,claim.token),incident=this.#root.collection('observations').doc(id),old=await tx.get(incident);
    if(old.exists&&(old.get('fixture')!==marker||old.get('lane')!==claim.lane||old.get('rowId')!==claim.id))throw Error('Invalid synthetic observation');
    if(!old.exists)tx.create(incident,{fixture:marker,lane:claim.lane,rowId:claim.id,claimToken:claim.token,observedAtMs:now,reason:'late_synthetic_ack_not_financial_proof'});
    return 'late_observation';
   }
   tx.update(ref,{state:'fixture_done',completedAtMs:now,leaseToken:null,leaseUntil:null,leaseOwner:null});return 'fixture_done';
  });
 }
 /** Models a transient failure only; no remote call or financial retry occurs. */
 async deferSynthetic(claim:FairFixtureClaim,now:number,retryAt:number):Promise<boolean>{
  this.#guard();if(!this.#enabled)throw Error('Synthetic selector disabled');safeClaim(claim,this.runId);nonnegative(now);nonnegative(retryAt);if(retryAt<=now)throw Error('Invalid synthetic retry');
  return this.#db.runTransaction(async tx=>{
   this.#guard();await this.#rootIn(tx);const ref=this.#row(claim.lane,claim.id),doc=await tx.get(ref),row=doc.data();
   if(!row||row.fixture!==marker||row.state!==lanes[claim.lane].state||row.leaseToken!==claim.token||row.generation!==claim.generation||row.leaseUntil!==claim.leaseUntil||!Number.isSafeInteger(row.claimedAtMs)||row.claimedAtMs>now||now>=claim.leaseUntil)return false;
   tx.update(ref,{nextAttemptAt:retryAt,leaseToken:FieldValue.delete(),leaseUntil:FieldValue.delete(),leaseOwner:FieldValue.delete()});return true;
  });
 }
 async inspectSynthetic(lane:FairFixtureLane,ordinal:number){this.#guard();const doc=await this.#row(lane,fixtureId(lane,ordinal)).get();return doc.data()??null;}
 async reviewCount(){this.#guard();return (await this.#root.collection('reviews').get()).size;}
 async observationCount(){this.#guard();return (await this.#root.collection('observations').get()).size;}
 /** Only this newly created demo root can be removed. Never targets another project. */
 async cleanupSynthetic(){this.#guard();const d=await this.#root.get();if(!validRoot(d.data(),this.runId))throw Error('Synthetic root missing');await this.#db.recursiveDelete(this.#root);}
 async close(){this.#enabled=false;await this.#db.terminate();await deleteApp(this.#app);}
}
