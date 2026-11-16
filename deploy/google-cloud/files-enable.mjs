import {cloudClient,projectNumber} from './cloudClient.mjs';
const cloud=await cloudClient('outputs/vistavo-gcs-cloud/enable-journal.json');
for(const api of ['firestore.googleapis.com','cloudscheduler.googleapis.com','iamcredentials.googleapis.com']){
 const url='https://serviceusage.googleapis.com/v1/projects/'+projectNumber+'/services/'+api;
 const prior=await cloud.required(url,'GET',undefined,'api-read');
 if(prior.state==='ENABLED'){console.log(JSON.stringify({api,state:'already-enabled'}));continue;}
 if(prior.state!=='DISABLED')throw Error('API state unknown');
 if(!process.argv.includes('--apply')){console.log(JSON.stringify({api,action:'would-enable'}));continue;}
 const operation=await cloud.required(url+':enable','POST',{},'api-enable');if(operation.name)await cloud.wait(operation.name,'serviceusage.googleapis.com');
 const current=await cloud.required(url,'GET',undefined,'api-confirm');if(current.state!=='ENABLED')throw Error('API enable not confirmed');
 console.log(JSON.stringify({api,state:current.state}));
}
