# Instalar LinguistVision en otra PC Windows

Esta guía instala la web comercial local: portada, cuenta, saldo, proyectos y editor. No publica la aplicación en internet ni habilita pagos reales. El repositorio es `Robcaze1980/video_transcript`.

Una instalación nueva comienza con una base vacía. Si quieres conservar cuentas locales, saldo y proyectos de la PC anterior, lee primero [trasladar los datos](#7-trasladar-cuentas-saldo-y-archivos-desde-la-pc-anterior).

## 1. Instalar las herramientas

Instala:

1. [Node.js, rama 24 LTS](https://nodejs.org/en/download). Esta aplicación se ha probado con 24.13.0; no selecciones otra rama sólo porque aparezca como predeterminada.
2. [Git para Windows](https://git-scm.com/downloads/win).
3. [PostgreSQL para Windows](https://www.postgresql.org/download/windows/), por ejemplo la rama 17. Usa una instancia exclusiva de LinguistVision, puerto **15438**, accesible sólo desde `127.0.0.1`. El piloto rechaza el puerto 5432 y conexiones a otras máquinas. No cambies la instancia de otro proyecto para acomodar esta aplicación.
4. [FFmpeg y ffprobe](https://ffmpeg.org/download.html#build-windows). Ambos ejecutables deben estar en PATH. El servidor los necesita para validar los videos; no basta con la copia WebAssembly del navegador.

Abre una PowerShell nueva y comprueba:

```powershell
node --version
npm --version
git --version
ffmpeg -version
ffprobe -version
```

Para usar `psql`, si no está en PATH, ajusta la versión a la que hayas instalado:

```powershell
$pgBin = 'C:\Program Files\PostgreSQL\17\bin'
$env:Path = "$pgBin;$env:Path"
psql --version
```

La alineación acústica local es opcional. Python, Faster Whisper y su modelo no son necesarios para arrancar la web; su configuración está en [despliegue](DEPLOYMENT.md#ensayo-privado-de-sincronía).

## 2. Descargar el código y preparar PostgreSQL

```powershell
git clone https://github.com/Robcaze1980/video_transcript.git LinguistVision
Set-Location -LiteralPath .\LinguistVision
npm ci --include=dev
```

Conserva abierta esa carpeta en PowerShell para los siguientes pasos. No copies `node_modules` ni `dist` desde otra PC: se generan de nuevo.

Conecta a la instancia dedicada como su administrador. La contraseña se introduce localmente cuando PostgreSQL la solicite:

```powershell
psql -h 127.0.0.1 -p 15438 -U postgres -d postgres -W
```

Si el administrador creado por tu instalador tiene otro nombre, sustituye `postgres`. Dentro de `psql`, ejecuta una sola vez:

```sql
CREATE ROLE linguistvision LOGIN;
\password linguistvision
CREATE DATABASE linguistvision OWNER linguistvision;
CREATE DATABASE linguistvision_test OWNER linguistvision;
\q
```

Elige una contraseña propia de LinguistVision. `\password` la solicita sin escribirla en el comando. La aplicación crea y migra automáticamente sus tablas dentro de un esquema propio; no ejecutes `schema.sql` sobre la base de otro proyecto. La base `linguistvision_test` es para pruebas con esquemas temporales.

## 3. Guardar la configuración local

### Archivo principal

Desde la carpeta del repositorio:

```powershell
$configRoot = Join-Path $env:LOCALAPPDATA 'LinguistVision'
New-Item -ItemType Directory -Force -Path $configRoot | Out-Null
if (-not (Test-Path -LiteralPath "$configRoot\.env")) {
    Copy-Item -LiteralPath .env.example -Destination "$configRoot\.env"
}
notepad "$configRoot\.env"
```

Guarda estas variables en ese archivo, sustituyendo los marcadores localmente:

```dotenv
GEMINI_API_KEY=TU_CLAVE_DE_GEMINI
GEMINI_MODEL=gemini-3.8-flash
HOST=127.0.0.1
PORT=3000
LINGUISTVISION_PILOT_DATABASE_URL=postgresql://linguistvision:CONTRASENA_CODIFICADA@127.0.0.1:15438/linguistvision
```

En una URL, caracteres de la contraseña como `@`, `:`, `/`, `#` y `%` necesitan codificación URL. No pegues la contraseña ni el archivo en el chat o en GitHub. Puedes dejar `GEMINI_API_KEY` vacía para probar importación y edición sin transcribir; la transcripción exige una clave válida y cuota de Gemini.

No guardes este archivo dentro del clon. No uses el prefijo `VITE_` para claves privadas. El arranque carga explícitamente el archivo externo; no lo imprime.

### Acceso inicial sin servicios externos

Para comprobar que la instalación funciona, puedes empezar con el acceso de prueba del paso4A. Los códigos se escriben en un buzón local y las compras son simuladas. No se envían correos ni se cobra dinero. Esto no es el acceso final de clientes.

### Firebase y Google, cuando quieras el acceso real

LinguistVision usa un proyecto Firebase propio. Para continuar el entorno existente, utiliza `linguistvision-dev` sólo si tienes autorización sobre ese proyecto. No crees otro proyecto ni copies credenciales de ROBATO o Techos.app.

1. En Firebase Console, abre el proyecto de LinguistVision y su aplicación Web. Obtén la configuración Web; no es una cuenta de servicio privada.
2. Authentication debe tener Google y correo/contraseña habilitados, con `localhost` y `127.0.0.1` entre sus dominios autorizados. Revisa también las plantillas de verificación y recuperación.
3. Copia la plantilla pública al directorio externo y completa su JSON en una sola línea:

```powershell
Copy-Item -LiteralPath .firebase.env.example -Destination "$configRoot\.firebase.env"
notepad "$configRoot\.firebase.env"
```

Antes de copiar, comprueba que no estás sobrescribiendo una configuración existente que necesites conservar. `LINGUISTVISION_FIREBASE_PROJECT_ID` y `projectId` dentro del JSON deben coincidir.

4. Instala [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) y autoriza personalmente las credenciales predeterminadas de aplicación de esta PC:

```powershell
gcloud auth application-default login --project=linguistvision-dev
```

Usa una identidad autorizada para administrar las sesiones de Firebase Authentication de LinguistVision. Firebase CLI por sí sola no sustituye estas credenciales del backend. No descargues una clave JSON de servicio al repositorio ni copies las autorizaciones locales de otra PC/proyecto. [Configuración oficial del Admin SDK](https://firebase.google.com/docs/admin/setup).

Google abre su pantalla de acceso: tú completas el inicio de sesión y cualquier verificación. La cuenta cliente que luego entra a la web es independiente de esta identidad administrativa del servidor.

Para Drive, el proyecto debe tener Drive API habilitada. La integración solicita `drive.file` al pulsar Guardar, mediante Google ya vinculado a la misma cuenta. Entrar con Google no concede ese permiso automáticamente. En `linguistvision-dev` la API ya está habilitada; no es necesario activar facturación para repetir esta configuración. El guardado real sigue pendiente de confirmación del propietario.

## 4. Arrancar la web completa en 3001

Compila primero:

```powershell
npm run lint
npm run build
```

### A. Primera comprobación: acceso y pagos simulados

En una PowerShell sin configuración Firebase/Supabase o PayPal heredada:

```powershell
$configRoot = Join-Path $env:LOCALAPPDATA 'LinguistVision'
$env:LINGUISTVISION_COMMERCIAL_PREVIEW = '1'
$env:LINGUISTVISION_COMMERCIAL_OUTBOX = Join-Path $configRoot 'test-mail'
$env:LINGUISTVISION_PRIVATE_STORAGE_DIR = Join-Path $configRoot 'private-files\local-preview'
$env:LINGUISTVISION_PILOT_USE_GEMINI = '0'
node "--env-file=$configRoot\.env" --import=tsx server/commercial/pilotLocal.ts
```

Deja esa ventana abierta. Abre **http://127.0.0.1:3001/**. Crea una cuenta con una dirección ficticia, por ejemplo `prueba@example.test`. Abre el JSON más reciente de `%LOCALAPPDATA%\LinguistVision\test-mail` con Bloc de notas para consultar el código y terminar el acceso.

Puedes importar un MP4 con sus subtítulos, corregir, guardar y reabrir. Con Gemini desactivado no aparecerá el servicio para transcribir un video nuevo. Drive requiere el modo Firebase del siguiente apartado.

Si tu archivo `.env` ya contiene credenciales de Firebase, Supabase o PayPal, usa un archivo de configuración distinto para este ensayo. El servidor elige Firebase y pagos Sandbox cuando sus variables están presentes: no basta con cambiar el título de la ventana o poner `USE_GEMINI=0`.

### B. Cuenta Google/Firebase y transcripción con Gemini

Detén el servidor con **Ctrl+C**. Desde la misma carpeta, usando los dos archivos externos ya configurados:

```powershell
$configRoot = Join-Path $env:LOCALAPPDATA 'LinguistVision'
$env:LINGUISTVISION_COMMERCIAL_PREVIEW = '1'
$env:LINGUISTVISION_PRIVATE_STORAGE_DIR = Join-Path $configRoot 'private-files\firebase-dev'
$env:LINGUISTVISION_PILOT_USE_GEMINI = '1'
node "--env-file=$configRoot\.env" "--env-file=$configRoot\.firebase.env" --import=tsx server/commercial/pilotLocal.ts
```

Abre la web y entra con Google o con el correo verificado. No configures a la vez Firebase y Supabase. La app verifica la identidad y crea su cookie de sesión; los archivos y saldos pertenecen a la cuenta de PostgreSQL correspondiente.

Sin credenciales PayPal, las compras son simuladas. Para repetir PayPal Sandbox, agrega al archivo externo **los tres valores propios del proyecto**, sin publicarlos:

```dotenv
LINGUISTVISION_PILOT_PAYPAL_CLIENT_ID=CLIENT_ID_SANDBOX
LINGUISTVISION_PILOT_PAYPAL_CLIENT_SECRET=SECRET_SANDBOX
LINGUISTVISION_PILOT_PAYPAL_MERCHANT_ID=MERCHANT_ID_SANDBOX
```

Reinicia y usa una cuenta de comprador Sandbox, no la cuenta vendedora. Los modos simulado, Firebase y Sandbox usan esquemas diferentes: cambiar de modo no migra saldos. Los pagos reales no se habilitan con esta guía.

### Qué comprobar

- Portada y acceso responden; una petición sin sesión a `/pilot/api/account` recibe401.
- Tras entrar, la cuenta muestra su saldo y proyectos.
- Importar un MP4 y un SRT, corregir una frase, guardar, volver a Mis proyectos y reabrir conserva los cambios.
- Los archivos grandes se guardan en el directorio privado y caducan a las24 horas desde iniciar la carga. La eliminación física requiere que el servidor esté funcionando; se reintenta al arrancar.
- Límite de ensayo:500 MB,10 minutos y1920 píxeles por lado; cupo privado2 GiB por cuenta. No es todavía un límite comercial validado con todos los formatos de cámara.
- El MP4 conserva el perfil anterior de hasta1 MiB y30 segundos. Para archivos mayores puedes editar y guardar SRT; exportar MP4 grande permanece bloqueado.
- Guardar SRT en Drive exige permiso adicional; comprueba que el enlace devuelto abra el archivo. Repite con un MP4 pequeño. Una prueba simulada no acredita guardado externo real.

La dirección127.0.0.1 sólo sirve en esa PC. Para probar desde un teléfono hace falta configurar por separado el acceso remoto privado; no abras puertos públicos siguiendo esta guía.

## 5. Ejecutar las pruebas completas

Usa exclusivamente la base `linguistvision_test` creada antes, con la contraseña codificada en la URL introducida localmente:

```powershell
$env:LINGUISTVISION_TEST_DATABASE_URL = 'postgresql://linguistvision:CONTRASENA_CODIFICADA@127.0.0.1:15438/linguistvision_test'
npm run lint
npm test
npm run build
```

Evita escribir una contraseña real en el historial compartido: puedes definir esta variable en un archivo externo de pruebas y cargarlo con Node en vez de escribir el valor en PowerShell:

```powershell
# En .test.env externo: LINGUISTVISION_TEST_DATABASE_URL=postgresql://...
node "--env-file=$configRoot\.test.env" node_modules/vitest/vitest.mjs run
```

La batería reciente pasó155 pruebas. Sin la variable PostgreSQL se omiten las integraciones; no interpretes esas omisiones como verificación completa. Las pruebas usan respuestas sintéticas y transportes simulados; no necesitan tu clave real de Gemini ni cobrar un pago.

Las auditorías opcionales `scripts/qa*.ts` usan Chrome y, algunas, el ZIP de diseño original en una ruta local del propietario. No son requisito de instalación ni todas son portables sin adaptar esos insumos. Las pruebas privadas y los videos originales no forman parte de GitHub.

## 6. Detener, volver a arrancar y actualizar

**Ctrl+C** detiene el servidor. La siguiente vez abre PowerShell en la carpeta del proyecto y repite el arranque del modo elegido. Reiniciar exige volver a definir las variables de esa ventana.

Para una actualización, conserva la versión que funciona y prepara una carpeta nueva con `npm ci --include=dev`, tipos, pruebas y compilación. El servidor usa `tsx` y carga Vite; conserva las dependencias de desarrollo. Verifica el puerto3001 antes de cambiar de versión y no cierres procesos de otras apps. [Guía de despliegue y reversión](DEPLOYMENT.md).

La configuración externa y la carpeta de datos no deben borrarse al cambiar de versión. Volver a una versión antigua puede ocultar proyectos de formatos de almacenamiento nuevos; conserva la base y los medios, y mantén la limpieza con una versión compatible.

## 7. Trasladar cuentas, saldo y archivos desde la PC anterior

**Clonar GitHub sólo traslada código.** El saldo, las compras, los borradores y las referencias a videos están en PostgreSQL; los videos grandes están en el directorio privado. Las cuentas Google continúan en el mismo proyecto Firebase.

1. Detén el procesamiento en la PC anterior y haz una copia protegida de PostgreSQL. Ejemplo con las herramientas y el usuario de esa instancia:

```powershell
$backupDir = Join-Path $env:LOCALAPPDATA 'LinguistVision\backups'
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$backupFile = Join-Path $backupDir 'linguistvision.dump'
pg_dump -h 127.0.0.1 -p 15438 -U linguistvision -d linguistvision -W -Fc -f $backupFile
```

Si la instalación anterior usa otra base o usuario, ajusta esos nombres. No reemplaces un backup previo sin conservarlo. El dump puede contener transcripciones y otros datos privados: no lo subas al repositorio.

2. Copia por un canal privado el dump y la carpeta indicada por `LINGUISTVISION_PRIVATE_STORAGE_DIR`. Conserva los nombres UUID de los archivos. La retención de24 horas no se reinicia al copiarlos: los vencidos se ocultarán y limpiarán al arrancar.
3. En la PC nueva, restaura el dump en una **base vacía exclusiva**. No uses una base que ya tenga datos que debas conservar:

```powershell
pg_restore -h 127.0.0.1 -p 15438 -U linguistvision -d linguistvision -W --no-owner --no-privileges $backupFile
```

4. Configura la conexión a esa base y la ruta al directorio privado copiado. Conserva también el mismo modo de identidad y pagos (por ejemplo, Firebase con PayPal Sandbox), porque determina qué esquema se abre. Usa el mismo proyecto Firebase para mantener los UID; autoriza personalmente las credenciales administrativas en la PC nueva. Introduce claves y secretos mediante tu gestor seguro, no mediante Git ni copiando autorizaciones de otros proyectos.
5. Arranca y comprueba una cuenta conocida, su saldo, proyectos no vencidos, reapertura y descargas. Una copia de la base sin los archivos privados no recupera esos videos; los videos pequeños anteriores pueden estar dentro del dump.

No dejes dos copias con bases y saldos independientes actuando como el mismo servicio comercial. Una migración de operación requiere detener la copia anterior y verificar la nueva; duplicar una base no crea un saldo comercial compartido.

## Problemas frecuentes

| Problema | Qué revisar |
|---|---|
| `ECONNREFUSED` o no abre3001 | PostgreSQL en15438, servidor arrancado y mensaje de inicio. No uses3000 si buscas el piloto. |
| `ffprobe` no encontrado | Instala FFmpeg, agrega su carpeta `bin` a PATH y abre PowerShell de nuevo. |
| Error de contraseña de PostgreSQL | Usuario/base/puerto correctos y contraseña codificada en la URL. |
| Google no abre o dominio no autorizado | Configuración Web, dominios Firebase y permiso del navegador para ventanas emergentes. |
| Backend Firebase no inicia o rechaza sesiones | ADC autorizado en esta PC y permisos sobre el proyecto correcto; Firebase CLI no sustituye ADC. |
| No aparece transcripción | Clave Gemini y `LINGUISTVISION_PILOT_USE_GEMINI=1`; después reinicia. |
| El saldo está vacío | Base nueva, modo/esquema diferente o falta de restauración. Git no contiene el saldo. |
| Drive rechaza el guardado | Drive API, consentimiento `drive.file`, misma cuenta Google, espacio disponible y conexión. No anuncies éxito sin abrir el enlace. |
| MP4 deshabilitado en archivo grande | Es el límite de exportación pendiente de validar, no un fallo del saldo. El SRT sigue disponible. |

No envíes claves, contraseñas, dumps o videos privados para pedir ayuda. Comparte el mensaje de error sin secretos, la versión de Node y el modo que estás arrancando.
