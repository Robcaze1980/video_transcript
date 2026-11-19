import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe,it,expect} from 'vitest';

const read=(path:string)=>readFileSync(resolve(process.cwd(),path),'utf8');

describe('reviewed translation switch is candidate-only',()=>{
 it('keeps the committed/production default off and the candidate module on',()=>{
  expect(read('server/commercial/web/reviewedTranslationFeature.ts')).toMatch(/REVIEWED_TRANSLATION_CANDIDATE:\s*boolean\s*=\s*false/);
  expect(read('server/commercial/web/reviewedTranslationFeature.candidate.ts')).toMatch(/REVIEWED_TRANSLATION_CANDIDATE:\s*boolean\s*=\s*true/);
 });
 it('swaps the module only in candidate mode, and the default build script never uses that mode',()=>{
  const config=read('vite.pilot.config.ts'),pkg=JSON.parse(read('package.json')).scripts as Record<string,string>;
  expect(config).toMatch(/mode === 'candidate'/);
  expect(config).toContain('reviewedTranslationFeature.candidate.ts');
  expect(pkg.build).not.toContain('candidate');
  expect(pkg['build:candidate']).toContain('--mode candidate');
 });
 it('registers the review service only in the local candidate runtime, behind the existing pilot authorization',()=>{
  const source=read('server/commercial/cloudCandidateLocal.ts');
  expect(source).toContain('new FirestoreReviewedTranslation(db,root,backend,objects)');
  expect(source).toMatch(/authorizeUser:existingPilotAuthorization\(root\),requirePilotBalance:true,files,ai,reviewedTranslation/);
  for(const other of ['cloudApi.ts','isolatedCandidateLocal.ts','cloudFilesRuntime.ts'])expect(read('server/commercial/'+other)).not.toContain('reviewedTranslation');
 });
});
