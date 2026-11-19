import assert from 'node:assert/strict';
import test from 'node:test';
import {assertHeadlessBrowserProduct,assertPinnedBrowserIdentity,SYNTHETIC_BROWSER_PATH,SYNTHETIC_BROWSER_PRODUCT,SYNTHETIC_BROWSER_SHA256} from './reviewBrowserBinaryIdentity.mjs';

test('accepts only the exact pinned synthetic browser identity',()=>{
  const valid={path:SYNTHETIC_BROWSER_PATH,sha256:SYNTHETIC_BROWSER_SHA256};assert.equal(assertPinnedBrowserIdentity(valid),valid);
  for(const invalid of [
    {...valid,path:'C:/Program Files/Google/Chrome/Application/chrome.exe'},
    {...valid,path:'C:/Users/rob62/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/other.exe'},
    {...valid,sha256:'0'.repeat(64)},
    {...valid,unexpected:'extra'},null,
  ])assert.throws(()=>assertPinnedBrowserIdentity(invalid),/does not match the pinned executable/);
});

test('requires the expected HeadlessChrome product response',()=>{
  assert.doesNotThrow(()=>assertHeadlessBrowserProduct({product:SYNTHETIC_BROWSER_PRODUCT}));
  for(const invalid of [{product:'Chrome/151.0.7922.34'},{product:'HeadlessChrome/152.0.0.0'},{product:'Edg/157.0.0.0'},{product:''},null]){
    assert.throws(()=>assertHeadlessBrowserProduct(invalid),/did not identify as the pinned HeadlessChrome/);
  }
});
