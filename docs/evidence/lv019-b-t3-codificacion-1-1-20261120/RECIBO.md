# Recibo · Paso 1.1 · Video usa la liquidación parcial (C2a, etapa 2) · 20 nov 2026

**Veredicto de Codex (certificación final): CERTIFICADO en local**, con los límites del final. Programó T3 (hilo «probe capacidades», cuatro rondas con pruebas primero); revisaron de forma independiente T3 con `~z-ai/glm-flash-latest` y `deepseek/deepseek-v4.1-flash` (ambos respondieron **FALLA** en la primera revisión; se conservan íntegros); Codex ejecutó, mutó, contrastó con el código y corrió la regresión. Todo local: no se desplegó nada ni se tocó una base real.

## Qué cambia

- **`server/commercial/firestoreBackend.ts`:** las filas de salida (`billingOutbox`) llevan `settlementProtocol: 3` (las antiguas se leen como protocolo 1; un campo nuevo sin protocolo 3 es inválido) y, según la acción, `attemptId` (también en la liberación tras admisión), `resolutionKind`, `evidenceSha256` o `capturedSeconds`; cada campo pertenece a una sola acción. `settle` marca `admitted` cuando el trabajo tiene filas `providerCalls` (la admisión durable) y exige resolución; `completeNoSpeech` libera con `no_speech` y el hash del recibo; `reconcile(failed)` libera con `not_delivered` y el hash de la evidencia. `recordExternalBillingFailure`: tope `EXTERNAL_BILLING_ATTEMPT_LIMIT = 8` para todo código permanente (alias `EXTERNAL_BILLING_CONFLICT_ATTEMPT_LIMIT`) → `needs_review` con alerta y **sin bloquear al dueño**; `unavailable` y `too_early` no lo cuentan; `too_early` reprograma `UNKNOWN_RESOLUTION_MIN_AGE_MS` después. `matchesOutboxSnapshot` exige la misma forma de protocolo en **ambos sentidos**.
- **`server/commercial/firestoreAi.ts`:** el drenaje envía a Cuenta el reclamo (`jobId`, `attemptId`) y la resolución; la puerta previa al POST usa la copia estricta (`copyOutboxSnapshot`), que rechaza claves desconocidas.
- **Pruebas:** `firestoreVideoSettlementC2a.emulator.mjs` con **Cuenta real** (21 escenarios, S1 a S20 más S6b) y `firestoreVideoSettlementC2a.test.ts` (10 unitarias); `billingSettlementSnapshotBinding.emulator.mjs` alineado (su ayudante construía a mano una expectativa v1 contra una fila v3); la regresión financiera (`scripts/runFinancialRegressionEmulator.mjs`) incluye el fixture nuevo.

## Evidencia (sobre el código final, copiado del worktree y verificado byte a byte)

| Prueba | Resultado |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| Pruebas unitarias del paso (`firestoreVideoSettlementC2a.test.ts`) | 10/10 (con el candado: 53) |
| Emulador, C2a con Cuenta real | **21/21** (incluye S1: el incidente «sin habla tras admitir» se reproduce y se cierra; S4: una fila v1 y una v3 drenan juntas) |
| Emulador, binding / historias y carreras / persistencia de ACK / carrera de propietario | 22/22 · 14/14 · 3/3 · 1/1 |
| Vitest de `server/commercial` y `server/account` (T3, sin tocar nada más) | 1344 aprobadas, 113 omitidas, 1 fallo preexistente y ajeno (`reviewBrowserNodeFixtures.test.ts`) |
| **Regresión financiera completa (Node 24, manifiesto con hashes)** | **247 pruebas: 242 aprobadas, 5 pausadas de voz (esperadas), 0 fallidas, 0 canceladas** ([resultado](../../../outputs/lv019-b-financial-runs/run-64cda9c6-91ed-4df0-bd3d-7f75a9a2eb9f/result.json)) |
| Mutaciones de T3 | G1 a G5 y las de las rondas anteriores: todas detectadas, archivos restaurados idénticos |
| **Mutaciones propias de Codex (15)** | 13 detectadas, **2 supervivientes**; ver abajo |

Mutantes propios: `admitted` siempre falso, sin comprobar `externalBilling` y sin llamadas; intento liberado solo el vigente; protocolo no 3; `too_early` que cuenta o sin espera; tope con `>` y con `unavailable` incluido; tipo de resolución cambiado en `no_speech` y `not_delivered`; hash de evidencia fijo; el drenador sin reclamo en liberación, con reclamo en liberación simple, sin resolución y con evidencia errónea. (`protocol-not-3` quedó fuera: el texto del mutante no coincidía con el código; lo cubren S4 y S5.)

### Supervivientes

1. **`limit-includes-unavailable`** (el tope también contaría `unavailable`): **real**, ninguna prueba lo detectaba. T3 añadió el escenario S20 (ronda 4): `unavailable` repetido `límite + 4` veces nunca pasa a `needs_review`; luego un único `conflict` sobre esa fila sí pasa (el contador `attempts` cuenta también los `unavailable`, comportamiento vigente y fail-closed, documentado). Codex verificó que S20 **mata** el mutante y que la suite queda 21/21.
2. **`admitted-ignores-external`** (`admitted` sin exigir `externalBilling`, es decir, un trabajo de IA simulado sin facturación externa que falla con llamadas registradas lanzaría `invariant`): no lo detecta la suite C2a, que solo ejerce facturación externa, pero **sí lo mata la regresión financiera completa** (con el mutante aplicado la regresión falla, `FAIL`, y el archivo se restauró idéntico). Queda cubierto por la regresión, no por una prueba propia de la suite nueva; se declara como límite.

## Revisiones independientes y adjudicación

| # | Origen | Hallazgo | Adjudicación |
|---|---|---|---|
| 1 | DeepSeek MEDIA | Una fila `capture` con resolución (o `release` con `capturedSeconds`) validaba y quedaba en `retry_wait` para siempre | **Real, adoptado** (cada campo ligado a su acción en `validOutboxSnapshot`; S13) |
| 2 | DeepSeek/GLM MEDIA | El tope de intentos solo cubría `conflict`; otros códigos permanentes reintentaban sin fin (y a la vez GLM lo ve «prematuro» con otros códigos) | **Adoptado el tope común** (alineado con §4.4 y §5: toda fila llega a terminal o `needs_review` en un número acotado); S14 y S16; `unavailable` exento por ser infraestructura (S20) |
| 3 | DeepSeek MEDIA | La puerta previa al POST ignoraba claves desconocidas | **Real, adoptado** (`copyOutboxSnapshot` también en el drenador; S15, S17) |
| 4 | DeepSeek (a) / GLM ALTA | `settle` puede lanzar `invariant` con llamadas admitidas sin resolución (GLM: por trabajos de voz) | **Parcialmente refutado, documentado:** en el código real solo el texto con facturación externa llega a `admitted` y sus dos llamadores pasan la resolución; los demás caminos están cercados (`finish`/`complete`/`quarantine` exigen `invoking`; `cancel`/`claim` ejecutan `cleanPendingPreprovider`; la voz se rechaza). La guarda se conserva como defensa en profundidad que **falla cerrado** sin mover saldo; S19 la fija |
| 5 | GLM MEDIA | `matchesOutboxSnapshot` no detectaba la reescritura v1→v3 | **Real, adoptado** (ronda 3; pruebas unitarias en ambos sentidos y mutantes G1 a G3) |
| 6 | DeepSeek/GLM MEDIA/BAJA | Huecos de prueba (`matchesOutboxSnapshot` siempre `true` sobrevivía; el valor 8 no se afirmaba; reclamo con `unknownAttemptId`) | **Adoptado:** S16, S18 y las unitarias |

## Límites declarados

- **Nada de esto está desplegado** (puerta G0): el incidente C-5 queda corregido en local y abierto en producción hasta el primer despliegue.
- Cancelación del cliente, plazo de `unknown` y llamador de producción de `reconcile`: paso 1.2 ([diseño](../../specs/LV-019-B-cancelacion-y-unknown-diseno.md)). La voz (fragmentos, captura parcial) llega en C2/C3.
- El contador `attempts` incluye los `unavailable`: tras una caída larga de Cuenta el primer error permanente lleva la fila a `needs_review` de inmediato (fail-closed, con alerta). El tope por edad máxima (48 h) está en el diseño del ejecutor (1.6) y no en este paso.
- `unavailable` no tiene tope de intentos propio: lo acota la edad máxima del ejecutor periódico (1.6).
- `matchesOutboxSnapshot` solo se ejerce de forma determinista por prueba unitaria (el emulador no reescribe el protocolo entre la lectura y el marcado de forma reproducible).
- Un fallo transitorio de transacción en el emulador ya registrado en `errorlogs.md` (tercera aparición) no se reprodujo en esta ronda.
