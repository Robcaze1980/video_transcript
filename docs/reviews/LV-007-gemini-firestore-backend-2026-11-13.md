# Primera revisión Gemini · Histórica

Batch batch-1794608027-BT54FRyNB7pQdbj4IGXb PASS local40 sobre su snapshot original. El gate se reabrió por fallo gRPC posterior39/40. NO aplicar ese PASS a REST o a código posterior. Véase LV-007-gemini-firestore-rest-2026-11-13.md para el cierre actual.

# Auditoría independiente final por batch — LV-007 (Núcleo local y API candidata)

## 1. Alcance y dictamen

Revisión **estática independiente sin herramientas** sobre la especificación `docs/specs/LV-007-firestore-backend.md`, los módulos en `server/commercial/*`, reglas/índices en `deploy/google-cloud/*`, la suite `server/commercial/firestoreBackend.emulator.mjs` y los registros suministrados en `outputs/vistavo-firestore-backend/*`.

- **No ejecuté comandos, compilaciones, pruebas ni consultas remotas**; los resultados de ejecución provienen de la evidencia suministrada en el batch.
- **Dictamen:** **PASS acotado exclusivamente al NÚCLEO LOCAL y API CANDIDATA** (persistencia transaccional en Firestore, outbox/recuperación, fencing del worker bajo demanda y superficie HTTP local `/api/cloud` con `POST /api/cloud/jobs` en 503).
- **Alcance excluido (permanece ABIERTO):** este PASS **no** aprueba ni cierra el backend completo, despliegue en Google Cloud/Cloud Run/Scheduler, Firebase Auth real, IAM, GCS, catálogo/cotización ligada al snapshot, verificación real de pagos, proveedor/artefactos ni protocolo/prueba de restauración en nube.

El piloto PostgreSQL (325/44 pruebas) y los compilados (`types`, `build-main`, `build-editor`) figuran por separado en la evidencia suministrada sin modificaciones reportadas en PG/UI.

---

## 2. Verificación de deltas tras T3 (DeepSeek / Kimi)

Comparando los hallazgos previos de T3 contra el código final suministrado:

1. **Fases `not_started` / `invoking` y recuperación diferenciada (`firestoreBackend.ts`, `firestoreWorker.ts`):**
   - `claim` inicia `invocationPhase: 'not_started'`; `beginInvocation` autoriza de forma durable el paso a `'invoking'` antes de cualquier IO remoto.
   - `recover` y `cancel` distinguen ambas fases: antes de invocar (`not_started`), `recover` reencola (`queued` + `outbox: pending`) y `cancel` libera la reserva (`cancelled`); tras autorizar (`invoking`), ambos pasan a `unknown` sin reejecutar proveedor.
   - **Verificado en código y pruebas #33 y #34.**

2. **Cuarentena inmediata en `heartbeat` expirado (`firestoreBackend.ts`):**
   - Si estado/intento coinciden pero `leaseUntil <= Date.now()`, `heartbeat` ejecuta `this.unknown(tx, c)` y retorna `false`.
   - **Verificado en código y prueba #38.**

3. **Bloqueo efectivo de hermanos `running` bajo `UNKNOWN` (`firestoreBackend.ts`):**
   - `beginInvocation`, `heartbeat` y `finish` comprueban `c.input.unknownCount > 0` y pasan el trabajo a `unknown` (retornando `false`), impidiendo invocar o capturar automáticamente mientras exista otro trabajo `UNKNOWN` sobre el mismo `inputId`.
   - Se mantiene la política de `LV-007` y del núcleo PG: `reconcile` resuelve internamente cada trabajo `unknown` individualmente con evidencia, mientras `unknownCount > 0` sigue bloqueando nuevas reservas, claims y finalizaciones automáticas.
   - **Verificado en código y prueba #35.**

4. **Estado persistido devuelto por el worker y contrato tipado (`firestoreWorker.ts`, `firestoreBackend.ts`):**
   - `processOnDemand` retorna `(await backend.job(...)).state` cuando `finish` liquida, evitando reportar `'succeeded'` si el input caducó o fue borrado antes de `finish` (liquidación `'failed'` con reembolso).
   - `OnDemandProcessor.process` recibe `work: Job` tipado (`operation`, `revision`, `snapshot`, `inputId`, `price`, etc.) y `providerRequestKey` determinista derivado por SHA-256 de `['vistavo:v1', accountId, jobId, requestKey, inputSha256]`.
   - **Verificado en código y prueba #40.**

5. **Superficie HTTP candidata (`firestoreHttp.ts`):**
   - `GET /api/cloud/jobs/:id` redacta el DTO a `{id, inputId, state, price}` sin exponer `snapshot`, `attemptId`, `leaseUntil`, `unknownAttemptId`, `requestKey` ni `inputSha256`.
   - `DELETE /api/cloud/jobs/:id` consulta el trabajo tras `cancel` y responde `{cancelled: value.state === 'cancelled', state: value.state}` (e.g. `{cancelled: false, state: 'unknown'}` cuando ya estaba `invoking`).
   - `POST /api/cloud/jobs` evalúa `priorRequest` antes de `readProject` y `quote`, devolviendo el `jobId` original ante replay incluso si el proyecto se editó o el input caducó después, y sin re-cotizar.
   - `body()` amplía el límite a `400000` bytes para acomodar la expansión JSON de un `draft` válido de 64 KiB.
   - `cloudApi.ts` no inyecta `quote`, manteniendo `POST /api/cloud/jobs` en `503` cerrado por diseño.
   - **Verificado en código y pruebas #37 y #39.**

6. **Runtime administrado y dispatcher one-shot (`firestoreRuntime.ts`, `cloudDispatcher.ts`, `cloudRunDispatch.ts`):**
   - `firestoreRuntime` exige `projectId` explícito (`vistavo-prod` | `linguistvision-dev`) y rechaza `FIRESTORE_EMULATOR_HOST`, `FIREBASE_AUTH_EMULATOR_HOST` y `GOOGLE_APPLICATION_CREDENTIALS`.
   - `cloudDispatcher.ts` ejecuta un único ciclo de `dispatchPending` + `cloudRunDispatch` sin polling residente y sin serializar objetos de error del SDK en logs.

7. **Consulta de outbox e índices (`firestoreBackend.ts`, `deploy/google-cloud/firestore.indexes.json`):**
   - `pendingDispatches` filtra `where('state', '==', 'pending').where('nextAttemptAt', '<=', Date.now()).orderBy('nextAttemptAt')` y descarta leases activos; `firestore.indexes.json` declara los índices compuestos correspondientes para `outbox` y `jobs`.

8. **Orden de bloqueo en `context` y evidencia trazable:**
   - `FirestoreBackend.context` adquiere `[accountRef, jobRef]` en el primer `tx.getAll` antes de leer `inputRef` y `terminalRef`, alineándose con `reserve` y `creditVerifiedPurchase`.
   - `firebaseAccess.ts` completo está incluido y valida `email_verified === true` y longitud de `uid`.
   - `firestoreBackend.emulator.mjs` contiene exactamente 40 pruebas y `outputs/vistavo-firestore-backend/tests-reviewed.log` reporta 40/40 aprobadas (0 fallidas, 0 omitidas), incluyendo la prueba #36 de rechazo REST anónimo (HTTP 403 en GET y PATCH) contra documentos creados por Admin en el emulador.
   - `lock-order-focused.log` reporta 3/3 aprobadas; `types-current.log` está vacío (sin errores); `full-check/check-results.json` reporta `types`, `tests` (325/44), `build-main` y `build-editor` con estado `0`.

---

## 3. Garantías verificadas estáticamente en el núcleo local

- **Invariantes contables:** `credited = available + reserved + consumed`, enteros seguros no negativos, `active <= 3`, recibos deterministas y documento único `movements/terminal:{jobId}` que impide doble liquidación (captura y liberación).
- **Sin IO remoto en callbacks transaccionales:** `processor.process` y `quote` se ejecutan fuera de `db.runTransaction`; los IDs (`jobId`, `attemptId`, `dispatchAttempt`, `receiptId`) se generan antes de las transacciones y `Date.now()` se reevalúa en cada reintento para caducidad.
- **Identidad y proyectos:** `accountForUid` deriva la cuenta del `uid` verificado (`verifiedFirebaseUser`), `body()` usa listas blancas de campos rechazando `accountId` o `price` inyectados, y `saveProject` exige `expectedRevision`.
- **Sin Cloud SQL:** ninguno de los artefactos usa ni referencia Cloud SQL; `remote-preflight.json` refleja `sql: {}` (200) y `firestore.googleapis.com: DISABLED` en `vistavo-prod` (solo lectura).

---

## 4. Observaciones menores y riesgos residuales (no bloqueantes para el núcleo local, requeridos para fases cloud)

1. **Observaciones menores en el código local:**
   - En `firestoreWorker.ts`, `dispatchPending` incrementa `accepted++` sin verificar el booleano devuelto por `acknowledgeDispatch` (métrica menor; no afecta el fencing ni el saldo).
   - En `beginInvocation`, si `c.input.unknownCount > 0`, el trabajo aún `not_started` pasa a `state: 'unknown'` (y `processOnDemand` devuelve `'not_claimed'`) en lugar de permanecer `queued`, lo cual obliga a reconciliar ese trabajo aunque no se autorizó invocación; es conservador y no pierde saldo ni ejecuta proveedor.
   - `firestoreBackend.ts` conserva en la línea 4 el comentario heredado `// Exploration only: deliberately not wired...`.
   - En carreras concurrentes pasadas del emulador se reportaron errores `INVALID_ARGUMENT` / `transaction closed` de causa interna no probada en el emulador; la corrección de orden `account` primero en `context` mantiene la suite actual en 40/40 sin capturar errores para fingir éxito.

2. **Gates abiertos para las siguientes fases (fuera de este PASS):**
   - **Infraestructura GCP y reglas/IAM reales:** `firestore.googleapis.com` está deshabilitado en `vistavo-prod`; no hay pruebas desplegadas de reglas, índices compuestos en servidor, IAM mínimo, OIDC/Scheduler ni entrada de Cloud Run Job ejecutando `processOnDemand` con `VISTAVO_ACCOUNT_ID`/`VISTAVO_JOB_ID`.
   - **HTTP y cotización en Fase 4:** cuando se habilite `quote`, deberá vincularse atómicamente al `snapshot`/revisión y `inputSha256`/generación GCS y versión de catálogo; `cloudRunDispatch` debería incorporar timeout explícito en `fetch`; `dispatchPending` paginación/backoff si crece el backlog.
   - **Pipeline comercial y restauración:** faltan GCS privado (carga/commit/checksum/generación/TTL/purga), verificador real de pagos (PayPal sandbox/live), proveedor externo con consulta de estado para reconciliación operativa, entrega de artefactos, pruebas con dos cuentas reales en nube y prueba/protocolo de restauración sin replay.
   - **Nota de evidencia:** el emulador con Admin SDK no prueba IAM productivo ni Auth real de Google; la prueba #36 verifica únicamente denegación REST anónima local contra `firestore.rules`.

=== RESUMEN FINAL ===
RESULTADO: PASS
EVIDENCIA: Auditoría estática sin herramientas sobre LV-007, server/commercial/*, deploy/google-cloud/* y logs suministrados. Se verifican las correcciones de fases not_started/invoking, cuarentena inmediata en heartbeat expirado, bloqueo de hermanos running por UNKNOWN, retorno del estado persistido en worker con work tipado y providerRequestKey, DTO redacted en GET job, estado real en DELETE job, runtime managed-only sin JSON de credenciales, priorRequest previo a quote, consulta outbox con índice y orden de bloqueo account-primero en context. Logs suministrados: 40/40 en tests-reviewed.log (coincide 1:1 con firestoreBackend.emulator.mjs, incluido 403 REST anónimo), 3/3 en lock-order-focused.log, types-current.log sin errores y full-check con types/325 PG tests/build-main/build-editor en estado 0.
NEGATIVOS: No ejecuté herramientas, pruebas ni consultas remotas. El PASS aplica únicamente al núcleo local y API candidata con POST /api/cloud/jobs en 503; no acredita backend completo, despliegue cloud, IAM, Auth real de Google, reglas/índices en producción, GCS, proveedor, pagos verificados, cotización ligada a snapshot ni restauración cloud. Detalles menores locales: dispatchPending no comprueba el retorno booleano de acknowledgeDispatch para el contador accepted y beginInvocation pone en unknown un trabajo not_started si unknownCount > 0.
BLOQUEOS: Ningún bloqueo reproducible dentro del alcance local acotado. Permanecen abiertos los gates remotos y de pipeline comercial: habilitar y probar Firestore/IAM/reglas/índices/Cloud Run/Scheduler en entorno cloud, implementar entrypoint worker y protocolo restore sin replay, integrar GCS privado, cotización vinculada a snapshot/generación, verificador de pagos, proveedor reconciliable y artefactos.
=== FIN RESUMEN ===