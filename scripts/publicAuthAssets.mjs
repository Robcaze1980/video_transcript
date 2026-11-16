import fs from 'node:fs/promises';
import path from 'node:path';

export const authPrefixes=['acceso','registro','recuperar','cuenta'];
export const authCsp="default-src 'none'; script-src 'self' https://apis.google.com; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com; frame-src https://vistavo-prod.firebaseapp.com https://accounts.google.com; form-action 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; upgrade-insecure-requests";
export function accountHosting(){return {rewrites:[{source:'/api/account/**',run:{serviceId:'vistavo-account-api',region:'us-central1'}}],headers:{source:'/api/account/**',headers:[{key:'Cache-Control',value:'private, no-store'},{key:'Vary',value:'Authorization'},{key:'Content-Security-Policy',value:"default-src 'none'; frame-ancestors 'none'; base-uri 'none'"}]}};}
export function assertAccountHosting(hosting){
 const expected=accountHosting();if(JSON.stringify(hosting.rewrites)!==JSON.stringify(expected.rewrites))throw Error('Account-only rewrite boundary');
 const rules=hosting.headers?.filter(h=>h.source==='/api/account/**');if(rules?.length!==1||JSON.stringify(rules[0])!==JSON.stringify(expected.headers))throw Error('Private account API headers missing');
 if(hosting.headers.some(h=>h.source.startsWith('/__')||h.source==='/api/**'))throw Error('Account scope must not affect helpers or other APIs');
}

/** Firebase CLI resolves hosting.public relative to the selected config's directory. */
export function publicDirectoryForConfig(configFile,directory){
 const relative=path.relative(path.dirname(path.resolve(configFile)),path.resolve(directory));
 if(!relative||path.isAbsolute(relative)||relative==='..'||relative.startsWith('..'+path.sep))throw Error('Hosting public directory outside config project');
 return relative.split(path.sep).join('/');
}

export function assertPublicDirectoryBinding(configFile,publicDirectory,expectedDirectory){
 if(typeof publicDirectory!=='string'||!publicDirectory||path.isAbsolute(publicDirectory)||publicDirectory.split(/[\\/]/).includes('..'))throw Error('Unsafe Hosting public directory');
 const resolved=path.resolve(path.dirname(path.resolve(configFile)),publicDirectory);
 if(resolved!==path.resolve(expectedDirectory))throw Error('Hosting config does not bind the verified candidate directory');
 return resolved;
}

/** Traverse only the two public entry closures; never copy a dist directory wholesale. */
export async function publicAuthAssets(directory='dist/pilot-editor'){
 const root=await fs.realpath(directory),manifest=JSON.parse(await fs.readFile(path.join(root,'.vite/manifest.json'),'utf8')),seen=new Set(),files=new Set();
 const entries=['server/commercial/web/publicAuth.ts','server/commercial/web/accountUi.ts'];
 async function walk(key){if(seen.has(key))return;seen.add(key);const item=manifest[key];if(!item||item.isEntry&&!entries.includes(key))throw Error('Nonpublic bundle entry: '+key);
  if(item.isEntry&&item.file!==(key.endsWith('/publicAuth.ts')?'publicAuth.js':'accountUi.js'))throw Error('Unexpected public entry filename');
  if(!item.isEntry&&!/^assets\/[a-zA-Z0-9_.-]+\.(?:js|css)$/.test(item.file))throw Error('Nonpublic shared asset');
  for(const file of [item.file,...(item.css??[])]){if(!/^(?:assets\/)?[a-zA-Z0-9_.-]+\.(?:js|css)$/.test(file)||file.includes('..'))throw Error('Invalid public asset path');const actual=await fs.realpath(path.join(root,file));if(!actual.startsWith(root+path.sep))throw Error('Public asset escapes dist');files.add(file);}
  for(const dependency of [...(item.imports??[]),...(item.dynamicImports??[])])await walk(dependency);
 }
 for(const entry of entries){if(!manifest[entry]?.isEntry)throw Error('Missing public auth build entry');await walk(entry);}
 return [...files].sort().map(file=>({source:path.join(root,file),name:'assets/'+file}));
}

export function commercialPolicies(locales,csp){
 const commercial=['/','/index.html','/404.html','/disponibilidad/**','/demo/**',...locales.map(locale=>'/'+locale.toLowerCase()+'/**')];
 return [...commercial.map(source=>({source,headers:[{key:'Content-Security-Policy',value:csp}]})),...authPrefixes.map(prefix=>({source:'/'+prefix+'/**',headers:[{key:'Content-Security-Policy',value:authCsp},{key:'Cache-Control',value:'no-store'},{key:'Cross-Origin-Opener-Policy',value:'same-origin-allow-popups'}]}))];
}
