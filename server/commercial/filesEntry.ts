import {filesMain} from './cloudFilesRuntime';
filesMain().catch(error=>{console.error(JSON.stringify({event:'file-runtime-failed',type:error?.name??'Error'}));process.exitCode=1;});
