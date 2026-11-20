// Counts-only, READ-ONLY runs of the reconciliation readers against the real project. Authorized by the owner in chat on 2026-11-19:
//   «Sí, autorizo 1C»      scope `billing`: the billing queues of the Video database (candidate namespace);
//   «Sí, autorizo Cuenta»  scope `account`: the Account database (balances, reservations, tombstones, guards, incidents, ledger).
// Output is COUNTS only, NO writes (no alerts, no audit records). Everything the readers see goes through a read-only facade
// (server/commercial/readOnlyFirestoreRoot.ts with the policy of billingReadOnlyRoot.ts or accountReadOnlyRoot.ts): a fixed list of collections,
// fixed equality filters, document-id ordering, no document reference, no write method, only the policy's scalar fields, and a cap on documents
// read applied BEFORE each query runs. The output has no row id, no account id and no per-row value, and errors are reported as short fixed
// codes, never as the text of the failure.
// The owner's isolated ADC file (explicit path, as the rest of the project's tooling) is the only credential; GOOGLE_APPLICATION_CREDENTIALS is
// refused so that no other credential can be picked up by accident.
//   real:      node --import tsx scripts/oneCReadOnlyCounts.mjs --target real --scope billing|account --out <file.json> [--max-docs <n>]
//   emulator:  FIRESTORE_EMULATOR_HOST=127.0.0.1:<port> GCLOUD_PROJECT=demo-... node --import tsx scripts/oneCReadOnlyCounts.mjs --target emulator --scope billing|account --root <collection/doc> --out <file.json>
import {existsSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {GoogleAuth} from 'google-auth-library';
import {Firestore} from 'firebase-admin/firestore';
import {readOnlyRoot} from '../server/commercial/billingReadOnlyRoot.ts';
import {summarizeQueues} from '../server/commercial/billingQueueCounts.ts';
import {accountReadOnlyRoot} from '../server/commercial/accountReadOnlyRoot.ts';
import {summarizeAccounts} from '../server/commercial/accountReconciliationCounts.ts';

const REAL_PROJECT='vistavo-prod',DEFAULT_MAX_DOCS=200000;
/** The real targets are fixed here: database, root document and the marker fields that must match. */
const SCOPES={
  billing:{databaseId:undefined,root:'vistavo/candidate-v1',marker:{schemaVersion:2,service:'vistavo',environment:'candidate',storageProtocol:'immutable-chunks-v1'},facade:readOnlyRoot,summarize:summarizeQueues},
  account:{databaseId:'vistavo-live',root:'vistavo/production-v1',marker:{schemaVersion:1,service:'vistavo-account',environment:'production',unit:'video_seconds'},facade:accountReadOnlyRoot,summarize:summarizeAccounts},
};
function refuse(message){console.error('REFUSED: '+message);process.exit(2);}
const args=process.argv.slice(2);let target,scopeName,out,rootPath,maxDocs=DEFAULT_MAX_DOCS;
for(let i=0;i<args.length;i++){
  if(args[i]==='--target')target=args[++i];else if(args[i]==='--scope')scopeName=args[++i];else if(args[i]==='--out')out=args[++i];else if(args[i]==='--root')rootPath=args[++i];
  else if(args[i]==='--max-docs')maxDocs=Number(args[++i]);else refuse('unknown argument');
}
if(!['real','emulator'].includes(target))refuse('--target real|emulator is required');
if(typeof scopeName!=='string'||!Object.hasOwn(SCOPES,scopeName))refuse('--scope billing|account is required');
if(!out||!/\.json$/.test(out))refuse('--out <file.json> is required');
if(!Number.isSafeInteger(maxDocs)||maxDocs<1)refuse('--max-docs must be a positive integer');
// The output is never allowed to replace an existing file (the isolated credential is a .json file too).
if(existsSync(out))refuse('the output file already exists');
if(target==='real'&&rootPath!==undefined)refuse('--root is only for the emulator target; the real target is fixed');
const scope=SCOPES[scopeName];

// Refusals that need no connection are decided before anything is opened.
let credentialPath;
if(target==='real'){
  for(const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST','STORAGE_EMULATOR_HOST','GOOGLE_APPLICATION_CREDENTIALS'])if(process.env[key]!==undefined)refuse('unexpected variable set: '+key);
  if(!process.env.LOCALAPPDATA)refuse('LOCALAPPDATA is required to find the isolated credential');
  credentialPath=path.join(process.env.LOCALAPPDATA,'LinguistVision','gcloud','application_default_credentials.json');
  if(!existsSync(credentialPath))refuse('the isolated credential file was not found');
}else{
  const host=process.env.FIRESTORE_EMULATOR_HOST,project=process.env.GCLOUD_PROJECT;
  if(!/^127\.0\.0\.1:\d{2,5}$/.test(host??''))refuse('a loopback Firestore emulator is required');
  if(!/^demo-[a-z0-9-]+$/.test(project??''))refuse('a demo-* project is required');
  for(const key of ['GOOGLE_APPLICATION_CREDENTIALS','K_SERVICE'])if(process.env[key]!==undefined)refuse('unexpected variable set: '+key);
  if(typeof rootPath!=='string'||!/^[A-Za-z0-9_-]{1,100}\/[A-Za-z0-9_-]{1,100}$/.test(rootPath))refuse('--root <collection/doc> is required');
}

/** Failures are reported as a short fixed code: the text of an error may name documents, paths or values. */
const KNOWN=new Set(['maximum documents exceeded','invalid clock','root document is not the expected namespace','requests would not be attributed to the project']);
const failureCode=error=>KNOWN.has(error?.message)?error.message:'read failed ('+(typeof error?.code==='number'||/^[A-Z_]{3,40}$/.test(String(error?.code))?'code '+error.code:String(error?.name??'Error').slice(0,40))+')';

let db;
const journal=[];
try{
  let root,projectLabel,rootLabel,databaseLabel;
  if(target==='real'){
    const googleAuth=new GoogleAuth({keyFilename:credentialPath,projectId:REAL_PROJECT,scopes:['https://www.googleapis.com/auth/cloud-platform']});
    const client=await googleAuth.getClient();client.quotaProjectId=REAL_PROJECT;
    // Requests must be attributed to the Vistavo project (never to another project of this account).
    if((await googleAuth.getRequestHeaders('https://firestore.googleapis.com')).get('x-goog-user-project')!==REAL_PROJECT)throw new Error('requests would not be attributed to the project');
    db=new Firestore({projectId:REAL_PROJECT,auth:googleAuth,preferRest:true,...(scope.databaseId?{databaseId:scope.databaseId}:{})});
    root=db.doc(scope.root);projectLabel=REAL_PROJECT;rootLabel=scope.root;databaseLabel=scope.databaseId??'(default)';
    // Boundary: the root must be the known namespace. Only booleans are kept from this one root-document read.
    const marker=(await root.get()).data();
    if(!Object.entries(scope.marker).every(([key,value])=>marker?.[key]===value))throw new Error('root document is not the expected namespace');
  }else{
    const project=process.env.GCLOUD_PROJECT;
    db=new Firestore({projectId:project});root=db.doc(rootPath);projectLabel=project;rootLabel=rootPath;databaseLabel='(emulator default)';
  }
  const counts=await scope.summarize(scope.facade(root,{maxDocs,journal:e=>journal.push(e)}),Date.now());
  const reads={};let documents=0;
  for(const e of journal){const r=reads[e.collection]??={queries:0,documents:0,countAggregations:0};if(e.op==='count')r.countAggregations++;else{r.queries++;r.documents+=e.docs;documents+=e.docs;}}
  if(documents>maxDocs)throw new Error('maximum documents exceeded'); // defense in depth: the facade already enforces it
  writeFileSync(out,JSON.stringify({target,scope:scopeName,project:projectLabel,database:databaseLabel,root:rootLabel,mode:'READ-ONLY, counts only, no writes',maxDocs,reads,counts},null,2),{flag:'wx'}); // never replaces a file
  const summary=scopeName==='billing'
    ?{sizes:counts.sizes,pending:counts.report.total,neverSelectedAtLeast:counts.inventory.neverSelectedAtLeast,maxFuturePerState:counts.inventory.maxFuturePerState}
    :{sizes:counts.sizes,reservations:counts.reservations,ledgerMinusReservations:counts.ledgerMinusReservations,accounts:{scanned:counts.accounts.scanned,invalid:counts.accounts.invalid,balanceBreaks:counts.accounts.balanceBreaks,reservedMismatch:counts.accounts.reservedMismatch,activeMismatch:counts.accounts.activeMismatch},openReservations:counts.openReservations,guardsBlocked:counts.guardsBlocked,incidentsActive:counts.incidentsActive};
  console.log(JSON.stringify({ok:true,target,scope:scopeName,project:projectLabel,database:databaseLabel,...summary,reads}));
}catch(error){
  console.log(JSON.stringify({ok:false,code:failureCode(error)}));process.exitCode=1;
}finally{
  try{await db?.terminate();}catch{/* nothing left to release */}
}
