import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {authPrefixes,authCsp,publicAuthAssets,assertPublicDirectoryBinding,assertAccountHosting} from './publicAuthAssets.mjs';
const evidence=path.resolve(process.env.VISTAVO_PUBLIC_EVIDENCE??'outputs/vistavo-public'),root=path.join(evidence,'site');
const manifest=JSON.parse(await fs.readFile(path.join(evidence,'build-proof.json'),'utf8'));
const configFile=path.resolve(process.env.VISTAVO_PUBLIC_CONFIG??'firebase.commercial.json');
const config=JSON.parse(await fs.readFile(configFile,'utf8'));
assertPublicDirectoryBinding(configFile,config.hosting.public,root);
const sha=b=>createHash('sha256').update(b).digest('hex'),allowed=new Set(manifest.files.map(f=>f.name)),fixed=new Set(JSON.parse(await fs.readFile('scripts/commercialStaticFiles.json','utf8')));
const locales=['en-us','es-419','pt-br','fr','de','ja','ko','ar','zh-hans','vi'];
for(const prefix of authPrefixes)for(const locale of locales)fixed.add(prefix+'/'+locale+'/index.html');
for(const file of await publicAuthAssets())fixed.add(file.name);fixed.add('assets/publicAuth.css');
if(allowed.size!==fixed.size||[...fixed].some(f=>!allowed.has(f)))throw Error('Exact public allowlist mismatch');
const originalPages=await fs.readFile('server/commercial/accountPages.ts','utf8');
const officialGoogle=originalPages.match(/const googleIcon = `([\s\S]*?)`;/)?.[1]?.replaceAll('\r\n','\n');if(!officialGoogle)throw Error('Official Google artwork missing');
const commercialCsp=config.hosting.headers.find(h=>h.source==='/es-419/**')?.headers.find(h=>h.key==='Content-Security-Policy')?.value;
if(!commercialCsp?.includes("connect-src 'none'")||!commercialCsp.includes("form-action 'none'"))throw Error('Commercial policy weakened');
if(config.hosting.headers.some(h=>h.source==='**'&&h.headers.some(v=>v.key==='Content-Security-Policy')))throw Error('Global CSP would conflict with auth/helper pages');
for(const prefix of authPrefixes){const rules=config.hosting.headers.filter(h=>h.source==='/'+prefix+'/**');if(rules.length!==1||rules[0].headers.find(h=>h.key==='Content-Security-Policy')?.value!==authCsp)throw Error('Auth CSP mismatch');}
if(/unsafe-eval|unsafe-inline|https:\/\/\*/.test(authCsp)||!authCsp.includes("form-action 'none'")||config.hosting.site!=='vistavo-prod')throw Error('Hosting boundary');
assertAccountHosting(config.hosting);
let links=0,htmls=0,authPages=0;const checks=[];
async function walk(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,e.name);if(e.isSymbolicLink())throw Error('Public symlink');if(e.isDirectory())await walk(file);else if(!e.isFile()||!allowed.has(path.relative(root,file).split(path.sep).join('/')))throw Error('Unexpected public residual: '+file);}}
await walk(root);
for(const item of manifest.files){const bytes=await fs.readFile(path.join(root,item.name));if(sha(bytes)!==item.sha256)throw Error('Artifact hash drift: '+item.name);
 if(item.name.endsWith('.js')){const source=bytes.toString();if(/\/api\/cloud\/|\/pilot\/|cloudCandidate|connectAuthEmulator\(/.test(source))throw Error('Private runtime or emulator in public bundle: '+item.name);for(const m of source.matchAll(/\b(?:from|import)\s*(?:\(\s*)?["'](\.[^"']+)["']/g)){const p=decodeURIComponent(new URL(m[1],'https://vistavo.app/'+item.name).pathname).slice(1);if(!allowed.has(p))throw Error('Missing JS module dependency: '+p);}}
 if(!item.name.endsWith('.html'))continue;htmls++;const html=bytes.toString(),auth=authPrefixes.some(p=>item.name.startsWith(p+'/'));
 if(!html.includes('name="robots" content="noindex"')||/localhost|127\.0\.0\.1|LinguistVision|href="\/pilot\/|src="\/pilot\//.test(html))throw Error('Invalid public page: '+item.name);
 if(auth){authPages++;if(!html.includes('/assets/publicAuth.js')||!html.includes('/assets/publicAuth.css')||!html.includes('data-auth-page=')||/type="file"|cloudCandidate|Vista previa comercial|saldo ficticio|\/api\/cloud\//.test(html))throw Error('Invalid Auth surface: '+item.name);
  for(const form of html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)){if(!/<button\b[^>]*\bdisabled\b/.test(form[1]))throw Error('Auth submit not fail-closed: '+item.name);}
  if(item.name.startsWith('acceso/')||item.name.startsWith('registro/')){if(!html.replaceAll('\r\n','\n').includes(officialGoogle)||!html.includes('gsi-material-button'))throw Error('Official Google button changed');}
 }else{if(/firebaseAuth\.js|publicAuth\.js|type="(?:password|email|file)"/.test(html))throw Error('Auth leaked into commercial page');
  for(const m of html.matchAll(/<style>([\s\S]*?)<\/style>/g))if(!commercialCsp.includes("'sha256-"+createHash('sha256').update(m[1]).digest('base64')+"'"))throw Error('Commercial CSS hash mismatch');
  if(!item.name.startsWith('disponibilidad/')&&item.name!=='404.html'&&!item.name.startsWith('demo/')){const c={file:item.name,notice:html.includes('class="publish-status"'),faq:(html.match(/data-faq-category=/g)??[]).length,videos:(html.match(/data-illustrative-video=/g)??[]).length,login:html.includes('/acceso/'),register:html.includes('/registro/')};if(!c.notice||c.faq!==16||c.videos!==8||!c.login||!c.register)throw Error('Commercial regression: '+item.name);checks.push(c);}
 }
 for(const m of html.matchAll(/\b(?:href|src|poster|data-src)="([^"]+)"/g)){const ref=m[1].replaceAll('&amp;','&');if(ref.startsWith('#')||ref.startsWith('data:'))continue;const url=new URL(ref,'https://vistavo.app/'+item.name);if(url.origin!=='https://vistavo.app')throw Error('External HTML navigation/asset: '+url.origin);const file=decodeURIComponent(url.pathname).replace(/^\//,'');if(!allowed.has(file)&&!allowed.has(file+'index.html'))throw Error('Broken public link: '+ref);links++;}
}
if(authPages!==40||manifest.authPages!==40||manifest.pages!==10||checks.length!==11||manifest.authEnabled!==true||manifest.accountBackendEnabled!==true||manifest.processingEnabled!==false)throw Error('Incomplete public account release');
const result={at:new Date().toISOString(),files:allowed.size,htmls,authPages,linksChecked:links,pages:checks,csp:true,officialGoogleArtwork:true,publicAllowlist:true,identityBackend:'Firebase Auth vistavo-prod',accountBackend:true,processingBackend:false,all:true};await fs.writeFile(path.join(evidence,'local-proof.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({files:allowed.size,htmls,authPages,links,all:true}));
