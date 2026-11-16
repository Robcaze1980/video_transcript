import {createServer} from 'node:http';
import {firestoreRuntime} from './firestoreRuntime';
import {firestoreHttp} from './firestoreHttp';

// Separate from pilotLocal/server/index: no PG, simulated payments or polling.
const project = process.env.VISTAVO_PROJECT_ID;
if (project !== 'vistavo-prod' && project !== 'linguistvision-dev') throw Error('Explicit Vistavo project required');
const runtime = firestoreRuntime(project);
const origin = process.env.VISTAVO_PUBLIC_ORIGIN;
if (!origin) throw Error('Explicit public origin required');
const port = Number(process.env.PORT ?? '8080');
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw Error('Invalid port');
const server = createServer(firestoreHttp({...runtime, origin}));
server.requestTimeout = 30000;
server.headersTimeout = 10000;
server.listen(port,'0.0.0.0');
for (const signal of ['SIGTERM','SIGINT'] as const) process.once(signal,()=>{
  server.close(()=>{void runtime.close().then(()=>process.exit(0),()=>process.exit(1));});
  setTimeout(()=>process.exit(1),10000).unref();
});
