# LV-007 · Análisis de archivos grandes, destinos y voz AI

Fecha: 2026-11-11. Estado: estudio de viabilidad solicitado; no autoriza activar proveedores, facturación, cambiar planes ni publicar funciones. Repositorio Robcaze1980/video_transcript, revisión base afe2d4caefd53b8576b066c0f20129095fbcc172 con cambios locales conservados. Conecta LV-003 (cuentas/archivos), LV-004 (calidad por idioma), LV-007 (costes) y editor LV-008–013.

## Base y propuestas a distinguir

Actual: piloto de archivos1MiB y oferta anunciada30s; proyectos24h; MP4 generado en navegador. Los planes aprobados son$1/10min,$5/50min,$10/100min. No se ha aprobado todavía500MB/10min por archivo,1080p, servicios conectados ni voice-over. Tampoco se ha demostrado que un MP4 generado localmente se almacene en el servidor. El máximo debe imponerse por tamaño, duración, dimensiones/códec, consumo temporal y cupo por cuenta; un plan de100min no implica un archivo100min.

Propuesta de ensayo: límite objetivo500MB (500.000.000bytes) y10min por archivo; probar escalones100/250/500MB,1/5/10min y concurrencia en PC/Pixel antes de fijar límite comercial. Cargar por partes/reanudar hacia almacenamiento privado, validar tamaño real/tipo/duración, no guardar buffers500MB en PostgreSQL ni duplicarlos en memoria. PostgreSQL mantiene identidad/estado/saldo/metadata y referencias de objetos. Cola, cancelación, reintentos idempotentes y limpieza de partes incompletas. No prometer compresión automática ni1080p sin validar HEVC/HDR/rotación y recursos.

## Almacenamiento y transferencia

Cuenta con almacenamiento temporal, no archivo permanente. Definir origen del reloj24h, aviso de caducidad, eliminación manual, limpieza de originales/derivados/audios/multipart y tratamiento de trabajos/exportaciones en curso. No eliminar copia externa del usuario al caducar nuestra copia. Aplicar límites por bytes y cuenta:24h por sí solo no controla coste.

[Spaces](https://www.digitalocean.com/pricing/spaces-object-storage):$5/mes incluye250GiB almacenados y1TiB salida; exceso$.02/GiB-mes y$.01/GiB salida. Tarifa consultada, no recurso contratado. No confundir GB decimal con GiB ni capacidad almacenada con tráfico mensual. No sumar prorrateo de cuota y exceso como si todo byte se pagara dos veces. Contar rutas: original→IA, original→navegador, exportación→objeto, reproducción/descarga y copia externa; su precio depende de origen y destino. Resultado no necesariamente pesa igual que entrada; temporales suman picos.

## Guardar en nube personal

Recomendar Drive primero y Dropbox después por el uso móvil observado, conservando descargar local. Login Google no concede permisos Drive. [drive.file](https://developers.google.com/workspace/drive/api/guides/api-specific-auth) restringe acceso a archivos creados/seleccionados con la app; autorización explícita sólo al usar destino, desconectar y reintentos sin copias duplicadas. [Carga reanudable](https://developers.google.com/workspace/drive/api/guides/manage-uploads) para archivos grandes/interrupciones; puede subir Blob del MP4 generado en navegador. Sólo indicar Guardado y mostrar enlace/identificador tras confirmación remota. Probar denegación, revocación, cuota llena, red cortada, duplicados y móvil.

[Dropbox Saver](https://docs.dropboxapi.com/dropbox-api/docs/pre-built-components/saver) descarga una URLHTTP(S) desde Dropbox, sin sesión del navegador; no puede usar directamente un Blob local. Requiere artefacto accesible mediante autorización temporal adecuada o alternativa API OAuth para cargarlo. Evitar publicación del archivo. Saver requiere terminar transferencia en15min; validar URLs firmadas y TTL suficientes. La integración no sustituye el almacenamiento temporal ni garantiza persistencia si la nube rechaza el archivo.

## Nuevo servicio de voz: capacidades separadas

1. Subtítulos: conserva audio original, añade texto traducido.
2. Narración traducida: voz sintética estándar lee texto revisado; descarga audio y MP4 con mezcla/reemplazo elegidos. No promete misma voz, sincronía labial ni separación perfecta de ambiente.
3. Doblaje sincronizado: ajuste de frases al tiempo, manejo de voces/ambiente y controles de calidad adicionales. No equivale a TTS y queda fuera del primer ensayo.

Primer ensayo propuesto: una voz estándar por idioma disponible, un hablante, texto traducido revisado antes de generar; reutilizar traducción sin nueva transcripción. Medir pronunciación de nombres/medidas/términos, cobertura de diez idiomas, duración generada vs hueco disponible, clipping/volumen, conservación de imagen y mezcla original. Si no cabe, avisar y ofrecer edición; no acelerar indiscriminadamente ni cortar palabras. Regenerar sólo segmentos cambiados con caché/versiones por texto/voz/modelo. Sin clonación ni lipsync en propuesta inicial. Mantener voz como capacidad/coste separados por idioma y por versión de audio; no heredar verificación lingüística de SRT.

## Escenarios de coste, no factura ni margen neto

Supuesto didáctico900caracteres por minuto de voz destino (no válido automáticamente para todos los alfabetos), sin reintentos ni mezcla/render. Precios de [Google Cloud TTS](https://cloud.google.com/text-to-speech/pricing), sin descontar cuotas gratuitas:

| TTS |1min|5min|10min|
|---|---:|---:|---:|
| Standard/WaveNet,$4/Mcaracteres|$0.0036|$0.018|$0.036|
| Neural2,$16/Mcaracteres|$0.0144|$0.072|$0.144|
| Chirp3HD,$30/Mcaracteres|$0.027|$0.135|$0.270|
| ElevenLabs Flash/Turbo,$.04/1000caracteres|$0.036|$0.180|$0.360|

[ElevenLabs API](https://elevenlabs.io/pricing/api) es tarifa TTS, no tarifa de doblaje. Revisar disponibilidad/voz/modelo en cada idioma antes de escoger. Google TTS exige facturación; no habilitada por este estudio. GeminiTTS puede servir como alternativa, pero modelos preview/promociones cambian: la tabla oficial duplica la tarifa anunciada3.8FlashTTS el1enero2027. No basar precio comercial estable en una promoción.

Para10min, reserva Gemini de subtítulos anterior$.15–.23 es provisional, no medición de video500MB. Con Chirp3HD y supuesto9000caracteres, subtotal de IA$.42–.50. Sobre venta$1 y comisión nacional hipotética micropagos$.1399, quedan$.3601–.4401 antes de servidor, almacenamiento, transferencias, reintentos, soporte/impuestos. No es margen neto ni justifica incluir voz en el paquete actual. Medir coste por trabajo exitoso y versiones/regeneraciones, no sólo primera llamada. Precio y consumo de voz requieren decisión comercial posterior.

## Secuencia y evidencia de cierre propuesta

A. Archivos grandes + almacenamiento privado, cuotas/borrado/aislamiento y prueba1/5/10min. B. En paralelo prototipo de voz sin comercializar y evaluación de permisos Drive. C. Drive completo y pruebaPixel; Dropbox tras resolver entrega de artefacto. D. Coste total medido y propuesta de precio voz separado. E. Actualizar catálogo/páginas sólo después de decidir alcance y superar aceptación. Nada de este estudio cierra LV-004 ni cambia publicación. Conservar ventanas orientativas del Gantt.

### Límites del ejemplo económico

La tarifa nacional hipotética PayPal$1→$.1399 requiere aprobación comercial; [micropagos](https://www.paypal.com/us/business/paypal-business-fees#micropayments) internacionales añaden1.50puntos porcentuales antes de conversión aplicable. Con tarifa Checkout nacional3.49%+$.49, la comisión$1 sería$.5249: usando el mismo supuesto de IA con vozChirp quedarían sólo$.0551–.1351 antes de operación. No se ha confirmado la tarifa efectiva de la cuenta y Sandbox no la acredita.

La generación actual en navegador evita parte de CPU del servidor pero no hace gratuita la entrega: puede requerir descargar original y recursosFFmpeg y usa memoria del cliente. El estudio debe comparar render local y worker en servidor con el Droplet real;500MB no equivale a500MB de RAM durante la decodificación. Los costes por carácter dependen del texto destino, no del tamaño del archivo ni de sus minutos nominales; el número de reintentos y destinos también cuenta.

## Contraste Codex de la primera revisión

DeepSeek coincide en no escalar buffersPostgreSQL, separar narración/doblaje/lipsync y medir coste por éxito. Propone compartir nativo como alternativa de menor alcance antes de OAuth; conservar como opción cuando el dispositivo lo soporte, sin presentarlo como guardado automático ni persistencia en Drive. Su mapeo tentativo de IDs no se adopta: LV-004 sigue calidad lingüística y LV-005 sigue portada/SEO; almacenamiento/exportación pertenecen a núcleo/editor y LV-007 coordina coste. Un worker servidor no es dependencia obligatoria de cualquier carga grande: se decide con mediciones de exportación/memoria móvil. Lifecycle y backups necesitan políticas verificadas; no prometemos eliminación24h de todas las copias sólo por configurar lifecycle. Cancelar una exportación no debe borrar otros proyectos o entradas reutilizadas.

### Prueba de carga y experiencia propuesta

Un archivo500MB tarda como mínimo400s (6min40s) a10Mbps de subida, u800s (13min20s) a5Mbps, antes de sobrecargas/reintentos. Mostrar progreso, tiempo aproximado y reanudar; no confundirMbps conMB/s. Ensayar MP4H.264 y cámaraHEVC/HDR/rotación, archivos truncados, duración manipulada, saldo insuficiente y dos cargas simultáneas. Confirmar límites del proveedor/modelo y rutaFilesAPI sin base64 masivo antes de elegir500MB. Separar aceptación de carga y exportación: que suba no demuestra que elPixel pueda renderizarlo. No exigir que el cliente convierta a mano sin explicar formato/error.

## Dictamen integrado y registro de revisión

Kimi coincide en separar ingesta/SRT y exportaciónMP4 por perfiles probados; propone audioTTS separado como primer prototipo y cuestiona venderlo todo a$.10/min. Codex adopta esa separación de aceptación, sin retirar MP4 existente ni imponer un worker antes de medir. La aplicación puede reutilizar cuenta/proyectos/saldo/cola, pero el servicio de voz necesita producto/consumo/versiones y calidad propios. No heredar90direcciones de traducción como90direcciones de doblaje.

Hallazgo económico confirmado por aritmética: ElevenLabs v4 a$.08/1000caracteres cuesta$.72 por9000caracteres; más Gemini provisional$.15–.23 =$.87–.95, por encima de$.8601 disponibles tras micropago nacional$1. Incluso sin operación da contribución negativa. Chirp deja$.3601–.4401 antes de costes restantes y regeneración, no ganancia neta. Precio de voz separado o una regla de consumo diferente sólo después de decidir oferta; no modificar saldo actual sin migración/reglas explicadas.

Referencia corregida usando reserva lineal$.015–.023/min y micropago hipotético: contribución después de sóloGemini/PayPal para$5/50min=$3.5105–3.9105 y$10/100min=$7.111–7.911. Son escenarios aritméticos, no sustituyen medición/factura ni otros escenarios históricos.

### Coordinación, vía y costes

Se comprobó el diagnóstico pendiente de T3 V2: los permisos full-access/MCP no garantizan revisores sin herramientas. No se modificó T3 global ni se lanzó otra revisión por esa vía. Respaldo explícitamente autorizado OpenRouter de LinguistVision; clave exclusiva externa, contexto técnico sin medios/transcripciones/datos de clientes, herramientas no incluidas y tool_choice:none. Dos consultas paralelas, un intento por modelo, cero herramientas/delegaciones/reintentos. No se afirma que T3 coordinara estas consultas.

| Revisor | Modelo | Generación | Coste devuelto USD |
|---|---|---|---:|
| DeepSeek |deepseek/deepseek-v4.1-flash|gen-1794430644-oEQDoFzokc8f2rohFm3A|0.01506035025|
| Kimi |moonshotai/kimi-k3.1-pro|gen-1794430644-J6KACvYBKc6eOf4hW2O8|0.19145491200|
|Total|||0.20651526225|

usage.cost devuelto por OpenRouter; factura pendiente de conciliación. GETgenerationDeepSeek confirmó$.01506035 redondeado; KimiGETgeneration recién completado dio404eventual, sin invalidar usage.cost de respuesta. No sumar upstream_inference_cost al coste de usuario. Respuestas completas y contabilidad: `%LOCALAPPDATA%\LinguistVision\t3-review\publicsafe\large-video-voice-20261111\REVIEW-SUMMARY.md`, `deepseek-review.md`, `kimi-review.md` y sus accountingJSON. No se usaron Gemini/TTS ni se habilitó facturación. Fuentes DropboxSaver/Drive resumable se contrastaron porCodex después del despacho, no se atribuyen a una revisión adicional.

### Resultado y siguiente trabajo preparado

Estudio completo y enlaces verificados. No hay coste extremo-a-extremo de500MB/10min ni nueva capacidad implementada. La siguiente entrega técnica recomendada es especificar e instrumentar carga/retención/cuotas y medir perfilesPC/Pixel; narraciónTTS puede prototiparse en paralelo con audio corto y texto sintético. El propietario decide si incluye voz en lanzamiento, su precio y la promesa comercial; no hace falta decidirlo para preparar diseño técnico y pruebas. No se cambia oferta pública ni se habilitan proveedores por este análisis.

## Incremento autorizado · archivos y Drive · 2026-11-11

El propietario autoriza preparar/medir archivos grandes, almacenamiento/borrado e incorporarDrive. Se implementa primero almacenamiento privado local externo al repositorio para medir sin contratarSpaces; la validaciónCloud requiere configuración exclusivaLinguistVision y queda diferenciada. Carga reanudable por bloques con cuota yTTL24h fijo, límite de ensayo500MB/600s/1920px y borrado explícito; no se anuncia todavía como límite comercial. Compatibilidad de datos anteriores y reserva/consumo de segundos permanecen. Los videos grandes nunca se guardan como bytea ni base64 masivo enNode. Importación/proyectos y fuentes conRange deben funcionar sin cargar el archivo entero. TrabajoGemini porFilesAPI opcional sin llamadas reales durante pruebas sintéticas.

Drive: permiso explícitodrive.file mediante cuentaGoogle, carga reanudable delSRT/MP4Blob, progreso/cancelación y enlace tras confirmación. Sin tokens propios persistidos ni acceso amplio aDrive. Medir y probar rechazo/reintento/duplicados. Cuenta y editor mantienen diseñoClaude. Si el proyectoGoogle requiere habilitarDriveAPI/consentimiento, informar el bloqueo real y dejar preparada integración comprobable localmente; no fingir guardado externo. Voz/Dropbox no forman parte de este incremento.

## Entrega local · archivos grandes y Drive · 2026-11-11

**Estado:** implementado y verificado localmente. Falta conceder el permiso de Google y abrir los archivos guardados para acreditar el recorrido real de Drive. No publicado.

Candidata: `%LOCALAPPDATA%\LinguistVision\releases\large-files-drive-guard-20261111`, sólo `127.0.0.1:3001`, PID65028. Se conserva `claude-active-audit-20261111` para volver atrás.

### Almacenamiento y carga

La nueva ruta autenticada admite cargas reanudables por bloques de hasta 8 MiB. PostgreSQL registra referencias y posiciones; los videos nuevos se guardan en `%LOCALAPPDATA%\LinguistVision\private-files\firebase-dev-sandbox`, fuera del repositorio. Los archivos anteriores siguen disponibles. El servidor confirma los bytes escritos antes de guardar la posición. El cliente reanuda la misma instancia File durante la sesión; no mezcla bloques de otro archivo reseleccionado. El backend conserva la posición, pero no se promete recuperar automáticamente el selector tras recargar la página.

Los límites de ensayo son **500.000.000 bytes, 600 segundos y 1920 píxeles por lado**. El cupo es de 2 GiB por cuenta y tres cargas incompletas. Se comprueban tamaño, estructura MP4 y duración reales antes de procesar. Hay un máximo de cuatro recepciones simultáneas, una por cuenta, y dos validaciones pesadas simultáneas. Estos límites no acreditan todavía todos los códecs, HDR ni la exportación de 500 MB en el Pixel. El editor bloquea MP4 fuera del perfil anterior de 1 MiB y 30 segundos, conservando edición y guardado SRT. Comprueba el tamaño con una lectura Range de un byte antes de habilitar MP4.

La caducidad se fija a 24 horas desde el inicio de la carga y no se amplía con reintentos. Se bloquean las lecturas vencidas inmediatamente. La limpieza física se ejecuta al arrancar y cada minuto mientras el servidor funciona; si está apagado, espera al siguiente arranque. Cuenta y saldo permanecen. Un estado duradero `deleting` permite reintentar fallos de disco sin volver a exponer el archivo. No se borra la copia que el usuario haya guardado en Drive.

Las fuentes se sirven con lectura parcial Range y autorización de cuenta. Guardar y reabrir un proyecto conserva sus pistas y edición. La migración añade referencias de archivo y permite proyectos de hasta 600 segundos; no modifica los paquetes ni sus precios.

La ruta de Gemini para videos grandes utiliza Files API por bloques, con cancelación, espera acotada y solicitud de eliminación remota. Sus métricas identifican `inputMode:file` y `timingMode:gemini-only`: todavía no aplica la alineación acústica local. Los clips de hasta 1 MiB y 30 segundos conservan la ruta anterior de sincronía. No se hicieron llamadas reales nuevas a Gemini. Un fallo de limpieza remota emite un aviso sin datos privados; no se promete que la retención del proveedor sea idéntica a nuestras 24 horas.

### Guardado en Drive

El editor incluye **Guardar SRT en Drive** y **Guardar MP4 en Drive**, además de descargar al dispositivo. Solicita el permiso adicional `drive.file` mediante `reauthenticateWithPopup` de la cuenta Google ya vinculada. Comprueba que el UID coincida con la sesión del servidor. No transforma automáticamente una cuenta de contraseña en una cuenta Google ni guarda tokens propios de forma persistente.

Se prepara el SDK antes del clic y se solicita autorización antes de generar el MP4. El guardado usa fragmentos Blob, progreso confirmado, cancelación y reintentos. Sólo muestra éxito después de verificar ID, tamaño y enlace del archivo. Conserva hasta 20 recibos durante la sesión para evitar duplicados de la misma exportación y admite dos cargas activas. Libera las referencias fuertes a los archivos al terminar, fallar o cancelar. Al cerrar el editor se cancela y limpia la memoria; no se borran copias ya guardadas.

Se habilitó Drive API exclusivamente en `linguistvision-dev`, proyecto922534410785, operación `operations/acat.p2-922534410785-d4c4e19e-5e5a-4374-a932-4a6c592b6a28`. La consulta posterior confirmó `drive.googleapis.com` activo y **billingEnabled=false**. No se creó ningún proyecto ni recurso de Spaces. La autorización y apertura reales requieren la intervención personal del propietario; las pruebas simuladas no se presentan como persistencia externa.

### Evidencia

Todas las rutas de evidencia siguientes están bajo `%LOCALAPPDATA%\LinguistVision`.

- Candidata instalada con `npm ci --include=dev`, auditoría sin vulnerabilidades. Tipos, **155 pruebas sin fallos** y ambas compilaciones correctos. Registro: `validation/large-files-candidate-tests-20261111.json`.
- [Medición de almacenamiento](../../scripts/qaPrivateStorage.ts): archivos de100/250/500 MB y60/300/600 segundos. Escritura local114/270/898 ms, sonda76/49/58 ms y aumento de memoria Node8,92/8,39/8,44 MB. Se comprobaron hashes por streaming, Range, rechazo de otra cuenta, vencimiento y eliminación física. **Son MP4 sintéticos con relleno:** miden volumen, no bitrate de cámara, red pública ni render móvil. Registro: `validation/large-files-20261111/run-yNKiIQ/evidence.json`.
- [Integración HTTP](../../server/commercial/largeVideoHttp.integration.test.ts): MP4 sintético real de1.216.276 bytes, almacenamiento sin contenido binario en PostgreSQL, permisos/CSRF, reserva y captura únicas, ambos SRT, Range, guardar/reabrir y borrado. Barreras de PostgreSQL reproducen las carreras entre completar/cancelar y entre caducar/publicar; ambas están corregidas.
- [Borrado ante fallos](../../server/commercial/privateStorageDeletion.integration.test.ts): un rollback SQL conserva el proyecto y el archivo; un fallo de disco después del commit deja el archivo inaccesible con borrado pendiente y el siguiente intento lo elimina. El recorrido pasa con un pool de una sola conexión.
- [Navegador](../../scripts/qaLargeFilesUi.ts):280 vistas, cero excepciones, importación, corrección, guardado, reapertura, SRT y MP4. Los botones Drive se probaron con un callback inyectado: **no es un guardado real en Google**. Registro: `validation/large-files-ui-20261111/run-Gjd4or/acceptance.json`.
- [Transporte Drive](../../server/commercial/web/pilotDrive.test.js):16 pruebas simuladas. [Reanudación cliente](../../server/commercial/web/pilotUpload.test.js):9 pruebas de respuesta perdida, cancelación, otra File/cuenta y expiración del inicio. Files API usa transporte simulado; una regresión comprueba que los clips cortos conservan la alineación anterior.
- HTTP activo: portada, piloto y módulos200; cuenta sin sesión401; Firebase propio, `noindex` y escucha sólo en127.0.0.1. Registro: `validation/large-files-implementation-20261111/active-http.json`.

### Revisión independiente y coste de esta implementación

T3 sigue pendiente de resolver el aislamiento de sus revisores. Se utilizó el respaldo OpenRouter exclusivo de LinguistVision, con contexto técnico sin archivos privados ni credenciales, herramientas ausentes y `tool_choice:none`. DeepSeek y Kimi revisaron en paralelo una instantánea previa a las últimas correcciones; no certificaron el código posterior.

Codex contrastó y corrigió la cancelación concurrente con el completado, la caducidad durante una publicación bloqueada, las conexiones anidadas, la retención de Blob y el reintento de un inicio caducado. El borrado físico se pospone hasta confirmar la transacción, con una marca duradera para recuperar fallos. Las regresiones verifican esas correcciones. Se descartaron propuestas no demostradas y el reembolso después de caducar un trabajo ya entregado, que habría cambiado las reglas comerciales.

| Modelo | Generación | Coste devuelto USD |
|---|---|---:|
| deepseek/deepseek-v4.1-flash | gen-1794432398-OkAcTEiK2A09N2Zg5Orw |0.0491382045|
| moonshotai/kimi-k3.1-pro | gen-1794432398-c88hdEZiPFLXhHCb6o4c |0.2584577160|
| Total nuevo | |**0.3075959205**|

Un intento por modelo, sin herramientas ni reintentos. Ambos costes se corroboraron con el endpoint de generación; DeepSeek devuelve0.049138204 redondeado. Conciliación con factura pendiente. Respuestas, instantánea y contabilidad: `t3-review/publicsafe/large-files-implementation-20261111/REVIEW-SUMMARY.md`. La ronda de análisis anterior, US$0.20651526225, se registra por separado. No hubo cargos nuevos de Gemini, TTS ni pagos reales.

### Pendientes

Confirmar consentimiento y guardar/abrir SRT y MP4 reales en Drive, en PC y Pixel. Probar videos de cámara, códecs y exportación larga representativos. Medir red, servidor DigitalOcean, Spaces y coste total con Gemini antes de anunciar límites comerciales nuevos. La portada conserva las condiciones previas. Voz y Dropbox quedan fuera de este incremento.

Para volver a la versión anterior, conservar esquema y medios: esa versión no muestra las entradas privadas nuevas. No borrar la carpeta privada ni la base. Si se deja una versión antigua funcionando, mantener la limpieza desde la versión actual hasta cerrar la operación.
