// LOCAL ONLY: runs the pending-billing sweep (report + durable alerts) against a Firestore EMULATOR.
// Refuses anything but a loopback emulator, a demo-* project and an environment without credentials. It never moves
// balance and is not wired to any scheduler or deployment. Prints a JSON summary with counts only (no row data).
// Usage: FIRESTORE_EMULATOR_HOST=127.0.0.1:<port> GCLOUD_PROJECT=demo-... \
//        node --import tsx scripts/runBillingPendingSweepLocal.mjs --root <collection/doc> [--audit] [--age-threshold-ms <n>]
import {Firestore} from 'firebase-admin/firestore';
import {runPendingSweep,SweepError} from '../server/commercial/billingPendingSweep.ts';

function refuse(message){console.error('REFUSED: '+message);process.exit(2);}
const host=process.env.FIRESTORE_EMULATOR_HOST,project=process.env.GCLOUD_PROJECT;
if(!/^127\.0\.0\.1:\d{2,5}$/.test(host??''))refuse('a loopback Firestore emulator (127.0.0.1:<port>) is required');
if(!/^demo-[a-z0-9-]+$/.test(project??''))refuse('a demo-* project is required');
for(const key of ['GOOGLE_APPLICATION_CREDENTIALS','GEMINI_API_KEY','OPENROUTER_API_KEY','K_SERVICE','GOOGLE_CLOUD_PROJECT_REAL'])if(process.env[key]!==undefined)refuse('unexpected variable set: '+key);

const args=process.argv.slice(2);let rootPath,audit=false,threshold;
for(let i=0;i<args.length;i++){
  if(args[i]==='--root')rootPath=args[++i];
  else if(args[i]==='--audit')audit=true;
  else if(args[i]==='--age-threshold-ms')threshold=Number(args[++i]);
  else refuse('unknown argument');
}
if(typeof rootPath!=='string'||!/^[A-Za-z0-9_-]{1,100}\/[A-Za-z0-9_-]{1,100}$/.test(rootPath))refuse('--root <collection/doc> is required');
if(threshold!==undefined&&(!Number.isSafeInteger(threshold)||threshold<1))refuse('--age-threshold-ms must be a positive integer');

const db=new Firestore({projectId:project});
try{
  const summary=await runPendingSweep(db,db.doc(rootPath),Date.now(),{audit,...(threshold!==undefined?{policy:{ageThresholdMs:threshold}}:{})});
  console.log(JSON.stringify(summary));
  process.exitCode=summary.ok?0:1;
}catch(error){
  console.log(JSON.stringify(error instanceof SweepError?{ok:false,code:error.code,stage:error.stage,alerted:error.alerted,summary:error.summary}:{ok:false,code:'sweep_failed',stage:'input'}));
  process.exitCode=1;
}
