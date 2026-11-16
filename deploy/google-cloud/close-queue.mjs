import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {cloudClient,project,projectNumber} from './cloudClient.mjs';
import {indexFor} from './indexContract.mjs';

const args=process.argv.slice(2),apply=args.includes('--apply'),backfill=args.includes('--backfill');
if(args.some(x=>!['--apply','--backfill'].includes(x))||backfill&&!apply)throw Error('Use --apply and optional --backfill');
process.on('uncaughtException',error=>{console.error(JSON.stringify({event:'close-queue-failed',type:error?.name??'Error',code:typeof error?.code==='number'?error.code:undefined}));process.exitCode=1;});
const planBytes=await fs.readFile(new URL('./stabilization-queue.plan.json',import.meta.url)),plan=JSON.parse(planBytes);
const planSha256=createHash('sha256').update(planBytes).digest('hex'),sourceContract='ai-outbox-profile-v1';
const expected={collectionGroup:'outbox',queryScope:'COLLECTION',fields:[{fieldPath:'aiProfile',order:'ASCENDING'},{fieldPath:'state',order:'ASCENDING'},{fieldPath:'nextAttemptAt',order:'ASCENDING'}]};
if(plan.project!==project||plan.projectNumber!==projectNumber||project!=='vistavo-prod'||plan.databaseId!=='(default)'||plan.root!=='vistavo/candidate-v1'||plan.profile!=='ai-candidate-v1'||!plan.cloudSqlForbidden||JSON.stringify(plan.index)!==JSON.stringify(expected)||plan.backfill?.pageSize!==100||plan.backfill.maxPagesPerRun!==10)throw Error('Queue migration boundary');
if(!apply){console.log(JSON.stringify({apply:false,project,index:expected,existingIndexOnly:true,indexCreateForbidden:true,backfill:'explicit --apply --backfill; existing pending AI rows only with transactional job/account/input checks',createWork:false,claimWork:false,providerCalls:false,noSql:true}));process.exit(0);}
const out='outputs/vistavo-three-fixes-20261114',receiptFile=out+'/queue-foundation.json',dbName=`projects/${project}/databases/(default)`;
await fs.mkdir(out,{recursive:true});
let receipt={project,root:plan.root,profile:plan.profile,sourceContract,planSha256,index:null,operation:null,intent:false,complete:false,nativeQuery:null,backfill:{cursor:null,checked:0,updated:0,complete:false,failures:[]}};
try{const saved=JSON.parse(await fs.readFile(receiptFile,'utf8'));if(saved.project!==project||saved.root!==plan.root||saved.profile!==plan.profile||saved.sourceContract!==sourceContract||saved.planSha256!==planSha256)throw Error('Queue receipt boundary');receipt=saved;}catch(e){if(e.code!=='ENOENT')throw e;}
const save=()=>fs.writeFile(receiptFile,JSON.stringify({...receipt,at:new Date().toISOString()},null,2));
const c=await cloudClient(out+'/queue-foundation-journal.json');
if(receipt.operation||receipt.intent)throw Error('Index creation operation/intent forbidden in this phase');
const base='https://firestore.googleapis.com/v1/'+dbName+'/collectionGroups/outbox/indexes';
async function lookup(){const list=await c.required(base);if(list.nextPageToken)throw Error('Index list paginated; inspect before mutation');return indexFor(list.indexes,dbName,expected);}
let index=await lookup();
if(!index)throw Error('Existing queue index missing; index creation forbidden in this phase');
if(!index||index.state==='NEEDS_REPAIR')throw Error('Queue index missing or damaged');
receipt.index={name:index.name,state:index.state};receipt.complete=false;await save();
if(index.state!=='READY'){console.log(JSON.stringify({ready:false,index:index.name,state:index.state,reenter:'--apply inspects existing operation/index'}));process.exit(0);}
const structuredQuery={from:[{collectionId:'outbox'}],where:{compositeFilter:{op:'AND',filters:[
 {fieldFilter:{field:{fieldPath:'aiProfile'},op:'EQUAL',value:{stringValue:plan.profile}}},
 {fieldFilter:{field:{fieldPath:'state'},op:'EQUAL',value:{stringValue:'pending'}}},
 {fieldFilter:{field:{fieldPath:'nextAttemptAt'},op:'LESS_THAN_OR_EQUAL',value:{integerValue:String(Date.now())}}},
]}},orderBy:[{field:{fieldPath:'nextAttemptAt'},direction:'ASCENDING'}],limit:30};
const native=await c.required('https://firestore.googleapis.com/v1/'+dbName+'/documents/'+plan.root+':runQuery','POST',{structuredQuery},'native-ai-outbox-before-limit');
if(!Array.isArray(native))throw Error('Native query response invalid');receipt.nativeQuery={success:true,at:new Date().toISOString(),documents:native.filter(x=>x.document).length};receipt.complete=true;await save();
if(backfill){
 // Dedicated existing user ADC outside repo. No provider, client tokens or service-account JSON.
 const {Firestore,FieldPath}=await import('firebase-admin/firestore');
 const {GoogleAuth}=await import('google-auth-library');
 const {FirestoreBackend}=await import('../../server/commercial/firestoreBackend.ts');
 const auth=new GoogleAuth({projectId:project,keyFilename:path.join(process.env.LOCALAPPDATA,'LinguistVision/gcloud/application_default_credentials.json'),scopes:['https://www.googleapis.com/auth/cloud-platform']});
 const client=await auth.getClient();client.quotaProjectId=project;
 if((await client.getRequestHeaders('https://firestore.googleapis.com')).get('x-goog-user-project')!==project)throw Error('Quota project boundary');
 const db=new Firestore({projectId:project,auth,preferRest:true});
 try{
  const root=db.collection('vistavo').doc('candidate-v1'),marker=(await root.get()).data();
  if(marker?.service!=='vistavo'||marker?.environment!=='candidate'||marker?.schemaVersion!==2)throw Error('Queue root marker boundary');
  const backend=new FirestoreBackend(db,root),algorithm='owned-ai-classification-v2';
  if(receipt.backfill?.algorithm!==algorithm){receipt.previousBackfill=receipt.backfill;receipt.backfill={algorithm,cursor:null,checked:0,updated:0,complete:false,failures:[]};await save();}
  // Explicit operator reentry may safely reclassify unresolved rows: it never creates/claims/pays work.
  if(receipt.backfill.failures.length){
   const previous=receipt.backfill.failures;receipt.backfill.failures=[];
   for(const failure of previous){try{if(!failure.id)throw Error('Unclassified document identity');if(await backend.backfillAiDispatchProfile(failure.id))receipt.backfill.updated++;}catch{receipt.backfill.failures.push(failure);}}
   await save();
  }
  for(let page=0;page<10&&!receipt.backfill.complete;page++){
   let query=root.collection('outbox').where('state','==','pending').orderBy(FieldPath.documentId()).limit(100);
   if(receipt.backfill.cursor)query=query.startAfter(receipt.backfill.cursor);
   const rows=await query.get();
   for(const row of rows.docs){receipt.backfill.checked++;try{if(await backend.backfillAiDispatchProfile(row.id))receipt.backfill.updated++;}catch{if(receipt.backfill.failures.length<100)receipt.backfill.failures.push({id:/^[a-f0-9-]{36}$/.test(row.id)?row.id:null,stage:'backfill'});}}
   if(rows.size)receipt.backfill.cursor=rows.docs.at(-1).id;
   receipt.backfill.complete=rows.size<100&&receipt.backfill.failures.length===0;await save();
   if(rows.size<100&&!receipt.backfill.complete)break; // Explicit operator inspection; no false migration acceptance.
  }
 }finally{await db.terminate();}
}
console.log(JSON.stringify({ready:receipt.complete&&receipt.backfill.complete,indexReady:receipt.complete,index:receipt.index,nativeQuery:receipt.nativeQuery,backfill:receipt.backfill,noSql:true,createWork:false,claimWork:false}));
