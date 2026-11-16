import type { DispatchTransport, WorkerMessage } from './firestoreWorker';

/** Access tokens come from managed identity/ADC, never service-account JSON. */
export function cloudRunDispatch(options: {
  projectId: 'vistavo-prod' | 'linguistvision-dev'; region: 'us-central1'; jobName: string;
  accessToken: () => Promise<string>; request?: typeof fetch;
}): DispatchTransport {
  if (!['vistavo-prod', 'linguistvision-dev'].includes(options.projectId) || options.region !== 'us-central1' ||
      !/^vistavo-[a-z0-9-]+$/.test(options.jobName)) throw Error('Invalid dispatch target');
  const url = `https://run.googleapis.com/v2/projects/${options.projectId}/locations/${options.region}/jobs/${options.jobName}:run`;
  return {async start(message: WorkerMessage) {
    const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
    if (!uuid.test(message.accountId) || !uuid.test(message.jobId)) throw Error('Invalid dispatch message');
    const response = await (options.request ?? fetch)(url, {method: 'POST', headers: {
      Authorization: 'Bearer ' + await options.accessToken(), 'Content-Type': 'application/json',
      'x-goog-user-project': options.projectId,
    }, signal:AbortSignal.timeout(20000), body: JSON.stringify({overrides: {taskCount: 1, containerOverrides: [{env: [
      {name: 'VISTAVO_ACCOUNT_ID', value: message.accountId}, {name: 'VISTAVO_JOB_ID', value: message.jobId},
    ]}]}})});
    // Acceptance of an LRO is deliberately not treated as worker completion.
    if (!response.ok) throw Error(`Cloud Run dispatch HTTP ${response.status}`);
    const operation = await response.json();
    if (typeof operation.name !== 'string' || !operation.name.startsWith(`projects/${options.projectId}/locations/${options.region}/operations/`) || operation.error) throw Error('Invalid dispatch receipt');
  }};
}
