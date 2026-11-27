// Freeze local inputs before an isolated emulator run. This script makes no network calls.
import {createHash,randomUUID} from 'node:crypto';
import {lstatSync,mkdirSync,readFileSync,readdirSync,realpathSync,writeFileSync} from 'node:fs';
import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=realpathSync(resolve(dirname(fileURLToPath(import.meta.url)),'../../..'));
const [mode,jdkArg,jarArg,manifestArg]=process.argv.slice(2);
if(!['prepare','verify'].includes(mode)||!jdkArg||!jarArg||mode==='verify'&&!manifestArg||mode==='prepare'&&manifestArg)throw Error('Use prepare <jdk> <jar> or verify <jdk> <jar> <manifest>');
const jdk=realpathSync(resolve(jdkArg)),jar=realpathSync(resolve(jarArg)),node=realpathSync(process.execPath);
const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
function inside(base,file){const rel=relative(base,file);return rel!==''&&rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel);}
function ordinary(file){const resolved=realpathSync(file),info=lstatSync(file);if(!info.isFile()||info.isSymbolicLink()||resolved.toLowerCase()!==resolve(file).toLowerCase())throw Error('Unexpected file or link: '+file);return resolved;}
function tree(name){
  const base=join(root,name),paths=[];
  function walk(dir){
    for(const entry of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
      const file=join(dir,entry.name),info=lstatSync(file);
      if(info.isSymbolicLink()||!(info.isDirectory()||info.isFile()))throw Error('Unexpected tree entry: '+file);
      if(info.isDirectory())walk(file);else paths.push({file,size:info.size});
    }
  }
  walk(base);
  const hash=createHash('sha256');let bytes=0;
  for(const item of paths){if(!inside(root,item.file))throw Error('Input escapes workspace');const local=relative(root,item.file).split(sep).join('/');bytes+=item.size;hash.update(local+'\0'+item.size+'\0'+sha(item.file)+'\n');}
  return {count:paths.length,bytes,sha256:hash.digest('hex')};
}
const localFiles=[
  'package.json','package-lock.json','tsconfig.json','types.ts','deploy/google-cloud/firestore.rules',
  'docs/specs/LV-019-B-observacion-edad-intenciones.md',
  'docs/evidence/lv019-b-entry-continuity-20261126/network-guard.cjs',
  'docs/evidence/lv019-b-age-observation-20261126/InspectOwnedFirestore.java',
  'docs/evidence/lv019-b-age-observation-20261126/run-inspected.ps1',
  'docs/evidence/lv019-b-age-observation-20261126/manifest.mjs',
];
const external=[node,jar,join(jdk,'bin/java.exe'),join(jdk,'bin/javac.exe'),join(jdk,'bin/java.dll'),join(jdk,'bin/server/jvm.dll'),join(jdk,'lib/modules')];
const snapshot={version:1,project:'demo-vistavo-admission',address:'127.0.0.1',ports:[8197,9197,9297],
  node:{path:node,version:process.version},jdk,jar,
  files:Object.fromEntries([...localFiles.map(name=>[name,ordinary(join(root,name))]),...external.map(name=>[name,ordinary(name)])].map(([name,file])=>[name,sha(file)])),
  trees:Object.fromEntries(['server','config','utils','services','scripts','deploy','node_modules'].map(name=>[name,tree(name)])),
  limitation:'Pre/post hashes do not create an immutable snapshot; native code and Java are not an OS network firewall.'};
if(snapshot.files[jar]!=='c3d3680a89d946a90a027365ea14c26c6472a162bcf37f099bbb1ebd66d25e8e')throw Error('Unexpected emulator JAR');
if(mode==='prepare'){
  const dir=join(root,'outputs','age-observation-manifests');mkdirSync(dir,{recursive:true});
  const output=join(dir,`manifest-${randomUUID()}.json`);writeFileSync(output,JSON.stringify(snapshot,null,2)+'\n',{flag:'wx'});
  process.stdout.write(`Prepared manifest: ${output}\nSHA-256: ${sha(output)}\n`);
}else{
  const dir=realpathSync(join(root,'outputs','age-observation-manifests')),file=ordinary(resolve(manifestArg));
  if(dirname(file).toLowerCase()!==dir.toLowerCase()||!/^manifest-[a-f0-9-]{36}\.json$/.test(file.split(sep).at(-1)))throw Error('Manifest outside the task directory');
  const previous=JSON.parse(readFileSync(file,'utf8'));
  if(JSON.stringify(previous)!==JSON.stringify(snapshot))throw Error('Frozen inputs differ from manifest');
  process.stdout.write(`Manifest verified: ${sha(file)}\n`);
}
