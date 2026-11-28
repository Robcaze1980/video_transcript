// Compare test-call bodies with 0244bfc; this does not execute tests or contact an emulator.
import {execFileSync} from 'node:child_process';
import {readFileSync,realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import ts from 'typescript';

const base='0244bfc591368524a4b980312c20c9b53952a532';
const repo=realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'));
const runner=readFileSync(path.join(repo,'scripts/runFinancialRegressionEmulator.mjs'),'utf8');
const declaration=/const fixtureFiles = \[([^\]]+)\];/s.exec(runner);
if(!declaration)throw Error('Fixture declaration missing');
const files=[...declaration[1].matchAll(/'([^']+)'/g)].map(match=>match[1]);
if(files.length!==14||new Set(files).size!==14)throw Error('Expected exactly 14 fixture files');
const normalize=(source,file)=>{
  let result=source.replace(/\r\n/g,'\n').replaceAll('demo-vistavo-financial','demo-vistavo-ledger').replaceAll('8198','8185');
  if(file==='server/account/unblockAudited.emulator.mjs')result=result.replaceAll('f=await fixture()','f=fixture()');
  return result;
};
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
for(const file of files){
  const before=execFileSync('git',['show',`${base}:${file}`],{cwd:repo,encoding:'utf8',maxBuffer:10_000_000});
  const after=readFileSync(path.join(repo,file),'utf8');
  const previous=calls(normalize(before,file),file),current=calls(normalize(after,file),file);
  if(!previous.length||JSON.stringify(previous)!==JSON.stringify(current))throw Error(`Test calls differ from base: ${file}`);
  total+=previous.length;
  process.stdout.write(`${file}: ${previous.length} test-call bodies match\n`);
}
process.stdout.write(`Test-call equivalence: PASS; files=${files.length}; static-calls=${total}. Fixture setup, safety, target and test-only backend gate differ.\n`);
