# LV-016.A · Contrato interno del pipeline

Este incremento no añade botones, endpoints activos, workers ni llamadas a Gemini. Establece la frontera que usarán B–E. La cuenta procede de la sesión autenticada del servidor; nunca de un accountId enviado en un cuerpo HTTP.

## Operaciones para conectar en E

Las siguientes rutas son propuestas del contrato, no funcionalidades publicadas:

- POST /pilot/projects/:id/pipeline/snapshots: captura la revisión vigente desde PostgreSQL. El cuerpo sólo solicita expectedRevision e idiomas es/en; no acepta texto ni hash arbitrario como snapshot.
- POST /pilot/projects/:id/pipeline/jobs: solicita una etapa para snapshot/configuración e idempotencyKey. Precondición: proyecto y revisión vigentes y entrada no vencida; dependencias se verificarán al conectar B–D. Proveedor/modelo/voz serán allowlist servidor por capacidad validada.
- GET /pilot/projects/:id/pipeline: manifiesto de snapshot, trabajos y artefactos con caducidad y marca desactualizado. Los DTO públicos no contienen claves, rutas de disco ni detalles privados de error del proveedor.
- POST /pilot/projects/:id/pipeline/jobs/:jobId/cancel: cancela con comprobación de propiedad y estado; terminal y repetible. Cancelar proveedor/FFmpeg y liberar recursos reales se conectará en B–D.

Antes de activarlas, reutilizar sesión Firebase/Origin/CSRF, parser/tamaño y manejo de errores del piloto; cuenta ajena y recurso inexistente comparten respuesta 404. Especificar pruebas HTTP entonces; las pruebas de repositorio de A no acreditan estas rutas.

## Persistencia y confianza

Snapshot conserva revisión, ambas pistas y estilo vigentes de un proyecto existente. No se reemplazan columnas ni métodos del editor; comparar con revisión actual evita tratar resultados previos como actuales. Identidad de segmento y encaje temporal se añadirán en B al producir segmentos reales: no atribuirlos a un SRT opaco.

Sólo servidor/worker puede reclamar trabajos o publicar metadatos de artefactos. Los artefactos de A son registros de prueba; todavía no prueban existencia, hash ni validez de archivos físicos. B–D deben verificar bytes, cuota, contenido y almacenamiento privado antes de declarar listos sus artefactos. La publicación física recuperable y su reconciliación requieren pruebas propias.

No se modifica saldo ni se promete idempotencia remota del proveedor. Un resultado de proveedor desconocido debe permanecer explícito y no provocar otro consumo automático.

## Contrato implementado en A

PipelineStore.createJob(accountId, request) captura el snapshot automáticamente: no hay método público para inyectar su contenido. Request contiene inputId, expectedRevision, requestKey, stage, config y dependencies opcionales (IDs de trabajos completados). Repetir una clave exige mismo proyecto/revisión/hash/config/dependencias. La revisión esperada evita generar sobre una edición que el usuario todavía no vio.

El snapshot congela SRT traducido, originalDraft, duración, estilo y highlights. Canonicalización v1: JSON de claves ordenadas, Unicode exacto sin normalizar, arrays ordenados, números finitos; SHA-256 con prefijo lv016-snapshot-v1 y byte nulo. Inmutabilidad protegida por trigger sólo en tabla nueva; comparación conservadora de toda la revisión y hash, sin regeneración selectiva por segmento en A.

Cada trabajo fija proveedor/modelo/voz o codecs. Sus DTO incluyen snapshotId, snapshotHash, configHash y dependencias sin rutas internas. El render exige narración completada del mismo snapshot/cuenta; texto y subtítulos provienen del snapshot aprobado. Otras dependencias opcionales deben tener etapa anterior y mismo snapshot. Las FK compuestas evitan cruzar cuenta/revisión/snapshot. Una edición de texto o presentación invalida conservadoramente todo el resultado.

Publicar metadatos sólo admite staged bajo token de intento y lease vigente. complete(succeeded) convierte el conjunto obligatorio a ready y el trabajo a succeeded en una única transacción: transcripción=texto ES; traducción=texto EN+SRT EN; narración=audio completo EN; render=MP4 EN. Vista previa está reservada en vocabulario, pero su alcance temporal/configuración y generación se implementan en C antes de habilitarla. En A ningún artefacto de prueba corresponde a un archivo real.

No hay reintentos automáticos: lease perdido pasa a unknown. No se vuelve a reclamar. Resolver un resultado remoto desconocido y registrar el historial completo de intentos corresponde al adaptador/worker de B–D antes de conectarlo a proveedores. Un nuevo requestKey es una nueva solicitud explícita, no un retry transparente. No se reutilizan staged de un intento perdido.

La migración pipelineMigration.sql se registra en el arranque local, sin instanciar workers o rutas. Borrado del proyecto existente cascada snapshots/trabajos/manifiestos; caducidad consulta siempre también inputs y la limpieza heredada borra el proyecto. Migración repetida probada. Se conserva esquema aditivo para reversión; antes de introducir workers, probar drenaje/compatibilidad de trabajos en curso en F.

### Correcciones de auditoría y límites confirmados

La primera candidata pasó188 pruebas pero ambos auditores devolvieron FALLA por highlights/canonicalización UUID; se conservan esos dictámenes. DeepSeek también detectó replay tras edición y UPDATE de artefactos demasiado amplio. Se añadieron cuatro regresiones que fallaron antes de corregir (regressions-before.log), luego24 pruebas focales pasaron; la suite final añade invalidación inversa por highlights y suma193 pruebas sin omisiones. Se alinearon originalDraft no vacío, duración de metadata y queued→failed, y se sustituyeron non-null assertions por errores controlados de caducidad.

Repetir requestKey tras editar devuelve el trabajo original con stale=true cuando coinciden proyecto, expectedRevision original, configuración y dependencias; no crea un trabajo nuevo ni lo asocia a la revisión actual. Pedir revisión nueva con la misma clave produce conflicto. Las dependencias y UUID de entrada se canonicalizan antes de comparar/deduplicar.

Las filas staged de otros intentos no se promueven al completar. La actualización final acota cuenta/trabajo/revisión/token/estado y tipos obligatorios. Sólo lectura de metadatos, sin reconciliación física ni costos comerciales. Ver outputs/lv016-a/check-results.json y tests.log para salidas de tipos, PostgreSQL, compilaciones y Node24.13.0; revisión corregida pendiente al redactar este párrafo, cierre consignado después.

## Cierre verificado · 2026-11-12

Paso A completado en su alcance interno. DeepSeek PASS final gen-1794512294-M2EuR73o83O8qgHO7Nhy y Kimi PASS final gen-1794512294-tG7ump4anij9SU6xOaSO; informes completos leídos y contrastados. Los dictámenes anteriores FALLA/INCONCLUYENTE y la propuesta inicial no ejecutada se conservan, no reciben verde retroactivo. Codex reescribió el store y corrigió contratos/migración; no se atribuye implementación fiable automática al PASS inicial de DeepSeek.

Verificación Node24.13.0:193pruebas/29archivos sin omisiones, tipos y ambas compilaciones con exit0. Logs completos y resultados de proceso en outputs/lv016-a/. Veinticinco pruebas nuevas cubren contratos y PostgreSQL, incluidos locks/cancelación/TTL/aislamiento/snapshot/manifiesto. Código coincide por SHA-256 con snapshot revisado. Grafo del proyecto reindexado.

Piloto reiniciado en127.0.0.1:3001 (sesión81171): migración aplicada,4tablas propias,0snapshots/trabajos/artefactos reales. Huellas SHA-256 de las filas de cuenta y proyectos idénticas antes/después:1cuenta/2proyectos/0trabajos comerciales/0movimientos. HTTP: raíz302 a portada española, portada e inicio200, anónimo401, Origin inválido403, noindex. La primera expectativa de smoke raíz200 fue un error del verificador: se comprobó redirección302 existente y se corrigió la expectativa sin cambiar aplicación.

Seis llamadas externas por respaldo OpenRouter autorizado de LinguistVision, sin herramientas/topes locales, no T3global por aislamiento pendiente.302561tokens y usage.cost totalUS$0.79310468457; factura no comprobada. Codex tokens/costo no medidos/modelo no controlado. Respuestas, contextos, hashes y contabilidad en LOCALAPPDATA/LinguistVision/t3-review/lv016-a-20261112/; contabilidad sanitizada en outputs/lv016-a/accounting.json. No hubo generación TTS/Gemini o cambios de presupuesto/paquetes/pagos en esta fase.

Pendientes B–F: endpoints activos/interfaz, transcripción y alineación reales, IDs estables de segmentos, vista previa/regeneración, allowlists de modelos/voces inglesas validadas, historial/reconciliación de intentos externos, almacenamiento físico/recursos/FFmpeg y aceptación de medios. A no acredita ninguna de esas capacidades. Reversión mantiene tablas aditivas, ningún worker pipeline está activo; al introducir workers exigir drenaje y compatibilidad. Siguiente B según LV-016. Drive independiente pendiente. Sin commit/push/publicación.
