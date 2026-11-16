import {build} from 'esbuild';import fs from 'node:fs/promises';
const files=['contracts.ts','backend.ts','http.ts','runtime.ts','entry.ts'];
const result=await build({entryPoints:['server/account/entry.ts'],outdir:'account-dist',bundle:true,platform:'node',target:'node24',format:'esm',packages:'external',metafile:true,banner:{js:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"}});
for(const input of Object.keys(result.metafile.inputs))if(!files.some(name=>input==='server/account/'+name))throw Error('Account bundle imported outside exact account allowlist');
await fs.writeFile('account-dist/source-inputs.json',JSON.stringify(Object.keys(result.metafile.inputs).sort()));
