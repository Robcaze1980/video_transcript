# LV-007 · Gemini Hydrogen Batch · Correcciones locales

Batch real batch-1794594686-SkN6WGUjNIg43MGaaqAe; modelo solicitado google/gemini-4-hydrogen:batch, devuelto google/gemini-4-hydrogen-20261112, proveedor Google. Informe completo siguiente. PASS limitado a candidata local325; no aceptación cloud. Contexto/recibos completos privados en LOCALAPPDATA/LinguistVision/t3-review/backend-fixes-20261113; huella y recibo público outputs/vistavo-backend-fixes/gemini-v2-submission.json.

### Auditoría estática final independiente (candidata local `final-v2-snapshot.json`)

Esta auditoría evalúa de forma independiente el código fuente y las evidencias adjuntas de la candidata local actual (snapshot `2026-11-13T18:31:22.318Z`, 44 archivos / 325 pruebas, 0 omisiones). **No** constituye aceptación de entorno cloud ni validación funcional contra infraestructura productiva, PayPal real o Firebase alojado. Los veredictos previos (`baseline`, `candidate`, `revised`) conservan su historial `FALLA`/`INCONCLUYENTE` y no se reinterpretan retroactivamente.

---

#### 1. Comprobación de correcciones núcleo (AUD01 / AUD02 / AUD06)

- **AUD01 (expiración TTL y liberación única):**
  - `CommercialJobs.claim()` invoca `reapExpired()` y exige `i.expires_at > clock_timestamp()`.
  - `runOnce()` vuelve a verificar `expires_at > clock_timestamp()` antes de invocar al adaptador.
  - `finish()` adquiere en orden los bloqueos `account` (`FOR UPDATE`), `inputs` (`FOR UPDATE OF i`) y `jobs` (`FOR UPDATE`) antes de evaluar `terminal` (`CASE WHEN $3='succeeded' AND i.expires_at<=clock_timestamp() THEN 'failed' ELSE $3 END`). Si el insumo expiró durante la espera del bloqueo o ejecución, la publicación pasa a `failed`, borra `result`/`original_result` y libera la reserva exactamente una vez.
  - `reconcileUnknown()` aplica el mismo criterio (`$3='succeeded' AND i.expires_at>clock_timestamp()`): si un resultado verificado expiró tras el TTL, cierra como `failed` con reembolso sin cobrar un entregable no disponible.

- **AUD02 (no repetición ante publicación perdida, lease vencido o cancelación en curso):**
  - `pilotVideo.ts` envuelve `requestSectionTranscription` en `requestCommercialTranscription` y convierte fallos ambiguos en `JobOutcomeUnknown`.
  - `runOnce()` envía a `quarantine()` (`state='unknown'`) ante `AbortSignal`, `JobOutcomeUnknown` o excepción en `publish()`. Cuando `publish()` ya había confirmado `succeeded` antes de perder la respuesta, `quarantine()` (`WHERE state='running'`) no altera el estado final.
  - `reapExpired()` mueve los leases `running` vencidos a `unknown` preservando `unknown_attempt_id` y `quarantined_at`; `enqueue()` impide nuevos trabajos sobre un `input_id` con trabajo `unknown`, y `retry()` solo admite `failed`/`cancelled`.
  - `cancel()` ejecuta `finish(..., 'cancelled')` para `queued` (liberando una vez) y pasa `running` a `unknown` abortando el `AbortController` activo (tests deterministas separados para ambos casos en `backendReliability.integration.test.ts`).
  - `reconcileUnknown()` valida también `artifacts.original` con `Buffer.isBuffer(...)` y rango `[1, 65536]` cuando está definido; el nuevo test verifica el rechazo `invalid_input` sin alterar `unknown`, reserva ni `credit_movements`, seguido de reconciliación válida posterior. Ninguna ruta HTTP de cliente expone `reconcileUnknown()`.

- **AUD06 (checkout con respuesta de creación perdida e idempotencia):**
  - `TestCheckout.createOrder()` bloquea la cuenta, verifica `checkout_orders(account_id, create_request_key)` rechazando discrepancias de `currency`/`amount`/`credits`/`create_return_url` con `conflict`, y confirma la intención local antes de llamar a `payments.createOrder()`.
  - `recoverCreation()` usa `order.id` como referencia idempotente y respeta la ventana de 5 horas y el cerrojo `create_lease`. Los huérfanos legacy sin datos de creación devuelven `unknown` en `status()` y quedan excluidos de `fulfillNext()`.
  - `fulfillNext()` no captura automáticamente si `capture_requested_at IS NULL`, y `applyCompletedCapture()` valida `provider_order_id`, `reference`, `merchantId`, `currency`, `amount` y `captureId`.
  - En cliente (`pilot.js` y `paypalWebPage.js`), `requestKey` e intención pendiente permanecen en `sessionStorage` sin auto-renovación cuando el estado es `unknown`, mostrando `paymentPending` hasta resolución.

---

#### 2. Correcciones secundarias verificadas

- **Migración `0017_reliability.sql`:** Usa `DROP CONSTRAINT IF EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE UNIQUE INDEX IF NOT EXISTS` y `encode(sha256(i.content),'hex')` (función nativa `sha256` de PostgreSQL sobre `bytea`, sin extensiones) condicionada a `j.input_sha256 IS NULL AND i.content IS NOT NULL`. La prueba `upgrades old columns and constraints twice without changing the ledger` valida la ejecución repetida con un trabajo preexistente conservando el saldo.
- **Borrado seguro en `ResumableUploads` / `PrivateFileStore` / `CommercialJobs`:**
  - `abortWithClient` fue retirado; `markDeletingWithClient()` solo marca `state='deleting'` dentro de la transacción.
  - `CommercialJobs.removeTerminalArtifacts()` marca `deleting` y desvincula `inputs`, ejecutando `files.purgeExpired()` solo tras `COMMIT` (`drainDeletes = true`).
  - `abortIncomplete()` exige `state='uploading'` bajo bloqueo, marca `deleting`, confirma la transacción y luego invoca `deleteBytes()`. Si `store.remove()` falla, el estado `deleting` persiste como tombstone durable reteniendo la cuota hasta reintento exitoso de `purgeExpired()`. Validado con pruebas dedicadas de rollback post-marcado y fallo de `unlink`.
- **Apertura segura de rangos HTTP (`sendPrivateVideo`):** Valida el encabezado `Range` y abre mediante `uploads.open(account, input.id, { start, end })` → `get()` (propiedad, expiración, estado `ready`, tamaño y SHA-256) → `store.open(id, range, file.size)` (`lstat` anti-symlink + `O_NOFOLLOW` + comprobación `dev`/`ino` + tamaño exacto) antes de `res.writeHead()`. La prueba en `largeVideoHttp.integration.test.ts` verifica los parámetros exactos de `store.open` y el fallo cerrado `500` JSON antes de emitir cabeceras.
- **Autenticación Firebase y botón Google (`firebaseRoutes.ts`, `accountPages.ts`, `account.css`):**
  - `firebaseRoutes.ts` expone únicamente `/pilot/register/`, `/pilot/sign-in/`, `/pilot/auth/forgot/`, `/pilot/auth/config/`, `/pilot/auth/session/` y `/pilot/auth/logout/`; no existe ruta expuesta de reset propio y la recuperación usa el handler alojado de Google (`sendPasswordResetEmail`).
  - `accountPages.ts` incluye el SVG oficial de 4 colores aportado por el propietario (`aria-hidden="true" focusable="false"`), etiquetas localizadas de acceso/registro en los 10 idiomas y estilos locales en `account.css` sin nuevo GIS. `google-browser-proof.json` registra comprobación local en 1910 px / 388 px (sin desbordamiento horizontal), RTL árabe y foco de teclado.

---

#### 3. Evidencia de compilación y pruebas aportada (no reejecutada)

- `final-v2-snapshot.json` vincula los hashes SHA-256 de los 12 archivos auditados con la corrida de 325 pruebas / 44 archivos / 0 omisiones.
- `check-results.json` reporta `testDatabaseConfigured: true` y código de salida `0` en `types`, `tests`, `build-main` y `build-editor`.
- `tests.log`: `44 passed (44)`, `325 passed (325)`.
- `build-main.log` (58 módulos) y `build-editor.log` (79 módulos): compilaciones limpias.
- `types.log` está vacío (consistente con `tsc --noEmit` sin errores cuando acompaña `status: 0` en `check-results.json`).

---

#### 4. Limitaciones y riesgos futuros fuera del alcance de este delta

- Esta revisión es exclusivamente estática sobre los artefactos entregados; no se ejecutaron herramientas ni pruebas en esta sesión.
- No cubre provisión cloud (SQL, buckets, Cloud Run), PayPal real en producción/sandbox remoto ni flujo E2E contra Firebase Auth alojado (los pagos siguen simulados).
- La conciliación remota de `JobOutcomeUnknown` / `checkout` `unknown` sigue dependiendo de evidencia verificada por operador u observabilidad futura antes de cerrar órdenes ambiguas.

=== RESUMEN FINAL ===
RESULTADO: PASS
EVIDENCIA: PASS limitado a la candidata local (`final-v2-snapshot.json`, hashes SHA-256 de 12 archivos, `check-results.json` con status 0 en types/tests/build-main/build-editor, `tests.log` 44 archivos / 325 pruebas sin omisiones). Se verifican en código y tests los deltas AUD01, AUD02 y AUD06: expiración TTL evaluada tras bloqueos en `finish()` y `reconcileUnknown()` con reembolso único; validación `Buffer.isBuffer` de `original` en `reconcileUnknown()` sin alterar reserva en rechazo; cancelación determinista `queued`→`cancelled` y `running`→`unknown`; conservación de huella SHA-256, `unknown_attempt_id` y `request_key` tras TTL; migración `0017_reliability.sql` idempotente con `sha256` nativo y doble upgrade con job preexistente; checkout sin auto-renovación de `requestKey` en `unknown`; borrado `commit→unlink` con `markDeletingWithClient`, `abortIncomplete` y tombstone `deleting` durable; apertura segura de rangos HTTP vía `uploads.open`→`store.open` (`O_NOFOLLOW`, `dev`/`ino`, tamaño) antes de cabeceras; `firebaseRoutes.ts` sin ruta de reset propia y SVG/CSS oficial local de Google.
NEGATIVOS: Revisión estática sin ejecución propia de comandos, navegador ni pruebas en esta sesión; `types.log` vacío (respaldado solo por `status: 0` en `check-results.json`); pagos simulados (sin PayPal real ni E2E Firebase alojado); sin infraestructura cloud desplegada aún; `google-browser-proof.json` cubre renderizado y teclado local, no autenticación alojada; veredictos históricos baseline/candidate/revised permanecen `FALLA`/`INCONCLUYENTE`.
BLOQUEOS: Ninguno para cerrar las correcciones AUD01/AUD02/AUD06 y secundarias en la candidata local. La aceptación de producción/cloud queda pendiente de provisión GCP, integración real de PayPal/Firebase y E2E en entorno real.
=== FIN RESUMEN ===