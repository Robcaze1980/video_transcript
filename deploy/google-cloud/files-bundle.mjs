import {build} from 'esbuild';
await build({entryPoints:['server/commercial/filesEntry.ts','server/commercial/filesProof.ts','server/commercial/filesTailProof.ts'],outdir:'cloud-dist',bundle:true,platform:'node',target:'node24',format:'esm',packages:'external',banner:{js:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"}});
