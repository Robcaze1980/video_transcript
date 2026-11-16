import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {renderCommercialPreview} from '../server/pilot-site/render';
import {demoAssets} from '../server/commercial/commercialPages';
import {pilotLanguages} from '../server/pilot-site/languages';
import {commercialLocale} from '../server/commercial/commercialPages';
import {publicAuthPage,publicAuthRoute} from '../server/commercial/publicAuthPages';
import {authPrefixes,commercialPolicies,publicAuthAssets,publicDirectoryForConfig,assertPublicDirectoryBinding,accountHosting,assertAccountHosting} from './publicAuthAssets.mjs';

const origin='https://vistavo.app';
const evidence=path.resolve(process.env.VISTAVO_PUBLIC_EVIDENCE??'outputs/vistavo-public');
const output=path.join(evidence,'site');
const configPath=path.resolve(process.env.VISTAVO_PUBLIC_CONFIG??'firebase.commercial.json');
const workspace=path.resolve('.'),outputsRoot=path.join(workspace,'outputs');
if(!evidence.startsWith(outputsRoot+path.sep)||!(configPath===path.join(workspace,'firebase.commercial.json')||configPath.startsWith(evidence+path.sep)))throw Error('Public export boundary');
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const digest=(b:string|Buffer)=>createHash('sha256').update(b).digest('hex');
const text:Record<string,readonly[string,string,string]>={
  'es-419':['Tu cuenta Vistavo','Ya puedes crear tu cuenta e iniciar sesión. Las compras y el procesamiento de videos todavía no están habilitados.','Volver a la portada'],
  'en-US':['Your Vistavo account','You can create your account and sign in. Purchases and video processing are not yet available.','Back to the homepage'],
  'pt-BR':['Sua conta Vistavo','Você já pode criar sua conta e entrar. Compras e processamento de vídeos ainda não estão disponíveis.','Voltar à página inicial'],
  fr:['Votre compte Vistavo','Vous pouvez créer votre compte et vous connecter. Les achats et le traitement vidéo ne sont pas encore disponibles.','Retour à l’accueil'],
  de:['Ihr Vistavo-Konto','Sie können Ihr Konto erstellen und sich anmelden. Käufe und Videoverarbeitung sind noch nicht verfügbar.','Zurück zur Startseite'],
  ja:['Vistavoアカウント','アカウントの作成とログインができます。購入と動画処理はまだ利用できません。','トップページに戻る'],
  ko:['Vistavo 계정','계정을 만들고 로그인할 수 있습니다. 구매 및 동영상 처리는 아직 사용할 수 없습니다.','홈페이지로 돌아가기'],
  ar:['حسابك في Vistavo','يمكنك إنشاء حسابك وتسجيل الدخول. عمليات الشراء ومعالجة الفيديو غير متاحة بعد.','العودة إلى الصفحة الرئيسية'],
  'zh-Hans':['您的 Vistavo 账号','您可以创建账号并登录。购买和视频处理暂未开放。','返回首页'],
  vi:['Tài khoản Vistavo của bạn','Bạn có thể tạo tài khoản và đăng nhập. Mua hàng và xử lý video chưa khả dụng.','Quay lại trang chủ'],
};
const infoStyle='.public-info{font:18px/1.6 system-ui,sans-serif;max-width:720px;margin:60px auto;padding:24px;color:#17231d}.public-info a{color:#126a4b}.public-info video{width:100%;height:auto}.publish-status{font:15px/1.5 system-ui,sans-serif;padding:12px 24px;background:#e8f3ed;color:#163a2b;text-align:center}.publish-status strong{display:block}.publish-status a{color:inherit;text-decoration:underline;margin-inline-start:10px}';
const files=new Map<string,Buffer>();
const brandStyle='.vistavo-wordmark{display:inline-flex!important;align-items:center;gap:10px;white-space:nowrap}.vistavo-wordmark,.claude-landing .ftlogo{font-family:Inter,system-ui,sans-serif!important;font-weight:600!important;letter-spacing:-.024em;direction:ltr}.vistavo-mark{display:block;width:32px;height:32px;flex:none}.ftlogo .vistavo-mark{width:38px;height:38px}@media(max-width:600px){.vistavo-wordmark{gap:8px}.vistavo-mark{width:28px;height:28px}}';
const brandMark='<img class="vistavo-mark" src="/brand/vistavo-symbol.svg" width="32" height="32" alt="">';
function applyBrand(html:string):string{
  if(html.includes('data-vistavo-brand="a3"'))return html;
  html=html.replace('<html ','<html data-vistavo-brand="a3" ');
  html=html.replace(/<a([^>]*data-design-style="zip-full-2"[^>]*)>Vistavo<\/a>/g,'<a$1 class="vistavo-wordmark">'+brandMark+'Vistavo</a>');
  html=html.replace(/(<a[^>]*class="ftlogo"[^>]*>)<span[^>]*class="ftmark"[^>]*>[\s\S]*?<\/span>Vistavo<\/a>/g,'$1'+brandMark+'Vistavo</a>');
  html=html.replace(/<a([^>]*href="[^"]+"[^>]*)>Vistavo<\/a>/g,'<a$1 class="vistavo-wordmark">'+brandMark+'Vistavo</a>');
  html=html.replace('<main class="public-info"><h1>','<main class="public-info"><a href="/es-419/subtitulos-video/" class="vistavo-wordmark">'+brandMark+'Vistavo</a><h1>');
  html=html.replace('</head>','<link rel="icon" type="image/svg+xml" href="/brand/vistavo-symbol.svg"><link rel="icon" type="image/png" sizes="32x32" href="/brand/vistavo-32.png"><link rel="shortcut icon" href="/favicon.ico"></head>');
  return html.replace('</style>',brandStyle+'</style>');
}
const allowedNames=new Set<string>(JSON.parse(await fs.readFile('scripts/commercialStaticFiles.json','utf8')));
const authAssets=await publicAuthAssets();
for(const asset of authAssets)allowedNames.add(asset.name);
allowedNames.add('assets/publicAuth.css');
for(const language of pilotLanguages)for(const prefix of authPrefixes)allowedNames.add(prefix+'/'+language.locale.toLowerCase()+'/index.html');
function add(name:string,content:string|Buffer){
  const full=path.resolve(output,name);
  if(!full.startsWith(output+path.sep)||!allowedNames.has(name)||files.has(name))throw new Error('Unsafe or duplicate public artifact: '+name);
  if(name.endsWith('.html')){
    if(Buffer.isBuffer(content))throw new Error('HTML must be transformed before encoding');
    content=applyBrand(content);
    const isAuth=authPrefixes.some(prefix=>name.startsWith(prefix+'/'));
    const expected=content.includes('<body class="claude-landing">')?2:1;
    if(!isAuth&&((content.match(/<img class="vistavo-mark"/g)??[]).length!==expected||content.includes('class="ftmark"')))throw new Error('Brand placement mismatch: '+name);
    for(const match of content.matchAll(/<style>([\s\S]*?)<\/style>/g))styles.add(match[1]);
  }
  files.set(name,Buffer.isBuffer(content)?content:Buffer.from(content));
}
const styles=new Set<string>();
const source=renderCommercialPreview(origin);
for(const language of pilotLanguages){
  const locale=language.locale;const [heading,note,back]=text[locale];if(!heading||!note||!back)throw new Error('Missing public status translation');
  const landing='/'+locale.toLowerCase()+'/'+language.slug+'/';
  const file=landing.slice(1)+'index.html';const original=source.get(file);if(!original)throw new Error('Missing landing '+file);
  const availability='/disponibilidad/'+locale.toLowerCase()+'/';
  let html=original.replace('src="/pilot/editor-assets/commercialLanding.js"','src="/assets/commercialLanding.js"');
  html=html.replace(/href="(\/pilot\/[^" ]*)"/g,(_all,href:string)=>{
    const p=new URL(href.replaceAll('&amp;','&'),origin).pathname;
    if(p==='/pilot/sign-in/')return 'href="'+publicAuthRoute(commercialLocale(language.id),'sign-in')+'"';
    if(p==='/pilot/register/')return 'href="'+publicAuthRoute(commercialLocale(language.id),'register')+'"';
    return 'href="'+(p.includes('/demo/')?'/demo/':p.endsWith('.srt')?'/demo/jobsite.srt':availability)+'"';
  });
  html=html.replace('</style>',infoStyle+'</style>');
  html=html.replace('<body class="claude-landing">','<body class="claude-landing"><aside class="publish-status" aria-label="'+esc(heading)+'"><strong>'+esc(heading)+'</strong>'+esc(note)+' <a href="'+availability+'">'+esc(heading)+'</a></aside>');
  const css=html.match(/<style>([\s\S]*?)<\/style>/)?.[1];if(!css)throw new Error('Missing styles');
  if(!html.includes('name="robots" content="noindex"')||html.includes('127.0.0.1')||html.includes('localhost')||/href="\/pilot\//.test(html))throw new Error('Public landing guard');
  add(file,html);
  add(availability.slice(1)+'index.html','<!doctype html><html lang="'+esc(locale)+'" dir="'+language.direction+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Vistavo · '+esc(heading)+'</title><link rel="canonical" href="'+origin+availability+'"><style>'+infoStyle+'</style></head><body><main class="public-info"><a href="'+landing+'">Vistavo</a><h1>'+esc(heading)+'</h1><p>'+esc(note)+'</p><a href="'+landing+'">'+esc(back)+'</a></main></body></html>');
}
for(const language of pilotLanguages){const pack=commercialLocale(language.id);for(const page of ['sign-in','register','forgot','account'] as const)add(publicAuthRoute(pack,page).slice(1)+'index.html',publicAuthPage(pack,page));}
for(const asset of authAssets)add(asset.name,await fs.readFile(asset.source));
add('assets/publicAuth.css',await fs.readFile('server/commercial/web/publicAuth.css'));
add('index.html',files.get('es-419/subtitulos-video/index.html')!.toString());
add('404.html','<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="robots" content="noindex"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vistavo · Página no encontrada</title><style>'+infoStyle+'</style></head><body><main class="public-info"><h1>Página no encontrada</h1><a href="/es-419/subtitulos-video/">Volver a Vistavo</a></main></body></html>');
add('demo/index.html','<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Vistavo · Ejemplo ilustrativo</title><style>'+infoStyle+'</style></head><body><main class="public-info"><h1>Ejemplo ilustrativo</h1><p>Clip sintético de obra, con audio y subtítulos en inglés. No es una demostración del procesamiento online.</p><video controls playsinline preload="metadata" poster="/demo/jobsite.webp" src="/demo/jobsite.mp4"><track default kind="captions" srclang="en" label="English" src="/demo/jobsite.vtt"></video><p><a href="/demo/jobsite.srt" download>Descargar SRT de ejemplo</a></p><a href="/es-419/subtitulos-video/">Volver a Vistavo</a></main></body></html>');
for(const[route,[name]]of demoAssets){if(!route.startsWith('/demo/')||path.basename(name)!==name)throw new Error('Invalid demo allowlist');add(route.slice(1),await fs.readFile(path.join('server/pilot-site/assets',name)));}
add('demo/Inter-OFL.txt',await fs.readFile('server/pilot-site/assets/Inter-OFL.txt'));
add('assets/commercialLanding.js',await fs.readFile('dist/pilot-editor/commercialLanding.js'));
add('brand/vistavo-symbol.svg',await fs.readFile('server/pilot-site/assets/brand/vistavo-symbol.svg'));
add('brand/vistavo-32.png',await fs.readFile('server/pilot-site/assets/brand/vistavo-32.png'));
add('favicon.ico',await fs.readFile('server/pilot-site/assets/brand/favicon.ico'));
add('robots.txt','User-agent: *\nAllow: /\n');
const styleHashes=[...styles].map(s=>"'sha256-"+createHash('sha256').update(s).digest('base64')+"'").join(' ');
const csp="default-src 'self'; script-src 'self'; style-src "+styleHashes+"; img-src 'self' data:; font-src 'self'; media-src 'self'; connect-src 'none'; form-action 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; upgrade-insecure-requests";
const config={hosting:{site:'vistavo-prod',public:publicDirectoryForConfig(configPath,output),ignore:['**/.*','**/node_modules/**'],trailingSlash:true,
  rewrites:accountHosting().rewrites,
  redirects:[{source:'/',destination:'/es-419/subtitulos-video/',type:302},...authPrefixes.map(prefix=>({source:'/'+prefix+'/',destination:'/'+prefix+'/es-419/',type:302}))],
  headers:[{source:'**',headers:[{key:'X-Content-Type-Options',value:'nosniff'},{key:'Referrer-Policy',value:'no-referrer'},{key:'X-Robots-Tag',value:'noindex'},{key:'Permissions-Policy',value:'camera=(), microphone=(), geolocation=()'},{key:'Cache-Control',value:'public,max-age=0,must-revalidate'}]},
    {source:'**/*.html',headers:[{key:'Cache-Control',value:'public,max-age=0,must-revalidate'}]},
    {source:'**/*.@(js|jpg|webp|mp4|ttf|svg|png|ico)',headers:[{key:'Cache-Control',value:'public,max-age=3600'}]},...commercialPolicies(pilotLanguages.map(l=>l.locale),csp),...['/assets/publicAuth.js','/assets/publicAuth.css'].map(source=>({source,headers:[{key:'Cache-Control',value:'no-store'}]})),accountHosting().headers]}};
if(files.size!==allowedNames.size)throw new Error('Incomplete public allowlist');
assertPublicDirectoryBinding(configPath,config.hosting.public,output);
assertAccountHosting(config.hosting);
await fs.mkdir(evidence,{recursive:true});
const staging=await fs.mkdtemp(path.join(evidence,'staging-'));
for(const[name,bytes]of files){const full=path.join(staging,name);await fs.mkdir(path.dirname(full),{recursive:true});await fs.writeFile(full,bytes);}
const actual:string[]=[];
async function inspect(directory:string):Promise<void>{for(const entry of await fs.readdir(directory,{withFileTypes:true})){const full=path.join(directory,entry.name);if(entry.isSymbolicLink())throw new Error('Public symlink');if(entry.isDirectory())await inspect(full);else if(entry.isFile()){const name=path.relative(staging,full).split(path.sep).join('/');if(!allowedNames.has(name)||digest(await fs.readFile(full))!==digest(files.get(name)!))throw new Error('Public tree mismatch');actual.push(name);}else throw new Error('Unexpected public file type');}}
await inspect(staging);
if(actual.length!==allowedNames.size)throw new Error('Incomplete physical public tree');
try{await fs.rename(output,path.join(evidence,'previous-site-'+Date.now()));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
await fs.rename(staging,output);
await fs.writeFile(configPath,JSON.stringify(config,null,2)+'\n');
const manifest=[...files].map(([name,bytes])=>({name,bytes:bytes.length,sha256:digest(bytes)}));
await fs.writeFile(path.join(evidence,'build-proof.json'),JSON.stringify({origin,site:'vistavo-prod',frontendOnly:false,identityBackend:'Firebase Authentication vistavo-prod',noindex:true,backendEnabled:true,accountBackendEnabled:true,processingEnabled:false,authEnabled:true,generatedAt:new Date().toISOString(),pages:pilotLanguages.length,authPages:pilotLanguages.length*4,files:manifest,totalBytes:manifest.reduce((s,f)=>s+f.bytes,0),styleHashes:[...styles].map(digest)},null,2));
console.log(JSON.stringify({pages:pilotLanguages.length,files:files.size,bytes:manifest.reduce((s,f)=>s+f.bytes,0),output,accountBackendEnabled:true,processingEnabled:false}));
