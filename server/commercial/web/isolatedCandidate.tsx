import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {initializeApp} from 'firebase/app';
import {connectAuthEmulator,createUserWithEmailAndPassword,getAuth,inMemoryPersistence,onIdTokenChanged,sendEmailVerification,setPersistence,signInWithEmailAndPassword,signOut,type Auth,type User} from 'firebase/auth';
import './isolatedCandidate.css';

type CandidateConfig={environment:'isolated-local';web:{projectId:string;authDomain:string;apiKey:string;appId:string};authEmulatorUrl:string;features:{accountApi:boolean;cloudApi:boolean;videoWorkflow:boolean;uploads:boolean;ai:boolean;textFixture:boolean;payments:boolean}};
type Connected={account:{id:string;balance:{unit:string;available:number}};cloud:{id:string;balance:number}};
type UploadedFile={id:string;name:string;size:number;state:string;sha256?:string;metadata?:{duration:number;width:number;height:number;audioTracks:number}};
type TextFixture={revision:number;phase:'transcribed'|'reviewed'|'translated';transcriptEs:string;reviewedEs:string|null;translationEn:string|null;source:'local-deterministic-fixture'};

async function request(path:string,token:string,method='GET',body?:unknown){
 const response=await fetch(path,{method,credentials:'omit',cache:'no-store',redirect:'error',headers:{Authorization:'Bearer '+token,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
 const value=await response.json().catch(()=>({}));if(!response.ok)throw Error(typeof value.error==='string'?value.error:`HTTP ${response.status}`);return value;
}

function App(){
 const [config,setConfig]=useState<CandidateConfig>(),[auth,setAuth]=useState<Auth>(),[user,setUser]=useState<User|null>(null),[identityRefresh,setIdentityRefresh]=useState(0),[connected,setConnected]=useState<Connected>(),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[register,setRegister]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[selectedFile,setSelectedFile]=useState<File>(),[uploadedFile,setUploadedFile]=useState<UploadedFile>(),[uploadBusy,setUploadBusy]=useState(false),[textFixture,setTextFixture]=useState<TextFixture>(),[reviewDraft,setReviewDraft]=useState(''),[fixtureBusy,setFixtureBusy]=useState(false);
 useEffect(()=>{let live=true,lastUid:string|null=null,unsubscribe:(()=>void)|undefined;void(async()=>{const response=await fetch('/api/candidate/config',{credentials:'omit',cache:'no-store',redirect:'error'});if(!response.ok)throw Error('No se pudo leer la configuración local.');const value=await response.json() as CandidateConfig;
  if(value.environment!=='isolated-local'||value.features.videoWorkflow!==false||value.features.uploads!==true||value.features.ai!==false||value.features.textFixture!==true||value.features.payments!==false||value.authEmulatorUrl!=='http://127.0.0.1:9099')throw Error('La candidata no tiene el aislamiento esperado.');
  const app=initializeApp(value.web,'vistavo-isolated-candidate'),instance=getAuth(app);connectAuthEmulator(instance,value.authEmulatorUrl,{disableWarnings:true});await setPersistence(instance,inMemoryPersistence);
  unsubscribe=onIdTokenChanged(instance,next=>{if(live){if(lastUid!==next?.uid){setUploadedFile(undefined);setTextFixture(undefined);setReviewDraft('');setSelectedFile(undefined);}lastUid=next?.uid??null;setUser(next);setConnected(undefined);}});if(live){setAuth(instance);setConfig(value);}
 })().catch(cause=>{if(live)setError(cause instanceof Error?cause.message:'No se pudo iniciar la candidata.');});return()=>{live=false;unsubscribe?.();};},[]);
 useEffect(()=>{if(!user||!config)return;let live=true;void(async()=>{if(!user.emailVerified){setNotice('Verifica el correo usando el enlace que muestra Firebase Authentication Emulator. No se envía ningún correo real.');return;}setBusy(true);setError('');try{
  const token=await user.getIdToken(true);
  await request('/api/account/bootstrap',token,'POST',{});
  const [account,cloud]=await Promise.all([request('/api/account/me',token),request('/api/cloud/me',token)]);
  if(live)setConnected({account,cloud});
 }catch(cause){if(live)setError(cause instanceof Error?cause.message:'No se pudieron conectar ambas APIs.');}finally{if(live)setBusy(false);}})();return()=>{live=false;};},[user,config,identityRefresh]);
 async function submit(event:React.FormEvent){event.preventDefault();if(!config||!auth)return;setBusy(true);setError('');setNotice('');try{if(register){const result=await createUserWithEmailAndPassword(auth,email,password);await sendEmailVerification(result.user);setNotice('Cuenta local creada. Abre el emulador para consultar el enlace de verificación: http://127.0.0.1:4000/auth');}else{await signInWithEmailAndPassword(auth,email,password);}}catch(cause){setError(cause instanceof Error?cause.message:'No se pudo iniciar sesión local.');}finally{setBusy(false);}}
 async function verifyAgain(){if(!user||!auth)return;setBusy(true);try{await user.reload();if(auth.currentUser)await auth.currentUser.getIdToken(true);setIdentityRefresh(value=>value+1);setNotice('Estado de verificación actualizado.');}catch{setError('No se pudo actualizar la sesión local.');}finally{setBusy(false);}}
 async function logout(){if(!auth)return;await signOut(auth);setConnected(undefined);setUploadedFile(undefined);setTextFixture(undefined);setReviewDraft('');setSelectedFile(undefined);setNotice('Sesión local cerrada.');}
 async function uploadFile(){
  if(!user||!selectedFile||!config?.features.uploads)return;
  if(selectedFile.size<1||selectedFile.size>8*1024*1024||!/^video\/mp4$/i.test(selectedFile.type)){
   setError('El ensayo local acepta un MP4 de hasta 8 MiB.');return;
  }
  const uid=user.uid;let token:string|undefined,uploadId:string|undefined;setUploadBusy(true);setError('');setNotice('');setUploadedFile(undefined);
  try{
   token=await user.getIdToken();const bytes=await selectedFile.arrayBuffer(),digest=await crypto.subtle.digest('SHA-256',bytes),sha256=Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');if(auth?.currentUser?.uid!==uid)return;
   const started=await request('/api/cloud/uploads',token,'POST',{name:selectedFile.name,size:selectedFile.size,sha256,requestKey:crypto.randomUUID()});
   uploadId=String(started.id);const cleanup=async()=>{if(token&&uploadId)await request(`/api/cloud/uploads/${uploadId}`,token,'DELETE').catch(()=>undefined);};if(auth?.currentUser?.uid!==uid){await cleanup();return;}
   const chunk=await fetch(`/api/cloud/uploads/${uploadId}/chunks?offset=0`,{method:'PUT',credentials:'omit',cache:'no-store',redirect:'error',headers:{Authorization:'Bearer '+token,'Content-Type':'application/octet-stream'},body:bytes});
   if(!chunk.ok)throw Error(`No se pudo guardar el bloque (${chunk.status}).`);
   await chunk.arrayBuffer();if(auth?.currentUser?.uid!==uid){await cleanup();return;}
   await request(`/api/cloud/uploads/${uploadId}/complete`,token,'POST',{});if(auth?.currentUser?.uid!==uid){await cleanup();return;}
   let status:UploadedFile|undefined;
   for(let attempt=0;attempt<20;attempt++){
    status=await request(`/api/cloud/uploads/${uploadId}`,token) as UploadedFile;if(auth?.currentUser?.uid!==uid){await cleanup();return;}
    if(status.state==='ready'||status.state==='deleting'||status.state==='deleted')break;
    await new Promise(resolve=>setTimeout(resolve,250));
   }
   if(status?.state!=='ready')throw Error(`El archivo quedó en estado ${status?.state??'desconocido'}.`);
   if(auth?.currentUser?.uid!==uid)return;setUploadedFile(status);setNotice('Video guardado y leído desde el almacenamiento privado local.');
  }catch(cause){if(token&&uploadId)await request(`/api/cloud/uploads/${uploadId}`,token,'DELETE').catch(()=>undefined);if(auth?.currentUser?.uid===uid)setError(cause instanceof Error?cause.message:'No se pudo completar la prueba local de almacenamiento.');}
  finally{setUploadBusy(false);}
 }
 async function openUploadedFile(){
  if(!user||!uploadedFile)return;const uid=user.uid;setError('');
  try{const token=await user.getIdToken(),response=await fetch(`/api/cloud/uploads/${uploadedFile.id}/content`,{credentials:'omit',cache:'no-store',redirect:'error',headers:{Authorization:'Bearer '+token}});if(auth?.currentUser?.uid!==uid)return;
   if(!response.ok)throw Error(`La descarga privada falló (${response.status}).`);
   const blob=await response.blob();if(auth?.currentUser?.uid!==uid)return;const objectUrl=URL.createObjectURL(blob),link=document.createElement('a');link.href=objectUrl;link.download=uploadedFile.name;link.click();setTimeout(()=>URL.revokeObjectURL(objectUrl),30000);
  }catch(cause){setError(cause instanceof Error?cause.message:'No se pudo abrir el archivo privado.');}
 }
 async function startTextFixture(){
  if(!user||!uploadedFile)return;const uid=user.uid;setFixtureBusy(true);setError('');setNotice('');setTextFixture(undefined);
  try{const value=await request('/api/cloud/text-fixture/transcribe',await user.getIdToken(),'POST',{inputId:uploadedFile.id}) as TextFixture;if(auth?.currentUser?.uid!==uid)return;setTextFixture(value);setReviewDraft(value.transcriptEs);setNotice('Se creó una muestra fija de texto. No se extrajo del video.');}
  catch(cause){setError(cause instanceof Error?cause.message:'No se pudo crear la muestra local.');}finally{setFixtureBusy(false);}
 }
 async function saveTextReview(){
  if(!user||!uploadedFile||!textFixture)return;const uid=user.uid;setFixtureBusy(true);setError('');
  try{const value=await request(`/api/cloud/text-fixture/${uploadedFile.id}/review`,await user.getIdToken(),'PUT',{reviewedEs:reviewDraft,expectedRevision:textFixture.revision}) as {revision:number;phase:'reviewed';reviewedEs:string};if(auth?.currentUser?.uid!==uid)return;setTextFixture(current=>current?{...current,revision:value.revision,phase:value.phase,reviewedEs:value.reviewedEs,translationEn:null}:current);setNotice('Revisión de muestra guardada localmente.');}
  catch(cause){setError(cause instanceof Error?cause.message:'No se pudo guardar la revisión local.');}finally{setFixtureBusy(false);}
 }
 async function translateTextFixture(){
  if(!user||!uploadedFile||!textFixture)return;const uid=user.uid;setFixtureBusy(true);setError('');
  try{const value=await request(`/api/cloud/text-fixture/${uploadedFile.id}/translate`,await user.getIdToken(),'POST',{expectedRevision:textFixture.revision}) as {revision:number;phase:'translated';translationEn:string;source:'local-deterministic-fixture'};if(auth?.currentUser?.uid!==uid)return;setTextFixture(current=>current?{...current,...value}:current);setNotice('Se creó el archivo de muestra en inglés; no se llamó a un traductor.');}
  catch(cause){setError(cause instanceof Error?cause.message:'No se pudo crear la muestra inglesa.');}finally{setFixtureBusy(false);}
 }
 async function downloadTextFixture(name:'transcript-es.txt'|'transcript-es.srt'|'translation-en.txt'|'translation-en.srt'){
  if(!user||!uploadedFile)return;if(name.startsWith('translation-')&&(!textFixture?.translationEn||textFixture.phase!=='translated'||reviewDraft!==textFixture.reviewedEs)){setError('Guarda la revisión actual antes de descargar el ejemplo inglés.');return;}const uid=user.uid;setError('');
  try{const response=await fetch(`/api/cloud/text-fixture/${uploadedFile.id}/results/${name}`,{credentials:'omit',cache:'no-store',redirect:'error',headers:{Authorization:'Bearer '+await user.getIdToken()}});if(auth?.currentUser?.uid!==uid)return;if(!response.ok)throw Error(`La descarga privada falló (${response.status}).`);const blob=await response.blob();if(auth?.currentUser?.uid!==uid)return;const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  catch(cause){setError(cause instanceof Error?cause.message:'No se pudo descargar la muestra privada.');}
 }
 return <div className="iso-shell"><header className="iso-header"><a href="/" className="iso-brand"><img src="/brand/vistavo-symbol.svg" width="36" height="36" alt=""/>Vistavo</a><span className="iso-badge">CANDIDATA AISLADA · LOCAL</span></header><main>
  <p className="iso-eyebrow">LV-019.B · PUENTE DE CUENTA Y VIDEO</p><h1>Una sesión, dos servicios privados.</h1><p className="iso-lead">Esta candidata conecta la API de cuenta y la API de archivos por el mismo origen local. Cada servicio conserva su propia base.</p>
  <section className="iso-notice"><strong>Solo pruebas sintéticas locales.</strong><p>El MP4 queda en memoria del proceso aislado; Firestore y Auth usan emuladores. No se conecta a GCS, producción ni proveedores. El ejemplo de texto es fijo y no analiza el video. IA real, voz, precios y pagos siguen apagados.</p></section>
  {!config&&<p role="status">Preparando emuladores locales…</p>}
  {config&&!user&&<section className="iso-card"><h2>{register?'Crear usuario de prueba':'Entrar a la candidata'}</h2><p>Usa una cuenta del emulador local. No se conecta con Google ni con tu cuenta real.</p><form onSubmit={event=>void submit(event)}><label>Correo local<input required type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Contraseña local<input required minLength={6} type="password" autoComplete={register?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)}/></label><button disabled={busy}>{busy?'Un momento…':register?'Crear cuenta local':'Entrar'}</button></form><button className="iso-link" onClick={()=>{setRegister(!register);setError('');setNotice('');}}>{register?'Ya tengo cuenta local':'Crear cuenta de prueba'}</button></section>}
  {user&&<section className="iso-card"><div className="iso-account-heading"><div><h2>Sesión local</h2><p>{user.email} · {user.emailVerified?'correo verificado':'correo pendiente de verificar'}</p></div><button className="iso-link" onClick={()=>void logout()}>Cerrar sesión</button></div>
   {!user.emailVerified&&<button className="iso-secondary" disabled={busy} onClick={()=>void verifyAgain()}>Ya verifiqué el correo</button>}
   {busy&&<p role="status">Conectando ambos servicios con el mismo token…</p>}
   {connected&&<div className="iso-services"><article><h3>API de cuenta</h3><p>Base: <code>account-candidate</code></p><p>ID interno: <code>{connected.account.id}</code></p><p>Saldo: {connected.account.balance.available} segundos</p></article><article><h3>API de archivos</h3><p>Base: <code>(default)</code></p><p>ID interno independiente: <code>{connected.cloud.id}</code></p><p>Procesamiento: desactivado</p></article></div>}
  </section>}
  {(error||notice)&&<p className={error?'iso-error':'iso-status'} role="status">{error||notice}</p>}
  {config?.features.uploads&&user?.emailVerified&&<section className="iso-card iso-off"><h2>Archivo privado sintético</h2><p>Prueba local: MP4 de hasta 8 MiB, guardado en memoria del proceso aislado y visible solo para esta cuenta. Se elimina al reiniciar la API. No se envía a Google Cloud ni a proveedores de IA.</p><label className="iso-file-label">Selecciona un MP4<input type="file" accept="video/mp4,.mp4" onChange={event=>{setSelectedFile(event.target.files?.[0]);setUploadedFile(undefined);setTextFixture(undefined);setReviewDraft('');setError('');setNotice('');}}/></label><button disabled={uploadBusy||!selectedFile} onClick={()=>void uploadFile()}>{uploadBusy?'Guardando y verificando…':'Guardar video privado local'}</button>{uploadedFile&&<div className="iso-upload-result"><p><strong>Estado:</strong> {uploadedFile.state} · {uploadedFile.metadata?.duration.toFixed(2)} s · {uploadedFile.metadata?.width}×{uploadedFile.metadata?.height} · {uploadedFile.metadata?.audioTracks} pistas de audio</p><button className="iso-secondary" disabled={uploadBusy} onClick={()=>void openUploadedFile()}>Descargar mi video</button></div>}</section>}
  {config?.features.textFixture&&user?.emailVerified&&uploadedFile&&<section className="iso-card iso-fixture"><h2>Ejemplo local de texto</h2><p>No es transcripción del MP4 ni una traducción de IA. Sirve para comprobar el recorrido de revisión y descargas privadas; no muestra ni cobra precio.</p>{!textFixture&&<button disabled={fixtureBusy} onClick={()=>void startTextFixture()}>{fixtureBusy?'Creando muestra…':'Crear muestra de texto en español'}</button>}{textFixture&&<><label>Texto español de muestra<textarea disabled={fixtureBusy} value={reviewDraft} maxLength={4000} onChange={event=>setReviewDraft(event.target.value)}/></label><div className="iso-fixture-actions"><button disabled={fixtureBusy||!reviewDraft.trim()} onClick={()=>void saveTextReview()}>{fixtureBusy?'Guardando…':'Guardar revisión de muestra'}</button><button className="iso-secondary" disabled={fixtureBusy} onClick={()=>void downloadTextFixture('transcript-es.txt')}>Descargar ES TXT</button><button className="iso-secondary" disabled={fixtureBusy} onClick={()=>void downloadTextFixture('transcript-es.srt')}>Descargar ES SRT</button></div>{textFixture.translationEn&&reviewDraft!==textFixture.reviewedEs&&<p role="status">El ejemplo inglés corresponde a la revisión anterior. Guarda esta edición antes de volver a descargarlo.</p>}{textFixture.phase==='reviewed'&&<button disabled={fixtureBusy} onClick={()=>void translateTextFixture()}>Crear ejemplo fijo en inglés</button>}{textFixture.translationEn&&<div className="iso-upload-result"><strong>Texto inglés de muestra</strong><p>{textFixture.translationEn}</p><div className="iso-fixture-actions"><button className="iso-secondary" disabled={fixtureBusy||reviewDraft!==textFixture.reviewedEs} onClick={()=>void downloadTextFixture('translation-en.txt')}>Descargar EN TXT</button><button className="iso-secondary" disabled={fixtureBusy||reviewDraft!==textFixture.reviewedEs} onClick={()=>void downloadTextFixture('translation-en.srt')}>Descargar EN SRT</button></div></div>}</>}</section>}
  {config?.features.videoWorkflow===false&&<section className="iso-card iso-off"><h2>Procesamiento real</h2><p>La transcripción del video y la traducción con proveedores siguen desactivadas. La muestra local no usa saldo ni cuesta dinero.</p><button disabled>Transcribir video con IA · desactivado</button></section>}
  <p className="iso-footnote">Proyecto Firebase Emulator: <code>{config?.web.projectId??'demo-vistavo-ledger'}</code>. No se consulta vistavo-prod.</p>
 </main><footer>Vistavo · Solo loopback · Sin publicación</footer></div>;
}

const root=document.getElementById('isolated-candidate');if(root)createRoot(root).render(<App/>);
