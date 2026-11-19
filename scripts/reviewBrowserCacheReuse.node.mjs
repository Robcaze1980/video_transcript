// Synthetic filesystem-only checks; no emulator, credentials, or cloud access.
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';
import test from 'node:test';
import {verifiedBrowserCache, verifiedPreviousBrowserCache} from './reviewBrowserCacheReuse.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
function fixture(){
  const parent=realpathSync(resolve('outputs')),root=join(parent,'lv019-b-cache-reuse-test-'+randomUUID());
  mkdirSync(root);const owner=randomUUID();writeFileSync(join(root,'.owner'),owner,{flag:'wx'});
  const manifests=join(root,'manifests');mkdirSync(manifests);
  const cache=join(manifests,'cache-'+randomUUID());mkdirSync(cache);
  const jar=join(cache,'cloud-firestore-emulator-v1.21.0.jar'),bytes=Buffer.from('synthetic emulator binary');writeFileSync(jar,bytes);
  const manifest=join(manifests,'manifest-'+randomUUID()+'.json');
  const content={version:1,project:'demo-vistavo-review-browser',host:'127.0.0.1:18765',authHost:'127.0.0.1:18766',expectedTests:1,jar:{path:jar,sha256:hash(bytes)}};
  const freeze=value=>{const text=JSON.stringify(value);writeFileSync(manifest,text);return hash(text);};
  const sourceJar={sha256:hash(bytes)};
  const verify=manifestSha256=>verifiedPreviousBrowserCache({manifestsDir:manifests,manifestPath:manifest,manifestSha256,sourceJar});
  return {root,parent,manifests,cache,jar,bytes,manifest,content,sourceJar,freeze,verify,cleanup(){
    const actual=realpathSync(root);assert.equal(actual.toLowerCase(),root.toLowerCase());assert.equal(dirname(actual).toLowerCase(),parent.toLowerCase());
    assert.match(basename(actual),/^lv019-b-cache-reuse-test-[a-f0-9-]{36}$/i);assert.equal(readFileSync(join(actual,'.owner'),'utf8'),owner);rmSync(actual,{recursive:true});
  }};
}

test('prior synthetic cache is reusable only after checking its manifest, real path and two hashes',async t=>{
  await t.test('accepts matching files without changing them',()=>{const f=fixture();try{
    const digest=f.freeze(f.content),before=readFileSync(f.manifest);assert.deepEqual(f.verify(digest),{path:f.jar,sha256:f.sourceJar.sha256});
    assert.deepEqual(readFileSync(f.manifest),before);assert.deepEqual(readFileSync(f.jar),f.bytes);
  }finally{f.cleanup();}});
  await t.test('rejects a wrong previous-manifest digest or project',()=>{const f=fixture();try{
    f.freeze(f.content);assert.throws(()=>f.verify('0'.repeat(64)),/manifest hash mismatch/);
    const digest=f.freeze({...f.content,project:'unrelated-project'});assert.throws(()=>f.verify(digest),/not for the dedicated synthetic/);
  }finally{f.cleanup();}});
  await t.test('rejects a previous manifest outside the task directory',()=>{const f=fixture();try{
    const text=JSON.stringify(f.content),outside=join(f.root,'manifest-'+randomUUID()+'.json');writeFileSync(outside,text);
    assert.throws(()=>verifiedPreviousBrowserCache({manifestsDir:f.manifests,manifestPath:outside,manifestSha256:hash(text),sourceJar:f.sourceJar}),/real task manifest/);
  }finally{f.cleanup();}});
  await t.test('rejects a jar outside the dedicated cache and a wrong cache-directory name',()=>{const f=fixture();try{
    const outside=join(f.root,'cloud-firestore-emulator-v1.21.0.jar');writeFileSync(outside,f.bytes);
    assert.throws(()=>verifiedBrowserCache({path:outside,sha256:f.sourceJar.sha256},f.manifests,f.sourceJar),/outside the synthetic browser task/);
    const fake=join(f.manifests,'cache-other');mkdirSync(fake);const file=join(fake,'cloud-firestore-emulator-v1.21.0.jar');writeFileSync(file,f.bytes);
    assert.throws(()=>verifiedBrowserCache({path:file,sha256:f.sourceJar.sha256},f.manifests,f.sourceJar),/outside the synthetic browser task/);
  }finally{f.cleanup();}});
  await t.test('rejects a changed jar, wrong manifest jar hash and wrong installed-binary hash',()=>{const f=fixture();try{
    const digest=f.freeze(f.content);writeFileSync(f.jar,'modified synthetic binary');assert.throws(()=>f.verify(digest),/Cache hash/);
    writeFileSync(f.jar,f.bytes);const changed=f.freeze({...f.content,jar:{path:f.jar,sha256:'0'.repeat(64)}});assert.throws(()=>f.verify(changed),/Cache hash/);
    assert.throws(()=>verifiedBrowserCache(f.content.jar,f.manifests,{sha256:'0'.repeat(64)}),/Cache hash/);
  }finally{f.cleanup();}});
});
