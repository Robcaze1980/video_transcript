## LV-019.B · checkpoint vigente · 16 nov 2026 · puente local validado

Se completaron en candidata local la carga sintética privada y el flujo de muestra de texto ES → revisión → EN → descarga TXT/SRT. Después se agregó el puente same-origin `/api/video/**` → gateway de loopback → API de archivos emulada, con verificación de identidad de usuario/servicio, rutas limitadas y backend que rechaza bypass. Test 1/1, lint, ambas builds y Qwen4 Max/T3 PASS. El fixture no lee ni transcribe el MP4; el secreto gateway es sintético y no simula una firma Google. No se usó Cloud Run real, IAM, VPC, Hosting, GCS, proveedores ni Cloud SQL. Siguiente: paquete de costos, cambios cloud exactos y reversión para aprobación explícita antes de implementación real. Evidencias: [flujo ES/EN local](outputs/lv019-b-video-text-20261116/local-text-fixture-acceptance-20261116.json) y `outputs/lv019-b-cloudrun-local-bridge-20261116/`.

<!-- LV-019-LIVE-ATTEMPT-20261115 -->
## LV-019.A · Panel de cuenta publicado y comprobado · 16 nov 2026

**COMPLETADO técnicamente.** Gemini v5 dio PASS al contexto congelado 961a74f2ae78f96c3aaaffe3c6e5e110d0533e3308bacba099a9c3dd3f48c7b1; informe íntegro verificado. La revisión focalizada de Kimi quedó INCONCLUYENTE (sin texto de respuesta); Gemini evaluó ese recibo y el paquete. No confundir el resultado de Kimi con aprobación.

Vistavo está publicado en https://vistavo.app/. Hosting release 1794796143133000, versión c5bb31bab5c215e3. Readback posterior PASS. QA: HTTPS/hash de 95 archivos PASS, smoke de escritorio y móvil PASS, ejecución nativa de 33 pasos PASS y limpieza confirmada. La publicación tocó Hosting solamente; no cambió backend, IAM o Firebase Auth. Evidencia principal en outputs/vistavo-account-services-20261114/{gemini-final-v5-status.json,hosting-postpublish.json,https-proof.json,browser-online.json,native-online.json}.

El panel sirve para el perfil y para proyectos privados de texto/SRT (crear/importar, editar, guardar, descargar y reabrir). Saldo inicial cero. No activa compra/crédito, transcripción, traducción, voz ni despacho de trabajos. Drive y videos largos tampoco quedan validados. No se creó Cloud SQL. El diagnóstico causal del HTTP 500 histórico sigue abierto/INCONCLUYENTE.

**Siguiente fase: LV-019.B, conectar video, selección de idioma y servicios opcionales con la cuenta.** El backend de video/IA y el panel usan bases aisladas, y ambos resuelven propiedad desde el UID Firebase verificado. Conectarlos por el mismo origen/token y una API de reserva, sin fusionar cuentas/saldos ni compartir bases. El usuario elige un par origen/destino validado, revisa texto y subtítulos, y puede añadir voz desde la traducción revisada. Texto cuesta US$0,10 por minuto de video; voz añade US$0,10/min (US$0,20/min con ambos). El saldo se mide en segundos: 1 segundo por segundo de video para texto y otro tanto si añade voz; se redondea cada video hacia arriba. Habilitar solo capacidades validadas por LV-004. Sin saldo no se procesa; sin crédito ficticio, compras, PayPal o Cloud SQL. Drive sigue separado. [Contrato LV-019.B](docs/specs/LV-019-B-video-text.md).

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
## LV-018 · Identidad pública permanente operativa

**14 de noviembre de 2026 (PST) · PUBLICADO Y VERIFICADO TÉCNICAMENTE.** Acceso permanente autorizado por Rob: [iniciar sesión](https://vistavo.app/acceso/es-419/), [registro](https://vistavo.app/registro/es-419/) y perfil real Firebase Authentication, con Google oficial y correo/contraseña en diez idiomas. Hosting `vistavo-prod`, versión `7327d2ad13d21070`, release `1794715814243000`, publicado UTC `2026-11-15T04:10:14.243Z`. Sustituye el estado pendiente de LV-017.PUBLIC-LOGIN; el diagnóstico anterior se conserva como historia.

[Informe de cierre](docs/reviews/LV-018-login-publico-2026-11-14.md), [Gemini íntegro](docs/reviews/LV-018-gemini-final-2026-11-14.md), [HTTPS95](outputs/vistavo-public-auth-20261114/https-proof.json), [nativo online17](outputs/vistavo-public-auth-20261114/native-online.json), [registro online11](outputs/vistavo-public-auth-20261114/registration-online.json), [frontera privada](outputs/vistavo-public-auth-20261114/private-boundary-online.json) y [costos](outputs/vistavo-public-auth-20261114/accounting-final.json).

Alcance: identidad y perfil públicos permanentes. Procesamiento, compras, ledger y backend de negocio siguen privados; Drive pendiente. No se acredita Google personal, recepción en buzón, recorrido UI alojado `/__/auth/action` ni Pixel físico. El reto Google y códigos reales consumidos por API no sustituyen esas comprobaciones. Ningún verde retroactivo de fallos previos ni causa histórica E55/500 resuelta por este cierre.
<!-- /LV-018-PUBLISHED-20261114 -->

<!-- LV-007.CLOSE-20261114-WIP -->
## LV-007.CLOSE · Cierre técnico privado ·14nov2026

**ACEPTADO TÉCNICAMENTE EN PRIVADO; sin publicación ni aceptación comercial.** [Gemini original íntegro](docs/reviews/LV-007-gemini-cierre-tres-pendientes-2026-11-14.md), Batch `batch-1794705294-nNMa49JhGZkxk2FxXMW0` completed/PASS UTC2026-11-15T01:23:29.789Z/contexto `07f4abd80d4667699d425b0469c92b42c36dd4bd0233d181e763c026c5770556`; resumen yFULLleídos. [Peer final35/35PASS](outputs/vistavo-three-fixes-20261114/gemini-close-final-peer-audit.json), [auditoría nativa120/120PASS](outputs/vistavo-three-fixes-20261114/native-v3-independent-audit.json) y [sellado de aceptación](outputs/vistavo-three-fixes-20261114/final-acceptance.json).

[CanonNode24](outputs/vistavo-three-fixes-20261114/full-check/check-results.json)541/541en62archivos/tipos/dosbuilds0; [backend](outputs/vistavo-three-fixes-20261114/backend-check/check-results.json)201/201,0skip; operadorV3offline73/73. D9decoder18/backend73/worker19son subsets, no sumar.72fuentes/manifiestob7460e85…/tar9b961af5…/imagen89ab489c… verificados y cinco runtimes privados; [readback UTC2026-11-15T00:29:43.103Z](outputs/vistavo-three-fixes-20261114/cloud-readback.json), SQLGET200/0/min0/secreto sólo worker, sinIAM/Scheduler/recursos nuevos. [Local3002](outputs/vistavo-three-fixes-20261114/local-parity.json) raíz/healthz200/Jobsanónimo401; no prueba de loginhumano.

[NativoV3PASS](outputs/vistavo-three-fixes-20261114/native-close-proof.json): proof961625b4…; outer78shs/speech5h5k4/silent2d2nd todosexit0/retry0/89ab. Cuenta100/79/21/0reservas-activos; speech1proveedor200/1.531tokens/capture21, silencio failed/no_speech/digital_zero/**cero registros proveedor de cualquier intento**/release2 y proofPCMf64nativo completo. Cinco descargas reales, revocaciónGET/HEAD/Range/GCS0 y transferencia ya autorizada positiva;14marcadores/9old404/cuota0/flagsOff,22intenciones auditadas. RecuperaciónACKoperacional, silencioexacto y revalidación transaccional de status/download completan el alcance técnico privado.

[Contabilidad final de esta fase](outputs/vistavo-three-fixes-20261114/accounting.json):14generacionesT3+Batch una vez,2.792.801tokens y subtotal observadoUS$3.39576499956; Batch992.196tokens/US$0.77925. Todos esos recibos tienen coste observado, **no todos los costes**: Google/proveedor de ejecución/cloud/Codex/factura no medidos. Excluye fases anteriores. PrimarioDSNULLINCONCLUYENTE con coste conocido contado una vez; sourcegateKimiFULL50 yDSseguimientoFULL13PASS conservan alcances distintos.

**Historial y límites:** V1FAIL0proveedor y V2FAIL100/77/23/capturas21+2/sinrefund/14marcadores/sólo3old404 permanecen fallidos; femenina6flpq y antigua cadena de auditoría incompleta no reciben verde retroactivo. Causa original500/104sE55 INCONCLUYENTE, aunque recuperación actual esté probada. GETsocket del deploy y UV_HANDLE_CLOSING/exit1 del helperpollNode24 se conservan como tooling: HTTP200/estadoBatch persistidos y completedraw autoritativo, sin resubmit ni causalidadE55. Abiertos fuera de este cierre: semántica de audio no nulo/ruido/música, Googlehumano/correo/Pixel, calidad lingüística/voz, videos largos/MP4/sincronía, precios/pagos/UNKNOWN/reconciliación/restore, Drive y publicación por Rob. Sin Cloud SQL. Historial inferior conserva sus cortes; [informe de integración](docs/reviews/LV-007-cierre-tres-pendientes-2026-11-14.md).
<!-- /LV-007.CLOSE-20261114-WIP -->
<!-- LV-007.STAB-WIP-20261113 -->
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

<!-- LV-007.STAB-20261113 -->
**13nov2026 · LV-007.STAB / LV-017.LOCAL en verificación.** Despacho fuera de HTTP, mantenimiento acotado/aislado y candidata local127.0.0.1:3002 conectada a Firestore/GCS/Jobs existentes. Suite general427/427, tipos/dos compilaciones correctos. Revisión corregida T3, despliegue privado y ensayo completo de navegador/Gemini final todavía pendientes; no declarar aceptado. [Especificación](docs/specs/LV-007-estabilizacion-cliente.md). El500 histórico LV-E55 sigue causalmente INCONCLUYENTE. Sin Cloud SQL ni publicación funcional.
<!-- /LV-007.STAB-20261113 -->

<!-- LV-007.AI-20261113-LOCAL -->
**13nov2026 · LV-007.AI · Conexión técnica privada verificada; producción pública bloqueada.** Video sintético español de20,8s/414.238bytes → cinco resultados textuales ES/EN y dos WAV ingleses: Kore19,2s y Charon17,64s. Tres llamadas reales recibidas una vez,2.328tokens de uso;23 unidades SIMULADAS, sin pago real ni precio comercial de voz. Descargas privadas/Range/HEAD/416, GCS anónimo403, revocación401 y borrado de nueve claves con marcadores vacíos/cuota cero demostrados. [Evidencia y límites](outputs/vistavo-ai-cloud/cloud-evidence-notes.md), [resumen derivado](outputs/vistavo-ai-cloud/cloud-proof.json).

**No fue un recorrido íntegro sin interrupción:** [prueba original FAIL](outputs/vistavo-ai-cloud/cloud-proof-failure.json) tras cuatro controles, al devolver500 el POST de voz femenina después de104s. Reserva posterior con la misma clave, Scheduler y [continuación acotada de siete controles PASS](outputs/vistavo-ai-cloud/cloud-tail-proof.json); original preservado. Causa exacta del500 INCONCLUYENTE y LV-E55 abierto antes de lanzamiento; logging seguro no es arreglo causal. [Candidata final/IAM](outputs/vistavo-ai-cloud/cloud-readback.json) y [equivalencia de procesamiento](outputs/vistavo-ai-cloud/processing-equivalence.json). Dos fixtures Auth y Job/grants de prueba retirados; bootstrap conservada sin claves.

[Verificación final](outputs/vistavo-ai-cloud/test-coverage.json):370/49 generales y94 pruebas únicas de backend, cero omisiones, tipos/dos compilaciones/audit0. T3 conserva los FALLA y candidata DeepSeek INCONCLUYENTE; no verde retroactivo. Gemini batch1794625807-CbTZINnB1JpdjBBGLbuT completó PASS técnico privado; no es aceptación comercial ni de producción pública. Sin aceptación comercial/humana, frontend conectado, render largo, pagos/restore o Drive; Cloud SQL prohibido.

**Cierre técnico privado LV-007.AI.** [Revisión Gemini final](docs/reviews/LV-007-ai-cloud-2026-11-13.md) y [aceptación acotada](outputs/vistavo-ai-cloud/acceptance.json): PASS privado, sin cambio de código de aplicación después de la revisión. [Estado tras limpieza](outputs/vistavo-ai-cloud/post-cleanup-state.json) confirma cuotas/reservas cero, tres Jobs succeeded, tres recibos y tres artefactos purgados/snapshots borrados. [Uso de proveedores](outputs/vistavo-ai-cloud/provider-measurements.json): tres llamadas Google,2.328tokens; factura NO medida. [Contabilidad OpenRouter](outputs/vistavo-ai-cloud/accounting.json): siete respuestas,845.896tokens,US$1.417184554152 observados, sólo revisiones OpenRouter; no incluye factura Google ni coste Codex. [Escaneo posterior](outputs/vistavo-ai-cloud/versionable-secret-scan.json):0 hallazgos sin resolver; dos coincidencias revisadas eran placeholders de documentación. El informe Gemini conserva el snapshot anterior de costes/escaneo; estos recibos posteriores lo actualizan sin modificar código.

**Antes de uso comercial:** LV-E55 sigue ABIERTO con causa del500 INCONCLUYENTE. LV-E56 exige sacar/acotar el despacho esperado dentro de HTTP y validar respuesta tras reserva durable; no se declara causa de LV-E55. Videos mudos/sin habla admitidos pueden terminar UNKNOWN y retener unidades: capacidad no soportada/no aceptada hasta definir rechazo o resultado seguro y sus pruebas. También quedan hardening de staging/cuota, fixtures sin storage/audio, coherencia de hermanos UNKNOWN y guards de status/descarga, con regresiones antes de comercializar. Frontend conectado, producción, calidad humana, render largo, pagos/restore y Drive permanecen bloqueados por sus fases propias.
<!-- /LV-007.AI-20261113-LOCAL -->

<!-- LV-007.GCS-20261113 -->
**13nov2026 · Archivos privados cloud verificados técnicamente.** Firestore, GCS privado y trabajos bajo demanda ya tienen evidencia real: MP4 sintético de145s/290.454.497bytes, dos cuentas, reanudación tras reiniciar API, descarga grande/Range, borrado y UNKNOWN. Se corrigió un índice de colección mal verificado; el ensayo original conserva FALLA24controles y el seguimiento acotado PASS5. No hay Cloud SQL (GET200,0instancias). La web pública continúa como preview; procesamiento IA/pagos/login humano/restore y publicación funcional conservan sus gates. Gemini batch final PASS para esta fase privada. [evidencia y revisión](docs/reviews/LV-007-gcs-cloud-2026-11-13.md).
<!-- /LV-007.GCS-20261113 -->

# Actualización vigente · 13nov2026

Rob aprobó Firestore y procesamiento bajo demanda para el backend. No crear Cloud SQL. La ruta anterior SQL queda sustituida por [LV-007 Firestore](docs/specs/LV-007-firestore-backend.md). Adaptación en curso: persistencia/UID/ledger/proyectos/outbox, después GCS/API/workers y candidata privada con T3/Gemini; publicación y gates funcionales siguen pendientes.

# Plan maestro de Vistavo

## Estado vigente y backend completo · 13 de noviembre de 2026

La marca es Vistavo; vistavo.app publica únicamente la vista previa comercial noindex con el logo A3. Firebase Authentication de producción vistavo-prod tiene Google y correo/contraseña habilitados, pero el login y el procesamiento público no están conectados todavía. La facturación a Billing for Robertson está vinculada y activa por autorización explícita: el bloqueo de asociación por cuota quedó resuelto. Supabase se conserva como integración anterior, sin un proyecto alojado de Vistavo acreditado.

Rob pide auditar todo el backend y este master plan para construir la solución completa en Firebase y Google Cloud. La arquitectura aprobada usa Firebase Hosting/Auth, Firestore, archivos privados en Cloud Storage y Node24/FFmpeg en Cloud Run bajo demanda. Cloud SQL está excluido por Rob. PostgreSQL se conserva como piloto local/referencia. La base privada B1.base ya existe; el backend funcional cloud y sus pruebas siguen pendientes.

El [plan del backend completo](docs/specs/LV-007-backend-completo-firebase.md) organiza inventario/contrato, infraestructura privada, datos/archivos durables, identidad/API, workers/texto/voz/render, calidad y salida controlada. El [inventario de configuración y login](docs/specs/LV-007-configuracion-calidad-2026-11-13.md) distingue código local, configuración remota, evidencia histórica y pendientes. La auditoría cubre todas las superficies previstas; no se declara100% de calidad ni implementación completa por inventariar archivos. DeepSeek/Kimi contrastan el plan y Gemini4Hydrogen batch revisa la versión integrada. Cada informe conserva su alcance y estado real.

Puertas abiertas: loginPC/Pixel y correos reales, cloud durable/backup/restauración, pagos Sandbox/producción separados, renderMP4largoLV-016.D, aceptación de voz inglesa y cobertura lingüística, Drive real, soporte/legales/costes y lanzamiento. Las notas inferiores documentan entregas históricas y no sustituyen este estado.

12nov2026 · Frontend comercial de Vistavo publicado en https://vistavo.app/ como vista previa noindex, diez idiomas y HTTPS comprobado. No equivale a lanzamiento de app: backend/loginE2E/compras/procesamiento/Drive,soporte y aceptación lingüística/indexable conservan sus gates. [Estado y evidencia](docs/specs/LV-005-despliegue-dominio.md).

Vistavo será el primer servicio web B2B de una plataforma que cobra por resultado mediante créditos. El objetivo integrado es que el cliente cargue un video, elija un par origen/destino habilitado y obtenga transcripción, subtítulos traducidos y, si lo elige, voz AI estándar generada desde el texto revisado. El texto cuesta US$0.10/min de video y la voz suma US$0.10/min. La integración avanza por fases: ES→EN es la prueba inicial; los demás pares dependen de LV-004. Render MP4 largo y aceptación cloud permanecen pendientes. Las mismas cuentas, créditos, trabajos y descargas servirán para futuros productos de archivos, como la extracción de datos de PDF.

## Primer lanzamiento

El alojamiento aprobado es Google Cloud para Vistavo: Firebase Hosting/Auth, Firestore, Cloud Run bajo demanda y Cloud Storage privado, con recursos dedicados; sustituye la elección anterior de DigitalOcean. [Preparación, costes y gates cloud](docs/specs/LV-007-vistavo-google-cloud.md). Las recargas aprobadas son US$1 por 10 minutos, US$5 por 50 y US$10 por 100, repartibles entre varios videos. [LV-007](docs/specs/LV-007-candidata-comercial.md#alojamiento-y-paquete-candidato) verifica el servidor y la operación de la oferta.

El registro comercial será abierto con Google o correo y contraseña, con confirmación y recuperación mediante Firebase Authentication propio de LinguistVision. [LV-003](backlog.md#lv-003) verifica la identidad y el aislamiento de cada cuenta. El proyecto de desarrollo `linguistvision-dev` ya está creado y Google fue validado con una cuenta real. El dominio y el proyecto de producción ya existen; falta probar y conectar el acceso definitivo en el backend cloud; [preparación](docs/specs/LV-003-login-produccion.md).

El primer lanzamiento comercial incluye **10 idiomas**, un recorrido web localizado, transcripción y traducción para la cobertura anunciada, descarga de SRT y páginas públicas preparadas para SEO y búsqueda con IA. La interfaz, el idioma hablado y el idioma de salida se tratan por separado. El detalle está en la [especificación LV-001](docs/specs/LV-001-plataforma-multilingue.md).

Los [diez idiomas iniciales](docs/specs/LV-001-propuesta-comercial.md#selección-aprobada-para-la-primera-versión) están aprobados. El catálogo de 30 sirve como inventario de expansión. El objetivo aprobado es que cada idioma se pueda dirigir a los otros nueve: 90 traducciones dirigidas, con disponibilidad y calidad verificadas por separado. El [plan de las 90 direcciones](docs/specs/LV-004-plan-90-direcciones.md) tiene luz verde de implementación privada tras la revisión T3. El usuario confirma variantes, oferta MP4, límites finales y publicación; los tres precios ya están aprobados.

**Orden aprobado.** Completar y verificar la app privada con inglés, español y árabe. Preparar el alcance de diez idiomas por paquete. Retomar la expansión tras publicar y comenzar a monetizar.

El [plan completo del editor](docs/specs/LV-009-plan-del-editor.md) reúne las funciones de CapCut revisadas, el alcance aprobado para la primera versión y la evidencia de cada entrega.

## Orden de ejecución

1. **Base ya probada.** [LV-002](backlog.md#lv-002) verificó Gemini → SRT, [LV-006](backlog.md#lv-006) la reutilización con PDF y [LV-008](backlog.md#lv-008) la edición y exportación. La sincronía del MP4 pasó en el Pixel. El núcleo y los pagos de [LV-003](backlog.md#lv-003) siguen en curso. PayPal Sandbox acreditó en escritorio y falló antes de la aprobación en Android.
2. **Completar el editor en tres idiomas.** Ya pasaron las pruebas locales de [proyectos e importación SRT](backlog.md#lv-009), [pistas y tiempos](backlog.md#lv-010) y [estilos y presets](backlog.md#lv-011). El Pixel importó [LRC y ASS y exportó el resaltado guardado](backlog.md#lv-012). En PC se cotejaron los dos SRT y se verificaron los [controles tipográficos y de posición](backlog.md#lv-013). El pago móvil avanza en paralelo. [LV-014](backlog.md#lv-014) cierra el recorrido en escritorio y teléfono.
3. **Completar el alcance de diez.** Después de LV-014, [LV-004](backlog.md#lv-004) reutiliza el flujo común. Cada idioma aporta mensajes, configuración, muestras y validación. [LV-005](backlog.md#lv-005) verifica en paralelo el contenido y el rastreo de sus rutas.
4. **Publicar y medir.** [LV-007](backlog.md#lv-007) consolida calidad, costes, pagos y operación. El propietario decide la publicación con la evidencia de los diez idiomas.
5. **Ampliar tras monetizar.** Priorizar los siguientes paquetes con compras, uso repetido y demanda observada por idioma.

La [matriz de clientes, usos y mensajes](docs/specs/LV-005-clientes-usos-y-mensajes.md) orienta el contenido comercial y su validación SEO/GEO sin modificar la cobertura aprobada.

Claude Design aportó la propuesta de las tres áreas sobre una base visual reutilizable. El [prompt inicial revisado por T3](docs/specs/LV-005-claude-design-prompt.md) y su [dictamen](docs/specs/LV-005-claude-design-revision.md) conservan el historial; la integración y dirección visual vigentes se registran a continuación.

Actualización 11 de noviembre: el propietario entregó el diseño blanco/sans serif que reemplaza la dirección crema anterior. [Tres áreas integradas y verificadas localmente](docs/specs/LV-005-integracion-claude-design.md), con panel del cliente y backend conservado. Autorizada la [ampliación posterior de perfil e historiales](docs/specs/LV-003-panel-cuenta.md). La revisión física móvil y los gates comerciales siguen abiertos.

La [segunda portada de Claude Design](docs/specs/LV-005-diseno-v2.md) añade ejemplos por etapas, pasos animados, recargas y preguntas buscables. Conserva las tres áreas y los gates comerciales; no habilita nuevas direcciones ni publicación.

Consulta las ventanas orientativas en el [cronograma](gantt.md). El [backlog](backlog.md) mantiene estados y responsables, y las [especificaciones](docs/specs/LV-001-plataforma-multilingue.md) detallan la aceptación.

## Evidencia para publicar

- **Calidad.** Gemini procesa el clip de prueba y se abre el SRT descargado para cotejar texto y tiempos. La candidata comercial supera las pruebas de los diez recorridos y valida cada capacidad anunciada con muestras de referencia. Si se incluye MP4, se comprueba también su reproducción.
- **Costes y operación.** Se mide coste por trabajo exitoso, idioma o par y minuto, incluidos reintentos y almacenamiento. Los resultados sustentan el precio y los límites que apruebe el usuario. En modo de prueba se comprueba el pago, la reserva y consumo únicos, la liberación de créditos ante fallo final y el acceso privado a los archivos.
- **Publicación.** La candidata en Node.js 24 LTS supera las comprobaciones técnicas y el recorrido completo. Las diez rutas públicas pasan la revisión de rastreo, canónicas, `hreflang` y sitemap, y queda lista la medición de indexación, referencias de asistentes y conversiones. Con esa evidencia, el usuario decide si se publica.

## Estudio de ampliaciones · 11 de noviembre

[Archivos grandes, almacenamiento temporal, Drive/Dropbox y voz sintética](docs/specs/LV-007-archivos-destinos-voz.md): análisis solicitado, no alcance comercial aprobado. Preparar carga/cuotas/borrado y medir1/5/10min antes de ampliar límites; estudiar narración en paralelo, con calidad/precio independientes de subtítulos. No cambiar paquetes, activar facturación ni publicar estas funciones por este estudio.

Incremento autorizado de archivos yDrive: [implementado en candidata local](docs/specs/LV-007-archivos-destinos-voz.md#entrega-local--archivos-grandes-y-drive--2026-11-11), con pruebas de volumen/borrado yAPI propiaGoogle habilitada sinfacturación. Guardado real enDrive requiere consentimiento/apertura delpropietario; límites comerciales definitivos, exportación larga ySpaces siguen por validar. No se incluye voz enlosplanes por estaentrega.

12 de noviembre · [LV-015 primer prototipo de voz AI](docs/specs/LV-015-prototipo-voz.md) autorizado: texto sintético20–30s, voz estándar sin clonación, comprobación de pronunciación/duración/coste y narración en video corto. Ensayo privado independiente de Drive; no incorpora voz a paquetes ni autoriza facturación nueva o publicación.

LV-015 generado y verificado técnicamente: Kore femenina20.8s y Charon masculina20.24s aprobadas por escucha del propietario, en español y con el mismo texto. Ambas tienen audio/MP4, revisión automática y coste/proyección1/5/10min documentados. La voz todavía no está integrada ni incluida en la oferta comercial.

El propietario aprueba la muestra femenina Kore y pide una voz femenina y una masculina por idioma como objetivo del servicio. LV-015 amplía ahora el ensayo español con Charon y comparación de costes del mismo texto. Validación de las dos opciones en los otros idiomas e integración siguen pendientes; no cambia el precio de los paquetes ni se declara cobertura por anticipado.

Siguiente prioridad: [LV-016, unir las piezas en la web](docs/specs/LV-016-video-real-es-en.md): contratos/versiones → texto y subtítulos ES→EN → voces inglesas → render MP4 en servidor → interfaz completa → candidata verificada. Objetivo inicial: videos de 2–3 minutos desde PC. Se comienza con fixtures sintéticos; el archivo del propietario no bloquea diseño ni implementación. Drive separado; precio de voz y publicación reservados a Rob.


12 de noviembre · LV-016.A completado: [base de contratos, revisiones y resultados](docs/specs/LV-016-A-contratos.md) implementada y auditada por DeepSeek/Kimi;193 pruebas sin omisiones, tipos/builds y arranque3001 correctos. Todavía sin botones nuevos ni voz/render integrados. Siguiente B: procesamiento ES→EN y revisión/exportación de texto. Drive y gates comerciales independientes.


12 de noviembre · LV-016.B completado técnicamente: [video español→texto ES/EN y TXT/SRT](docs/specs/LV-016-B-texto.md) funciona en candidata privada3001 con revisión/aplicación/guardado/reapertura.232pruebas sin omisiones, tipos/ambas builds y DeepSeek/KimiPASS final. Validado con fixtures120/180s; revisar siempre nombres, medidas y sentido. Habla continua cruzando30s y revisión humana siguen LV-004; no se declara lanzamiento o cobertura universal. Siguiente C: voces estándar inglesas; D/E/F y Drive pendientes.


12 de noviembre · LV-016.C integra técnicamente las voces inglesas estándar Kore/Charon en el ensayo privado: texto guardado→generar→escuchar/descargar WAV, con versiones y storage privado. Corrección por chunks para no colapsar repeticiones; 286pruebas, tipos/builds y revisión técnica DeepSeek/Kimi satisfactorios. [Evidencia C](docs/specs/LV-016-C-voz.md). La aprobación humana inglesa sigue pendiente. D encaje y MP4 largo/E recorrido/F aceptación y Drive siguen separados; no se incorpora voz a paquetes ni se publica.


12 de noviembre · Entrega de ajustes LV-005 ZIP3: medios nuevos, ejemplos de precio coherentes y titulares como borradores, integrados sólo en candidata local. Conserva gates visuales (discontinuidad residual de Inspección), nativos y de publicación. No cambia precios, pares habilitados, saldo ni el estado pendiente de Drive/voz inglesa/render. [Contrato y evidencia](docs/specs/LV-005-diseno-v2.md#incremento-del-zip-recibido-el-12-de-noviembre--alcance-de-esta-sesión).


12 de noviembre · LV-005: corregida la entrega parcial ZIP3 mediante traslado de las nueve áreas de la portada española, panel del cliente y navegación móvil. [Matriz del paquete completo](docs/specs/LV-005-matriz-zip.md) y [contrato](docs/specs/LV-005-zip-completo.md). Candidata local,292pruebas; no equivale a completar las otras nueve portadas, revisión nativa, accesibilidad total ni lanzamiento. LV-016.D y Drive mantienen sus pendientes.


12 de noviembre · LV-005: las nueve portadas restantes ya comparten el diseño ES aprobado en preview noindex, con catálogos completos y adaptación RTL/CJK.306/306pruebas43archivos, tipos/builds y navegador correctos. DeepSeek/Kimi revisaron correcciones independientemente; nativos aún pendientes. [Contrato y evidencia](docs/specs/LV-005-portadas-localizadas.md). Sustituye el pendiente de traslado de layout extranjero de entradas anteriores; conserva revisión nativa, comprobaciones de publicación, renderer release/oferta dinámica, seam Inspección y gates globales. Sin cambios de fechas, capacidades, Drive o LV-016.D.


12 de noviembre de 2026 · Rob eligió Vistavo como nombre comercial, en sustitución de LinguistVision. Decisión registrada en docs/specs/LV-005-marca-vistavo.md. Adaptación de interfaz/metadatos pendiente; disponibilidad de marca/dominio no comprobada. Sin compras, publicación o cambios de identificadores técnicos.



12 de noviembre · Marca Vistavo aplicada localmente a diez portadas y panel; Firebaseprod configurado tras aprobación explícita (Google/correo, Vistavo Web, dominios autorizados), separado de dev.306/306pruebas43archivos, tipos/builds0 y DeepSeek/KimiPASS técnico acotado. [Informe](docs/FIREBASE-VISTAVO-2026-11-12.md). No desplegar ni habilitar billing según última instrucción; pruebas humanas/prodcloud y gates globales pendientes. Sin nueva fecha pública.


13nov2026 · [Auditoría integral del backend](docs/AUDITORIA-BACKEND-VISTAVO-2026-11-13.md): no aceptar producción todavía. Dos reproducciones sintéticas confirman trabajo inline trasTTL y repetición tras fallo de publish/lease; no hubo llamadasIA ni doblecobro real. Bloques de código revisados independientemente por DeepSeek/Kimi con FALLA de preparación cloud. Plan B0–B6 y registro AUD-01–10 condicionan la construcción, sin trasladar ledger a Firestore ni usar Supabase como proveedor vigente. Las pruebas locales no cierran los gates cloud.


## 2026-11-13 · LV-007 · Correcciones y B1.base

Tres fallos de fiabilidad corregidos y aceptados localmente:325/44sinomisiones, instalación limpia/tipos/2builds y T3/Gemini con alcance explícito. B1.base creada y verificada (red/PSA, almacenamiento privado, registro e identidades sin claves); no B1 completo ni backend online. Continúa B1.SQL/IAM/bootstrap/backup, B2GCS/datos/migraciones y B3API/AuthE2E antes de workers y publicación funcional. Informe: docs/reviews/LV-007-base-cloud-2026-11-13.md. No se cambian gates de Drive, voz/render, pagos reales, Pixel o calidad nativa.


## 2026-11-13 · Decisión de persistencia y costo en revisión
Rob cuestiona el costo fijo de Cloud SQL frente a su experiencia de poco gasto con Techos.app. Cloud SQL0 y secreto/grantsSQL inexistentes; no se provisiona mientras se compara y elige. Se conserva la arquitectura PostgreSQL actual como referencia; Firestore es alternativa por evaluar, no migración aprobada. Comparación y gates en docs/specs/LV-007-comparacion-postgres-firestore-2026-11-13.md. B1.base privada permanece creada/verificada y reutilizable; loginFirebase/Hosting/GCS no requieren elegir CloudSQL. La siguiente dependencia de SQL/migrador es la elección informada de Rob tras contraste T3/Gemini; continuar frentes independientes sin borrar recursos o cambiar de proveedor silenciosamente.


## 2026-11-13 · LV-007 · Comparación y prototipo Firestore cerrados localmente

19/19pruebasFirestoresinomisiones,325/44PostgreSQLsinomisiones, tipos2builds correctos. T3detectóclaimhermanoqueuedenUNKNOWN:reproFALLApreservada,fixvalidado19yGeminiBatchfinalPASSscopeprototipo. No backend migrado niSQL/Firestorecloudcreado. Recomendación: adaptaciónFirestoreporfasesparaevitarinstanciaSQLfija; elección remota/cutover pendiente. Login/Hosting/GCSseconservan; jobs poractividad,outboxsinpoll4Hz, medircostos/restore antesdeproducción. Informe docs/reviews/LV-007-firestore-ledger-2026-11-13.md y outputs/vistavo-firestore-prototype.


## 2026-11-13 · LV-007 · Núcleo Firestore y procesamiento bajo demanda, avance local

Rob aprobó Firestore; Cloud SQL prohibido. Nuevo núcleo de cuentasUID/ledger/proyectos/outbox/API/worker, separado del pilotoPG y del experimento19. Matriz REST52/52(41núcleo+11transporte),100carreras2clientes, suitegeneral332/45,ceroomisiones, npmci348/audit0, tipos2builds. T3diseño/candidata/transporte conservaronINCONCLUYENTE/FALLA; Codex integróyprobó. Gemini primerPASS40reabierto porgRPC39/40; controlgRPCfalló2/20 y sepreservó. PreferRestpúblico sinpatchSDK/retrycode3/altgaxglobal; rollbackABORTED, consultasparciales/503/errores3y7 ycommitsconacuseperdido validados. GeminiRESTfinalbatch-1794610269-epEVVKC3qJCXRJpVKDcQPASSLOCAL exacto,no cloud/backendcompleto. Informe docs/reviews/LV-007-firestore-backend-2026-11-13.md.

Sin nuevo recurso/Firestorecloud/SQL/roles/keys/deploy; SQL200/0 ensonda; FirestoreAPIoff/list403noausencia. CloudSQLroles/secretosretiradosdelplan, infraestructuraanteriorpreservada. Piloto3001HTTP200, ADCglobal/otrosproyectosintactos. No commit/push. SiguienteGCS+FirestorecloudIAM/indexes/rules+provider/cotización/artefacto; Sandbox/live separadosantespagos, restore/GooglePCPixel/Drive/calidad pendientes. Aprobaciónvigentepermitecontinuar.

Fase independiente:8respuestasmedidas,337008tokens,US$0.92317678049usage.cost;4solicitudes transporte sinusage son no medido. Sin topeslocales; factura/Google/Codexnomedidos; fasesanterioresexcluidas.

## Estado de LV-019 · 16 nov 2026
LV-019.A cerrado técnicamente y publicado. Ver resumen vigente al inicio de MASTERPLAN.md y evidencia en outputs/vistavo-account-services-20261114. Gemini v5 PASS; Hosting version c5bb31bab5c215e3 readback PASS; QA HTTPS95, navegador y prueba nativa PASS. La sección anterior del intento v3 y la FALLA/UNKNOWN de revisiones directas son historial conservado, no el estado vigente. Próximo: LV-019.B flujo video→transcripción→traducción→TXT/SRT; procesamiento y pagos continúan apagados. El HTTP500 histórico sigue sin causa demostrada.
