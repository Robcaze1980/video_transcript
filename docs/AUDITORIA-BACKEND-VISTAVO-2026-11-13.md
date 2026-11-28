# Vistavo · Resultado de auditoría del backend y master plan

Fecha: 13 de noviembre de 2026. Preparación LV-003/LV-007; no es autorización de lanzamiento ni certificado de seguridad completa.

## Resultado actual

**No aceptar el backend como listo para producción.** La base local es reutilizable y pasa sus controles existentes, pero quedan defectos y trabajo cloud. DeepSeek y Kimi revisaron independientemente los bloques núcleo y multimedia y emitieron FALLA para aceptar una candidata funcional, sin ejecutar pruebas propias. Codex leyó los informes, contrastó fuentes y ejecutó controles locales. Gemini batch revisó después el material integrado y emitió PASS exclusivamente para B0 documental; el primer lote de login terminó INCONCLUYENTE y no cubre la ampliación.

La arquitectura vigente es Firebase Hosting/Auth, Cloud Run, Cloud SQL PostgreSQL y Cloud Storage. Supabase pertenece a una candidata anterior. No se ha encontrado configuración vigente de un proyecto alojado Supabase en los archivos inspeccionados; el conector no permitió listar proyectos por falta de link_id. Rob aclaró que el destino es Firebase/Google Cloud, por lo que no se abre una migración a Supabase.

## Cobertura y evidencia

- Inventario de 162 archivos de servidor, despliegue y planes: rutas, tamaños y SHA256.
- Dos paquetes con 103 archivos completos únicos de código, pruebas y dependencias compartidas, aportados a ambos revisores. Incluyen 44 archivos en núcleo y64 en multimedia, con cinco comunes. Cada paquete también incluye master plan, plan cloud y snapshot remoto.
- La lista de material aportado y exclusiones está en `review-packs.json` y `coverage-map.json`. Las plantillas/frontend restantes y el probe de despliegue conservan su evidencia separada. No se afirma lectura semántica exhaustiva de cada línea, pentest o auditoría de todas las dependencias transitivas.
- Nueva ejecución: 306 pruebas en43 archivos, sin omisiones; tipos y dos compilaciones correctos. Logs en `outputs/vistavo-config-quality/`. Una suite verde no demuestra las nuevas hipótesis ni la operación cloud.
- Lectura remota: Google/correo habilitados, privacidad mejorada del correo activa, billing activo, APIs SQL/Run deshabilitadas, cero buckets. Evidencia `backend-remote.json` y snapshots relacionados. No se crearon recursos.
- Dos reproducciones locales en esquemas efímeros de la base de tests dedicada, con adaptadores sintéticos y cero llamadas facturables: `expired-inline-proof.json` y `publish-replay-proof.json`.

## Hallazgos que condicionan la construcción

| ID | Prioridad y estado | Evidencia y condición de cierre |
|---|---|---|
| AUD-01 | Alta, reproducción local | Un input inline caducado se procesa antes del rechazo terminal. Control positivo1llamada; input caducado1llamada; termina failed y libera reserva. Corregir descarte seguro antes del proveedor y probar cola/TTL/purga concurrentes. No generalizar a archivos privados protegidos por files.get. |
| AUD-02 | Alta, reproducción con fallo inyectado | Si publish falla después del proveedor, el trabajo queda running; tras expirar lease se vuelve a invocar el adaptador. Prueba sintética observa2efectos, no2cobros reales. Cerrar UNKNOWN/reconciliación y demostrar una sola ejecución autorizada o resultado ambiguo controlado. |
| AUD-03 | Alta, código y prueba multiworker pendiente | CommercialJobs ignora errores de renew y puede reclamar leases expirados; fencing protege publicación/ledger pero no deshace costos externos. PipelineStore nuevo sí tiene UNKNOWN. Preservar ambos contratos y no unificar por suposición. Probar crash, particiónDB, cancelación remota y versiones de adaptador durante rolling updates. |
| AUD-04 | Crítica si se expone, no exposición actual acreditada | server/index.ts tiene rutas legacy de IA/borrado sin identidad ni ledger. El frontend público no las ofrece; no usar ese entrypoint como producción. El modo directo del navegador también debe quedar fuera del build comercial y sin claves. No se afirma filtración actual. |
| AUD-05 | Alta, brecha cloud conocida | PrivateFileStore local, pilotLocal/loopback, timers y restricciones de preview son deliberados. Construir entrypoint cloud y adaptador durable; no relajar globalmente sus guardas. Probar dos instancias, reinicio/escala a cero, IAM y backup/restauración. |
| AUD-06 | Alta, revisión estática | Checkout inserta orden antes de creación remota; pérdida de respuesta de creación y estados abandonados carecen de aceptación de recuperación/terminación acotada. Añadir negativos de creación/captura/DB y prueba Sandbox. No se demostró doble acreditación; validaciones de captura y ledger existentes se conservan. |
| AUD-07 | Alta antes de acceso público, ensayo deliberado | Texto/voz experimentales no usan ledger y exigen pagos simulados. Definir autorización de gasto/trial y límites durables antes de abrirlos. Rob decide precio/inclusión de voz; no añadirla automáticamente a paquetes actuales. |
| AUD-08 | Media, código e hipótesis de fallo | Fallo de DELETE Gemini conserva resultado pero sólo notifica/loguea; necesita obligación durable de limpieza sin repetirIA. abortWithClient borra bytes antes de commit para subidas incompletas; ensayar rollback. Revisar borrado de proyecto con trabajo activo y retorno de éxito. |
| AUD-09 | Media, hipótesis y pruebas concretas | Órdenes de locks purge/finish, retenciónTTL de trabajos queued, posible artefacto con attempt_id antiguo, retries de cues inválidos y endurecimientoFFmpeg. Reproducir cada escenario antes de corregir; no dar hipótesis por incidente real. |
| AUD-10 | Alta para publicar, brecha de aceptación | Proxy/limitador distribuido, Firebase real PC/Pixel/correos, acceso cruzado de archivos/audio/SRT, pagos, restauración, costos/alertas, render largo, idiomas/voz humana, Drive y soporte/legal siguen sin aceptación cloud. |

## Hallazgos rechazados o acotados por Codex

- **Billing pendiente:** falso; vinculación activa comprobada. Se corrigieron MASTERPLAN y README, conservando errores históricos.
- **Faltan las migraciones:** falso como ausencia general; el arranque local aplica varios SQL. Falta migrador cloud versionado y probado.
- **Append no es idempotente:** falso; compara bytes de un fragmento repetido. El test existente mantiene el offset. La reanudación completa del cliente debe comprobarse en el recorrido cloud.
- **JSON de sesión limitado a4096 o excepción sin capturar:** la factoría Firebase recibe jsonBody(req,8192) y el handler HTTP exterior captura RequestError y responde400/413. No cambiar código por haber visto sólo el try interior del módulo. Mantener negativos de payload y token como controles.
- **Cuota de voz liberada nunca se recupera:** el SQL retiene reservas hasta borrar bytes; PipelineVoiceService.reconcile elimina filas después de files.remove. No filtrar simplemente released para liberar cuota antes de unlink. Probar el ciclo entero y su disparador durable; el reporte del bloque núcleo no incluía ese servicio.
- **Logout local debe revocar todos los dispositivos:** no es el contrato actual; borrar cookie local y revocar globalmente son acciones distintas. Evaluar revocación por dispositivo/global y su UX antes de cambiarlo; no afirmar que se implementó revocación global.
- **MFA desactivado/API adicional habilitada = vulnerabilidad:** no se adopta esa equivalencia. Revisar política e IAM; una API habilitada no concede por sí sola permisos. No deshabilitar servicios existentes como efecto de esta auditoría.
- **Cada revisor necesita herramientas para guardar el informe:** la instancia está configurada sin herramientas; Codex guarda la respuesta íntegra. Eso no es un bloqueo de escritura ni permite fingir ejecución del revisor.

## Plan de ejecución consolidado

1. B0 entrega el inventario, esta matriz y el master plan coherente, con revisiones y discrepancias trazables.
2. Antes de activar varios workers o gasto de IA público, cerrar AUD-01–04 y la reconciliación de pagos de AUD-06 con pruebas negativas. Incorporar estos cambios como tareas específicas de B2/B4; no sustituir PostgreSQL.
3. Construir B1–B3: manifiestos e identidad, migraciones/backup/restore, almacenamiento privado, entrypoint y autenticación cloud. Mantener una candidata privada.
4. Completar B4–B5: procesamiento/UNKNOWN, autorización de gasto, limpieza, render LV-016.D y calidad por capacidad, con ensayos reales PC/Pixel.
5. B6 exige recorrido completo, costos, restauración/rollback, revisión lingüística y gates legales/comerciales antes de pedir publicación.

Detalle y aceptación por superficie: [backend completo](specs/LV-007-backend-completo-firebase.md). Configuración actual y login: [inventario](specs/LV-007-configuracion-calidad-2026-11-13.md).

## Informes y estado de revisión

Respuestas originales y contextos completos: `%LOCALAPPDATA%/LinguistVision/t3-review/config-quality-20261113/`. Se conservan el rechazo inicial Kimi402, la recarga observada y las rondas posteriores sin topes locales. No se vuelve verde retroactivamente un informe FALLA/INCONCLUYENTE ni se atribuyen a los modelos las pruebas de Codex.

Gemini final de alcance ampliado completado: PASS exclusivo del plan/cierre documental B0; backend B1–B6 NO ACEPTADO. [Informe íntegro](reviews/LV-007-gemini-hydrogen-batch-2026-11-13.md). Lote batch-1794590249-2QvySA4Fj0vILvPkUTep, proveedor Google, modelo devuelto google/gemini-4-hydrogen-20261112. Se usó Batch API con slug base, correspondiente a la variante solicitada :batch según documentación oficial. Costos observados se consolidan en `outputs/vistavo-config-quality/accounting.json`; factura y costo Codex no medidos. Sin cambio de código de aplicación, commit, push, nuevos recursos cloud o despliegue funcional por esta auditoría.

## Evidencia adicional de Codex posterior al envío del lote final

No se atribuye retrospectivamente a los revisores ni a Gemini:

- checkout-create-proof.json reproduce la pérdida de respuesta al crear orden con transporte sintético. Control positivo guarda provider_order_id; control negativo deja1fila sin provider_order_id ni next_attempt_at y fulfillNext devuelvefalse. Cero red/capturas reales. AUD-06 queda reproducido en ese límite; estados PayPal reales y políticas de terminación siguen pendientes.
- npm-audit.json reporta0vulnerabilidades conocidas en la base consultada. Esto no demuestra ausencia de vulnerabilidades de lógica, FFmpeg o todas las dependencias de sistema.
- iam-readonly.json registra roles por tipo/conteo sin divulgar principales: propietario humano y agentes Firebase. Listar service accounts devuelve403 por IAM API deshabilitada. No se cambió IAM, no se han inspeccionado exhaustivamente permisos heredados/denegaciones y no se certifica mínimo privilegio runtime. La candidata necesita identidad propia y auditoría IAM completa.

No se modificó código de negocio para corregir los hallazgos en esta fase; las pruebas de reproducción quedaron fuera de la suite del producto, en outputs y esquemas efímeros de tests que se eliminaron al finalizar.

## Cierre documental B0

Codex leyó el informe Gemini íntegro y adoptó sus dos ajustes editoriales: estado final/histórico y JSON de sesión8192 con catchHTTP exterior. Gemini PASS se limita a B0; los cuatro FALLA de preparación cloud permanecen. Ningún servicio se certifica listo por el plan. Después del envío, Codex comprobó además checkout sintético e IAM parcial y verificó explícitamente que la reproducción de replay genera2efectos de adaptador y1movimiento terminal del ledger. Estas comprobaciones posteriores no se atribuyen al modelo.

Contabilidad final de esta fase:10intentos registrados,9respuestas de generación con usage (incluidos2lotes batch),1rechazoKimi402 sin usage/costo informado;1.072.186tokens yUS$1.7834322879 de costo observado. El rechazo no se presume gratuito sin dato, factura y costeCodex no medidos. Se mantuvieron modelos indicados y ausencia de topes locales, tras recarga observada. Fuente accounting.json.

Siguiente trabajo listo: implementación privada de AUD-01–03 con pruebas que reproduzcan antes y pasen después; reconciliación de creación de órdenes AUD-06 e aislamiento del entrypoint comercial. Integrar revisión independiente de cambios antes de proseguir con infraestructura durable, sin pedir nuevo avanza para decisiones técnicas dentro del alcance vigente.
