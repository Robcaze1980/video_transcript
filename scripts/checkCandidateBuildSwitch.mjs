// Diagnostic only: builds the REAL pilot bundle in candidate mode (what `npm run build:candidate` produces) and in the default mode
// (what `npm run build` produces for the pilot config) into TEMPORARY directories, and checks in the compiled output that the
// reviewed-translation switch is on only in the candidate bundle. It never touches dist/ and never uses the synthetic test plugin.
// Usage: node scripts/checkCandidateBuildSwitch.mjs   (run from the repository root)
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {build} from 'vite';

// Literals that live only in one branch of `REVIEWED_TRANSLATION_CANDIDATE ? … : …` in cloudCandidate.tsx.
const ENABLED_ONLY='La revisión por frases tiene sus propias descargas',DISABLED_ONLY='este ensayo no incluye el editor SRT avanzado';
const ENTRY='server/commercial/web/cloudCandidate.tsx';

/** Text of the entry chunk and of every chunk it imports, from the Vite manifest. */
function chunkText(out,manifest,key,seen=new Set()){
  if(seen.has(key))return '';seen.add(key);
  const entry=manifest[key];assert.ok(entry?.file,'manifest entry for '+key);
  return readFileSync(join(out,entry.file),'utf8')+(entry.imports??[]).map(i=>chunkText(out,manifest,i,seen)).join('\n');
}
async function bundle(mode){
  const out=mkdtempSync(join(tmpdir(),'lv-switch-'+mode+'-'));
  try{
    await build({configFile:resolve('vite.pilot.config.ts'),mode,logLevel:'error',build:{outDir:out,emptyOutDir:true}});
    const manifest=JSON.parse(readFileSync(join(out,'.vite','manifest.json'),'utf8'));
    const text=chunkText(out,manifest,ENTRY);
    return {hasEnabled:text.includes(ENABLED_ONLY),hasDisabled:text.includes(DISABLED_ONLY),bytes:text.length};
  }finally{rmSync(out,{recursive:true,force:true});}
}
const candidate=await bundle('candidate'),standard=await bundle('production');
assert.equal(candidate.hasEnabled,true,'the candidate bundle contains the reviewed-translation (enabled) branch');
assert.equal(candidate.hasDisabled,false,'the candidate bundle does not contain the disabled branch');
assert.equal(standard.hasEnabled,false,'the default bundle does not contain the reviewed-translation (enabled) branch');
assert.equal(standard.hasDisabled,true,'the default bundle keeps the disabled branch');
console.log(JSON.stringify({ok:true,candidate,default:standard,distTouched:false}));
