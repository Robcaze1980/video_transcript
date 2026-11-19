// Dedicated synthetic-browser executable; unrelated to production or customer browsers.
import {createHash} from 'node:crypto';
import {closeSync,fstatSync,lstatSync,openSync,readSync,realpathSync} from 'node:fs';
import path from 'node:path';

export const SYNTHETIC_BROWSER_PATH='C:/Users/rob62/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe';
export const SYNTHETIC_BROWSER_SHA256='ce4635cd0e5dc0e21494542a701f347e91c1f1d821970578d97ed8df4ced50ef';
export const SYNTHETIC_BROWSER_PRODUCT='HeadlessChrome/151.0.7922.34';
const sameWindowsPath=(a,b)=>path.win32.normalize(a).toLowerCase()===path.win32.normalize(b).toLowerCase();

export function assertPinnedBrowserIdentity(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='path,sha256'||
      typeof value.path!=='string'||!path.win32.isAbsolute(value.path)||!sameWindowsPath(value.path,SYNTHETIC_BROWSER_PATH)||value.sha256!==SYNTHETIC_BROWSER_SHA256){
    throw Error('Synthetic browser identity does not match the pinned executable');
  }
  return value;
}

export function readPinnedBrowserIdentity(){
  if(process.platform!=='win32')throw Error('Synthetic browser identity requires Windows');
  const candidate=path.resolve(SYNTHETIC_BROWSER_PATH),info=lstatSync(candidate);
  if(!info.isFile()||info.isSymbolicLink())throw Error('Synthetic browser must be a regular executable');
  const actual=realpathSync(candidate);if(!sameWindowsPath(actual,candidate))throw Error('Synthetic browser real path mismatch');
  const fd=openSync(actual,'r'),digest=createHash('sha256'),chunk=Buffer.allocUnsafe(1024*1024);
  try{if(!fstatSync(fd).isFile())throw Error('Synthetic browser must be a regular executable');
    for(;;){const read=readSync(fd,chunk,0,chunk.length,null);if(!read)break;digest.update(chunk.subarray(0,read));}
  }finally{closeSync(fd);}
  return assertPinnedBrowserIdentity({path:actual,sha256:digest.digest('hex')});
}

export function assertHeadlessBrowserProduct(value){
  if(!value||typeof value!=='object'||value.product!==SYNTHETIC_BROWSER_PRODUCT)throw Error('Synthetic browser did not identify as the pinned HeadlessChrome');
}
