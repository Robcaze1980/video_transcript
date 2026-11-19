// Validate a cache from a prior synthetic browser-test manifest. No writes.
import {createHash} from 'node:crypto';
import {closeSync, fstatSync, lstatSync, openSync, readFileSync, readSync, realpathSync} from 'node:fs';
import path from 'node:path';

const samePath=(a,b)=>a.toLowerCase()===b.toLowerCase();
const fail=message=>{throw Error(message);};
const isHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function hashFile(file){
  const fd=openSync(file,'r'),hash=createHash('sha256'),chunk=Buffer.allocUnsafe(1024*1024);
  try{
    if(!fstatSync(fd).isFile())fail('Cache object must be a regular file');
    for(;;){const read=readSync(fd,chunk,0,chunk.length,null);if(!read)break;hash.update(chunk.subarray(0,read));}
    return hash.digest('hex');
  }finally{closeSync(fd);}
}

export function verifiedBrowserCache(cacheRecord,manifestsDir,sourceJar){
  if(!cacheRecord||Object.keys(cacheRecord).sort().join(',')!=='path,sha256'||typeof cacheRecord.path!=='string'||!path.isAbsolute(cacheRecord.path)||!isHash(cacheRecord.sha256)||!isHash(sourceJar?.sha256))fail('Invalid cache identity');
  const root=realpathSync(manifestsDir),candidate=path.resolve(cacheRecord.path),info=lstatSync(candidate);
  if(!info.isFile()||info.isSymbolicLink())fail('Cache jar must be a regular file');
  const jar=realpathSync(candidate),cacheDir=path.dirname(jar),dirInfo=lstatSync(cacheDir);
  if(!samePath(candidate,jar)||!samePath(path.dirname(cacheDir),root)||!/^cache-[a-f0-9-]{36}$/i.test(path.basename(cacheDir))||
      !dirInfo.isDirectory()||dirInfo.isSymbolicLink()||!samePath(realpathSync(cacheDir),cacheDir)||
      path.basename(jar)!=='cloud-firestore-emulator-v1.21.0.jar')fail('Cache path is outside the synthetic browser task');
  const sha256=hashFile(jar);
  if(sha256!==cacheRecord.sha256||sha256!==sourceJar.sha256)fail('Cache hash does not match the prior manifest and installed emulator');
  return {path:jar,sha256};
}

export function verifiedPreviousBrowserCache({manifestsDir,manifestPath,manifestSha256,sourceJar}){
  if(typeof manifestPath!=='string'||!path.isAbsolute(manifestPath)||!isHash(manifestSha256))fail('Invalid previous manifest reference');
  const root=realpathSync(manifestsDir),candidate=path.resolve(manifestPath),info=lstatSync(candidate);
  if(!info.isFile()||info.isSymbolicLink()||info.size>2_000_000||!/^manifest-[a-f0-9-]{36}\.json$/i.test(path.basename(candidate))||
      !samePath(path.dirname(candidate),root)||!samePath(realpathSync(candidate),candidate))fail('Previous manifest must be a real task manifest');
  const bytes=readFileSync(candidate);
  if(createHash('sha256').update(bytes).digest('hex')!==manifestSha256)fail('Previous manifest hash mismatch');
  const manifest=JSON.parse(bytes.toString('utf8'));
  if(!manifest||manifest.version!==1||manifest.project!=='demo-vistavo-review-browser'||manifest.host!=='127.0.0.1:18765'||
      manifest.authHost!=='127.0.0.1:18766'||manifest.expectedTests!==1)fail('Previous manifest is not for the dedicated synthetic browser test');
  return verifiedBrowserCache(manifest.jar,root,sourceJar);
}
