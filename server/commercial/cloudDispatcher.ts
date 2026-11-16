import {firestoreRuntime} from './firestoreRuntime';
import {cloudRunDispatch} from './cloudRunDispatch';
import {dispatchPending} from './firestoreWorker';

// An IAM-protected Cloud Run Job, invoked by Scheduler or an authenticated trigger.
// It exits after one bounded recovery/dispatch batch. No resident polling timer.
const projectId = process.env.VISTAVO_PROJECT_ID;
if (projectId !== 'vistavo-prod' && projectId !== 'linguistvision-dev') throw Error('Explicit Vistavo project required');
const jobName = process.env.VISTAVO_WORKER_JOB;
if (!jobName) throw Error('Explicit worker target required');
const runtime = firestoreRuntime(projectId);
try {
  const accepted = await dispatchPending(runtime.backend,cloudRunDispatch({projectId,region:'us-central1',jobName,accessToken:runtime.accessToken}));
  console.log(JSON.stringify({event:'dispatch_completed',accepted}));
} catch (error) {
  // Do not serialize SDK exception objects: they can contain authorization headers.
  console.error(JSON.stringify({event:'dispatch_failed',error:error instanceof Error ? error.name : 'Error'}));
  process.exitCode = 1;
} finally {await runtime.close();}
