# LinguistVision

Aplicación web para transcribir y traducir videos, corregir subtítulos sobre la vista previa y descargar SRT o MP4. Incluye una portada localizada, acceso con Firebase, proyectos por cuenta y paquetes de minutos con PayPal Sandbox.

**Instalación en otra PC Windows:** sigue [INSTALACION-WINDOWS.md](docs/INSTALACION-WINDOWS.md). Incluye PostgreSQL, configuración, Firebase, Drive, arranque, pruebas y cómo trasladar cuentas y saldo sin publicar datos privados.

## Estado actual

- Portada e interfaz preparadas para diez idiomas. La calidad y disponibilidad de cada traducción se validan por separado: diez idiomas de interfaz no equivalen a noventa pares verificados.
- Editor con importación SRT/LRC/ASS, dos pistas, tiempos, búsqueda, estilos, presets, resaltado y reapertura de proyectos.
- Piloto privado con cuenta y saldo, reserva de segundos y devolución ante fallo. Paquetes aprobados: US$1/10 min, US$5/50 min y US$10/100 min. Los pagos de esta candidata son de prueba.
- Almacenamiento privado local y carga reanudable con límite de ensayo de **500 MB/10 minutos**, caducidad de 24 horas y borrado. DigitalOcean Spaces y videos de cámara representativos siguen pendientes de validación.
- SRT disponible para archivos grandes; **MP4 del perfil anterior: hasta 1 MiB y 30 segundos**. La exportación MP4 grande está bloqueada hasta medirla.
- Guardado de SRT/MP4 en Google Drive implementado con permiso adicional. El consentimiento y la apertura de archivos reales en PC/Pixel siguen pendientes; las pruebas automatizadas usan un destino simulado.

No es todavía una entrega comercial pública. [Plan maestro](MASTERPLAN.md) · [Backlog y pendientes](backlog.md) · [Última entrega](docs/specs/LV-007-archivos-destinos-voz.md).

## Dos formas de ejecutarlo

| Modo | Dirección local | Requisitos adicionales |
|---|---|---|
| Web comercial y piloto: portada, cuenta, saldo, proyectos y editor | `http://127.0.0.1:3001/` | PostgreSQL dedicado, FFmpeg/ffprobe; Firebase para Google y Drive |
| Utilidad local anterior: transcribir y editar sin cuenta comercial | `http://127.0.0.1:3000/` | Clave Gemini para transcribir; no requiere PostgreSQL |

Son servidores diferentes. Para continuar la aplicación completa usa el **piloto en 3001**. `npm start` arranca la utilidad anterior, no el área comercial.

## Requisitos

- **Node.js 24 LTS**, versión de referencia probada: 24.13.0. Instala la rama 24, aunque la página de Node ofrezca otra rama por defecto.
- Git y PowerShell.
- Para el piloto: PostgreSQL en una instancia propia sobre `127.0.0.1:15438` y FFmpeg/ffprobe disponibles en PATH.
- Internet para instalar dependencias y usar Google, Gemini o PayPal.

## Descargar y compilar

```powershell
git clone https://github.com/Robcaze1980/video_transcript.git LinguistVision
Set-Location -LiteralPath .\LinguistVision
npm ci --include=dev
npm run lint
npm test
npm run build
```

Sin `LINGUISTVISION_TEST_DATABASE_URL`, las pruebas que necesitan PostgreSQL se omiten. Para ejecutar la batería completa configura la base de pruebas descrita en la [guía de instalación](docs/INSTALACION-WINDOWS.md#5-ejecutar-las-pruebas-completas).

Conserva las dependencias de desarrollo: el servidor usa `tsx` y Vite. No uses `npm ci --omit=dev` para esta instalación.

## Configuración fuera del repositorio

Las claves y los datos locales se guardan bajo `%LOCALAPPDATA%\LinguistVision`, no en GitHub. Las plantillas [.env.example](.env.example) y [.firebase.env.example](.firebase.env.example) contienen sólo ejemplos. La guía indica cómo copiarlas y completarlas localmente.

GitHub **no contiene** cuentas, saldos, compras, proyectos privados, videos subidos, claves Gemini/PayPal/OpenRouter ni autorizaciones de Google. Para trasladar esos datos necesitas una migración separada de PostgreSQL y de la carpeta privada, explicada en la guía.

## Arranque rápido de la utilidad local anterior

Después de compilar, y con tu clave guardada en el archivo externo:

```powershell
$configRoot = Join-Path $env:LOCALAPPDATA 'LinguistVision'
$env:HOST = '127.0.0.1'
$env:PORT = '3000'
node "--env-file=$configRoot\.env" --import=tsx server/index.ts --production
```

Abre `http://127.0.0.1:3000`. Para la aplicación con cuentas y proyectos usa los pasos de [arranque del piloto](docs/INSTALACION-WINDOWS.md#4-arrancar-la-web-completa-en-3001).

## Desarrollo y operación

- [Instalar en otra PC](docs/INSTALACION-WINDOWS.md).
- [Preparar versiones, comprobar y volver atrás](docs/DEPLOYMENT.md).
- [Arquitectura multilingüe](docs/MULTILINGUAL-ARCHITECTURE.md).
- [Instrucciones del proyecto](AGENTS.md), [cronograma](gantt.md), [bitácora](bitacora.md) y [errores](errorlogs.md).

Las comprobaciones recientes pasaron 155 pruebas con PostgreSQL, tipos, ambas compilaciones y 280 vistas de navegador. Las evidencias privadas referenciadas por los documentos se conservan fuera de Git; no se descargan al clonar. Algunas auditorías visuales opcionales necesitan el ZIP original de Claude y Chrome local.

## Acceso y publicación

La instalación descrita escucha sólo en la PC. `127.0.0.1` en un teléfono apunta al teléfono, no a la computadora. El acceso remoto privado, dominio, HTTPS, pagos reales y despliegue en DigitalOcean requieren su configuración y validación propias. La utilidad anterior de 3000 no ofrece autenticación comercial; no la expongas como sustituto del piloto.

Repositorio exclusivo de LinguistVision: `Robcaze1980/video_transcript`. No reutilices recursos ni credenciales de ROBATO o Techos.app.
