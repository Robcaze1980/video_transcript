# Gemini batch · Núcleo Firestore local

Batch batch-1794610269-epEVVKC3qJCXRJpVKDcQ; modelo google/gemini-4-hydrogen-20261112; proveedor Google. Informe estático sobre fuentes y evidencia recibidas; no ejecución independiente ni aceptación cloud.

### Auditoría Independiente (Segunda Revisión Final · Alcance Local / Mitigación REST)

**Alcance y método:** Revisión estática independiente sin ejecución de herramientas sobre el código fuente, configuración, especificación `LV-007` y logs aportados. Este dictamen evalúa exclusivamente el **núcleo local Firestore y la matriz REST en emulador sobre la versión exacta revisada**; **no** aprueba producción, despliegue cloud, resolución del issue upstream del SDK ni backend completo.

---

### 1. Verificación del Núcleo, Runtime y Worker

1. **Factoría hospedada (`server/commercial/firestoreRuntime.ts`):**
   - Configura `initializeFirestore(app, { preferRest: true })` desde la API pública del Admin SDK antes de construir cualquier referencia (`db.collection('vistavo').doc('v1')`).
   - No aplica parches privados al SDK, no habilita `gaxServerStreamingRetries` globalmente y no añade listeners `onSnapshot`.
   - Mantiene la guarda de rechazo para proyectos fuera de `vistavo-prod` / `linguistvision-dev`, emuladores (`FIRESTORE_EMULATOR_HOST`, `FIREBASE_AUTH_EMULATOR_HOST`) y `GOOGLE_APPLICATION_CREDENTIALS`.

2. **Persistencia y ledger (`server/commercial/firestoreBackend.ts`):**
   - Guardas estrictas de entrada y aritmética: `identifier` (UUID v4 hex), `text` (no vacío, `<= 200`), `integer` (`Number.isSafeInteger` con cota `>= 0` o `>= 1`), validación de desbordamiento en `saveProject` (`integer(nextRevision, true)`), `balance` (`credited === available + reserved + consumed`, enteros seguros no negativos) y `unknownCount`.
   - `context()` adquiere cuenta y trabajo antes que input y movimiento terminal; `settle()` exige `!c.terminalExists` y crea el movimiento único `terminal:<jobId>`.
   - `claim()` / `beginInvocation()` / `recover()` / `cancel()` separan `not_started` de `invoking`: antes de autorizar proveedor puede reencolarse o cancelarse liberando saldo; tras `invoking`, expiración o cancelación pasan a `UNKNOWN`, conservando reserva y bloqueando nuevas reservas o claims de hermanos sobre el mismo `inputId` hasta reconciliación interna (`reconcile`).
   - `pendingDispatches()` y `recoverExpiredLeases()` validan límites (`1..100`) y no capturan errores de consulta; cualquier fallo de transporte se propaga.
   - No existe captura genérica de `code: 3` ni reintentos ad hoc en lógica de dominio.

3. **Worker y despacho (`server/commercial/firestoreWorker.ts`):**
   - Todo IO de proveedor (`processor.process`) ocurre fuera de transacciones Firestore.
   - `processOnDemand()` lee el estado durable (`(await backend.job(...)).state`) tanto tras `finish()` como dentro del `catch` después de `quarantine()`, informando el estado persistido real incluso cuando `finish()` devuelve `false` o cuando se pierde el acuse de un commit ya aplicado.
   - Observación menor no bloqueante: `dispatchPending()` incrementa `accepted++` tras `transport.start()` sin comprobar si `acknowledgeDispatch()` devolvió `true`; no afecta la redelivery durable, pero ese contador no debe interpretarse como número de acuses persistidos.

4. **Superficie HTTP y despacho Cloud Run (`firestoreHttp.ts`, `cloudRunDispatch.ts`, `cloudApi.ts`, `cloudDispatcher.ts`):**
   - `firestoreHttp` exige token Bearer y verificación de identidad con `checkRevoked = true` y `email_verified === true`, deriva `accountId` desde `uid` verificado, y no expone rutas cliente de acreditación ni reconciliación.
   - `POST /api/cloud/jobs` responde `503` mientras `quote` no esté integrado (sin GCS/cotización ligada a snapshot/proveedor/artefactos).
   - `cloudRunDispatch` restringe proyecto/región/nombre de job y envía únicamente `VISTAVO_ACCOUNT_ID` y `VISTAVO_JOB_ID`.

---

### 2. Verificación de Matriz REST, Controles y Pruebas Negativas

1. **Matriz emulador (`outputs/vistavo-firestore-backend/tests-rest-final.log` · 52/52, 0 omitidas):**
   - **41 pruebas de núcleo (`firestoreBackend.emulator.mjs`):** incluyen la guarda fail-closed sin emulador dedicado `127.0.0.1:8185`, concurrencia de créditos/reservas/finalizaciones/proyectos/UID, overflow (`MAX_SAFE_INTEGER`), `UNKNOWN` bloqueando hermanos en cola y en ejecución, expiración tardía con reembolso y reglas cliente deny-all (`403`).
   - **11 pruebas de transporte REST (`firestoreTransport.emulator.mjs`) con servidor loopback de fallos sobre emulador real (sin parches al SDK):**
     - Rollback real + HTTP `409 ABORTED` en `batchGet` con transacción abierta: demuestra reintento en transacción nueva con un único efecto durable.
     - Inyección de `code: 3` (`INVALID_ARGUMENT`) y `code: 7` (`PERMISSION_DENIED`): propagan fallo cerrado con `callbacks === 1` sin reintento ni mutación.
     - Interrupción de flujo JSON (`partial-query`, `partial-batch`): exige resultado completo único `['a','b','c']` o error explícito; nunca trunca ni duplica silenciosamente.
     - **100 carreras prefijadas con dos clientes SDK independientes** (`finish` vs `cancel`): ejecutadas con `Promise.all` (cualquier error de transporte haría fallar la prueba), 1 movimiento terminal por trabajo (`movements.size === 2`) y balance conservado.
     - **Commits realmente aplicados en emulador con respuesta cortada (`res.destroy()`):**
       - `credit` y `reserve`: registran honestamente `code: 3` (`{"diagnostic":"lost_credit_reserve","creditResolved":false,"creditCode":3,"reserveResolved":false,"reserveCode":3}`) sin ocultarlo; la prueba comprueba `commitApplied` y demuestra que el replay idempotente conserva 1 recibo, 1 trabajo, 1 outbox y saldo exacto.
       - `beginInvocation`: impide segunda invocación al proveedor.
       - `finish`: lee el estado persistido y reporta `'succeeded'` sin repetir proveedor y con 1 movimiento terminal.
     - **Consultas de recuperación:** `query-denied` (403 -> `code: 7`) propaga en `pendingDispatches`, `recoverExpiredLeases` y `dispatchPending` sin convertirse en `[]`/`0` ni despachar; caso vacío de control devuelve `[]` y `0`; `query-unavailable` (503) recupera snapshot ordenado completo sin duplicados.
   - **Validación de aserciones de error:** Las pruebas únicamente aceptan errores donde el contrato exige fallo cerrado (verificando código exacto en `reject(..., code)` / `e => e.code === 3 | 7`), o para diagnosticar el error de transporte tras un corte simulado de acuse comprobando después idempotencia y estado durable; ninguna captura errores genéricos para dar por buenos efectos monetarios.

2. **Controles preservados y regresión general:**
   - Corrida gRPC previa `tests-hardened.log` (**39/40** con `code: 3`) y control gRPC acotado `grpc-control.json` (**REPRODUCED_ERROR en trial 2/20**, `code: 3`) preservados sin repetir hasta verde.
   - `full-check-rest`: Node `v24.13.0`, `types` = `0`, `tests` (Vitest) = **45 archivos / 332 tests** (incluyendo los 7 guardas de `firestoreRuntime.test.ts` y la regresión PG separada), `build-main` = `0`, `build-editor` = `0`.
   - `npm-ci.log`: 348 paquetes añadidos, 0 vulnerabilidades.

---

### 3. Brechas y Gates Abiertos (No Cubiertos por este PASS)

- **Observación unitaria en `firestoreRuntime.test.ts`:** Prueba los 7 rechazos de entorno/proyecto, pero no verifica mediante spy/mock que `initializeFirestore` reciba `{ preferRest: true }` (verificado aquí por inspección directa de `firestoreRuntime.ts`).
- **Infraestructura e IAM cloud aún inexistentes:** No se han creado recursos, base Firestore cloud, roles IAM (`proposedFirestoreRoles` en `foundation.plan.json` sigue pendiente de validación), claves ni despliegues; Cloud SQL sigue prohibido (`cloudSqlForbidden: true`).
- **Identidad administrada no demostrada:** Rechazar `GOOGLE_APPLICATION_CREDENTIALS` y emuladores en `firestoreRuntime.ts` no demuestra el origen real de ADC ni los permisos mínimos en Cloud Run.
- **Índices compuestos no validados en la nube:** `deploy/google-cloud/firestore.indexes.json` define los índices para `outbox` y `jobs`, pero el emulador no valida su existencia operativa en Cloud Firestore.
- **Dependencia externa pendiente:** `preferRest` no elimina `code: 3` ante pérdida de acuse de commit, no demuestra causalidad RPC inicial de gRPC ni resuelve el issue upstream #9693 ni comportamiento en producción.
- **Backend completo no integrado:** Faltan GCS privado (checksums, cuota, tombstones, limpieza física/TTL), cotización ligada a snapshot, proveedor/artefactos reales, login Google/Firebase real en HTTP, separación estricta de ledgers/namespaces Sandbox vs. Live antes de pagos reales, verificación servidor de captura/catálogo, y prueba de aislamiento en restore.

---

=== RESUMEN FINAL ===
RESULTADO: PASS
EVIDENCIA: Revisión estática de fuentes, config y logs sobre núcleo local/mitigación REST: firestoreRuntime usa initializeFirestore(app,{preferRest:true}) sin parches SDK, sin gaxServerStreamingRetries global y sin onSnapshot; firestoreBackend mantiene guardas ID/overflow/balance, locking cuenta-primero, terminal único y UNKNOWN sin replay; worker lee estado durable tras finish y en catch; matriz emulador REST 52/52 (41 core + 11 transport: rollback+409, code 3/7 sin retry, query/batch parcial, 100 carreras dos clientes sin errores, query 403/503, lost commit acks con replay seguro y diagnostic code 3 visible); controles gRPC 39/40 y 2/20 preservados; full-check-rest types=0, 332/45, 2 builds=0, npm-ci 0 vuln.
NEGATIVOS: No ejecuté pruebas ni despliegues. Este PASS se limita exclusivamente al núcleo local y la matriz REST exacta revisada; no acredita producción, no resuelve el issue upstream #9693, no prueba causalidad gRPC ni aprueba backend completo. firestoreRuntime.test.ts sólo testea rechazos de entorno/proyecto y dispatchPending incrementa accepted aunque acknowledgeDispatch devuelva false.
BLOQUEOS: Gates cloud y de producto abiertos antes de desplegar o cobrar: validar índices compuestos e IAM Firestore en nube; demostrar identidad administrada real en Cloud Run (rechazar env no basta); integrar GCS privado/cotización-snapshot/proveedor/artefactos (hoy /api/cloud/jobs responde 503); validar login Firebase real; separar ledgers/entornos Sandbox y live con verificación servidor antes de pagos; probar aislamiento de restore y maxRetries 0.
=== FIN RESUMEN ===