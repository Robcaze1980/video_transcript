import fs from'node:fs/promises';import path from'node:path';import{createHash}from'node:crypto';
const publicRelease=JSON.parse(await fs.readFile(path.join(process.env.VISTAVO_PUBLIC_EVIDENCE??'outputs/vistavo-public','build-proof.json'),'utf8'));
if(publicRelease.authEnabled===true){await import('./checkPublicAuthStatic.mjs');}else{
const root=path.resolve('outputs/vistavo-public/site');const manifest=JSON.parse(await fs.readFile('outputs/vistavo-public/build-proof.json','utf8'));const config=JSON.parse(await fs.readFile('firebase.commercial.json','utf8'));const csp=config.hosting.headers[0].headers.find(x=>x.key==='Content-Security-Policy').value;
const allowed=new Set(manifest.files.map(f=>f.name));let links=0;let htmls=0;const checks=[];
const exact=new Set(JSON.parse(await fs.readFile('scripts/commercialStaticFiles.json','utf8')));
if(allowed.size!==exact.size||[...allowed].some(x=>!exact.has(x)))throw new Error('Public allowlist mismatch');
async function walk(p){for(const e of await fs.readdir(p,{withFileTypes:true})){const f=path.join(p,e.name);if(e.isSymbolicLink())throw new Error('Public symlink');if(e.isDirectory())await walk(f);else if(!e.isFile()||!allowed.has(path.relative(root,f).split(path.sep).join('/')))throw new Error('Unexpected public file '+f);}}
await walk(root);
for(const item of manifest.files){const bytes=await fs.readFile(path.join(root,item.name));if(createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw new Error('Hash drift');
 if(item.name.endsWith('.html')){htmls++;const html=bytes.toString();if(!html.includes('name="robots" content="noindex"')||/localhost|127\.0\.0\.1|LinguistVision|firebaseAuth\.js|type="(?:password|email|file)"/.test(html))throw new Error('Unsafe public content');
  for(const m of html.matchAll(/<style>([\s\S]*?)<\/style>/g)){const hash=createHash('sha256').update(m[1]).digest('base64');if(!csp.includes("'sha256-"+hash+"'"))throw new Error('CSP hash mismatch');}
  for(const m of html.matchAll(/\b(?:href|src|poster|data-src)="([^"]+)"/g)){const ref=m[1].replaceAll('&amp;','&');if(ref.startsWith('#')||ref.startsWith('data:'))continue;const url=new URL(ref,'https://vistavo.app/'+item.name);if(url.origin!=='https://vistavo.app')throw new Error('Unexpected external link '+url);const name=decodeURIComponent(url.pathname).replace(/^\//,'');if(!allowed.has(name)&&!allowed.has(name+'index.html'))throw new Error('Broken static link '+ref+' in '+item.name);links++;}
  if(!item.name.startsWith('disponibilidad/')&&item.name!=='404.html'&&!item.name.startsWith('demo/')){const check={file:item.name,statusNotice:html.includes('class="publish-status"'),faq:(html.match(/data-faq-category=/g)??[]).length,videos:(html.match(/data-illustrative-video=/g)??[]).length,canonicals:html.includes('href="https://vistavo.app/'),noPilotLinks:!html.includes('href="/pilot/')};if(!check.statusNotice||check.faq!==16||check.videos!==8||!check.canonicals||!check.noPilotLinks)throw new Error('Page gate');checks.push(check);}
 }
}
if(allowed.size!==manifest.files.length||manifest.pages!==10||config.hosting.site!=='vistavo-prod'||!csp.includes("form-action 'none'")||!csp.includes("connect-src 'none'"))throw new Error('Release guard');
const result={files:allowed.size,htmls,linksChecked:links,pages:checks,csp:true,publicAllowlist:true,backend:false,all:true};await fs.writeFile('outputs/vistavo-public/local-proof.json',JSON.stringify(result,null,2));console.log(JSON.stringify({files:allowed.size,htmls,links,all:true}));
}
