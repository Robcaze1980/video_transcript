# LV-007.GCS · Archivos privados y candidata cloud

Rob autoriza conectar GCS y continuar el backend cloud con T3 y Gemini. Cloud SQL queda prohibido. Se conserva la web pública como preview y el piloto PostgreSQL; no se modifican otros productos ni ADC global.

## Resultado de esta fase

Una candidata privada real de Vistavo puede subir un MP4 por fragmentos, reanudar sin duplicar bytes, verificar hash/tamaño/video, guardar el input durable en Firestore, descargar su generación autorizada con Range y borrar los bytes aunque una petición antigua termine tarde. Probar dos cuentas, proceso nuevo, caducidad, acuses perdidos y anonimato denegado en GCS. No aceptar sólo mocks/emulador como conexión cloud.

## Diseño propuesto para contraste T3

- API Firebase autentica y deriva cuenta del UID. Firestore reserva cuota de almacenamiento y registra upload/request/chunks/outbox; ninguna operación GCS o FFprobe se ejecuta en callbacks transaccionales.
- Fragmentos de 8 MiB en claves generadas por servidor, con creación `ifGenerationMatch=0`, huella SHA-256 y tamaño acotado. El servidor conserva las credenciales GCS; no entrega capacidades de escritura o sesiones GCS al navegador.
- Repetir offset/bytes idénticos es idempotente. Datos diferentes en el mismo fragmento producen conflicto. Offset sólo avanza después de confirmar el objeto; un acuse perdido se comprueba mediante lectura.
- Complete encola validación durable. Un Cloud Run Job compone objetos inmutables con generaciones explícitas (máximo32fuentes por compose; grupos intermedios si hacen falta), descarga a temporal privado, verifica SHA/tamaño/FFprobe y confirma input+estado con fencing en Firestore. Reejecución de validación es segura porque no llama IA y todas las escrituras de bytes son idempotentes.
- Límites heredados: archivo500.000.000bytes, cuota2GiB, tres subidas activas,24h,600s y1920px. Reservar también el pico temporal de composición (hasta3veces tamaño); reducir al tamaño final después de limpiar fragmentos/intermedios. No cambiar precios comerciales.
- Borrado: tombstone lógico antes de efectos físicos; invalidar input sin borrar registros necesarios para UNKNOWN. Sustituir por objetos vacíos las claves previamente enumerables de fragmentos/grupos/final, usando CAS por generación. Esos marcadores sin contenido impiden que un escritor antiguo con precondición0 recree bytes. No liberar cuota hasta comprobar todos los marcadores. No borrar los marcadores como si fueran un archivo pendiente de limpiar; su retención es una limitación explícita del protocolo.
- Descarga inicial por API autenticada, generación exacta y Cache-Control no-store; GCS permanece privado, sin URLs públicas ni CORS abierto. Revocar no retira copias ya descargadas.

## Infraestructura y límites

Proyecto exclusivo vistavo-prod, región us-central1, bucket privado existente vistavo-prod-107404655346-media; validar UBLA/PAP/versioning/softDelete antes de escribir. Crear Firestore Native Standard y sus índices/reglas si se demuestra ausencia tras habilitar API; PITR y protección de borrado, sin importar datos. Roles mínimos y cuentas de servicio separadas para API, validación y despacho; builder sin permisos de despliegue. Sin claves JSON de servicio.

Preparar imágenes con Node24 y FFmpeg, digest inmutable, API/Jobs con escala cero, maxRetries0 y recuperación durable programada. API mantiene ingress interno e IAM sin invocador público; prueba desde job del mismo proyecto con Direct VPC/PGA y configuración DNS necesaria, sin ALB/NAT de alquiler. Validar contratos de API antes de aplicar y registrar cada respuesta/operación con errores saneados y lecturas posteriores acotadas.

La prueba hospedada usa archivos y dos identidades sintéticas claramente etiquetadas, nunca archivos/cuentas de clientes. Demuestra acceso Firebase de servidor; no sustituye login humano PC/Pixel. No habilitar procesamiento IA, pagos, Hosting rewrites ni publicación funcional por esta fase. Sandbox/live, cotización vinculada, artefactos de proveedor y restore financiero conservan sus gates.

## Cierre

T3 propone/audita de forma independiente; Codex integra y ejecuta negativos. Gemini batch revisa la candidata final y evidencia exactas. Instalación, tipos, regresión completa y ambas builds; verificar GCS/Firestore y ejecución real en cloud, dos cuentas, reinicio y borrado tardío. Guardar costos observables por intento, desconocidos como no medido. Si un gate falla, conservar el fallo y corregirlo; no repetir hasta verde ni cambiar de modelo silenciosamente.

Referencias: [compose](https://docs.cloud.google.com/storage/docs/composing-objects), [precondiciones](https://docs.cloud.google.com/storage/docs/request-preconditions), [red privada Cloud Run](https://docs.cloud.google.com/run/docs/securing/private-networking).


## Ajustes de diseño tras T3

Manifiesto completo persistido antes de escribir, incluidos destinos nunca creados; generación como cadena. Marcadores con metadata vistavoMarker=v1 y tamaño0, sin lifecycle ni retención de versiones. Cuota de pico3× reservada desde begin y separada en storageReservedBytes/storageCommittedBytes/activeUploads. Recibo de validación durable antes de limpieza normal; sólo después de marcadores verificados se crea input ready y se reduce cuota. Validador sin permiso de borrar; limpiador con identidad propia y sobrescrituraCAS. Ambas limpiezas usan el mismo protocolo.

La candidata utiliza vistavo/candidate-v1 en Firestore y candidate-files-v1/ en GCS, separados de futuros saldos live. Por defecto el ledger exige input ready y binding verificado (bucket, clave, generación, tamaño, SHA). El atajo financiero de fixtures sólo se permite en emulador y namespaces demo explícitos; no en runtime. El precio reservado se conserva al repetir la misma solicitud lógica aunque una nueva cotización cambie. No se adopta liberar una reserva queued por existir UNKNOWN: se mantiene la política ya probada de bloquear nuevas ejecuciones y resolver resultados con evidencia.

IAM concreto en deploy/google-cloud/files.plan.json: API/validador creador+lector de objetos, limpiador objectUser, condicionados al prefijo candidato; Firestore datastore.user limitado por condición a(default); verifier Firebase sólo users.get. Mantenimiento es un servicioHTTP privado min0 (no un Job periódico que facture un minuto ocioso); Scheduler lo llama cada5min y sólo lanza Jobs cuando hay trabajo. Jobs con overrides usan roles/run.jobsExecutorWithOverrides; builder no despliega. Prueba desde DirectVPC all-traffic+PGA; sin DNS/NAT/ALB adicionales.

Caducidad lógica a24h; purga física durable programada y observable, con posibles retrasos de ejecución o indisponibilidad, sin prometer exactitud física al segundo. No equivale a retirar copias ya descargadas. El PITR de metadata tiene retención separada y debe reflejarse en privacidad antes de lanzamiento.

### Ajuste de identidad de prueba por cuota (2026-11-13)
Google rechazó crear `vistavo-files-proof` con HTTP429 al alcanzar10SAs. La prueba usa temporalmente `vistavo-bootstrap`, identidad aislada de Vistavo previamente sin permisos. Se verifica ausencia de grants/keys anteriores, se añaden sólo permisos de prueba, y se retiran al terminar. No se borra esa identidad existente. Las cuatro identidades runtime y Scheduler mantienen sus roles separados.

### Ensayo de Scheduler
La API rechazó ForceRun en estado PAUSED con FAILED_PRECONDITION400. Para probar se reanuda la tarea propia, se fuerza una entrega y se vuelve a pausar; no se recrea la tarea ni se relajan permisos. El cron periódico queda pendiente de habilitar tras la aceptación privada. Fallo y corrección conservados. *(Actualización del 19 nov 2026: la [lectura P0](../reviews/LV-019-B-cloud-readback-2026-11-19.md) mostró el planificador `vistavo-files-maintenance` HABILITADO, `*/5 * * * *`, con último intento a las 04:10Z del 20 nov UTC; quién lo habilitó y cuándo no consta en esa lectura.)*

### Corrección de alcance de índices tras prueba cloud fallida
La lista nativa de índices incluyó varias colecciones. El aplicador había comparado sólo campos/scope y confundió outbox con fileOutbox porque comparten campos. La consulta real de fileOutbox falló con código9/requires-index; mantenimiento dejó input deleting y cuota retenida, correctamente sin liberar bytes no comprobados. Se exige ahora nombre de colección exacto en ambas búsquedas/readbacks y ejecutar las consultas reales en la nube antes del cierre. Conservar el Job fallido con24checks y retestar sólo los gates afectados tras corregir el índice, sin recobrar créditos ni repetir proveedor.

## Cierre técnico de la fase privada · 2026-11-13

Criterio cumplido con evidencia real:24checks del primer intento fallido por índice y5checks focalizados tras arreglo causal, sin volver verde el intento original. RuntimeAPI/core idéntico27c496…; imagen8f25… sólo continuación temporal, ya retirada junto con grants y dos usuarios. SQLGET200/0,4fixtures45marcadores vacíos, generación vieja404. 65emulador y346/47generales,0skip, tipos/dosbuilds/audit0. Gemini final batch1794619619-xOF8ac6rWwjS5QOggQjC PASS exclusivo de este alcance. [Informe completo](../reviews/LV-007-gcs-cloud-2026-11-13.md).

Continúa el backend con catálogo/cotización ligada al input verificado, proveedor con límites de confianza/reconciliación y artefactos privados; después cliente/aceptación/restore antes de publicar. /api/cloud/jobs sigue503, sin IA/pagos reales ni rewrites. No Cloud SQL. Marcadores y PITRmetadata tienen retenciones distintas; privacidad antes de producción.
