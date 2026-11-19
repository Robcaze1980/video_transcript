// Synthetic Firestore Emulator experiment. This module is never imported by the product.
import {createHash,randomUUID} from 'node:crypto';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore,FieldPath} from 'firebase-admin/firestore';

const PROJECT='demo-vistavo-ledger';
const COLLECTION='lv_witness_queue_synthetic_experiment';
const MARKER='lv-witness-queue-experiment-v1';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HEX_ID=/^[a-f0-9]{64}$/;
const CONSTRUCT=Symbol('synthetic fixture');

function boundary(){
  if(process.env.LV_WITNESS_QUEUE_EMULATOR_ONLY!=='1'||
     process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8185'||
     process.env.NODE_ENV!=='test')throw Error('emulator_boundary');
  for(const key of ['GOOGLE_APPLICATION_CREDENTIALS','K_SERVICE','K_JOB','FUNCTION_TARGET','GAE_ENV']){
    if(process.env[key])throw Error('emulator_boundary');
  }
  for(const key of ['GOOGLE_CLOUD_PROJECT','GCLOUD_PROJECT']){
    if(process.env[key]&&process.env[key]!==PROJECT)throw Error('emulator_boundary');
  }
}
function uuid(value){if(typeof value!=='string'||!UUID.test(value))throw Error('invalid_id');return value;}
function hexId(value){if(typeof value!=='string'||!HEX_ID.test(value))throw Error('invalid_id');return value;}
function time(value){if(!Number.isSafeInteger(value)||value<0||value>1_000_000_000)throw Error('invalid_clock');return value;}
function action(value){if(!['seal','release'].includes(value))throw Error('invalid_action');return value;}
export function syntheticTerminalKey(intentId,terminalAction){
  hexId(intentId);action(terminalAction);
  return createHash('sha256').update(JSON.stringify(['billing-intent-terminal-v1',intentId,terminalAction])).digest('hex');
}
function worker(value){if(typeof value!=='string'||!/^worker-[a-z0-9-]{1,32}$/.test(value))throw Error('invalid_worker');return value;}
function exactFields(row,fields){
  return !!row&&typeof row==='object'&&!Array.isArray(row)&&
    Object.keys(row).length===fields.length&&fields.every(key=>Object.hasOwn(row,key));
}
function checkWitness(row,terminalId,expectedAction){
  action(expectedAction);
  if(!exactFields(row,['fixture','intentId','terminalId','action','stage','generation','createdAt'])||
     row.fixture!==MARKER||row.terminalId!==terminalId||row.action!==expectedAction||
     row.stage!=='prepared'||row.generation!==1||!Number.isSafeInteger(row.createdAt)||
     row.createdAt<0||row.createdAt>1_000_000_000||!HEX_ID.test(row.intentId)||
     syntheticTerminalKey(row.intentId,row.action)!==terminalId)throw Error('witness_inconsistent');
}
function checkTask(row,terminalId,expectedAction){
  action(expectedAction);
  if(!exactFields(row,['fixture','terminalId','action','state','generation','attempts','nextAttemptAt','lease','lastCompletion','createdAt'])||
     row.fixture!==MARKER||row.terminalId!==terminalId||row.action!==expectedAction||
     !['pending','needs_review'].includes(row.state)||!Number.isSafeInteger(row.generation)||row.generation<0||
     !Number.isSafeInteger(row.attempts)||row.attempts<0||row.attempts>5||
     !Number.isSafeInteger(row.createdAt)||row.createdAt<0||row.createdAt>1_000_000_000||
     (row.state==='pending'&&(!Number.isSafeInteger(row.nextAttemptAt)||row.nextAttemptAt<0||row.nextAttemptAt>1_000_000_000))||
     (row.state==='needs_review'&&row.nextAttemptAt!==null))throw Error('task_inconsistent');
  if(row.lease!==null){
    const lease=row.lease;
    if(!exactFields(lease,['token','owner','generation','expiresAt'])||!UUID.test(lease.token)||lease.generation!==row.generation||
       typeof lease.owner!=='string'||!/^worker-[a-z0-9-]{1,32}$/.test(lease.owner)||
       !Number.isSafeInteger(lease.expiresAt)||lease.expiresAt<0||lease.expiresAt>1_000_000_000||
       row.state!=='pending'||row.nextAttemptAt!==lease.expiresAt)throw Error('lease_inconsistent');
  }
  const last=row.lastCompletion;
  if(last!==null&&(!exactFields(last,['token','owner','generation','outcome','incidentRequired'])||
     !UUID.test(last.token)||typeof last.owner!=='string'||!/^worker-[a-z0-9-]{1,32}$/.test(last.owner)||
     !Number.isSafeInteger(last.generation)||last.generation<1||last.generation>row.generation||
     !['unverified','not_found','captured'].includes(last.outcome)||typeof last.incidentRequired!=='boolean'))throw Error('completion_inconsistent');
  if(row.state==='needs_review'&&(row.lease!==null||!last||!last.incidentRequired||last.generation!==row.generation))throw Error('completion_inconsistent');
  if(row.state==='pending'&&last?.incidentRequired)throw Error('completion_inconsistent');
  if(row.state==='pending'&&row.attempts>=5)throw Error('task_inconsistent');
}
function equalClaim(a,b){
  return !!a&&!!b&&a.token===b.token&&a.generation===b.generation&&a.owner===b.owner;
}
function incidentId(terminalId,kind){return terminalId+'--'+kind;}
function incidentData(terminalId,kind){
  return {fixture:MARKER,terminalId,kind,state:'open',priority:kind==='captured'?'critical':'high'};
}
function sameIncident(row,terminalId,kind){
  const expected=incidentData(terminalId,kind);
  return !!row&&Object.keys(expected).every(key=>row[key]===expected[key])&&Object.keys(row).length===Object.keys(expected).length;
}

export class WitnessQueueFixture {
  #app; #db; #root; #runId; #enabled=false;
  constructor(secret,app,db,root,runId){
    if(secret!==CONSTRUCT)throw Error('constructor_boundary');
    this.#app=app;this.#db=db;this.#root=root;this.#runId=runId;
  }
  static async create(){
    boundary();const runId=randomUUID();
    const app=initializeApp({projectId:PROJECT},'lv-witness-fixture-'+randomUUID());
    const db=getFirestore(app);db.settings({preferRest:true});
    const root=db.collection(COLLECTION).doc('run-'+runId);
    try{await root.create({fixture:MARKER,runId});return new WitnessQueueFixture(CONSTRUCT,app,db,root,runId);}
    catch(error){await db.terminate();await deleteApp(app);throw error;}
  }
  static async attach(runId){
    boundary();uuid(runId);
    const app=initializeApp({projectId:PROJECT},'lv-witness-fixture-'+randomUUID());
    const db=getFirestore(app);db.settings({preferRest:true});
    const root=db.collection(COLLECTION).doc('run-'+runId);
    try{
      const marker=await root.get();
      if(marker.get('fixture')!==MARKER||marker.get('runId')!==runId)throw Error('fixture_missing');
      return new WitnessQueueFixture(CONSTRUCT,app,db,root,runId);
    }catch(error){await db.terminate();await deleteApp(app);throw error;}
  }
  get runId(){return this.#runId;}
  enableForSyntheticTests(){boundary();this.#enabled=true;}
  #guard(){
    boundary();
    if(!this.#enabled)throw Error('fixture_disabled');
    if(this.#root.path!==COLLECTION+'/run-'+this.#runId)throw Error('fixture_boundary');
  }
  #witness(id){return this.#root.collection('witnesses').doc(hexId(id));}
  #task(id){return this.#root.collection('recoveryTasks').doc(hexId(id));}
  #incident(id,kind){return this.#root.collection('incidents').doc(incidentId(hexId(id),kind));}

  async createPair(intentId,terminalAction,now,options={}){
    this.#guard();hexId(intentId);action(terminalAction);time(now);
    const terminalId=syntheticTerminalKey(intentId,terminalAction);
    return this.#db.runTransaction(async tx=>{
      this.#guard();
      const witness=this.#witness(terminalId),task=this.#task(terminalId);
      const [w,q]=await tx.getAll(witness,task);
      if(w.exists||q.exists){
        if(!w.exists||!q.exists)throw Error('pair_incomplete');
        checkWitness(w.data(),terminalId,terminalAction);
        checkTask(q.data(),terminalId,terminalAction);
        if(q.get('state')==='needs_review'){
          const kind=q.get('lastCompletion').outcome;
          const incident=await tx.get(this.#incident(terminalId,kind));
          if(!sameIncident(incident.data(),terminalId,kind))throw Error('incident_inconsistent');
        }
        return 'already_exists';
      }
      tx.create(witness,{fixture:MARKER,intentId,terminalId,action:terminalAction,stage:'prepared',generation:1,createdAt:now});
      if(options.failAfterWitnessStaged)throw Error('synthetic_crash');
      tx.create(task,{fixture:MARKER,terminalId,action:terminalAction,state:'pending',generation:0,
        attempts:0,nextAttemptAt:now,lease:null,lastCompletion:null,createdAt:now});
      return 'created';
    });
  }

  async claimNext(owner,now,ttl){
    this.#guard();worker(owner);time(now);time(ttl);
    if(ttl<1||now+ttl>1_000_000_000)throw Error('invalid_lease');
    const due=await this.#root.collection('recoveryTasks').where('nextAttemptAt','<=',now)
      .orderBy('nextAttemptAt').orderBy(FieldPath.documentId()).limit(100).get();
    for(const candidate of due.docs){
      const terminalId=hexId(candidate.id);
      const claim=await this.#db.runTransaction(async tx=>{
        this.#guard();
        const [q,w]=await tx.getAll(this.#task(terminalId),this.#witness(terminalId));
        if(!q.exists||!w.exists)throw Error('pair_incomplete');
        const task=q.data();checkTask(task,terminalId,task.action);checkWitness(w.data(),terminalId,task.action);
        if(task.state!=='pending'||task.nextAttemptAt>now||task.lease&&task.lease.expiresAt>now)return null;
        if(task.generation===Number.MAX_SAFE_INTEGER)throw Error('generation_exhausted');
        const lease={token:randomUUID(),owner,generation:task.generation+1,expiresAt:now+ttl};
        tx.update(this.#task(terminalId),{generation:lease.generation,lease,nextAttemptAt:lease.expiresAt});
        return {terminalId,action:task.action,...lease};
      });
      if(claim)return claim;
    }
    return null;
  }

  async finish(claim,outcome,now,options={}){
    this.#guard();hexId(claim?.terminalId);action(claim.action);worker(claim.owner);uuid(claim.token);time(now);
    if(!Number.isSafeInteger(claim.generation)||claim.generation<1||
       !['unverified','not_found','captured'].includes(outcome))throw Error('invalid_observation');
    const id=claim.terminalId;
    return this.#db.runTransaction(async tx=>{
      this.#guard();
      const taskRef=this.#task(id),witnessRef=this.#witness(id),incidentRef=this.#incident(id,outcome);
      const [q,w,inc]=await tx.getAll(taskRef,witnessRef,incidentRef);
      if(!q.exists||!w.exists)throw Error('pair_incomplete');
      const task=q.data();checkTask(task,id,claim.action);checkWitness(w.data(),id,claim.action);
      if(task.lastCompletion&&equalClaim(task.lastCompletion,claim)&&task.generation===claim.generation){
        if(task.lastCompletion.outcome!==outcome)throw Error('completion_conflict');
        if(task.lastCompletion.incidentRequired&&!sameIncident(inc.data(),id,outcome))throw Error('incident_inconsistent');
        return 'already_applied';
      }
      if(task.state!=='pending'||!equalClaim(task.lease,claim)||task.lease.expiresAt<=now)return 'stale';
      const attempts=outcome==='not_found'?task.attempts+1:task.attempts;
      const needsReview=outcome!=='not_found'||attempts>=5;
      const delay=Math.min(100*2**Math.max(0,attempts-1),1600);
      const nextAttemptAt=needsReview?null:time(now+delay);
      if(needsReview){
        if(inc.exists&&!sameIncident(inc.data(),id,outcome))throw Error('incident_inconsistent');
        if(!inc.exists)tx.create(incidentRef,incidentData(id,outcome));
        if(options.failAfterIncidentStaged)throw Error('synthetic_crash');
      }
      const completed={token:claim.token,owner:claim.owner,generation:claim.generation,outcome,incidentRequired:needsReview};
      tx.update(taskRef,{state:needsReview?'needs_review':'pending',attempts,lease:null,
        nextAttemptAt,lastCompletion:completed});
      return needsReview?'needs_review':'retry';
    });
  }

  async snapshot(terminalId){
    this.#guard();hexId(terminalId);
    const witness=await this.#witness(terminalId).get(),task=await this.#task(terminalId).get();
    const docs=await this.#root.collection('incidents').where('terminalId','==',terminalId).get();
    return {witness:witness.exists?witness.data():null,task:task.exists?task.data():null,
      incidents:docs.docs.map(doc=>({id:doc.id,...doc.data()})).sort((a,b)=>a.id.localeCompare(b.id))};
  }
  async corruptTaskActionForSyntheticTest(terminalId,wrongAction){
    this.#guard();hexId(terminalId);action(wrongAction);
    await this.#task(terminalId).update({action:wrongAction});
  }
  async corruptWitnessIntentForSyntheticTest(terminalId,wrongIntentId){
    this.#guard();hexId(terminalId);hexId(wrongIntentId);
    await this.#witness(terminalId).update({intentId:wrongIntentId});
  }
  async corruptTaskNumberForSyntheticTest(terminalId,field,value){
    this.#guard();hexId(terminalId);
    if(!['generation','attempts'].includes(field)||!Number.isSafeInteger(value))throw Error('invalid_corruption');
    await this.#task(terminalId).update({[field]:value});
  }
  async addExtraTaskFieldForSyntheticTest(terminalId){
    this.#guard();hexId(terminalId);
    await this.#task(terminalId).update({unexpected:'synthetic-corruption'});
  }
  async injectBadIncidentForSyntheticTest(terminalId,kind){
    this.#guard();hexId(terminalId);
    if(!['unverified','not_found','captured'].includes(kind))throw Error('invalid_observation');
    await this.#incident(terminalId,kind).create({...incidentData(terminalId,kind),state:'corrupt'});
  }
  async corruptExistingIncidentForSyntheticTest(terminalId,kind){
    this.#guard();hexId(terminalId);
    if(!['unverified','not_found','captured'].includes(kind))throw Error('invalid_observation');
    await this.#incident(terminalId,kind).update({state:'corrupt'});
  }
  async close(){await this.#db.terminate();await deleteApp(this.#app);}
  async cleanup(){
    this.#guard();
    const marker=await this.#root.get();
    if(marker.get('fixture')!==MARKER||marker.get('runId')!==this.#runId)throw Error('fixture_boundary');
    await this.#db.recursiveDelete(this.#root);
  }
}
