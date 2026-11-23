# LV-019.B paso 1.3b · ACK durable del solicitante · nota de T3 (23 nov 2026)

**Estado: implementado en el worktree `lv019b/t3-a3-ack`, sin commit; pendiente de certificación de Codex.** No se ha desplegado nada y la ruta HTTP externa sigue cerrada (`enqueueForUid` continúa fail-closed para Cuenta externa).

## Qué se conectó

- `FirestoreAi.enqueue` (`server/commercial/firestoreAi.ts`): antes del POST a Cuenta ejecuta y espera `prepareExternalReserveAttempt`, que relee en una sola transacción los 14 documentos y crea `billingReserveAttempts/{attemptId}`; sin intento guardado no hay POST. Tras un ACK validado, `reserve(...)` recibe `attempt` y `ack`, y el ACK se registra con `attribution:"unverified"` en la misma transacción que crea el trabajo. Si esa transacción falla por cualquier causa (identidad revocada o reasignada, cerca de liberación, fila terminal nueva, error de base), se conserva la observación con `recordExternalReserveAck` y no se crea trabajo.
- `FirestoreBackend` (`server/commercial/firestoreBackend.ts`): `prepareExternalReserveAttempt`, `recordExternalReserveAck`, y `reserve`/`reserveAs` con la ventana de 3.2 comprobada dentro de la transacción del trabajo antes de escribir. `reserve` y `reserveAs` siguen sin crear trabajo a partir de un `status` (`statusSnapshot` devuelve `null`).
- `server/commercial/reserveAttemptWindow.ts` (nuevo): comparación pura de 3.2. Versión exacta (`createTime`/`updateTime`/existencia) para `identity`, `input`, `project`, `origin`, `intentGuard`, `request`, `jobMarker` y las cuatro filas terminales; valor semántico para `intent` (`state`, `inputId`, `operation`, `revision`, `seconds`, `jobId` ausente) y `account` (`aiPilot`, `simulationOnly`); `guard` por ausencia o no bloqueo de la misma cuenta. Una pareja terminal incompleta no es historia limpia.
- `server/commercial/reserveAttemptEvidence.ts`: `stageReserveAck(tx, root, attempt, observed, prepared, ack)` valida la tupla del ACK observado con las mismas reglas que `recordReserveAckInTransaction` (misma copia defensiva, mismo `conflict` si ya existe una observación distinta) y escribe dentro de la transacción ajena.

## Decisiones técnicas

- Perfil persistido: literal v1 histórico `ai-candidate-v1` (`RESERVE_ATTEMPT_PROFILE_V1`). No se acopla al catálogo vivo; `reserveAttemptProfileSentinel.test.ts` falla si `AI_CATALOG_VERSION` deja de coincidir sin migración explícita.
- Identificadores: UUID en minúsculas, como valida el módulo. `attemptId` se genera fuera de la transacción para que los reintentos del SDK conserven el mismo.
- Acceso y retención: sin cambios. `billingReserveAttempts` y `billingReserveAckObservations` siguen cubiertas por la denegación total de `deploy/google-cloud/firestore.rules`; no se añaden a `READABLE_COLLECTIONS` ni al reporte. No se implementa borrado (retención es decisión del dueño).
- Sin tocar `server/account/*`, `cloudFilesRuntime.ts`, `billingDrainSection.ts` ni el drenaje de intenciones de 1.3a.

## Pruebas (resultados reales)

| Suite | Resultado | Evidencia |
| --- | --- | --- |
| `textAccountReserveIdentity.emulator.mjs` (referencia, 13 casos) | **13/13** | `outputs/lv019-b-text-account-reserve-runs/run-a1653210-21e6-4365-8ac8-64a4bce89e6c/fixture.stdout.tap` (reejecución protegida equivalente; el lanzador oficial falla por la unión de `node_modules/tsx`, ver límites) |
| `textAccountReserveAckWindow.emulator.mjs` (propia, 13 casos con Cuenta real de emulador) | **13/13** | `outputs/ackwindow-final2.log` |
| `reserveAttemptWindow.test.ts` + `reserveAttemptEvidence.test.ts` + `reserveAttemptProfileSentinel.test.ts` | **32/32** | ejecución local |
| `reserveAttemptEvidence.emulator.mjs` | **8/8** | `outputs/lv019-b-reserve-evidence-runs/run-70480b91-a409-4d87-aa00-110d72d04995/fixture.stdout.tap` |
| `firestoreAi.emulator.mjs` | 170 pruebas, 166 pasan, 0 fallan, 4 omitidas ya existentes | `outputs/reg13b4/firestoreAi.log` |
| `firestoreA3Exit.emulator.mjs` | **27/27** | `outputs/reg13b4/firestoreA3Exit.log` |
| `firestoreBlocksA.emulator.mjs` | **27/27** | `outputs/reg13b4/firestoreBlocksA.log` |
| `firestoreVideoSettlementC2a.emulator.mjs` | **21/21** | `outputs/reg13b4/firestoreVideoSettlementC2a.log` |
| `billingDirectJobRace.emulator.mjs` | **7/7** | `outputs/reg13b3/billingDirectJobRace.log` |
| `externalReserveReplayRace` / `externalReplayStatusFence` / `externalStatusChangedHistory` | 3/3 · 8/8 · 10/10 | `outputs/reg13b5/` |
| `statusOnlyReserve` / `reservedPollBackoffGreen` / `reservedPollBackoff` | 6/6 · 5/5 · 2/2 | `outputs/reg13b5/` |
| `tsc --noEmit` | limpio | ejecución local |

La suite propia cubre: `active` en las dos bases (3.3), reserva de otro intento con la misma tupla, cada documento inmutable reescrito tras el preflight, identidad revocada antes del POST, trabajo sin ACK atómico, observación conflictiva preexistente, intent reprogramado (no bloquea), saldo de cuenta cambiado (no bloquea), guard bloqueado y guard ausente, dos intentos distintos y una tupla de ACK ajena.

## Mutaciones

`docs/evidence/lv019-b-t3-codificacion-1-3b-20261122/mutaciones/`: `mutate_13b.py` (`run-final.log`, 29 mutantes de la ventana de 3.2) y `mutate_13b_retry.py` (`run-ack-tuple-final.log`, 4 mutantes del ACK). Todas con restauración `try/finally` y hash idéntico (`final restore verified: True`).

- **33 mutantes KILLED, 0 supervivientes efectivos**: 11 documentos inmutables, `createTime`, `updateTime`, existencia, los seis campos del `intent`, fila nula, `aiPilot`, `simulationOnly`, las tres condiciones del `guard`, pareja terminal incompleta, retirada de la comprobación de ventana, retirada del ACK en la transacción, sobrescritura del conflicto de ACK, no crear el ACK y no validar la tupla del ACK.
- `ack-stage-removed` y `window-check-removed` sobreviven a Vitest y solo los mata el emulador: correcto, porque requieren Cuenta y Firestore.
- `doc-*` y la comparación de versiones solo los mata Vitest; `ack-conflict-overwritten`, `ack-not-created` y `ack-tuple-not-validated` los mata la suite unitaria de evidencia.
- Retirada `account-missing-ignored`: la guarda era inalcanzable (el preflight ya rechaza una cuenta ausente); no se reintroduce código muerto.

## Límites y observaciones

- Todo es emulación (Firestore y Cuenta locales): no acredita IAM, Cuenta real, cobro real ni recuperación entre dispositivos. La atribución del ACK es `unverified`; la autenticidad la dará la vía HTTP autenticada entre servicios.
- El lanzador oficial `scripts/runTextAccountReserveIdentityEmulator.mjs` no arranca en este worktree: `repositoryFile` rechaza `node_modules/tsx/package.json` porque es una unión simbólica (`Unsafe tracked file`). La referencia se ejecutó con la misma invocación protegida (guardia de red, `--import tsx`, perfil y temp aislados y las variables fijas del contrato). No se modificó el lanzador.
- `enqueueForUid` externo sigue devolviendo `disabled`; abrir la ruta HTTP es un paso posterior a la certificación y a la revisión T3.
- `reserveWithReserveAck` queda como envoltorio público sin llamadores; el camino real es `enqueue` → `reserve`. Se conserva como superficie explícita para pruebas y para una futura ruta autenticada.
- `billingIntentAdmissionGuard.emulator.mjs`: 14/15. La prueba `a legacy intent missing its guard is not adopted or automatically reconstructed` falla **igual en `HEAD`** (verificado retirando temporalmente el parche con restauración idéntica): espera la intención intacta, pero 1.6c ya la reprograma con `recordExternalBillingIntentStall`. Es una expectativa obsoleta previa a 1.3b, no una regresión de este paso; queda reportada, sin tocar.
- La retención de las dos colecciones privadas sigue pendiente de decisión del dueño; no se implementa borrado.
