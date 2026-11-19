## LV-019.B · Contrato financiero en candidata · 17 nov 2026

El código local exige segundos y, al capturar, el trabajo/intento admitido; cada llamada al proveedor tiene un recibo propio en Cuenta. El bloqueo de Cuenta y el sello ante una reserva ausente usan nuevos contratos internos. **Las versiones antiguas y nuevas no interoperan:** antes de habilitar video, pausar y drenar workers antiguos, inspeccionar y conciliar reservas activas legacy, actualizar Cuenta/video coordinadamente, probar reversión y conservar consultas y recibos. Una reserva legacy activa no se libera ni captura automáticamente.

La cola local de bloqueos usa el índice propuesto en `deploy/google-cloud/billing-hold.indexes.json`; **no está aplicado ni comprobado en cloud**. Antes de activarla, preparar el cambio separado, verificar el índice real y las identidades, y auditar/migrar incidentes anteriores o eventos dañados que puedan no aparecer en consultas por fecha. El modo `billing` procesa bloqueos y liquidaciones, pero falta un scheduler autenticado y equitativo verificado. La conexión y los gates siguen en [Master Plan](../MASTERPLAN.md); no se ha aplicado este cambio en cloud.

<!-- LV-018-PUBLISHED-20261114 -->
## LV-018 · Release público permanente aplicado · 14nov2026

**14 de noviembre de 2026 (PST) · PUBLICADO Y VERIFICADO TÉCNICAMENTE.** Acceso permanente autorizado por Rob: [iniciar sesión](https://vistavo.app/acceso/es-419/), [registro](https://vistavo.app/registro/es-419/) y perfil real Firebase Authentication, con Google oficial y correo/contraseña en diez idiomas. Hosting `vistavo-prod`, versión `7327d2ad13d21070`, release `1794715814243000`, publicado UTC `2026-11-15T04:10:14.243Z`. Sustituye el estado pendiente de LV-017.PUBLIC-LOGIN; el diagnóstico anterior se conserva como historia.

[Informe de cierre](../docs/reviews/LV-018-login-publico-2026-11-14.md), [Gemini íntegro](../docs/reviews/LV-018-gemini-final-2026-11-14.md), [HTTPS95](../outputs/vistavo-public-auth-20261114/https-proof.json), [nativo online17](../outputs/vistavo-public-auth-20261114/native-online.json), [registro online11](../outputs/vistavo-public-auth-20261114/registration-online.json), [frontera privada](../outputs/vistavo-public-auth-20261114/private-boundary-online.json) y [costos](../outputs/vistavo-public-auth-20261114/accounting-final.json). Readback HTTPS95/alias5/www301, Auth no-store/CSP separadas, QA online17+11 con limpieza y frontera privada5/SQL0PASS. Candidata570/65/tipos/dosbuilds0.

Reversión preparada: helper `outputs/vistavo-public-auth-20261114/rollback.mjs`, --apply exige nombre exacto de versión live y crea un nuevo release de contenido apuntando a versión previa `98a81624fa93bb66`. Preserva cuentas Auth/recursos privados; intent exclusivo y UNKNOWN impiden replay. Preflight readonly y13controles offline: no rollback real ensayado. No ejecutar sin necesidad operativa y coordinación de único escritor. Alcance: identidad y perfil públicos permanentes. Procesamiento, compras, ledger y backend de negocio siguen privados; Drive pendiente. No se acredita Google personal, recepción en buzón, recorrido UI alojado `/__/auth/action` ni Pixel físico. El reto Google y códigos reales consumidos por API no sustituyen esas comprobaciones. Ningún verde retroactivo de fallos previos ni causa histórica E55/500 resuelta por este cierre.
<!-- /LV-018-PUBLISHED-20261114 -->

<!-- LV-007.AI-20261113-LOCAL -->
## LV-007.AI · Operación privada verificada; gates comerciales abiertos

El incremento añade `FirestoreAi`, rutas `/api/cloud/ai`, `cloudAiWorker` y resultados privados al backend Firestore existente. No conecta Hosting al procesador ni cambia el piloto PostgreSQL3001. `VISTAVO_AI_ENABLED=1` sólo habilita rutas/dispatch en la candidata; cada cuenta requiere aiPilot y simulationOnly verdaderos. Catálogo ai-candidate-v1 con unidades simuladas, no tarifa comercial de narración.

Plan incremental en `deploy/google-cloud/ai.plan.json` y `ai-foundation.mjs`: dry-run por defecto; IAM/índices y creación/actualización del Job son pasos separados. Worker candidato `vistavo-ai-process`,2CPU/4Gi/1800s, una tarea y maxRetries0, identidad administrada propia y secreto `vistavo-gemini-provider` sólo para worker. Conservar ADC local aislado; no claves JSON, Cloud SQL ni permisos públicos. Los dos índices de artifacts del archivo canónico coinciden con el plan; el estado READY debe validarse contra colección exacta y consulta nativa.

Antes de proveedor se persisten todas las claves bajo `candidate-files-v1/<inputUUID>/results/<jobUUID>/`. No reemplazar marcadores ni aplicarles lifecycle que permita resucitar escrituras tardías. TXT/SRT/JSON tienen presupuesto conjunto1MiB y máximo256KiB/objeto; WAV32MiB por narración. La carga original conserva límite8MiB por parte. Publicación/captura/cuota ocurre en una transacción después de verificar objetos y recibos; purga por lotes de100 documentos. Uso no recibido se declara usageUnavailable; no inventar costes a partir de unidades de ensayo.

Ante acuse perdido, releer estado durable; no reenviar proveedor ni reconstruir resultados por intuición. STAGE/FINISH con recibo confirmado se recuperan sin repetir IO/captura; una invocación ambigua queda UNKNOWN y requiere conciliación confiable. Antes de revertir/deshabilitar, drenar queued/running y conservar limpieza, planes, recibos y marcadores hasta resolver reservas. Apagar un flag no elimina bytes. La [prueba aiProof](../server/commercial/aiProof.ts) requiere fixtures sintéticos/controlados y comprobación real de aislamiento, generaciones, uso, purga y revocación; no usarla como arranque normal. [Cobertura final](../outputs/vistavo-ai-cloud/test-coverage.json):370/49 generales y94 únicas de backend sin omisiones, tipos/dos builds/audit0; Gemini final batch1794625807-CbTZINnB1JpdjBBGLbuT PASS técnico privado.

**Estado real y límites del ensayo.** Video sintético20,8s/414.238bytes, cinco archivos ES/EN y WAV Kore19,2s/Charon17,64s; tres llamadas reales una vez con2.328tokens y23 unidades SIMULADAS. Privacidad API/GCS403, Range/HEAD/416, revocación401 y nueve claves con marcadores vacíos/cuotas cero. [Readback final](../outputs/vistavo-ai-cloud/cloud-readback.json): cinco configuraciones con imagen71277b…; [equivalencia de procesamiento](../outputs/vistavo-ai-cloud/processing-equivalence.json) con imagen9f688… de generación, salvo logger seguro500. No corrección causal atribuida al logger.

El [ensayo original FAIL](../outputs/vistavo-ai-cloud/cloud-proof-failure.json) terminó tras cuatro controles por POST voz femenina500/104s. Diagnóstico exacto INCONCLUYENTE, LV-E55 abierto antes de comercializar. Una reserva posterior con la misma clave y Scheduler permitió [continuación acotada PASS de siete controles](../outputs/vistavo-ai-cloud/cloud-tail-proof.json), sin nueva transcripción/upload/crédito. [Resumen DERIVADO](../outputs/vistavo-ai-cloud/cloud-proof.json) no es un recorrido íntegro sin interrupción ni cambia el original. No reejecutar la prueba completa ni repetir llamadas ambiguas para lograr verde; conservar recibos y resolver estado durable. La [continuación explícita](../outputs/vistavo-ai-cloud/ai-tail-proof.mjs) es evidencia, no procedimiento de arranque.

[Limpieza temporal](../outputs/vistavo-ai-cloud/ai-proof-cleanup.json) y [Auth](../outputs/vistavo-ai-cloud/proof-users-cleanup.json) confirmadas: Job/grants retirados, dos usuarios ficticios eliminados, bootstrap conservada sin claves. El secreto pertenece exclusivamente al worker, API interna sin invocadores públicos, sin Hosting conectado ni Cloud SQL. Costes Google no medidos; no inferir factura de unidades simuladas. Estabilidad del POST y despacho, frontend, aceptación humana/comercial, restore, pagos, render largo y Drive permanecen abiertos. [Notas de alcance](../outputs/vistavo-ai-cloud/cloud-evidence-notes.md).

**Cierre técnico privado LV-007.AI.** [Revisión Gemini final](reviews/LV-007-ai-cloud-2026-11-13.md) y [aceptación acotada](../outputs/vistavo-ai-cloud/acceptance.json): PASS privado, sin cambio de código de aplicación después de la revisión. [Estado tras limpieza](../outputs/vistavo-ai-cloud/post-cleanup-state.json) confirma cuotas/reservas cero, tres Jobs succeeded, tres recibos y tres artefactos purgados/snapshots borrados. [Uso de proveedores](../outputs/vistavo-ai-cloud/provider-measurements.json): tres llamadas Google,2.328tokens; factura NO medida. [Contabilidad OpenRouter](../outputs/vistavo-ai-cloud/accounting.json): siete respuestas,845.896tokens,US$1.417184554152 observados, sólo revisiones OpenRouter; no incluye factura Google ni coste Codex. [Escaneo posterior](../outputs/vistavo-ai-cloud/versionable-secret-scan.json):0 hallazgos sin resolver; dos coincidencias revisadas eran placeholders de documentación. El informe Gemini conserva el snapshot anterior de costes/escaneo; estos recibos posteriores lo actualizan sin modificar código.

**Antes de uso comercial:** LV-E55 sigue ABIERTO con causa del500 INCONCLUYENTE. LV-E56 exige sacar/acotar el despacho esperado dentro de HTTP y validar respuesta tras reserva durable; no se declara causa de LV-E55. Videos mudos/sin habla admitidos pueden terminar UNKNOWN y retener unidades: capacidad no soportada/no aceptada hasta definir rechazo o resultado seguro y sus pruebas. También quedan hardening de staging/cuota, fixtures sin storage/audio, coherencia de hermanos UNKNOWN y guards de status/descarga, con regresiones antes de comercializar. Frontend conectado, producción, calidad humana, render largo, pagos/restore y Drive permanecen bloqueados por sus fases propias.
<!-- /LV-007.AI-20261113-LOCAL -->

<!-- LV-007.GCS-20261113 -->
**13nov2026 · Candidata de archivos cloud privada verificada técnicamente.** Contrato vigente: [LV-007.GCS](specs/LV-007-gcs-cloud.md). El backend de esta fase usa Firestore, no PostgreSQL alojado/Cloud SQL. API y mantenimiento Cloud Run internos min0; Jobs de validación/limpieza y GCS privado con generaciones y marcadores. Aplicadores en deploy/google-cloud/files-*.mjs son dry-run salvo --apply; no ejecutar preparación de prueba como arranque normal, porque sus grants son temporales. Verificar nombres completos de colección en índices y ejecutar consultas nativas, no aceptar un índice READY de una colección hermana. Scheduler no admite ForceRun pausado: reanudar, comprobar entrega real y decidir pausa después de recibo. No usar updateMask al PATCH de Jobs v2.

La candidata no está conectada a Hosting ni a pagos/proveedores; el piloto3001 se conserva. Google ADC local permanece aislado fuera del repo; servidores usan identidad administrada. No se crean claves JSON ni SQL. [Evidencia](reviews/LV-007-gcs-cloud-2026-11-13.md).
<!-- /LV-007.GCS-20261113 -->

# Despliegue y actualización en Windows

12nov22:05PST · Vista previa comercial estática ya publicada con HTTPS normal en https://vistavo.app/ y www301. Firebase Hosting vistavo-prod únicamente, noindex, sin billing/backend online. Certificados emitidos sirviendo; API en propagación global. Contrato/evidencias: [dominio Vistavo](specs/LV-005-despliegue-dominio.md), outputs/vistavo-public/acceptance.json. Las notas anteriores de prohibición de deploy o dominio pendiente se conservan como historial; autorización vigente «Publica a Vistavo.app» ya ejecutada sólo para este frontend.

LinguistVision se ejecuta desde PowerShell con Node.js 24 LTS y Git. El navegador abre la aplicación en `127.0.0.1` y el servidor local se comunica con Gemini. Usa una carpeta por versión para poder volver al último commit que funcionó.

## Vista previa comercial de LV-005

Prepara la compilación y usa la conexión PostgreSQL local de pruebas en `LINGUISTVISION_PILOT_DATABASE_URL`. Ejecuta desde la carpeta de la versión:

```powershell
$env:LINGUISTVISION_COMMERCIAL_PREVIEW = '1'
$env:LINGUISTVISION_COMMERCIAL_OUTBOX = Join-Path $env:LOCALAPPDATA 'LinguistVision\validation\commercial-preview-mail'
npm run pilot:local
```

Abre `http://127.0.0.1:3001/`. Usa una dirección ficticia para el alta y busca el código en el JSON más reciente del buzón de pruebas. Las compras usan el simulador cuando la sesión de PowerShell carece de credenciales de PayPal Sandbox. El saldo de las tres recargas se mide en segundos. Los datos simulados se guardan en `lv_commercial_minutes`. PayPal Sandbox usa `lv_commercial_minutes_sandbox`. Los saldos de créditos de candidatas anteriores permanecen en sus esquemas de prueba.

Para probar consumo real de minutos, inicia la candidata con `LINGUISTVISION_PILOT_USE_GEMINI=1` y la configuración local del proyecto. Compra un paquete con el comprador de Sandbox, verifica el saldo y procesa dos MP4 distintos de hasta 30 segundos y 1 MiB cada uno. Compara la duración medida por el servidor y el saldo que queda tras descargar cada SRT.

### Propuesta de Firebase para LinguistVision

El propietario aprobó y se creó `linguistvision-dev` (LinguistVision Dev), exclusivo de esta app. Plan Spark sin cuenta de facturación vinculada, Analytics desactivado. Aplicación Web: `1:922534410785:web:42448c25c2a5a335bc4160`. Authentication está inicializado con Google y correo/contraseña habilitados. Dominios autorizados: `localhost`, `127.0.0.1`, `linguistvision-dev.firebaseapp.com` y `linguistvision-dev.web.app`. El dominio final se añadirá al preparar la publicación. Producción requiere otro proyecto aprobado por separado.

La configuración cliente se guarda fuera del repositorio en `%LOCALAPPDATA%\LinguistVision\.firebase.env`, mediante `LINGUISTVISION_FIREBASE_WEB_CONFIG` (JSON de Firebase Web) y `LINGUISTVISION_FIREBASE_PROJECT_ID`. El servidor usa Application Default Credentials; la prueba contra el proyecto alojado verificó acceso sin archivo privado de cuenta de servicio. No configurar a la vez las variables de Supabase. La candidata Firebase usa el esquema propio `lv_commercial_firebase_dev` (sufijo `_sandbox` si usa PayPal de prueba); las cuentas y archivos anteriores se conservan.

En desarrollo, cargar `.env` y `.firebase.env` y ejecutar `server/commercial/pilotLocal.ts` con `LINGUISTVISION_COMMERCIAL_PREVIEW=1` desde la carpeta candidata. El navegador usa Firebase Web; el servidor comprueba el ID token, el correo verificado y la autenticación reciente, y crea una cookie HttpOnly de ocho horas. Cada acceso privado vuelve a verificar revocación. La tabla `commercial_firebase_identities` relaciona el UID validado con PostgreSQL, sin fusionar cuentas por correo. Esto permite las solicitudes Range del video y las descargas protegidas. El cliente obtiene el token vigente desde el SDK, sin copiarlo a un almacenamiento propio.

La verificación y recuperación usan el manejador de enlaces de Firebase con retorno al inicio de sesión local. Google intenta ventana emergente y contempla redirección si está bloqueada; falta acreditar ese retorno en el Pixel y en el dominio final. La vinculación de proveedores exige inicio con la cuenta existente y confirmación explícita.

[Pruebas y pendientes de Firebase](FIREBASE-VALIDATION-2026-11-10.md). [CLI](https://firebase.google.com/docs/cli) · [Sesiones](https://firebase.google.com/docs/auth/admin/manage-cookies) · [Redirecciones](https://firebase.google.com/docs/auth/web/redirect-best-practices).

### Supabase Auth de la candidata anterior

En el proyecto dedicado habilita registro, correo con confirmación obligatoria y Google. Configura el SMTP de LinguistVision para confirmar cuentas y recuperar contraseñas. En Google Cloud autoriza el callback del proyecto Supabase `https://<proyecto>.supabase.co/auth/v1/callback` y configura el cliente OAuth de LinguistVision en ese mismo proyecto. [Google en Supabase](https://supabase.com/docs/guides/auth/social-login/auth-google) · [Correo y contraseña](https://supabase.com/docs/guides/auth/passwords)

Autoriza en Supabase las rutas `/pilot/auth/google/`, `/pilot/auth/confirm/` y `/pilot/auth/recovery/` del origen de la candidata. Incluye la variante con el parámetro `sb_flow_id` que añade el SDK al inicio de PKCE. Configura las URLs del dominio definitivo por separado al preparar la publicación. Las pruebas de confirmación y recuperación se completan en el navegador que inició la solicitud.

Guarda `LINGUISTVISION_SUPABASE_URL` y `LINGUISTVISION_SUPABASE_PUBLISHABLE_KEY` en la configuración local de LinguistVision. La app usa la clave publicable. Con ambas variables y `LINGUISTVISION_COMMERCIAL_PREVIEW=1`, el alta y el inicio de sesión usan Supabase. Se usan esquemas de prueba propios, `lv_commercial_auth` o `lv_commercial_auth_sandbox`. Para la vista previa con el buzón de códigos de prueba se omiten las dos variables de Supabase.

## Primera instalación

Abre PowerShell y prepara la carpeta del repositorio y la de versiones:

```powershell
node --version
$deployRoot = Join-Path $env:LOCALAPPDATA 'LinguistVision'
$sourceRepo = Join-Path $deployRoot 'source'
$releases = Join-Path $deployRoot 'releases'
New-Item -ItemType Directory -Force -Path $releases | Out-Null
git clone https://github.com/Robcaze1980/video_transcript.git $sourceRepo
if ($LASTEXITCODE -ne 0) { throw 'No se pudo clonar el repositorio.' }
```

Si ya tienes una copia del repositorio, asigna su ruta a `$sourceRepo` y sigue con **Preparar una versión**. Si el repositorio es privado, usa una sesión de GitHub con acceso.

Guarda `GEMINI_API_KEY` en `%LOCALAPPDATA%\LinguistVision\.env`, dentro de tu perfil de Windows. Ábrelo con `notepad (Join-Path $deployRoot '.env')` y guarda una línea `GEMINI_API_KEY=<tu clave de Gemini>`, sustituyendo el texto entre ángulos. Usa ese mismo archivo al cambiar de versión. El secreto de GitHub Actions se configura por separado del archivo local.

## Preparar una versión

Ejecuta estos pasos tanto para la primera instalación como para cada actualización. Durante una actualización, deja el servidor anterior funcionando mientras preparas la versión nueva.

```powershell
git -C $sourceRepo fetch origin main
if ($LASTEXITCODE -ne 0) { throw 'No se pudo obtener origin/main.' }
$revision = git -C $sourceRepo rev-parse --verify origin/main
if ($LASTEXITCODE -ne 0) { throw 'No se pudo identificar el commit.' }
$release = Join-Path $releases $revision
Write-Host "Commit candidato: $revision"
```

Si el commit coincide con el de la versión activa, termina aquí. Consulta el commit activo con `git rev-parse HEAD` desde su carpeta. Si es distinto, continúa:

```powershell
if (-not (Test-Path -LiteralPath $release)) {
    git -C $sourceRepo worktree add --detach $release $revision
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear la carpeta de la versión.' }
}
$releaseRevision = git -C $release rev-parse --verify HEAD
if ($LASTEXITCODE -ne 0 -or $releaseRevision -ne $revision) {
    throw 'La carpeta existente no corresponde al commit candidato.'
}

Set-Location -LiteralPath $release
npm ci --include=dev
if ($LASTEXITCODE -ne 0) { throw 'Falló la instalación.' }
npm run lint
if ($LASTEXITCODE -ne 0) { throw 'Falló la revisión de tipos.' }
npm test
if ($LASTEXITCODE -ne 0) { throw 'Fallaron las pruebas.' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Falló la compilación.' }
```

El servidor compilado se arranca con `tsx` y usa Vite para cargar configuración. Por eso `npm ci --include=dev` instala también las dependencias de desarrollo.

## Arrancar y comprobar

Abre una terminal dedicada en la carpeta de la versión. Usa el puerto `3000` para el servicio normal o `3001` para ensayar una candidata. Quita las variables de clave heredadas de esa sesión porque Node les da prioridad sobre el archivo.

```powershell
Remove-Item Env:GEMINI_API_KEY,Env:API_KEY -ErrorAction SilentlyContinue
$envFile = Join-Path $env:LOCALAPPDATA 'LinguistVision\.env'
if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) {
    throw "Falta el archivo de configuración: $envFile"
}
$env:HOST = '127.0.0.1'
$env:PORT = '3000' # cambia a '3001' para el ensayo
if (Get-NetTCPConnection -State Listen -LocalPort ([int]$env:PORT) -ErrorAction SilentlyContinue) {
    throw "El puerto $env:PORT ya está en uso."
}
node --env-file="$envFile" --import tsx server/index.ts --production
```

Después de que el servidor anuncie el arranque, abre otra ventana de PowerShell. Usa el mismo puerto que en la terminal del servidor.

```powershell
$checkPort = 3000 # usa 3001 si estás comprobando la candidata
$listeners = @(Get-NetTCPConnection -State Listen -LocalPort $checkPort -ErrorAction Stop)
if ($listeners.Count -ne 1 -or $listeners[0].LocalAddress -ne '127.0.0.1') {
    throw "El puerto $checkPort debe escuchar solo en 127.0.0.1."
}
$baseUrl = "http://127.0.0.1:$checkPort"
$health = Invoke-RestMethod "$baseUrl/api/health" -TimeoutSec 10
if ($health.ok -ne $true -or $health.configured -ne $true) {
    throw 'El servidor no está listo o falta la clave de Gemini.'
}
```

Abre en el navegador la dirección que acabas de comprobar. `configured: true` indica que el servidor cargó una clave. Para comprobar que Gemini la acepta, usa un video corto de prueba en esa misma dirección, transcríbelo y descarga los subtítulos. Si falla el ensayo en `3001`, deja la versión anterior activa en `3000`.

## Cambiar de versión y volver atrás

1. Anota la carpeta y el commit de la versión que funciona. Prepara la candidata y compruébala en el puerto `3001`. Si una comprobación falla, deja la versión activa en `3000`.
2. Termina las transcripciones o exportaciones activas. Detén el ensayo con `Ctrl+C` en su terminal y después detén el servidor anterior en la suya. Espera a que ambas terminales devuelvan el control. Entra en la carpeta candidata, repite **Arrancar y comprobar** con el puerto `3000` y abre la página. Si aparece `EADDRINUSE`, identifica qué proceso usa el puerto antes de reintentar.
3. Si el arranque o la comprobación falla, detén la candidata, entra en la carpeta anterior y repite **Arrancar y comprobar** en `3000` con el mismo archivo `.env`. Abre nuevamente la página.
4. Conserva al menos la última versión que funcionó, incluidas sus dependencias y `dist/`, para poder revertir sin reinstalar.

### Reversión del editor privado

Para volver de LV-012/LV-013 a LV-011, termina los trabajos en curso y detén la recepción de nuevas cargas y pagos. Conserva la base de datos y la migración aditiva de resaltados. Mantén la versión anterior en modo de consulta mientras se recupera la candidata. Limita el acceso a inicio de sesión y lecturas, porque LV-011 carece de los controles para editar los estilos y resaltados nuevos.

Comprueba que el proyecto previo abra sus dos pistas y su video. Al volver a la candidata, inicia una sesión nueva y comprueba revisión, estilo, resaltado y saldo. El [ensayo de LV-014](specs/LV-009-plan-del-editor.md#ensayo-de-reversión) ejecutó la secuencia con dos carpetas y un esquema de prueba.

### Ensayo privado de sincronía

El piloto web admite un ajuste experimental del final de subtítulos para audio en inglés, español y vietnamita. Para ensayarlo, configura `LINGUISTVISION_PILOT_WORD_TIMING_PYTHON` con la ruta absoluta de un Python de entorno virtual que tenga Faster Whisper 1.2.1 y NumPy. Configura `LINGUISTVISION_PILOT_WORD_TIMING_MODEL` con la ruta absoluta del modelo multilingüe CTranslate2 `small` ya descargado. FFmpeg debe estar disponible en la ruta de comandos. Ambas variables se usan al arrancar la candidata privada. Para volver al flujo habitual, retira las dos variables de esa candidata y reiníciala.

El lector intenta decodificar por entrada estándar. Si falla y la carga cabe en el límite de 1 MiB, reintenta con una copia de acceso directo en un directorio temporal exclusivo del intento. El lector cierra FFmpeg y elimina la copia al terminar o cancelar. Un cierre forzado de Node puede interrumpir esa limpieza. Si el audio sigue sin poder leerse, se entregan los tiempos de Gemini y se registra un aviso sin contenido. Prueba ambos tipos de MP4 en la candidata y coteja las dos pistas SRT. [Cotejo de LV-004](specs/LV-004-paquetes-de-idioma.md#mp4-con-el-índice-al-final).

### Acceso privado Firebase desde el Pixel

LV-003 prepara la candidata Firebase mediante Tailscale Serve, solo dentro de la red privada existente. Se permite un origen HTTPS `*.ts.net` con Firebase alojado, sin emulador. Los modos de buzón local y Supabase conservan su restricción de loopback. No utilizar Funnel ni publicar el puerto Node en interfaces externas. Registrar el origen exacto para cookies, comprobación de Origin y retornos de autenticación; autorizar el hostname propio en Firebase.

## Candidata local de archivos grandes y Drive

`LINGUISTVISION_PRIVATE_STORAGE_DIR` habilita la ruta reanudable privada; debe apuntar a carpeta absoluta externa al repositorio/versiones. Candidata Windows usa `%LOCALAPPDATA%\LinguistVision\private-files\firebase-dev-sandbox`. No ponerla dentro de carpetas públicas ni sincronizadas; no mezclar con ROBATO. Al actualizar conserva esa carpeta y la misma base/esquema. Migraciones `privateInputMigration.sql` y `privateUploads.sql` se aplican en el esquema dedicado. La configuración permanece fuera deGit. No cambia el servicio normal3000 ni activaSpaces.

La cuenta muestra los límites devueltos por servidor (ensayo500MB/600s,TTL24h,cupo2GiB); portada conserva condiciones comerciales hastavalidación. Limpieza alarranque ycadaminuto mientras corre; si se apaga se reintenta alvolver. Controlar estadosdeletingy avisosdeworker; no asumir eliminación física si hay fallo de disco. Reversión a versión antigua no interpreta entradasprivadasnuevas: conservar esquema/medios y mantenerlimpieza con versión actual hasta cerrar operación.

Driveusa FirebaseGooglepropio ypermiso adicionaldrive.file, no unAPIkeyprivado ni credenciales deotroproducto. DriveAPI está habilitada enlinguistvision-dev, sin facturación. Usuario debe confirmar consentimiento yabrirarchivo devuelto antes de declarar recorrido real aprobado. No solicitaraccesocompletoaDrive ni copiaraccessTokenalog/chat. [Implementación, pruebas y pendientes](specs/LV-007-archivos-destinos-voz.md#entrega-local--archivos-grandes-y-drive--2026-11-11).

## Instalar desde cero en otra PC

Para requisitos, creación de una base dedicada, configuración externa, arranque y traslado de datos, sigue [Instalación en Windows](INSTALACION-WINDOWS.md). Esta guía de despliegue se centra en preparar y cambiar versiones.

### LV-016.A · Contratos internos

El arranque local aplica pipelineMigration.sql después de las migraciones de archivos. Es aditiva: snapshots, trabajos, dependencias y manifiestos de metadata; trigger de inmutabilidad sólo en snapshots. No hay rutas ni workers pipeline activos. No habilita voz, Gemini, exportación larga ni cobros. Comprobada repetición de migración y conservación de proyectos/saldos en3001; [evidencia y contrato](specs/LV-016-A-contratos.md).

Reversión de este incremento conserva tablas propias; la versión anterior no las usa y el borrado de proyectos cascada sus registros. No ejecutar SQL destructivo para quitar la migración. Antes de incorporar workers/proveedores en fases siguientes, definir drenaje, compatibilidad y limpieza física; la ausencia de workers en A no prueba esa reversión futura.

### LV-016.B · Texto español/inglés privado

LINGUISTVISION_TEXT_PIPELINE=1 habilita únicamente el incremento textual ES→EN con pagos simulados, carga privada y clave de proyecto sólo en servidor. LINGUISTVISION_PILOT_USE_GEMINI permanece0: no activar de forma general el procesador comercial o nuevos pares. Arranque aplica pipelineTextMigration.sql: resultado textual acotado, recibo de aplicación y segment_ids aditivos. No cambiar paquetes/saldos por esta candidata. [Contrato, evidencia y límites](specs/LV-016-B-texto.md).

Perfil local outputs/Iniciar-LinguistVision-Google.ps1 usa outputs/Start-LinguistVision-Texto.mjs: lee únicamente GEMINI_API_KEY del archivo privado de LinguistVision y no importa otras credenciales al proceso. Configuración Firebase/DB y ADC dedicados permanecen externos. El .cmdgeneral apunta a ese perfil vigente. WindowsPowerShell5.1 requiere helper.mjs para resolver realpath: no volver a node -e con comillas incrustadas. No relajar restricciones del PrivateFileStore.

Antes de detener, comprobar que no hay trabajos queued/running. Apagar flag y conservar esquema aditivo permite volver al editor anterior; mantener limpieza/caducidad y no volver a exponer artefactos caducados. No hay retry remoto automático para unknown; cancelar/reconciliar explícitamente antes de otra generación. Esta fase no valida voz, MP4largo o publicación, ni habla continua que atraviese ventanas30s. En3001 se verifica con fixtures sintéticos, no se utiliza archivo privado del propietario para revisores.


### LV-016.C · Voces inglesas del ensayo privado

`LINGUISTVISION_VOICE_PIPELINE=1` habilita Kore/Charon sobre texto inglés guardado y exige TEXT_PIPELINE, clave Gemini del proyecto, uploads privados y pagos simulados. El wrapper local vigente habilita ambos flags y mantiene PILOT_USE_GEMINI=0. Arranque aplica `migrations/0016c_voice.sql`; WAV fuera de BD en raíz física hermana `-voice`, con reserva/cuota técnica, tombstones, TTL y reconciliación. No cambiar paquetes/saldo. [Contrato C](specs/LV-016-C-voz.md).

Antes de revertir, drenar los trabajos narration queued/running y comprobar unknown explícitamente. Apagar VOICE_PIPELINE oculta generación y descarga, pero **no elimina bytes ni sustituye la limpieza**. Conservar migración y una versión compatible del reconciliador hasta vaciar narraciones/reservas/tombstones; después puede volver al perfil textual. No borrar el esquema ni la raíz de videos. C no certifica reversión con trabajo en curso: se ensaya en F. Escucha humana inglesa, encaje temporal y MP4 largo siguen pendientes.


2026-11-12 · LV-007/Vistavo: Rob aprueba ruta Google Cloud y presupuesto; selecciona Billing for Robertson. Sustituye DigitalOcean y rechaza página temporal. Proyecto dedicado vistavo-prod creado ACTIVE y Firebase añadido correctamente. Vinculación billing falla HTTP400 QuotaFailure Cloud billing quota exceeded, permiso de asociación comprobado; primer intento y un reintento preservados. Fase A incompleta, sin Cloud SQL/Run/Storage de pago creados ni cambios DNS ni exposición local. Preparación y cálculo en docs/specs/LV-007-vistavo-google-cloud.md y deploy/google-cloud/. Linux Node24.13.0/FFmpeg5.1.9 bajo usuario1000, sin red/fsreadonly/tmpfs256MiB/1GiBRAM/2CPU: patrón+seno180s,4500frames,H264/AAC y archivo inválido rechazado. No prueba ASR/traducción/voz/rendercloud. Datos/candidata3001 conservados. Siguiente: resolver cuota de la cuenta elegida, reanudar sólo billing del proyecto existente; después B almacenamiento durable/SQL y C entrypoint/activación cloud, manteniendo gates D/E. Revisiones y costes se completan en el cierre de esta fase.



12 de noviembre · Marca Vistavo aplicada localmente a diez portadas y panel; Firebaseprod configurado tras aprobación explícita (Google/correo, Vistavo Web, dominios autorizados), separado de dev.306/306pruebas43archivos, tipos/builds0 y DeepSeek/KimiPASS técnico acotado. [Informe](docs/FIREBASE-VISTAVO-2026-11-12.md). No desplegar ni habilitar billing según última instrucción; pruebas humanas/prodcloud y gates globales pendientes. Sin nueva fecha pública.


## Frontend comercial Firebase Hosting · Vistavo (12nov)
Autorizado y desplegado sólo Hosting vistavo-prod, sin billing. Preview pública noindex https://vistavo-prod.web.app/; acceso/compras/procesamiento no habilitados, CTA a disponibilidad. Dominio propio con5DNS reales en Cloudflare DNS only; TLS aún en comprobación, no afirmar dominio operativo. [Contrato/estado](specs/LV-005-despliegue-dominio.md).
Preparación: ejecutar builds del proyecto, luego node node_modules/tsx/dist/cli.mjs scripts/exportCommercialStatic.ts y node scripts/checkCommercialStatic.mjs. Publica únicamente la carpeta site inventariada; no usar dist genérico. Deploy exacto: firebase deploy --only hosting --project vistavo-prod --config firebase.commercial.json. Esta instrucción documenta el alcance autorizado, no permite otros servicios. Evidencia/rollback/versiones en outputs/vistavo-public. Verificar HTTP hashes/CSP/noindex/404/Range y TLS normal después. Sin exponer PC3001, sin deploy de Auth/Run/SQL/backend.

13nov2026: A3 publicado sóloHosting vistavo-prod, versión98a81624fa93bb66. Rollbackprevio e3a9dad2b9671663 conservado; guía/evidencia outputs/vistavo-a3-publish/rollback.md y release-proof.json. Exportador aplica marca y hashes CSP finales antes de generar51archivos exactos; rutas HTML limpias deben responder Cache-Control:max-age=0,must-revalidate y assets max-age3600. PruebaHTTP ambosdominios y negativo de archivo extra incluidos.


## Backend Firestore candidato · 13nov2026

La ruta aprobada usa Firestore y procesamiento bajo demanda; no crear Cloud SQL. [Spec vigente](specs/LV-007-firestore-backend.md) e [informe local](reviews/LV-007-firestore-backend-2026-11-13.md). API/dispatcher propios en cloudApi.ts/cloudDispatcher.ts, sin desplegar. Runtime REST público; no añadir onSnapshot al cliente servidor ni parchear SDK/reintentar código3 genéricamente. El piloto3001 PostgreSQL permanece separado. Procesamiento cloud503 hasta GCS/cotización/proveedor/artefactos; no promover a3000 ni añadir rewrites públicos por este avance. npm run emulator:firestore; en otra terminal FIRESTORE_EMULATOR_HOST=127.0.0.1:8185 y npm run test:firestore. Matriz52 local separada de npm test332. IAM/identidadreal/índices/Sandbox-live/restore siguen pendientes.
