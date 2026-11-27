// Integridad estatica del candidato congelado 61e64070c2ac6245caaee8eaad620feb68d9e246.
// Solo lectura: no escribe archivos, no abre red, no inicia emulador ni fixture y no contiene secretos.
// NO sustituye al comparador contra 0244bfc; NO verifica todo el setup ni todas las dependencias del proyecto.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import ts from 'typescript';

const base='61e64070c2ac6245caaee8eaad620feb68d9e246';
const repo=realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'));

if(process.argv.length!==3)throw Error('Use: node checkFinancialCandidateIntegrity.mjs <candidate-manifest>');
const manifestPath=path.resolve(process.argv[2]);

const head=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
if(head!==base)throw Error(`Unexpected HEAD ${head}; expected ${base}`);

const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const inside=(baseDir,file)=>{const relative=path.relative(baseDir,file);return relative!==''&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};

// Manifiesto candidato: identidad y mapa files.
const manifestEntry=lstatSync(manifestPath);
if(!manifestEntry.isFile()||manifestEntry.isSymbolicLink())throw Error('Candidate manifest is not an ordinary file');
const snapshot=JSON.parse(readFileSync(manifestPath,'utf8'));
if(typeof snapshot!=='object'||snapshot===null||Array.isArray(snapshot))throw Error('Candidate manifest is not an object');
if(snapshot.project!=='demo-vistavo-financial'||snapshot.host!=='127.0.0.1:8198'||snapshot.expectedSkipped!==5)throw Error('Unexpected candidate manifest identity');
if(!snapshot.files||typeof snapshot.files!=='object'||Array.isArray(snapshot.files))throw Error('Candidate manifest files map missing');

// Declaraciones del ejecutor contra el commit base.
const runnerPath='scripts/runFinancialRegressionEmulator.mjs';
const show=file=>execFileSync('git',['show',`${base}:${file}`],{cwd:repo,encoding:'utf8',maxBuffer:20_000_000});
const baseRunner=show(runnerPath);
const currentRunner=readFileSync(path.join(repo,runnerPath),'utf8');

const fixtureDeclaration=(source,label)=>{
  const match=/const fixtureFiles = \[([^\]]+)\];/s.exec(source);
  if(!match)throw Error(`fixtureFiles declaration missing: ${label}`);
  return [...match[1].matchAll(/'([^']+)'/g)].map(m=>m[1]);
};
const skippedDeclaration=(source,label)=>{
  const match=/const expectedSkippedNames = \[([\s\S]*?)\];/.exec(source);
  if(!match)throw Error(`expectedSkippedNames declaration missing: ${label}`);
  return [...match[1].matchAll(/'([^']+)'/g)].map(m=>m[1]);
};

const baseFiles=fixtureDeclaration(baseRunner,'base');
const currentFiles=fixtureDeclaration(currentRunner,'current');
if(JSON.stringify(baseFiles)!==JSON.stringify(currentFiles))throw Error('fixtureFiles differ from base');
if(currentFiles.length!==14||new Set(currentFiles).size!==14)throw Error('Expected exactly 14 unique fixture files');

const baseSkipped=skippedDeclaration(baseRunner,'base');
const currentSkipped=skippedDeclaration(currentRunner,'current');
if(currentSkipped.length!==5||new Set(currentSkipped).size!==5)throw Error('Expected exactly five voice skips');
if(JSON.stringify(baseSkipped)!==JSON.stringify(currentSkipped))throw Error('expectedSkippedNames differ from base');

const normalize=source=>source.split('\r\n').join('\n');
function calls(source,file){
  const parsed=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),found=[];
  function visit(node){
    if(ts.isCallExpression(node)){
      const callee=node.expression.getText(parsed);
      if(callee==='test'||callee.startsWith('test.')||callee==='it'||callee.startsWith('it.'))found.push(node.getText(parsed));
    }
    ts.forEachChild(node,visit);
  }
  visit(parsed);return found;
}
let total=0;
for(const file of currentFiles){
  const after=readFileSync(path.join(repo,file),'utf8');
  if(!after.trim())throw Error(`Empty fixture file: ${file}`);
  const previousSource=normalize(show(file)),currentSource=normalize(after);
  if(previousSource!==currentSource)throw Error(`Fixture file differs from base (hooks/setup included): ${file}`);
  const previous=calls(previousSource,file),current=calls(currentSource,file);
  if(!previous.length||!current.length)throw Error(`Missing test/it calls: ${file}`);
  if(previous.length!==current.length||JSON.stringify(previous)!==JSON.stringify(current))throw Error(`Test calls differ from base: ${file}`);
  total+=previous.length;
  process.stdout.write(`${file}: whole file matches base; ${previous.length} test-call bodies match\n`);
}

// Cobertura del manifiesto: runner, comparador y demas entradas listadas.
for(const required of ['scripts/runFinancialRegressionEmulator.mjs','scripts/checkFinancialCandidateIntegrity.mjs']){
  if(!Object.prototype.hasOwnProperty.call(snapshot.files,required))throw Error(`Manifest must include ${required}`);
}
let verified=0;
for(const [name,expected] of Object.entries(snapshot.files)){
  if(typeof expected!=='string'||!/^[0-9a-f]{64}$/.test(expected))throw Error(`Unsafe manifest hash for ${name}`);
  if(!name||!/^[A-Za-z0-9@._/-]+$/.test(name))throw Error('Unsafe manifest path');
  const segments=name.split('/');
  if(segments.some(part=>!part||part==='.'||part==='..'))throw Error('Unsafe manifest path segment');
  const target=path.join(repo,...segments);
  const entry=lstatSync(target);
  if(!entry.isFile()||entry.isSymbolicLink())throw Error(`Manifest entry is not an ordinary file: ${name}`);
  const real=realpathSync(target);
  if(!inside(repo,real)||real.toLowerCase()!==target.toLowerCase())throw Error(`Manifest entry escapes or differs: ${name}`);
  if(sha(real)!==expected)throw Error(`Manifest entry changed: ${name}`);
  verified++;
}

process.stdout.write(`Candidate integrity: PASS; base=${base}; fixtures=${currentFiles.length}; static-calls=${total}; manifest-entries=${verified}.\n`);
process.stdout.write('Does not replace the 0244bfc comparator. Does not cover every dependency file, races, concurrency or firewall; no immutable snapshot exists and there is a window until launch.\n');

