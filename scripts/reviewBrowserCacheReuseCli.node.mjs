// Test rejection by the real launcher without starting an emulator or fixture.
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdirSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync} from 'node:fs';
import {basename, dirname, join, parse, resolve} from 'node:path';
import test from 'node:test';

test('launcher rejects a foreign prior manifest and wrong manifest hash before preparing',()=>{
  if(process.platform!=='win32')throw Error('This launcher test requires Windows');
  const node='C:/Users/rob62/AppData/Local/LinguistVision/tools/node-v24.13.0-win-x64/node.exe';
  const outputs=realpathSync(resolve('outputs')),bootstrap=join(outputs,'lv019-b-review-browser-bootstrap'),manifests=join(outputs,'lv019-b-review-browser-manifests');
  const boot=join(bootstrap,'boot-'+randomUUID()),profile=join(boot,'profile'),temp=join(boot,'temp');
  mkdirSync(boot);mkdirSync(profile);mkdirSync(temp);
  const marker=randomUUID().replaceAll('-',''),owner=join(profile,'.synthetic-bootstrap-owner');writeFileSync(owner,marker,{flag:'wx'});
  const text='{"synthetic":true}',digest=createHash('sha256').update(text).digest('hex');
  const fake=join(manifests,'manifest-'+randomUUID()+'.json'),outside=join(boot,'manifest-'+randomUUID()+'.json');
  writeFileSync(fake,text,{flag:'wx'});writeFileSync(outside,text,{flag:'wx'});
  try{
    const systemRoot=process.env.SystemRoot??process.env.WINDIR;assert.ok(systemRoot);
    const env={SystemRoot:systemRoot,WINDIR:systemRoot,PATH:join(systemRoot,'System32'),
      USERPROFILE:profile,APPDATA:profile,LOCALAPPDATA:profile,TEMP:temp,TMP:temp,
      HOMEDRIVE:parse(profile).root.slice(0,2),HOMEPATH:profile.slice(2),SYSTEMDRIVE:parse(systemRoot).root.slice(0,2),
      USERNAME:'synthetic-review',USERDOMAIN:'SYNTHETIC',LOGONSERVER:'SYNTHETIC',
      LV_REVIEW_BROWSER_BOOTSTRAP:boot,LV_REVIEW_BROWSER_BOOTSTRAP_MARKER:marker};
    const run=(manifest,sha)=>spawnSync(node,['scripts/runReviewedTranslationBrowserEmulator.mjs','--prepare','--reuse-cache',manifest,sha],{cwd:resolve('.'),env,encoding:'utf8',timeout:25_000,windowsHide:true});
    const wrongHash=run(fake,'0'.repeat(64));assert.notEqual(wrongHash.status,0);assert.match(wrongHash.stderr,/Previous manifest hash mismatch/);assert.doesNotMatch(wrongHash.stdout,/Synthetic manifest prepared/);
    const wrongPath=run(outside,digest);assert.notEqual(wrongPath.status,0);assert.match(wrongPath.stderr,/Previous manifest must be a real task manifest/);assert.doesNotMatch(wrongPath.stdout,/Synthetic manifest prepared/);
    assert.equal(readFileSync(fake,'utf8'),text);assert.equal(readFileSync(outside,'utf8'),text);
  }finally{
    const actualFake=realpathSync(fake);assert.equal(dirname(actualFake).toLowerCase(),realpathSync(manifests).toLowerCase());assert.match(basename(actualFake),/^manifest-[a-f0-9-]{36}\.json$/i);assert.equal(readFileSync(actualFake,'utf8'),text);unlinkSync(actualFake);
    const actual=realpathSync(boot);assert.equal(actual.toLowerCase(),boot.toLowerCase());assert.equal(dirname(actual).toLowerCase(),realpathSync(bootstrap).toLowerCase());assert.match(basename(actual),/^boot-[a-f0-9-]{36}$/i);assert.equal(readFileSync(owner,'utf8'),marker);rmSync(actual,{recursive:true});
  }
});
