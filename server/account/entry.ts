import {createServer} from 'node:http';
import {accountRuntime} from './runtime';
import {accountHttp} from './http';

async function main(){
 const runtime=await accountRuntime(),port=Number(process.env.PORT??8080);if(!Number.isSafeInteger(port)||port<1||port>65535)throw Error('Account port boundary');
 const listener=accountHttp(runtime.store,runtime.identity),server=createServer((req,res)=>{void listener(req,res);});
 server.requestTimeout=30000;server.headersTimeout=15000;
 let stopping=false;const stop=()=>{if(stopping)return;stopping=true;server.close(()=>{void runtime.close().finally(()=>process.exit(0));});setTimeout(()=>{server.closeAllConnections();void runtime.close().finally(()=>process.exit(1));},9000).unref();};
 process.on('SIGTERM',stop);process.on('SIGINT',stop);server.listen(port,'0.0.0.0');
}
main().catch(()=>{console.error(JSON.stringify({event:'account-runtime-failed'}));process.exitCode=1;});
