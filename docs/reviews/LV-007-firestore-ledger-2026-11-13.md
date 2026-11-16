# LV-007 · Firestore: ensayo financiero local y comparación · 13nov2026

## Resultado

**19/19 pruebas del prototipo Firestore, cero omisiones.** Además, backend actual PostgreSQL325/325en44archivos sin omisiones, tipos y ambas compilaciones correctos. Se probó compra duplicada, reserva concurrente, recibos/request keys incompatibles, captura o liberación única, callback ABORTED repetido, UNKNOWN con varios trabajos, bloqueo de hermano ya encolado, TTL lógico, intento/lease y acceso por cuenta.

Es un módulo experimental aislado en server/commercial/experiments/firestoreLedger.ts; no está conectado a la web, pagos, Auth o workers. Usa emulador oficial1.21.0, Node24.13.0/tsx, Java24, CLI15.19.1 y @google-cloud/firestore9.4.1 reexportado por firebase-admin14.5.0. El informe Gemini llama al SDK firebase-admin/firestore9.4.1; el dato de runtime corresponde a @google-cloud/firestore, no a la versión de firebase-admin.

## Contraste y evidencia

DeepSeek y Kimi revisaron la comparación y luego el código de forma independiente por respaldo OpenRouter autorizado sin herramientas. DeepSeek dio PASS18; Kimi FALLA18 por claim de un hermano ya encolado durante UNKNOWN. Codex reprodujo el fallo en sibling-before.log, agregó guarda después de TTL, declaró metadatos/límite3activos y ejecutó la batería19completa. Gemini Hydrogen Batch final PASS19: batch-1794600851-4SStkN3ru606x24cad1g, modelo google/gemini-4-hydrogen-20261112, proveedor Google. Los dictámenes históricos permanecen; no hay PASS retroactivo de Kimi ni ejecución atribuida a revisores.

La primera comprobación PostgreSQL falló porque el servicio local estaba apagado después de una interrupción; se conservó el log, se arrancó el PostgreSQL dedicado15438 y la nueva corrida completa325/44 pasó sin omisiones. No se relajaron tests ni se tocaron datos de clientes. La candidata3001 fue restaurada y responde200, acceso/cobros simulados y GeminiOff.

Evidencia: outputs/vistavo-firestore-prototype/{tests-first.log,sibling-before.log,tests-final.log,runtime.json,final-snapshot.json,acceptance.json,accounting.json}; suite actual completa en full-check-current/. Respuestas completas privadas: LOCALAPPDATA/LinguistVision/t3-review/{datastore-comparison-20261113,firestore-ledger-20261113}. El emulador valida semántica; sus26.16s no predicen latencia productiva ni factura.

## Recomendación para el costo fijo

El informe aportado de Techos muestra el patrón Firestore/Functions/Run con mínimos0; no aporta factura de30d ni un pipelineFFmpeg. SQLAPIdeshabilitada enTechos no demuestra inventario vacío. Vistavo tiene SQLAPIhabilitada y0instancias verificadas; no se ha creado el alquiler CloudSQL propuesto. No se modificó Techos ni se copiaron sus credenciales/código.

Recomendación de Codex: adaptar porfases a Firestore si Rob prioriza evitar una instancia SQL fija, conservando PostgreSQL local como referencia; la elección/cutover remoto permanece pendiente. Auth/Hosting se conservan, archivos en GCS y procesamiento con CloudRunJobs bajo demanda. Hay212querycallsen7clasesseleccionadas: port sustantivo, no sustitución de una variable ni estimación de horas. El sondeo local4Hz no se lleva a nube; requiere eventos/outbox/dispatchdurable y limpieza propia.

Firestore puede permanecer dentro de cuotas para poco uso, pero este ensayo no acredita menor factura total ni costo0. SQL25.55USD/730h es sólo cómputo; ambas rutas suman almacenamiento/operaciones/transferencia, backups/restore y procesamiento/IA cuando corresponda. Fuentes: [Firestore](https://firebase.google.com/docs/firestore/pricing), [Cloud SQL](https://cloud.google.com/sql/pricing), [mínimos Cloud Run](https://docs.cloud.google.com/run/docs/configuring/min-instances).

## Pendiente antes de una migración

Persistencia completa, identidad/HTTP/IAM/reglas y proveedores reales; cola/reativación trasUNKNOWN; GCS/generaciones/tombstones; expiración/autorización y borrado físico; métricas de consumo; backup/restore y candidata privadaE2E/PC/Pixel. TTL nativo generalmente borra después de vencer y no es garantía de plazo exacto, ni borra subcolecciones automáticamente. No se aceptan producción ni publicación por este ensayo. No se crearon CloudSQL/Firestore alojado ni cambiaron precios/saldos reales.

## Costos observados de comparación y prototipo

5 consultas,180985tokens,US$0.502073382900 usage.cost; sin topes locales. No incluye la fase previa backend-fixes deUS$2.36603468667. Factura, Google y Codex no medidos.

## Informe Gemini completo

# Informe de auditoría final independiente · LV-007 (post-T3)

**Ámbito:** Revisión final del prototipo local de ledger Firestore y de la comparación PostgreSQL vs Firestore para decisión de Rob.  
**Método y alcance de esta sesión:** Auditoría estática independiente **sin herramientas** (sin ejecución propia de Node, Vitest, emulador ni llamadas cloud, y sin escritura directa en disco). No se atribuyen ejecuciones propias ni se alteran los registros históricos de T3 (`tests-first.log`, DeepSeek PASS 18/18, Kimi FALLA 18/18).  
**Frontera de aprobación:** Este dictamen aplica **exclusivamente** al alcance de prototipo local aislado y documento de comparación; **no** aprueba migración completa, cutover, creación de recursos remotos ni salida a producción.

---

## 1. Resolución del defecto bloqueante de T3 y trazabilidad histórica

En T3 original, Kimi detectó un defecto bloqueante (mientras DeepSeek dio PASS sobre 18 pruebas): `reserve()` bloqueaba nuevas reservas cuando `input.unknownCount > 0`, pero `claim()` no comprobaba `unknownCount`, permitiendo que un trabajo hermano ya encolado (`queued`) pasara a `running` mientras otro trabajo del mismo input permanecía en estado `unknown`.

Verificación en los artefactos posteriores:

1. **Reproducción previa al parche (`outputs/vistavo-firestore-prototype/sibling-before.log`):** La prueba `UNKNOWN blocks an already queued sibling until reconciliation` falló como se esperaba antes del ajuste (`tests 1 / pass 0 / fail 1`), devolviendo `{ attemptId, leaseUntil }` en lugar de `null`.
2. **Corrección aplicada (`server/commercial/experiments/firestoreLedger.ts`):** Dentro de `claim()`, tras leer el contexto transaccional y tras la limpieza por TTL/borrado (`if (c.input.deleted || c.input.expiresAtMs <= Date.now()) { this.settle(tx, c, 'failed'); return null; }`), se añadió:
   ```ts
   if (c.input.unknownCount > 0) return null;
   ```
   - La lectura de `input` y `job` ocurre dentro de `context()` antes de cualquier escritura.
   - Si el input venció o fue borrado, el trabajo `queued` se libera (`failed`) sin alterar `unknownCount` (porque `settle()` sólo resta `1` cuando `c.job.state === 'unknown'`), manteniendo intacta la cuarentena de los trabajos `unknown`.
   - Si el input sigue vigente y `unknownCount > 0`, `claim()` retorna `null`: el hermano permanece `queued` con su reserva retenida hasta la reconciliación.
3. **Regresión y batería completa (`outputs/vistavo-firestore-prototype/tests-final.log`):** Reporta `tests 19 / pass 19 / fail 0 / cancelled 0 / skipped 0 / todo 0` en `26163.463 ms`, incluyendo el caso #19 que comprueba el bloqueo en `queued`, la retención de `active: 2` y `reserved: 2`, y el desbloqueo tras `reconcile()`.

Los hallazgos previos de T3 quedan correctamente separados en el historial: el fix no se atribuye retroactivamente al PASS inicial de 18 pruebas.

---

## 2. Verificación de observaciones secundarias de T3

Las observaciones menores señaladas en T3 quedaron atendidas sin ampliar alcance ni debilitar invariantes:

- **Versión de runtime y reproducibilidad:** `runtime.json` y `LV-007-prototipo-firestore-ledger.md` documentan `Node v24.13.0` con loader `tsx`, `Java 24`, `Firebase CLI 15.19.1`, `firebase-admin/firestore 9.4.1` y emulador oficial `1.21.0` (con comando explícito de arranque y test). Se aclara que el "18" previo correspondía al número de pruebas, no a Node 18.
- **Tipado de `Job`:** `quarantinedAtMs?: number` y `reconciliationRef?: string | null` figuran ahora en `type Job` en `firestoreLedger.ts`.
- **Aislamiento y `projectId`:** `createLocalFirestoreLedger` fija `projectId = 'demo-vistavo-ledger'` y `host = '127.0.0.1:8185'`, retorna `projectId` en el objeto de factoría (el SDK instalado no expone getter público tipado `projectId`) y el fixture de `ledger-check.mjs` lo verifica explícitamente junto con la prueba fail-closed sin `FIRESTORE_EMULATOR_HOST` o con host distinto.
- **Límite `active >= 3`:** Queda documentado en `LV-007-prototipo-firestore-ledger.md` como límite técnico heredado del piloto, no como tope monetario.

---

## 3. Auditoría estática de gates del prototipo (`firestoreLedger.ts` y `ledger-check.mjs`)

| Gate | Verificación en código y pruebas | Estado |
|---|---|---|
| Duplicados de compra y conflicto | `creditVerifiedPurchase` usa `receiptId = hash(['paypal:sandbox', captureId])` y `fingerprint`; rechaza `conflict` si cambia cuenta/créditos/importe/merchant; valida ausencia de movimiento previo (`invariant`). | **PASS local** |
| Retry de callback `ABORTED` | Lecturas (`tx.getAll`) preceden a escrituras en todas las transacciones; prueba #15 fuerza error sintético `code: 10` tras callback y verifica crédito único. | **PASS local** |
| Concurrencia en reserva y terminal | `Promise.all`/`allSettled` en pruebas #2, #4, #5, #6, #9, #13; `settle()` exige `!c.terminalExists` y escribe `movements/terminal:<jobId>`. | **PASS local** |
| `requestKey` idempotente / conflicto | `requests/<hash(accountId, requestKey)>` retorna el mismo `jobId` si `fingerprint` coincide y lanza `conflict` si cambia `inputId`/`price`. | **PASS local** |
| Cuarentena `UNKNOWN` y hermanos | `unknown()` incrementa `unknownCount`; `reserve()` rechaza con `conflict`; `claim()` devuelve `null` tras TTL; `reconcile()` exige evidencia no vacía y decrementa `unknownCount` al liquidar. Pruebas #8, #9, #14 y #19. | **PASS local** |
| TTL de input y expiración | `expiresAtMs` validado en `addInput` y revalidado en `reserve`, `claim`, `finish` y `reconcile` (devuelve reserva como `failed` si expiró o fue borrado). Pruebas #10, #11 y #18. | **PASS local** |
| Fencing de intento y lease vencido | `finish()` y `quarantine()` exigen `state === 'running'` y `attemptId` exacto; lease vencido en `finish()` transiciona a `unknown` sin capturar ni liberar. Pruebas #12 y #16. | **PASS local** |
| Ownership y aislamiento | `context()` y `job()` verifican `accountId` del trabajo y del input; namespace UUID aislado por test con limpieza `recursiveDelete` + `terminate`. | **PASS local** |
| Sin IO externo en transacción | Comentario y código libres de llamadas HTTP/Auth/GCS/pagos dentro de `runTransaction`; sólo IO de documentos Firestore. | **PASS local** |
| Invariante de saldo y overflow | `balance()` exige enteros seguros no negativos (`Number.isSafeInteger`) y `credited === available + reserved + consumed`. Prueba #17 valida `NaN`, negativos y `MAX_SAFE_INTEGER`. | **PASS local** |
| Guardas de emulador y reglas | `localOnly` Symbol + comprobación exacta `FIRESTORE_EMULATOR_HOST === '127.0.0.1:8185'`; `firebase.json` en loopback 8185/9185 sin UI; `firestore.rules` deniega todo acceso cliente (`cloudResourcesCreated: false`). | **PASS local** |

---

## 4. Integridad del backend actual y métricas de acoplamiento

- **Aislamiento:** `server/commercial/experiments/firestoreLedger.ts` declara no estar conectado a HTTP, Auth, pagos ni workers; las especificaciones confirman que el backend PostgreSQL actual no fue portado ni modificado por este prototipo.
- **Checks actuales (`outputs/vistavo-firestore-prototype/full-check-current/check-results.json` y `tests.log`):** Con `Node v24.13.0` y `testDatabaseConfigured: true` (tras reiniciar PG local después de la interrupción previa), reportan salida `0` en `types`, `tests` (**44 archivos / 325 tests passed** en Vitest v5.0.5, `11.71s`, sin omisiones ni tests debilitados), `build-main` y `build-editor`. Los 325 tests PG no se contabilizan como cobertura Firestore.
- **Acoplamiento estático (`outputs/vistavo-datastore-comparison/coupling.json`):** `67 + 16 + 36 + 18 + 35 + 15 + 25 = 212` llamadas `query` en 7 archivos seleccionados que importan `pg`. Queda correctamente acotado como señal estática de port significativo, no como inventario total del repositorio ni estimación de horas.

---

## 5. Revisión de la comparación y postura de costos para Rob (`LV-007-comparacion-postgres-firestore-2026-11-13.md`)

- **Cifras verificables y honestidad:**
  - Cloud SQL `g1-small` a `0.035 USD/h × 730 h = 25.55 USD/mes` corresponde **sólo a cómputo** (sin disco ni backups; además `shared-core` de ensayo sin SLA).
  - Firestore Standard (`50k` lecturas / `20k` escrituras / `20k` borrados diarios y `1 GiB` en una base por proyecto) no cubre TTL/PITR/backups/restore ni promete factura `0`.
  - Cloud Run/Functions, GCS, workers FFmpeg, IA/transcripción/traducción/voz y monitoreo siguen siendo cargos aparte en ambas rutas.
- **Separación Techos.app vs Vistavo:**
  - Techos.app (evidencia aportada por otro LLM en solo lectura, sin leer código ni modificar repo ni revisar factura de 30 días): confirma Firestore y Functions/Run sin mínimos positivos observados, con Scheduler/Storage/R2/secretos/Artifact Registry. Que `Cloud SQL API` esté deshabilitada allí no acredita costo `0` ni inventario completo, ni acredita el pipeline FFmpeg.
  - Vistavo: `SQL API` habilitada con listado `200` vacío (`0` instancias SQL, `0` secretos/bases/usuarios SQL creados) y `B1.base` con 27 controles PASS reutilizables en ambas opciones.
- **Advertencia crítica de arquitectura (polling 4 Hz):** El piloto local sondea cada `250 ms` (`4 Hz` = `345,600` ciclos/día/instancia). El documento acierta al señalar que **no debe portarse ese sondeo a Firestore/nube**; la ruta cloud en ambas opciones requiere activación por eventos / outbox / dispatch durable (`Cloud Run jobs`) + limpieza propia y GCS.
- **Recomendación:** La recomendación de explorar una adaptación por fases a Firestore si Rob prioriza evitar el cargo fijo de SQL es coherente con la evidencia local, manteniendo PostgreSQL local como referencia/rollback y sin atribuir ahorro total demostrado. La decisión final de arquitectura remota, cutover y publicación permanece reservada a Rob.

---

## 6. Negativos y bloqueos abiertos

- **Lo que este PASS no cubre:** Semántica de emulador ≠ producción (sin contención real, latencia de red, TTL físico no instantáneo de hasta ~24 h ni borrado automático de subcolecciones); sin prueba de Auth HTTP real, reglas de seguridad de cliente para datos reales, IAM, PITR, backups o restore; sin idempotencia integrada de PayPal/proveedores reales; sin workers, outbox/dispatch, subidas/tombstones GCS, texto, voz ni pipeline FFmpeg; sin medición real de operaciones o factura de 30 días.
- **Bloqueos antes de cualquier migración o producción:** Decisión expresa de Rob; falta de métricas reales de consumo/costo de Vistavo (y sin factura de Techos); diseño e implementación de cola basada en eventos/outbox (eliminando polling 4 Hz en nube), reactivación tras `UNKNOWN`, retención/limpieza GCS, pruebas de restore y pruebas integradas end-to-end en fase privada antes de evaluar cualquier cutover.

=== RESUMEN FINAL ===
RESULTADO: PASS
EVIDENCIA: Auditoría estática sin herramientas ni ejecuciones propias de firestoreLedger.ts, ledger-check.mjs, firebase.json, firestore.rules, runtime.json, sibling-before.log, tests-final.log (19/19 pass, 0 fail, 0 skip, 26163.463 ms), full-check-current (types, 44 archivos/325 tests PG, build-main, build-editor en status 0), coupling.json (212 query calls en 7 archivos) y docs LV-007. Verificado el fix de Kimi en claim() (guarda unknownCount > 0 tras limpieza por TTL/borrado), reproducido antes (sibling-before.log) y cubierto por el test #19 sin debilitar pruebas ni modificar logs históricos T3. Verificados invariantes del ledger local (idempotencia compra/request, retry ABORTED, terminal único, UNKNOWN/cuarentena, lease fencing, ownership, overflow y fallo cerrado loopback 127.0.0.1:8185 / demo-vistavo-ledger) y consistencia de la comparación SQL (25.55 USD sólo cómputo) vs Firestore.
NEGATIVOS: Alcance estrictamente acotado al prototipo local aislado y documento de comparación; no aprueba full port, migración ni producción. Emulador no acredita contención real, TTL físico (~24h, sin subcolecciones), PITR, backups ni restore. Sin Auth HTTP real, reglas cliente ejercitadas, IAM, idempotencia de proveedor real, outbox/dispatch, GCS/tombstones, FFmpeg ni factura de 30 días o ahorro total demostrado (Cloud SQL API deshabilitada en Techos no prueba costo 0). Los 325 tests PG no cubren Firestore y coupling.json (212 calls) no estima horas ni cubre todo el repo.
BLOQUEOS: Decisión remota, cutover y publicación reservadas exclusivamente a Rob. Faltan métricas de consumo real de Vistavo, plan/ensayo de restore y diseño de cola/dispatch sin sondeo 4 Hz en nube; fases posteriores (proyectos/metadatos, cola/leases/texto/voz/retención, GCS, candidata Firebase privada y pruebas humanas) no iniciadas.
=== FIN RESUMEN ===
