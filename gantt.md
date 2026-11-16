## LV-019.B · estado al 16 nov 2026

1. Identidad/cuentas separadas y candidata loopback aislada: PASS.
2. **Carga privada sintética con propiedad comprobada en almacenamiento efímero local: PASS** (test, lint, builds y revisión Qwen); no es storage persistente.
3. Adaptador privado GCS y comprobación de compose/IAM: PASS en LV-007.GCS (evidencia independiente; no se repite desde la candidata local).
4. Flujo local ES fixture → revisión → EN fixture → TXT/SRT privado: PASS local; Qwen PASS con residuales menores, sin navegador E2E.
5. Siguiente: navegador local y diseño del puente seguro a Cloud Run interno; voz, cobros y publicación después.

<!-- LV-019-LIVE-ATTEMPT-20261115 -->
## LV-019.A · Panel de cuenta publicado y comprobado · 16 nov 2026

**COMPLETADO técnicamente.** Gemini v5 dio PASS al contexto congelado 961a74f2ae78f96c3aaaffe3c6e5e110d0533e3308bacba099a9c3dd3f48c7b1; informe íntegro verificado. La revisión focalizada de Kimi quedó INCONCLUYENTE (sin texto de respuesta); Gemini evaluó ese recibo y el paquete. No confundir el resultado de Kimi con aprobación.

Vistavo está publicado en https://vistavo.app/. Hosting release 1794796143133000, versión c5bb31bab5c215e3. Readback posterior PASS. QA: HTTPS/hash de 95 archivos PASS, smoke de escritorio y móvil PASS, ejecución nativa de 33 pasos PASS y limpieza confirmada. La publicación tocó Hosting solamente; no cambió backend, IAM o Firebase Auth. Evidencia principal en outputs/vistavo-account-services-20261114/{gemini-final-v5-status.json,hosting-postpublish.json,https-proof.json,browser-online.json,native-online.json}.

El panel sirve para el perfil y para proyectos privados de texto/SRT (crear/importar, editar, guardar, descargar y reabrir). Saldo inicial cero. No activa compra/crédito, transcripción, traducción, voz ni despacho de trabajos. Drive y videos largos tampoco quedan validados. No se creó Cloud SQL. El diagnóstico causal del HTTP 500 histórico sigue abierto/INCONCLUYENTE.

**Siguiente fase: LV-019.B, integrar el video con la cuenta.** El backend de video/IA ya existe como servicio privado de ensayo, separado del panel publicado; cada uno usa su propio Firestore y resuelve propiedad desde el UID Firebase verificado. Enlazarlos por el mismo origen y token, sin fusionar cuentas/saldos ni dar acceso de una API a la base de la otra. La integración empieza apagada mientras se implementa y verifica en candidata. Recorrido: subir video → transcribir español → revisar → traducir inglés → descargar TXT/SRT; luego voz opcional. Las unidades `test-unit` no son precio. US$0.25/min fue solo ejemplo; antes de cobrar, Rob define tarifa, redondeo, cotización y saldo. Drive sigue separado. [Contrato LV-019.B](docs/specs/LV-019-B-video-text.md).

Coste observado de las dos revisiones de este cierre: Kimi 12,886 tokens / USD 0.027952452; Gemini 1,053,010 tokens / USD 0.8356575; total observado USD 0.863609952. Codex, facturación de Google y consumo cloud: no medidos. Sin commit/push en este cierre documental.

<!-- /LV-019-LIVE-ATTEMPT-20261115 -->

<!-- LV-019-START-20261114 -->
## LV-019 · Snapshot de implementación al 14 nov (reemplazado por el estado vigente arriba)

Rob confirmó personalmente el acceso Google en su teléfono y pidió avanzar. Se implementaron cuenta real con saldo inicial cero y proyectos privados SRT/texto: importar, editar, guardar, descargar y reabrir desde otra sesión. Se mantienen diez idiomas y los botones oficiales de Google. No se acreditan compras, transcripción, traducción o voz productivas por esta fase; siguen B/C del [contrato](docs/specs/LV-019-cuenta-servicios.md). La decisión comercial de voz sigue pendiente y no bloquea A.

593 pruebas, tipos y ambas compilaciones correctas; diez pruebas reales de emulador. DeepSeek y Kimi aprobaron fuente candidata, con informes íntegros leídos; el INCONCLUYENTE de diseño Kimi se conserva. [API nativa17](outputs/vistavo-account-services-20261114/native-direct.json), [candidata3001 SDK34](outputs/vistavo-account-services-20261114/native-local-candidate-v2.json) y [reglas6](outputs/vistavo-account-services-20261114/native-rules.json) PASS con fixtures eliminadas. La candidata fallida anterior permanece FALLA: faltaba Origin en el operador; se corrigió el protocolo, se autorizó expresamente un intento separado y se comprobó ausencia fresca antes de crear nuevas fixtures. No fue una omisión de seguridad del producto. Evidencia vinculada a los hashes de esa candidata; el ajuste visual CSS posterior requiere su propia compilación/revisión y no hereda pruebas visuales anteriores.

Firestore nombrado vistavo-live y API nueva vistavo-account-api creados; imagen inmutable9cdc51b0…, identidad dedicada, min0/max2. [Readback](outputs/vistavo-account-services-20261114/native-cloud-readback.md): cinco runtimes anteriores privados/intactos, SQL0 y dos eventos SDK reales nueva identidad→producción permitido / candidata denegada. La consulta inversa de las cinco identidades antiguas devolvió HTTP400 antes de evaluar: gate INCONCLUYENTE, no se inventa aislamiento completo. [Propuesta concreta de excepción](outputs/vistavo-account-services-20261114/native-inverse-decision.md), revisada independientemente y con preflight; pregunta de autorización enviada a Rob. Sin concesiones de impersonación, claves o trabajos nuevos.

Siguiente orden: terminar ajuste visual y comprobar candidata; resolver decisión/permisos de la prueba inversa sin asumir respuesta; Gemini Batch final íntegro; publicación Hosting acotada y QA HTTPS/SDK/limpieza. El sitio público sigue en versión7327d2ad13d21070: login permanente operativo, panel nuevo todavía no publicado. Coste observado provisional de cuatro llamadas T3:630271tokens / USD0.674090744877, sin sumar fases anteriores; Gemini nuevo aún no solicitado, Codex/GCP/factura no medidos. No Cloud SQL.
<!-- /LV-019-START-20261114 -->

<!-- LV-018-PUBLISHED-20261114 -->
## LV-018 · Hito público de identidad — 14nov2026 PST

Completado: diseño → candidata → reproducción/corrección de recuperación y binding → peer → Gemini fuente PASS → Hosting autorizado → HTTPS95 → QA online17+11/limpieza → frontera privada PASS. [Informe de cierre](docs/reviews/LV-018-login-publico-2026-11-14.md), [Gemini íntegro](docs/reviews/LV-018-gemini-final-2026-11-14.md), [HTTPS95](outputs/vistavo-public-auth-20261114/https-proof.json), [nativo online17](outputs/vistavo-public-auth-20261114/native-online.json), [registro online11](outputs/vistavo-public-auth-20261114/registration-online.json), [frontera privada](outputs/vistavo-public-auth-20261114/private-boundary-online.json) y [costos](outputs/vistavo-public-auth-20261114/accounting-final.json).

Dependencias siguientes: LV-018.HUMAN-GOOGLE / HUMAN-MAIL / HUMAN-ACTION-UI / HUMAN-PIXEL requieren observación de Rob. No bloquean declarar la publicación técnica observada, sí impiden afirmar aceptación humana integral. Procesamiento/compras/Drive mantienen gates propios.
<!-- /LV-018-PUBLISHED-20261114 -->

<!-- LV-007.CLOSE-20261114-WIP -->
## LV-007.CLOSE · Cierre técnico privado ·14nov2026

**ACEPTADO TÉCNICAMENTE EN PRIVADO; sin publicación ni aceptación comercial.** [Gemini original íntegro](docs/reviews/LV-007-gemini-cierre-tres-pendientes-2026-11-14.md), Batch `batch-1794705294-nNMa49JhGZkxk2FxXMW0` completed/PASS UTC2026-11-15T01:23:29.789Z/contexto `07f4abd80d4667699d425b0469c92b42c36dd4bd0233d181e763c026c5770556`; resumen yFULLleídos. [Peer final35/35PASS](outputs/vistavo-three-fixes-20261114/gemini-close-final-peer-audit.json), [auditoría nativa120/120PASS](outputs/vistavo-three-fixes-20261114/native-v3-independent-audit.json) y [sellado de aceptación](outputs/vistavo-three-fixes-20261114/final-acceptance.json).

[CanonNode24](outputs/vistavo-three-fixes-20261114/full-check/check-results.json)541/541en62archivos/tipos/dosbuilds0; [backend](outputs/vistavo-three-fixes-20261114/backend-check/check-results.json)201/201,0skip; operadorV3offline73/73. D9decoder18/backend73/worker19son subsets, no sumar.72fuentes/manifiestob7460e85…/tar9b961af5…/imagen89ab489c… verificados y cinco runtimes privados; [readback UTC2026-11-15T00:29:43.103Z](outputs/vistavo-three-fixes-20261114/cloud-readback.json), SQLGET200/0/min0/secreto sólo worker, sinIAM/Scheduler/recursos nuevos. [Local3002](outputs/vistavo-three-fixes-20261114/local-parity.json) raíz/healthz200/Jobsanónimo401; no prueba de loginhumano.

[NativoV3PASS](outputs/vistavo-three-fixes-20261114/native-close-proof.json): proof961625b4…; outer78shs/speech5h5k4/silent2d2nd todosexit0/retry0/89ab. Cuenta100/79/21/0reservas-activos; speech1proveedor200/1.531tokens/capture21, silencio failed/no_speech/digital_zero/**cero registros proveedor de cualquier intento**/release2 y proofPCMf64nativo completo. Cinco descargas reales, revocaciónGET/HEAD/Range/GCS0 y transferencia ya autorizada positiva;14marcadores/9old404/cuota0/flagsOff,22intenciones auditadas. RecuperaciónACKoperacional, silencioexacto y revalidación transaccional de status/download completan el alcance técnico privado.

[Contabilidad final de esta fase](outputs/vistavo-three-fixes-20261114/accounting.json):14generacionesT3+Batch una vez,2.792.801tokens y subtotal observadoUS$3.39576499956; Batch992.196tokens/US$0.77925. Todos esos recibos tienen coste observado, **no todos los costes**: Google/proveedor de ejecución/cloud/Codex/factura no medidos. Excluye fases anteriores. PrimarioDSNULLINCONCLUYENTE con coste conocido contado una vez; sourcegateKimiFULL50 yDSseguimientoFULL13PASS conservan alcances distintos.

**Historial y límites:** V1FAIL0proveedor y V2FAIL100/77/23/capturas21+2/sinrefund/14marcadores/sólo3old404 permanecen fallidos; femenina6flpq y antigua cadena de auditoría incompleta no reciben verde retroactivo. Causa original500/104sE55 INCONCLUYENTE, aunque recuperación actual esté probada. GETsocket del deploy y UV_HANDLE_CLOSING/exit1 del helperpollNode24 se conservan como tooling: HTTP200/estadoBatch persistidos y completedraw autoritativo, sin resubmit ni causalidadE55. Abiertos fuera de este cierre: semántica de audio no nulo/ruido/música, Googlehumano/correo/Pixel, calidad lingüística/voz, videos largos/MP4/sincronía, precios/pagos/UNKNOWN/reconciliación/restore, Drive y publicación por Rob. Sin Cloud SQL. Historial inferior conserva sus cortes; [informe de integración](docs/reviews/LV-007-cierre-tres-pendientes-2026-11-14.md).

Hito técnico privado completo: D9fuente/tests/T3/build/deploy → V3/limpieza → auditoría120 → GeminiFULL → peer35/cierre. No cambia fecha ni gates del lanzamiento comercial.
<!-- /LV-007.CLOSE-20261114-WIP -->
<!-- LV-007.STAB-WIP-20261113 -->
Secuencia vigente: checks → rollout/readback → UI → fix lifecycle → ambos probes nativos PASS → purga/Auth completas → Gemini recuperación PASS y aceptación técnica privada sellada. Sin nueva fecha comercial.

**14nov2026 · LV-007.STAB / LV-017.LOCAL · CIERRE TÉCNICO PRIVADO ACEPTADO. No aceptación comercial ni publicación funcional.** [448/448 pruebas en57 archivos, tipos/dos builds0](outputs/vistavo-stabilization/lifecycle-final-canonical-check.json), audit0; [escaneo final424textos/0pendientes](outputs/vistavo-stabilization/versionable-secret-scan.json). [Digest0b8bbd0e83f4d180185296897c3f7c8c9adb9bf76110eb597f3fc78e84a28b57](outputs/vistavo-stabilization/ai-deploy-ready.json) desplegado en cinco runtimes privados. [Readback final UTC literal 2026-11-14T17:51:06.342Z](outputs/vistavo-stabilization/cloud-readback.json): runtimes exactos, sin invocadores públicos y SQLGET200/0. Sin despliegue Hosting ni cambios al piloto3001 por esta fase. Puertos3000/3001 sin listeners al retomar; no se acredita piloto activo. Local3002 reiniciado con Node24: raíz/healthz200 y Jobs anónimo401. Sin Cloud SQL ni publicación funcional.

[Probe nativo readonly](outputs/vistavo-stabilization/lifecycle-native-probe.json) y [reentrada del mismo Job femenino terminal](outputs/vistavo-stabilization/lifecycle-terminal-probe.json) PASS: ambos exit0/retried0, recibos3→3, saldo inalterado y cero peticiones pagadas adicionales. Probe acredita lectura real SDK/heartbeat drenado con negocio/proveedor simulados; reentrada obtiene `not_claimed`, no otra generación. LV-E57 original `vistavo-ai-process-6flpq` permanece FAILED/exit1 tras Job/recibo succeeded; mecanismo de carrera compatible corregido, sin reconstrucción exacta del scheduling original. LV-E55/500104s sigue abierto, causalmente INCONCLUYENTE.

[UI sintética3002](outputs/vistavo-stabilization/browser-proof.json): fuente española20,8s/414.238bytes → cinco textos ES/EN y WAV Kore19,8s/Charon18,28s. [Siete descargas SHA](outputs/vistavo-stabilization/download-verification.json), reproducción Blob y reapertura revisión2/digest; tres llamadas únicas,23 unidades FICTICIAS,277 disponibles/reservadas0. [13 negativos](outputs/vistavo-stabilization/browser-cloud-negative.json). No se despachó el botón logout: sesión nueva con login sin borrador privado no acredita revocación. Sin aceptación humana Google/correo/lingüística/audio/Pixel/render largo/pagos/restore/Drive ni factura Google medida.

**LIMPIEZA COMPLETA:** [remove lógico protegido](outputs/vistavo-stabilization/browser-cleanup-operator.json) ejecutado una vez con intención exclusiva; [verificación independiente](outputs/vistavo-stabilization/browser-cleanup.json) PASS: fuente deleted/purge done, tres artefactos purged/snapshots retirados, nueve marcadores vacíos, nueve generaciones anteriores404, almacenamiento/reservas/activos0 y saldo financiero inalterado. [Tres Auth sintéticos eliminados y flags piloto deshabilitados](outputs/vistavo-stabilization/fixtures-cleanup.json). Cero proveedor/dispatch/GCS directo desde el operador; purga física por infraestructura existente. [Recuperación de medios](outputs/vistavo-stabilization/media-recovery.json): siete archivos originales en Downloads, cada fila `existing-match` con SHA/tamaño idénticos; no se descargó media GCS ni se sobrescribieron archivos personales. Config pública del app Firebase existente restaurada por GET; sin crear app/proyecto o modificar ADC global.

**Pérdida externa explícita:** [audit-recovery](outputs/vistavo-stabilization/audit-recovery.json) recuperó desde este chat siete MD con SHA originales exactos; dos MD históricos y todos los API JSON/raw originales siguen ausentes, no fabricados. [GET de metadata de generación](outputs/vistavo-stabilization/recovery-provider-metadata.json) corrobora ambas generaciones Kimi/versiones/uso, sin autenticar sus textos/contextos ni sustituir recibos originales; discrepancias de precisión/coste se preservan. Kimi lifecycle PASS histórico acotado,402 previo y DeepSeek NULL+seguimiento UNKNOWN conservados. La clave original `.openrouter-key.txt` sigue ausente. Rob [autorizó explícitamente](outputs/vistavo-stabilization/recovery-key-authorization.json) usar la clave encontrada para esta revisión y se registró el [binding del proyecto](outputs/vistavo-stabilization/recovery-key-binding.json); ninguna clave ROB utilizada. Gemini recuperación usa protocolo separado: [informe original íntegro](docs/reviews/LV-007-gemini-final-2026-11-14.md), [raw Batch byte-exacto](outputs/vistavo-stabilization/gemini-recovery-final-response.json) y [aceptación técnica privada](outputs/vistavo-stabilization/gemini-recovery-final-acceptance.json) PASS. La cadena histórica original permanece **INCONCLUYENTE**, sin reconstrucción ni verde retroactivo. Revisiones/FAIL históricos conservan su alcance. Publicación y aceptación global BLOQUEADAS.

[Informe vigente](docs/reviews/LV-007-estabilizacion-cliente-2026-11-13.md). Las notas inferiores son cortes históricos y no sustituyen este bloque.

**Revisión nueva sellada14nov18:42:48UTC.** Batch `batch-1794680629-8w8OW1uYPdZf3suVFFV4`, modelo `google/gemini-4-hydrogen`, terminó PASS18:39:49UTC; contexto `c8bf633b3f014184090c5912d93d634ae48699b0db09805ea4ad70151f504989`. Codex leyó resumen e informe completo y contrastó [peer independiente16/16](outputs/vistavo-stabilization/gemini-recovery-peer-audit.json). Los cuatro subrecibos que Gemini declaró indirectos fueron inspeccionados después por el peer junto con los siete medios reales; no se afirma que Gemini los leyera directamente. [Productos89fee875 y candidata final0b8](outputs/vistavo-stabilization/cloud-proof.json) se distinguen mediante [equivalencia de procesamiento](outputs/vistavo-stabilization/lifecycle-equivalence-after.json); los probes nativos sí corresponden a0b8. El checkpoint emulador112/112 precede a F-01/heartbeat;23AI y15lifecycle posteriores son evidencia separada, sin sumar pruebas solapadas.

[Contabilidad final](outputs/vistavo-stabilization/accounting-recovery-final.json): Batch nuevo587.661tokens/US$0.49597875 observados una vez; subtotal histórico secundarioUS$2.255270078358 y subtotal conocido combinadoUS$2.751248828358, con dos intentos de costo desconocido. No todos los costes están medidos; factura/Codex/GoogleCloud/runtimeAI siguen no medidos. SESSION_COSTS registra el incremento sin volver a cobrar el histórico.

**Siguientes gates, abiertos antes de uso comercial:** `LV-E55` causal; `SILENT_VIDEO_CONTRACT` (sin habla `hasSpeech:false` alcanza UNKNOWN y retiene reserva: bloqueo comercial confirmado estáticamente, no nuevo incidente pagado); `STATUS_INPUT_REVALIDATION` y `DOWNLOAD_REVOCATION_TOCTOU` (hardening comercial, sin afirmar fuga o carrera cloud reproducida). Siguen Google humano/correo/Pixel, calidad humana/nativa de traducción y voz inglesa, video largo/habla continua entre ventanas, render/sincroníaMP4, precios/pagosSandbox-live/reconciliaciónUNKNOWN/restore financiero, Drive y publicación funcional por Rob. [Tareas y aceptación](backlog.md). Ningún PASS privado cierra estos gates.
<!-- /LV-007.STAB-WIP-20261113 -->

<!-- LV-007.AI-20261113-LOCAL -->
**13nov2026 · LV-007.AI · Secuencia vigente.** GCS privado verificado → proveedores/resultados privados implementados → prueba sintética real y continuación acotada ejecutadas → revisión Gemini final completada con PASS técnico privado (batch1794625807-CbTZINnB1JpdjBBGLbuT) → estabilidad del POST de reserva/diagnóstico LV-E55 e integración del cliente/aceptación humana antes de lanzamiento. Original FAIL tras cuatro controles y tail PASS de siete conservados por separado: no recorrido íntegro sin interrupción ni verde retroactivo. [Evidencia](outputs/vistavo-ai-cloud/cloud-evidence-notes.md), [cobertura final](outputs/vistavo-ai-cloud/test-coverage.json). Tres llamadas reales/una vez, ambas voces y borrado/cuota/revocación comprobados; recursos temporales limpiados. T3 FALLA/INCONCLUYENTE conservados. Restore, pagos/Pixel, render largo y Drive mantienen dependencias propias. Sin nueva fecha comercial ni Cloud SQL.

**Cierre técnico privado LV-007.AI.** [Revisión Gemini final](docs/reviews/LV-007-ai-cloud-2026-11-13.md) y [aceptación acotada](outputs/vistavo-ai-cloud/acceptance.json): PASS privado, sin cambio de código de aplicación después de la revisión. [Estado tras limpieza](outputs/vistavo-ai-cloud/post-cleanup-state.json) confirma cuotas/reservas cero, tres Jobs succeeded, tres recibos y tres artefactos purgados/snapshots borrados. [Uso de proveedores](outputs/vistavo-ai-cloud/provider-measurements.json): tres llamadas Google,2.328tokens; factura NO medida. [Contabilidad OpenRouter](outputs/vistavo-ai-cloud/accounting.json): siete respuestas,845.896tokens,US$1.417184554152 observados, sólo revisiones OpenRouter; no incluye factura Google ni coste Codex. [Escaneo posterior](outputs/vistavo-ai-cloud/versionable-secret-scan.json):0 hallazgos sin resolver; dos coincidencias revisadas eran placeholders de documentación. El informe Gemini conserva el snapshot anterior de costes/escaneo; estos recibos posteriores lo actualizan sin modificar código.

**Antes de uso comercial:** LV-E55 sigue ABIERTO con causa del500 INCONCLUYENTE. LV-E56 exige sacar/acotar el despacho esperado dentro de HTTP y validar respuesta tras reserva durable; no se declara causa de LV-E55. Videos mudos/sin habla admitidos pueden terminar UNKNOWN y retener unidades: capacidad no soportada/no aceptada hasta definir rechazo o resultado seguro y sus pruebas. También quedan hardening de staging/cuota, fixtures sin storage/audio, coherencia de hermanos UNKNOWN y guards de status/descarga, con regresiones antes de comercializar. Frontend conectado, producción, calidad humana, render largo, pagos/restore y Drive permanecen bloqueados por sus fases propias.
<!-- /LV-007.AI-20261113-LOCAL -->

<!-- LV-007.GCS-20261113 -->
**13nov2026 · Actualización LV-007.GCS.** Núcleo local Firestore → archivos privados/identidades/índices → candidata cloud y pruebas reales ejecutados. Fallo de índice de fileOutbox corregido y gates afectados retestados; revisión Gemini final PASS privado. Después: proveedores/cotización vinculada/artefactos, integración del cliente, restore y aceptación humana antes de publicación. Drive sigue separado y pendiente; voz AI requiere completar su recorrido cloud. Sin Cloud SQL. [evidencia y revisión](docs/reviews/LV-007-gcs-cloud-2026-11-13.md).
<!-- /LV-007.GCS-20261113 -->

# Actualización vigente · 13nov2026

LV-007.STAB/LV-017.LOCAL: diagnóstico nativo y observabilidad → despachoHTTP separado/límites/aislamiento → revisión T3 corregida e índice/backfill → despliegue privado → navegador sintético texto/dosvoces/negativos/limpieza → Gemini final. En curso;427pruebas generales/tipos/builds correctos, no aceptación final ni fecha comercial nueva. Piloto3001/Hosting preservados. E55 causal sigue abierto; Cloud SQL prohibido.

Rob aprobó Firestore y procesamiento bajo demanda para el backend. No crear Cloud SQL. La ruta anterior SQL queda sustituida por [LV-007 Firestore](docs/specs/LV-007-firestore-backend.md). Adaptación en curso: persistencia/UID/ledger/proyectos/outbox, después GCS/API/workers y candidata privada con T3/Gemini; publicación y gates funcionales siguen pendientes.

# Cronograma de Vistavo

12nov22:05PST · Hito frontend estático+dominio+HTTPS completado para vista previa noindex en https://vistavo.app/. Emisión real verificada; Firebase aún propaga certificados globalmente. Continúan independientes backendcloud,Drive/render,nativos y lanzamiento indexable. No nueva fecha comercial comprometida.

12 de noviembre · LV-016 sustituye la secuencia centrada en seleccionar archivo: A contratos/versiones → B texto ES→EN → C voz inglesa → D render servidor → E interfaz → F candidata3001/aceptación. Tras A, validación de voces, worker y componentes UI pueden avanzar independientes con contratos/adaptadores simulados. Archivo privado sólo para aceptación de sus grabaciones; no bloquea trabajo inicial. Sin fecha de lanzamiento nueva; Drive separado.

12 de noviembre · LV-015: ambas voces españolas aprobadas y costes1/5/10min proyectados. Próxima fase de voz: validación por idioma e integración; sin cambio de precio comercial ni publicación.

12 de noviembre · LV-015: especificación y revisión independiente → generación de voz estándar → comprobación de audio/duración/coste → MP4 sintético y evidencia. Puede avanzar mientras Drive sigue pendiente; no cambia fecha/gates de lanzamiento ni precios comerciales.

LV-015: etapas técnicas completadas con20.8s de audio/MP4. Siguiente: escucha/valoración humana → decidir ensayo ampliado e integración privada; no se asume comercialización ni cobertura multilingüe por una muestra.

LV-015 comparación: Kore femenina aceptada por el propietario; Charon masculina20.24s lista para escuchar, mismo texto/coste documentado. Objetivo aprobado de dos opciones por idioma se valida individualmente antes de integrar; no genera ni habilita los otros idiomas en esta entrega.

12 de noviembre · LV-003 protección de acceso directo verificada: reproducción del bloqueo cruzado, limitador por peer, controles de cabeceras/capacidad/caducidad y candidata3001.168pruebas sin omisiones. Producción aún depende de definir proxy/topología y validar sus cuotas; no cambian ventanas comerciales ni la publicación. Drive y voz fuera de esta fase.

11 de noviembre · Cuenta y pagos local: criterios de duplicados, reserva y aislamiento comprobados con162tests sin omisiones y revisión independiente. No modifica dependencias comerciales ni ventanas; PayPal remoto/Pixel siguen pendientes. Drive diferido a mañana por el propietario, sin automatización programada. El endurecimiento del límite de login queda como seguimiento técnico previo a producción.

11 de noviembre · Continuación en esta PC: paso1 local comprobado con Google real, saldo inicial0, importación sintética/edición/guardado/reapertura y nueva carga HTTP tras corregir ruta Windows empaquetada. Paso2 sigue pendiente de autorización/persistencia Drive y Pixel; cancelación de espera de autorización corregida y probada en SRT/MP4. Pruebas160/160, tipos/builds correctos. Los ensayos reales de cámara1/5/10min y demás gates mantienen dependencias y ventanas orientativas.

Orden de ejecución y dependencias. Las semanas son ventanas orientativas de planificación desde que estén disponibles los insumos de cada bloque. No representan fechas ni duraciones comprometidas. Reestimar tras la prueba real, el cierre de alcance y las primeras mediciones.

| Tarea | Bloque | Inicio relativo | Depende de | Evidencia de cierre |
|---|---|---|---|---|
| LV-001 | Alcance de lanzamiento | Semana 1 | Decisión del usuario | Lista de diez, pares prometidos, formatos y límites |
| LV-002 | Prueba local Gemini → SRT | Semana 1, en paralelo | Clave y saldo disponible del proyecto Gemini | Clip real procesado y SRT descargado y cotejado |
| LV-003 | Núcleo comercial y adaptadores | Semanas 2–3 para la base. Pago móvil y preparación de Firebase en paralelo al editor. | LV-001 para cerrar reglas comerciales y Google real en desarrollo verificado; dominio y proyecto final aprobados para el alta de producción | Alta, confirmación, Google, recuperación y aislamiento de cuenta. Acreditación de PayPal Sandbox en el teléfono. |
| LV-006 | Prueba de reutilización con PDF | Tras disponer del núcleo local de LV-003 | Circuito local de trabajos y saldo | Verificado en la web local con PDF → CSV y video → SRT |
| LV-008 | Revisión y exportación del piloto | Preparación en paralelo con LV-002 | La prueba con subtítulos reales depende de LV-002 | Corrección sobre el video y salidas SRT y MP4 cotejadas |
| LV-009 | Proyectos, borrador e importación SRT web | Candidata local verificada | LV-008 y núcleo local de LV-003 | Importación, guardado y reapertura verificados en Chrome. Prueba física del Pixel pendiente. |
| LV-010 | Pistas bilingües, tiempos y estados de trabajo | Candidata local verificada, en paralelo con LV-011 | LV-009 | Edición y MP4 bilingüe verificados en el Pixel. Pendiente cotejar ambos SRT descargados. |
| LV-011 | Estilos globales y presets | Verificada | LV-009 | Reapertura comprobada en Chrome. MP4 con Alto contraste y preset personalizado guardado en el Pixel. |
| LV-012 y LV-013 | Importación LRC/ASS, resaltado manual y estilos estáticos | Importación, reapertura, resaltado y MP4 con estilo personalizado comprobados en el Pixel. Descarga SRT cotejada en VS Code. | LV-009 a LV-011. El pago móvil puede avanzar en paralelo. | Evidencia del editor registrada. |
| LV-014 | App privada completa en inglés, español y árabe | Editor, tres muestras con voz y ensayo de reversión comprobados. | LV-009 a LV-013 según alcance, LV-003 para pago y operación | Acreditar PayPal Sandbox en el Pixel. Prueba aplazada por el propietario. |
| LV-004 | Completar los diez idiomas por paquete | Ajuste local de finales y lectura de MP4 con índice al final comprobados. Sigue la validación con clips nuevos. | Contrato de idioma estable y selección comercial de LV-001 | Diez idiomas y pares anunciados con evidencia por capacidad. |
| LV-005 | Web pública SEO y GEO en diez idiomas | Portada y alta de prueba verificadas en localhost. | LV-003 para acceso comercial, LV-004 para capacidades y LV-007 para oferta y cobro | Revisión humana por mercado y comprobación pública de las diez rutas y la medición. |
| LV-007 | Candidata comercial | Medición de obra en PC y tres recargas aprobadas. Evaluar el Droplet de DigitalOcean en paralelo. Cierre tras LV-003, LV-004, LV-005 y LV-014. | Costes, calidad, pagos y alcance aprobados | Recorrido completo con saldo repartido, prueba de capacidad y restauración, límites y decisión de publicación. |

El [backlog](backlog.md) guarda el estado de cada tarea. Al cambiar alcance o dependencias, ajusta el orden aquí y explica el motivo en la [bitácora](bitacora.md). La fecha de lanzamiento se estima después de medir la carga de validación lingüística.

Claude Design: propuesta de base compartida → contraste de recorridos y escrituras → integración privada → pruebas. La propuesta puede avanzar en paralelo al catálogo y al contenido localizado; no bloquea su preparación ni cambia las ventanas orientativas. [Prompt y revisión](docs/specs/LV-005-claude-design-revision.md).

11 de noviembre: integración privada de las tres áreas y pruebas automatizadas completadas. Siguiente incremento LV-003: contrato de perfil/historiales → backend autorizado → panel con datos → aislamiento/concurrencia y recorrido. Revisión de contenido/Pixel puede avanzar en paralelo. Se conservan ventanas orientativas y aprobación pública pendiente. [Evidencia](docs/specs/LV-005-integracion-claude-design.md).

Actualización LV-005 (10 de noviembre): rediseño de las diez portadas implementado y verificado localmente con casos por comprador, demo, planes y FAQ. La revisión editorial humana puede avanzar en paralelo al cierre de cuentas y consumo. Dominio y publicación siguen condicionando la verificación pública; se conservan las ventanas orientativas anteriores.

LV-005: el caso de inspección español→inglés y los cinco usos secundarios quedaron integrados y verificados en diez locales. Se conservan fechas orientativas y dependencias; siguen revisión humana y publicación con dominio.

Revisión T3 de 90 direcciones: catálogo/estado efectivo → API/selector → validación y activación por dirección. La redacción localizada y preparación de muestras pueden avanzar en paralelo. La publicación conserva sus gates y ventanas orientativas. [Plan](docs/specs/LV-004-plan-90-direcciones.md).

11 de noviembre · LV-005: [diseño comercial V2](docs/specs/LV-005-diseno-v2.md) integrado y probado localmente. Secuencia conservada: revisión editorial y prueba física → gates LV-003/LV-004/LV-007 → aprobación del dominio/publicación. La ampliación de perfil e historiales sigue en paralelo como siguiente incremento de LV-003. No cambian las ventanas orientativas.

11 de noviembre · Estudio solicitado de [archivos grandes/destinos/voz](docs/specs/LV-007-archivos-destinos-voz.md), sin nueva fecha comprometida. Dependencia propuesta: carga y almacenamiento privado medidos→Drive→Dropbox según disponibilidad del artefacto. Evaluación TTS y revisión de textos en paralelo; precio/alcance de voz después de coste y calidad. Conserva ventanas y gates de lanzamiento existentes; la voz no se convierte en requisito de lanzamiento sin decisión comercial.

11 de noviembre · incremento autorizado: carga privada/reanudación/cuotas/borrado yDrive implementados/verificados localmente. [Evidencia](docs/specs/LV-007-archivos-destinos-voz.md#entrega-local--archivos-grandes-y-drive--2026-11-11). Ahora consentimientoGoogle→persistenciaSRT/MP4 PC/Pixel; enparalelo medición cámara/render ypreparaciónDigitalOcean. Sinfecha pública nueva, no se eleva promesa500MB ni se incluye voz. Conserva ventanasanteriores.


12 de noviembre · LV-016.A terminado y verificado: contratos/persistencia/migración/estados y193pruebas. Camino restante B texto ES→EN → C voz inglesa → D render → E interfaz → F aceptación. La validación de voz y diseño del worker pueden usar contratos A sin bloquear B; no se ejecutaron esas fases en esta entrega. No cambia fecha comercial ni pendiente Drive.


12 de noviembre · LV-016.B cerrado técnicamente: A→B listos,232pruebas, candidata3001 y revisión independiente final. Próximo C vocesinglesas; D renderMP4largo→E recorrido completo→F aceptación. Slice UI textual completada en B no cierra E de voz/render. LV-004 revisión humana/habla continua entre30s permanece gate antes de publicar. Drive separado; sin fecha pública nueva.


12 de noviembre · LV-016.C integrado técnicamente en3001 (286pruebas/39archivos, tipos/builds, DeepSeek/KimiPASS técnico). Generación/escucha/WAV de ambas voces inglesas listas para evaluación. Escucha/aprobación humana de inglés pendiente; en paralelo puede prepararse D encaje por segmentos y render servidor, sin afirmar sincronía por duración total. E/F y Drive conservan gates; ninguna fecha pública nueva.


12 de noviembre · Ajustes del ZIP3 integrados y comprobados en3001. Cuatro pares de reproductores con bucle funcional y pausa;290pruebas, tipos/builds y revisiones técnicas correctos. Antes del cierre visual queda Inspección (empalme entre extremos), revisión nativa y320px/200%/preferencia real de movimiento reducido. Esto no publica ni cambia la fecha comercial. LV-016.C conserva aceptación inglesa pendiente; D/render y Drive no se retomaron en esta sesión.


12 de noviembre · LV-005 portada española y panel local listos para revisión del propietario tras corregir el alcance parcial ZIP3. Matriz17pantallas y evidencia outputs/lv005-complete/. Las nueve portadas extranjeras completas/revisión nativa y comprobaciones de publicación siguen pendientes; no cambia fecha comercial. LV-016.C conserva aceptación inglesa pendiente, D/render y Drive siguen independientes.


12 de noviembre · LV-005: las nueve portadas restantes ya comparten el diseño ES aprobado en preview noindex, con catálogos completos y adaptación RTL/CJK.306/306pruebas43archivos, tipos/builds y navegador correctos. DeepSeek/Kimi revisaron correcciones independientemente; nativos aún pendientes. [Contrato y evidencia](docs/specs/LV-005-portadas-localizadas.md). Sustituye el pendiente de traslado de layout extranjero de entradas anteriores; conserva revisión nativa, comprobaciones de publicación, renderer release/oferta dinámica, seam Inspección y gates globales. Sin cambios de fechas, capacidades, Drive o LV-016.D.


2026-11-12 · LV-007/Vistavo: Rob aprueba ruta Google Cloud y presupuesto; selecciona Billing for Robertson. Sustituye DigitalOcean y rechaza página temporal. Proyecto dedicado vistavo-prod creado ACTIVE y Firebase añadido correctamente. Vinculación billing falla HTTP400 QuotaFailure Cloud billing quota exceeded, permiso de asociación comprobado; primer intento y un reintento preservados. Fase A incompleta, sin Cloud SQL/Run/Storage de pago creados ni cambios DNS ni exposición local. Preparación y cálculo en docs/specs/LV-007-vistavo-google-cloud.md y deploy/google-cloud/. Linux Node24.13.0/FFmpeg5.1.9 bajo usuario1000, sin red/fsreadonly/tmpfs256MiB/1GiBRAM/2CPU: patrón+seno180s,4500frames,H264/AAC y archivo inválido rechazado. No prueba ASR/traducción/voz/rendercloud. Datos/candidata3001 conservados. Siguiente: resolver cuota de la cuenta elegida, reanudar sólo billing del proyecto existente; después B almacenamiento durable/SQL y C entrypoint/activación cloud, manteniendo gates D/E. Revisiones y costes se completan en el cierre de esta fase.



12 de noviembre · Marca Vistavo aplicada localmente a diez portadas y panel; Firebaseprod configurado tras aprobación explícita (Google/correo, Vistavo Web, dominios autorizados), separado de dev.306/306pruebas43archivos, tipos/builds0 y DeepSeek/KimiPASS técnico acotado. [Informe](docs/FIREBASE-VISTAVO-2026-11-12.md). No desplegar ni habilitar billing según última instrucción; pruebas humanas/prodcloud y gates globales pendientes. Sin nueva fecha pública.


12nov · Hito LV-005 frontend Hosting cumplido en web.app. Secuencia restante: certificado de vistavo.app → HTTPS/HTTP y navegador del dominio → cierre acotado de publicación noindex. No bloquea ni sustituye fases independientes de backend cloud, Drive y render; no se declara app operativa. [Evidencia](docs/specs/LV-005-despliegue-dominio.md).

12nov · Identidad Vistavo: brief y tres prototipos/revisión independiente completados → elección de dirección por Rob → afinación óptica y kit → aplicación según alcance autorizado. No bloquea backend ni cambia fechas de lanzamiento.

13nov · Identidad: elección A3 completada y kit listo. Mensaje hero actualizado como propuesta subtítulos+voz futura; siguiente adoptar/ajustar copy y aplicarlo coherentemente con FAQ/pie/metadatos/locales. Sin cambio de hitos de backend/voz MP4.

13nov · Hito identidad A3 publicado cumplido en vistavo.app. Próximo: resolver autorización de billing para backend cloud y adoptar mensaje comercial de voz de forma coherente; sin nueva fecha de lanzamiento.

13nov · LV-007: dependencia de asociación billing resuelta por aprobación explícita y PUT/GET exitosos. Continúa preparación B almacenamiento/SQL; no se crean recursos en esta operación.

13nov · LV-007 secuencia vigente: B0auditoría/matriz → cierre de riesgos AUD-01–04/06 con negativos → B1–B3infraestructura/datos/login privados → B4workers/texto/voz/render → B5calidadPC/Pixel → B6aceptación/lanzamiento porRob. Sin plazos nuevos. Firebasevigente; Supabaselegacy. Revisión Gemini final en curso, sin declarar backend aceptado.

13nov · Cierre B0documental completado porrevisiónGeminiHydrogenbatch; B1–B6siguenabiertos. Primertrabajolisto AUD-01–03y06, conreproducciones yrevisiónindependiente. No cambianplazos ni gatespublicación/Drive/vozcomercial.


## 2026-11-13 · Dependencias tras correcciones y B1.base

| Hito | Estado verificable | Siguiente dependencia |
|---|---|---|
| AUD01/02/06 y secundarios | Cerrado localmente325/44 y Gemini | Conserva gates reales por proveedor |
| B1.base red/archivos/registro/identidades | Creado y verificado privado | IAM mínimo; Firestore y recuperación |
| B1.Firestore y B2durabilidad | Adaptación aprobada; núcleo local en revisión | Firestore privado, GCS y restauración antes de datos |
| B3identidad/API | Abierto | Datos durables y entrypoint propio; E2EPC/Pixel |
| B4–B6 | Abiertos | Workers, mediciones, calidad y gates de publicación |

Sin fecha de lanzamiento nueva; Drive, render de voz y pagos reales conservan sus dependencias. Informe docs/reviews/LV-007-base-cloud-2026-11-13.md.


## 2026-11-13 · Decisión de persistencia y costo en revisión
Rob cuestiona el costo fijo de Cloud SQL frente a su experiencia de poco gasto con Techos.app. Cloud SQL0 y secreto/grantsSQL inexistentes; no se provisiona mientras se compara y elige. Se conserva la arquitectura PostgreSQL actual como referencia; Firestore es alternativa por evaluar, no migración aprobada. Comparación y gates en docs/specs/LV-007-comparacion-postgres-firestore-2026-11-13.md. B1.base privada permanece creada/verificada y reutilizable; loginFirebase/Hosting/GCS no requieren elegir CloudSQL. La siguiente dependencia de SQL/migrador es la elección informada de Rob tras contraste T3/Gemini; continuar frentes independientes sin borrar recursos o cambiar de proveedor silenciosamente.


## 2026-11-13 · LV-007 · Comparación y prototipo Firestore cerrados localmente

19/19pruebasFirestoresinomisiones,325/44PostgreSQLsinomisiones, tipos2builds correctos. T3detectóclaimhermanoqueuedenUNKNOWN:reproFALLApreservada,fixvalidado19yGeminiBatchfinalPASSscopeprototipo. No backend migrado niSQL/Firestorecloudcreado. Recomendación: adaptaciónFirestoreporfasesparaevitarinstanciaSQLfija; elección remota/cutover pendiente. Login/Hosting/GCSseconservan; jobs poractividad,outboxsinpoll4Hz, medircostos/restore antesdeproducción. Informe docs/reviews/LV-007-firestore-ledger-2026-11-13.md y outputs/vistavo-firestore-prototype.


## 2026-11-13 · LV-007 · Núcleo Firestore y procesamiento bajo demanda, avance local

Rob aprobó Firestore; Cloud SQL prohibido. Nuevo núcleo de cuentasUID/ledger/proyectos/outbox/API/worker, separado del pilotoPG y del experimento19. Matriz REST52/52(41núcleo+11transporte),100carreras2clientes, suitegeneral332/45,ceroomisiones, npmci348/audit0, tipos2builds. T3diseño/candidata/transporte conservaronINCONCLUYENTE/FALLA; Codex integróyprobó. Gemini primerPASS40reabierto porgRPC39/40; controlgRPCfalló2/20 y sepreservó. PreferRestpúblico sinpatchSDK/retrycode3/altgaxglobal; rollbackABORTED, consultasparciales/503/errores3y7 ycommitsconacuseperdido validados. GeminiRESTfinalbatch-1794610269-epEVVKC3qJCXRJpVKDcQPASSLOCAL exacto,no cloud/backendcompleto. Informe docs/reviews/LV-007-firestore-backend-2026-11-13.md.

Sin nuevo recurso/Firestorecloud/SQL/roles/keys/deploy; SQL200/0 ensonda; FirestoreAPIoff/list403noausencia. CloudSQLroles/secretosretiradosdelplan, infraestructuraanteriorpreservada. Piloto3001HTTP200, ADCglobal/otrosproyectosintactos. No commit/push. SiguienteGCS+FirestorecloudIAM/indexes/rules+provider/cotización/artefacto; Sandbox/live separadosantespagos, restore/GooglePCPixel/Drive/calidad pendientes. Aprobaciónvigentepermitecontinuar.

Fase independiente:8respuestasmedidas,337008tokens,US$0.92317678049usage.cost;4solicitudes transporte sinusage son no medido. Sin topeslocales; factura/Google/Codexnomedidos; fasesanterioresexcluidas.

2026-11-15 · Dependencia de revisión: T3 ya tiene instancia Codex aislada `linguistvision-openrouter` y modelos DeepSeek/GLM, el alcance de ajustes está en `Robcaze1980/video_transcript`; falta que Rob introduzca allí la clave OpenRouter como variable sensible dentro de T3. Primer probe app-server fallido; refresh posterior Available v0.164.0, pendiente probar autenticación después de que Rob guarde el secreto. No se envió revisión ni Gemini v3 se reutiliza. Tras habilitarla: revisar por separado con DeepSeek y GLM, después lote Gemini nuevo; publicación sólo con el gate PASS ya aprobado.

2026-11-16 · Gate T3 actualizado: el catálogo ya muestra DeepSeek + GLM, pero el primer probe explícito terminó antes del proveedor con `powershell produced an empty token`; sin request ni cargo. Dependencia actual: guardar API key sensible en `linguistvision-openrouter` para `Robcaze1980/video_transcript` / `SalaPC`; luego revisar con DeepSeek y GLM en hilos separados y preparar lote Gemini nuevo.

## 16 nov 2026 · LV-019.A · panel publicado
Cierre PASS técnico: Gemini v5, Hosting version c5bb31bab5c215e3 con readback, HTTPS/hash 95 archivos, navegador desktop/móvil y prueba nativa 33 pasos con limpieza. Costes observados del cierre: USD 0.863609952 entre Kimi y Gemini; Codex/cloud sin medir. Siguiente: LV-019.B integrar flujo privado de video y texto; compras/servicios permanecen deshabilitados, precio de voz requiere decisión de Rob y Drive conserva fase propia.

## 16 nov 2026 · LV-019.B · candidata aislada preparada
Subhito de identidad/transporte same-origin PASS local: emuladores Auth/Firestore demo; procesos separados; `account-candidate` y `(default)` independientes; proxy allowlist sin credenciales; video/upload/IA/pagos apagados. Sin cambios cloud ni publicación. Pendiente inspección del formulario con navegador, luego archivo sintético upload/delete solo en emuladores; posteriormente conectar ES→revisión→EN→TXT/SRT en candidata. Voz, tarifas, compras, GCS/Drive, pruebas de video real y despliegue siguen en pasos posteriores y con gates separados. Auditoría Kimi INCONCLUYENTE, preservada sin reintento.

Revisor vigente cambia a Qwen4 Max por solicitud de Rob. Auditoría `qwen/qwen4-max` PASS sobre el módulo final separado; 6.749 tokens/USD0.010758825; reasoning apagado. PASS acotado al puente local. Kimi histórico no se reutiliza. Evidencia en outputs/lv019-b-video-text-20261116/qwen4-max-isolated-candidate-20261116-*.

## 16 nov 2026 · LV-019.B · gateway local al backend privado simulado
Candidata same-origin ahora enruta el cliente a `/api/video/**` → proxy loopback 3003 → gateway 3006 → Cloud API emulada 3005. Separa token Firebase de usuario y assertion sintético efímero; Cloud API falla cerrado sin el assertion, valida de nuevo Firebase UID y propiedad. `npm run test:candidate:isolated` PASS 1/1, 0 omitidos; lint PASS; ambas builds PASS; smoke de los cinco servicios HTTP PASS y bypass directo 403. T3 Qwen4 Max PASS inicial + seguimiento PASS. No firma Google/IAM/VPC/Cloud Run real, GCS, Hosting, proveedores, costos ni despliegue. Evidencia `outputs/lv019-b-cloudrun-local-bridge-20261116/`. Siguiente dependencia: inventario de costos/cambios exactos y decisión explícita antes de IAM/VPC/Hosting real.
