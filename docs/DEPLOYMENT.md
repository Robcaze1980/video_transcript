# Despliegue y actualización en Windows

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
