// Offline harness checks only: creates a synthetic profile and logs; never starts an emulator or finance fixture.
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

if(process.platform!=='win32'||!/^v24\./.test(process.version)||process.env.NODE_OPTIONS)throw Error('Use Windows Node 24 without NODE_OPTIONS');
const repo=realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'));
const systemRoot=process.env.SystemRoot??process.env.WINDIR;
if(!systemRoot||!path.isAbsolute(systemRoot))throw Error('Windows system directory unavailable');
const run=path.join(repo,'outputs','lv019-b-financial-isolated-preflight-20261126',`offline-${randomUUID()}`);
const profile=path.join(run,'profile'),temp=path.join(run,'temp');
mkdirSync(profile,{recursive:true});mkdirSync(temp);
const env={SystemRoot:systemRoot,WINDIR:systemRoot,PATH:path.join(systemRoot,'System32'),
  APPDATA:profile,USERPROFILE:profile,LOCALAPPDATA:profile,TEMP:temp,TMP:temp,
  NODE_ENV:'test',LV_REVIEW_CONTRACT:'1',LV_FINANCIAL_REGRESSION:'1',METADATA_SERVER_DETECTION:'none',
  FIRESTORE_EMULATOR_HOST:'127.0.0.1:8198',GOOGLE_CLOUD_PROJECT:'demo-vistavo-financial',GCLOUD_PROJECT:'demo-vistavo-financial'};
const checks=[
  {name:'root-guard',args:['--test','--test-isolation=none','--test-reporter=tap','scripts/checkFinancialOwnedRootGuard.mjs'],
    valid:s=>/^# tests 9\s*$/m.test(s)&&/^# pass 9\s*$/m.test(s)&&/^# fail 0\s*$/m.test(s)&&/^# skipped 0\s*$/m.test(s)},
  {name:'network-guard',args:['scripts/financialEmulatorNetworkGuard.windows.cjs'],
    valid:s=>{try{const value=JSON.parse(s.trim());return value.result==='PASS'&&value.negativeCases===21&&value.realConnectCalls===0&&value.positiveControl===true;}catch{return false;}}},
];
for(const check of checks){
  const result=spawnSync(process.execPath,check.args,{cwd:repo,env,encoding:'utf8',timeout:60000,windowsHide:true,maxBuffer:2_000_000});
  writeFileSync(path.join(run,`${check.name}.stdout.log`),result.stdout??'',{flag:'wx'});
  writeFileSync(path.join(run,`${check.name}.stderr.log`),result.stderr??'',{flag:'wx'});
  if(result.error||result.status!==0||result.signal||!check.valid(result.stdout??'')){
    writeFileSync(path.join(run,`${check.name}.result.json`),JSON.stringify({pass:false,status:result.status,signal:result.signal,error:result.error?.code??null})+'\n',{flag:'wx'});
    throw Error(`Offline ${check.name} incomplete; inspect preserved evidence: ${run}`);
  }
  writeFileSync(path.join(run,`${check.name}.result.json`),JSON.stringify({pass:true,status:0})+'\n',{flag:'wx'});
}
process.stdout.write(`Offline harness checks: PASS; evidence: ${run}\n`);
