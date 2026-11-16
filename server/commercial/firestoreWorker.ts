import { FirestoreBackend } from './firestoreBackend';
import {createHash} from 'node:crypto';

export interface WorkerMessage { accountId: string; jobId: string }
export interface DispatchTransport { start(message: WorkerMessage): Promise<void> }
export interface OnDemandProcessor {
  // This runs outside all database transactions. An ambiguous error is UNKNOWN.
  process(message: WorkerMessage & {attemptId: string; inputSha256: string; requestKey: string;
    providerRequestKey: string; work: Awaited<ReturnType<FirestoreBackend['job']>>},
    heartbeat: () => Promise<boolean>): Promise<'succeeded' | 'verified_failed'>;
}

/** Invoked by an authenticated trigger/scheduled recovery, not a resident poll loop. */
export async function dispatchPending(backend: FirestoreBackend, transport: DispatchTransport) {
  await backend.recoverExpiredLeases();
  let accepted = 0;
  for (const jobId of await backend.pendingDispatches()) {
    const event = await backend.claimDispatch(jobId);
    if (!event) continue;
    try {
      await transport.start({accountId: event.accountId, jobId});
      await backend.acknowledgeDispatch(jobId, event.dispatchAttempt);
      accepted++;
    } catch {
      // Lost transport response: preserve the leased event for bounded redelivery.
      // The same jobId is reused; a second worker cannot claim the provider again.
    }
  }
  return accepted;
}

/** One invocation processes one durable job. Caller authenticates the trigger. */
export async function processOnDemand(backend: FirestoreBackend, message: WorkerMessage, processor: OnDemandProcessor) {
  await backend.recover(message.accountId, message.jobId);
  const attempt = await backend.claim(message.accountId, message.jobId);
  if (!attempt) return 'not_claimed' as const;
  const job = await backend.job(message.accountId, message.jobId);
  try {
    if (!await backend.beginInvocation(message.accountId,message.jobId,attempt.attemptId)) return 'not_claimed' as const;
    // Recheck expiry/ownership and renew fencing immediately before remote work.
    if (!await backend.heartbeat(message.accountId, message.jobId, attempt.attemptId)) return 'unknown' as const;
    const result = await processor.process({...message, attemptId: attempt.attemptId,
      inputSha256: job.inputSha256, requestKey: job.requestKey, work: job,
      providerRequestKey: createHash('sha256').update(JSON.stringify(['vistavo:v1',message.accountId,message.jobId,job.requestKey,job.inputSha256])).digest('hex')},
    () => backend.heartbeat(message.accountId, message.jobId, attempt.attemptId));
    if (result !== 'succeeded' && result !== 'verified_failed') throw Error('Invalid processor outcome');
    await backend.finish(message.accountId, message.jobId, attempt.attemptId, result === 'succeeded');
    // A successful remote result can be refunded after expiry. Report persisted state.
    return (await backend.job(message.accountId,message.jobId)).state;
  } catch {
    await backend.quarantine(message.accountId, message.jobId, attempt.attemptId);
    // A lost commit acknowledgement may already have settled the job.
    return (await backend.job(message.accountId,message.jobId)).state;
  }
}
