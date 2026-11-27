// Freeze candidate and local executable hashes. This command does not start an emulator or fixture.
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync,lstatSync,mkdirSync,readFileSync,realpathSync,statSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const base='a0f1cc42dd50ae221d4b2ee17c08a7c56fa0b15b';
const repo=realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'));
const [candidateArg,jdkArg,jarArg]=process.argv.slice(2);
if(process.argv.length!==5||process.platform!=='win32'||!/^v24\./.test(process.version)||process.env.NODE_OPTIONS||!candidateArg||!jdkArg||!jarArg)
  throw Error('Use Windows Node 24: prepareUnblockFenceIsolation.mjs <candidate-manifest> <jdk> <jar>');
const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const ordinary=file=>{const entry=lstatSync(file),real=realpathSync(file);if(!entry.isFile()||entry.isSymbolicLink()||real.toLowerCase()!==path.resolve(file).toLowerCase())throw Error('Unexpected file or link');return real;};
const inside=(baseDir,file)=>{const relative=path.relative(baseDir,file);return relative!==''&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
const head=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
if(head!==base)throw Error('Unexpected base revision');
const candidate=ordinary(path.resolve(candidateArg)),manifestDir=realpathSync(path.join(repo,'outputs','lv019-b-unblock-fence-manifests'));
if(path.dirname(candidate).toLowerCase()!==manifestDir.toLowerCase())throw Error('Candidate manifest is outside its task directory');
const snapshot=JSON.parse(readFileSync(candidate,'utf8'));
if(snapshot.version!==1||snapshot.project!=='demo-vistavo-financial'||snapshot.host!=='127.0.0.1:8198'||snapshot.expectedSelected!==5||!snapshot.files)
  throw Error('Unexpected candidate manifest');
const node=ordinary(process.execPath),nodeSha=sha(node);
if(snapshot.node?.path?.toLowerCase()!==node.toLowerCase()||snapshot.node?.sha256!==nodeSha||snapshot.node?.version!==process.version)
  throw Error('Candidate Node identity mismatch');
for(const [name,expected] of Object.entries(snapshot.files)){
  if(!/^[A-Za-z0-9@._/-]+$/.test(name)||name.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Unsafe candidate path');
  const file=ordinary(path.join(repo,...name.split('/')));
  if(!inside(repo,file)||sha(file)!==expected)throw Error(`Candidate input changed: ${name}`);
}
const jdk=realpathSync(path.resolve(jdkArg));
if(!statSync(jdk).isDirectory())throw Error('JDK path is not a directory');
const names={java:'bin/java.exe',javac:'bin/javac.exe',javaDll:'bin/java.dll',jvm:'bin/server/jvm.dll',modules:'lib/modules'};
const jdkFiles={};
for(const [name,relative] of Object.entries(names)){
  const file=ordinary(path.join(jdk,...relative.split('/')));
  if(!inside(jdk,file))throw Error('JDK file escapes its root');
  jdkFiles[name]={path:file,sha256:sha(file)};
}
const jar=ordinary(path.resolve(jarArg)),jarSha=sha(jar);
if(jarSha!=='c3d3680a89d946a90a027365ea14c26c6472a162bcf37f099bbb1ebd66d25e8e')throw Error('Unexpected emulator JAR');
const output=path.join(repo,'outputs','lv019-b-unblock-fence-isolation-manifests');
if(!existsSync(output))mkdirSync(output);
if(lstatSync(output).isSymbolicLink()||!inside(repo,realpathSync(output)))throw Error('Unsafe manifest directory');
const result={version:1,base,project:snapshot.project,host:snapshot.host,fixedPorts:[8198,9198,9298],
  candidate:{path:candidate,sha256:sha(candidate),trackedCount:Object.keys(snapshot.files).length},
  node:{path:node,version:process.version,sha256:nodeSha},jdk:{path:jdk,files:jdkFiles},jar:{path:jar,sha256:jarSha},
  limitation:'File hashes before/after are not immutable snapshots; unlisted transitive files and native networking are not firewalled.'};
const destination=path.join(output,`manifest-${randomUUID()}.json`);
writeFileSync(destination,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
process.stdout.write(`Isolated regression inputs frozen: ${destination}\nSHA-256: ${sha(destination)}\nNo emulator or fixture was started.\n`);
