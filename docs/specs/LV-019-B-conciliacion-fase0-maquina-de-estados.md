# LV-019.B · Conciliación de saldo · Fase 0: máquina de estados (BORRADOR)

**Estado:** documento de diseño del 19 nov 2026. **Sin código ni cambios de saldo.** Es un inventario hecho leyendo `server/commercial/firestoreBackend.ts`, `firestoreAi.ts`, `server/account/backend.ts` y las especificaciones LV-019-B; **no está probado como un todo**: cada fila indica de dónde sale. Plan: [plan de conciliación](../plans/LV-019-B-plan-conciliacion-saldo-2026-11-19.md). La voz sigue cerrada y fuera de alcance.

## 1. Quién es autoridad
- **Cuenta** (`server/account/backend.ts`) es la autoridad del saldo: reserva, sello, admisión por llamada, captura/liberación y su bloqueo (`guard`: `blocked`, `incidentCount`, `epoch`).
- **Video** (`firestoreBackend.ts`) lleva la *intención* de cada operación, los trabajos y la evidencia local. Las dos bases **no comparten transacción**: ninguna transición de Video prueba por sí sola lo que Cuenta hizo.

## 2. Estados por entidad
### 2.1 Cuenta · reserva (`reservations`)
`reserved` → `captured` | `released` (acción terminal, una sola vez por reserva). La admisión por llamada (`callKey`) solo ocurre mientras `reserved`. Captura y liberación se excluyen entre sí. *Fuente:* `account/backend.ts` (reserve ~228, admisión ~264, settle ~309).
> **Corrección del 19 nov (fase 1, lectura de código):** la versión anterior de este párrafo tenía dos errores. (1) «≤600 s» **no es un vencimiento**: `seconds>600` es el máximo de segundos del video (`backend.ts:229`); no existe campo ni lógica de expiración. (2) `sealed` **no es un estado de la reserva**: `sealVideoReservation` (`:204`) crea una *lápida* (`videoReservationTombstones`) solo si la reserva **no existe**, para impedir que se cree después; si la reserva existe devuelve su estado actual sin sellar. Reserva existente + lápida = `invariant()` (`:214`, `:241`).

### 2.2 Cuenta · bloqueo (`guard`, hold)
`sin bloqueo` → `blocked` por incidente (idempotente por incidente; sube `incidentCount` y `epoch`). No existe reapertura automática (reabrir requiere un protocolo auditado distinto). El hold bloquea también capturas y liberaciones; no es la restricción «solo videos nuevos» de la decisión del dueño. *Fuente:* `account/backend.ts` ~169–200.

### 2.3 Video · intención (`billingIntents`)
| Estado | Cómo se llega | Sale hacia |
|---|---|---|
| `reserve_pending` | `beginExternalBillingIntent` (crea intención, testigo de origen y `intentGuard: clear`); un reintento incrementa `attempts` | `job_created`, `release_pending`, `needs_review` |
| `job_created` | `reserve` crea el trabajo (misma transacción que escribe la marca de trabajo) | fin del camino de reserva; el trabajo sigue su vida |
| `release_pending` | `fenceExternalBillingRelease` (solo sin trabajo; desde `reserve_pending`) | `closed`, `needs_review` |
| `closed` | `finishExternalBillingRelease` / observación confirmada | terminal |
| `insufficient` | `settleExternalBillingIntent` | terminal |
| `needs_review` | `recordExternalBillingReview`, observación confirmada con historia incoherente, preservación de incertidumbre | **ninguno automático** (revisión humana o protocolo autorizado) |

*Fuente:* `firestoreBackend.ts` ~630–970 y ~1179.

### 2.4 Video · testigos y recuperación terminal
`billingIntentWitnesses/{intent}` (origen; marcadores `sealPrepared` y `releasePrepared` solo pasan `false→true`); par por acción `billingIntentTerminalWitnesses` (`stage: prepared`) + `billingIntentTerminalRecovery` (`pending`, `generation`, `attempts`, `nextAttemptAt`). `not_found` y `reserved` remotos son **inciertos**: reprogramar y alertar, no sellar ni liberar. *Fuente:* spec de recuperación de testigos; `prepareExternalIntentTerminal` ~728.

### 2.5 Video · colas, incidentes y trabajos
- **Hold outbox** (`billingHoldOutbox`): `pending` → `applied` | `needs_review`; los fallos incrementan `attempts` y mueven `nextAttemptAt`.
- **Outbox de saldo/captura** (`billingOutbox`): `pending` → `retry_wait` → … → `settled` | `needs_review`.
- **Incidentes** (observaciones de intención y similares): ID determinista, solo `needs_review`.
- **Trabajo** (`jobs`): `running`, `succeeded`, `failed`, `cancelled`, `unknown`; `unknown` conserva la reserva. *Fuente:* ~971–1058 y ~1332–1450.

## 3. Invariantes que deben cumplirse (y dónde se comprueban hoy)
| # | Invariante | Estado hoy |
|---|---|---|
| I1 | Una reserva tiene como máximo **una** acción terminal (captura o liberación) | Cuenta lo impone; Video no tiene marca de idempotencia por reserva propia (**hueco → fases 0/1**) |
| I2 | `not_found`/`reserved`/silencio **no** prueban ausencia de efecto: conservar la reserva | Implementado en el lector puntual; falta el consumidor automático (**fase 2**) |
| I3 | Solo se bloquea a una cuenta con **titular original** verificado | Cuenta guarda el titular de la reserva, pero resuelve por el vínculo **actual**; no hay índice histórico ni época (**hueco → fase 1**) |
| I4 | `needs_review` nunca se resuelve solo ni acredita/devuelve a una cuenta supuesta | Cumplido por diseño; faltan cola, dueño y alerta entregable (**fase 2b**) |
| I5 | Toda reserva llega a estado final o a revisión con alerta | **No garantizado:** sin barrido/scheduler autenticado, una intención `reserve_pending` puede quedar eterna (**fase 2**) |
| I6 | Los escritores legados o ciegos respetan el protocolo | Sin verificar; la migración propuesta tiene T3 INCONCLUYENTE (**fase 4**) |

## 4. Transiciones prohibidas (para convertir en pruebas)
- `closed`, `insufficient` o `job_created` → cualquier otro estado.
- `release_pending` cuando ya existe trabajo o marca de trabajo (la cerca debe ver el cambio y devolver `changed`/`job_created`).
- Un segundo movimiento de saldo (captura o liberación) con la misma reserva, venga de un reintento, un ACK duplicado o dos procesos.
- Marcar una cuenta como bloqueada usando solo el vínculo actual de la identidad.
- Pasar de `needs_review` a cerrado sin evidencia verificada y registro auditable.

### 4.1 Añadidas tras la revisión T3 (19 nov; ver [recibo](../evidence/lv019-b-t3-fase0-estados-20261119/RECIBO.md))
- `release_pending` → `reserve_pending` (rebobinar la intención): prohibida. Desde `release_pending` solo se sale a `closed` o `needs_review`.
- Admitir una reserva nueva en una cuenta con `guard.blocked` sin un protocolo de reapertura auditado: prohibido, aunque la época esté vigente. (`blocked` es un guard, no un estado de reserva: la prueba es que la admisión falle cerrada.)
- Resultado remoto incierto (`not_found`/`reserved`/silencio) → liberar o sellar: prohibido; el único destino válido es conservar la reserva, reprogramar y, al agotar el criterio de escalado, `needs_review` con alerta.

### 4.2 Terminalidad y salidas (aclaraciones)
| Estado | ¿Terminal? | Salida |
|---|---|---|
| `closed`, `insufficient`, `job_created` (para el camino de reserva) | sí | ninguna |
| `needs_review` (intención, hold, outbox, incidente) | no, pero sin salida automática | solo revisión humana o protocolo auditado autorizado por el dueño |
| `guard.blocked` | no, sin reapertura automática | protocolo auditado distinto |
| cola agotada (hold/outbox) | no | `needs_review` con alerta (nunca descartar en silencio) |

**Preguntas abiertas nuevas — RESPONDIDAS en §4.3 (fase 1, 19 nov):** qué hace Cuenta cuando una reserva `reserved` vence (≤600 s) sin sello ni confirmación; qué efecto tiene `hold: applied` sobre el estado de la reserva; y si `settled` en el outbox implica «Cuenta capturó» o solo «saldo consistente». Cada una se resuelve leyendo el código en la fase 1, antes de implementar nada.

## 4.3 Fase 1 · respuestas a las tres preguntas abiertas (solo lectura de código; 19 nov)
**P1 · ¿Qué pasa si una reserva `reserved` «vence»?** **Nada: no vence.** No hay TTL, `expiresAt` ni barrido en `account/backend.ts` (búsqueda de `expire|ttl|deadline|timeout`: sin coincidencias). Una reserva `reserved` solo sale por `settleVideo` (`:309`), que exige: reserva `admissionProtocol===2` (`:343`), cuenta **sin hold** (`:345`), y para liberar, **ninguna admisión de proveedor previa** (`:347`; el comentario `:308` dice «release after admission remains closed for manual reconciliation»). Consecuencia: una reserva con llamada ya admitida que no llega a captura, o cualquier reserva de una cuenta con hold, **queda en `reserved` indefinidamente** y retiene saldo y un cupo `active` (`maxActiveVideoReservations`, `:249`). Esto confirma el hueco de I5 y añade el cupo atrapado como efecto visible para el cliente.

**P2 · ¿Qué efecto tiene `hold: applied`?** Solo marca la fila local `billingHoldOutbox` como `applied` (`firestoreBackend.ts:1004–1011`), después de que `drainExternalHolds` llamó a `accountBilling.block` y recibió ACK (`firestoreAi.ts:153–154`); exige que el `billingGuards` local siga `blocked`. **No toca la reserva.** El efecto sobre el saldo viene del hold en Cuenta (`blockVideoBilling`, `:170`), que hace fallar con `conflict` a `reserveVideo` (`:248`), `admitVideoCall` (`:297`) y `settleVideo` (`:345`, captura **y** liberación; solo se devuelve el replay de una reserva ya terminal, `:334–340`). Si el ACK llega pero `markExternalHoldApplied` devuelve false, se llama `recordExternalHoldAckMismatch` (`:155`) → revisión. Los fallos reintentan con espera `min(15 min, 1 s·2^min(n,10))` (`:1024`), sin tope de intentos.

**P3 · ¿Qué significa `settled`?** Es una marca **local de Video** (`billingOutbox.state='settled'`, `firestoreBackend.ts:1398`) escrita por `markExternalBillingSettled` **después** de que `accountBilling.settle` devolvió ACK (`firestoreAi.ts:~255`), y solo si la lectura previa (`captureExternalBillingSettlement`) sigue idéntica dentro de la transacción y el trabajo se clasifica `account_seconds`. Por tanto `settled` = «Cuenta confirmó la acción y Video lo registró»; **no es una prueba independiente** de que Cuenta capturó: es el ACK. Si el ACK llega y la escritura local falla o los datos cambiaron, se pasa a `quarantineExternalBillingOutbox(after_ack)` → `needs_review` (`:1445`), no a `settled`. Lo que `settled` no distingue es *qué* acción se aplicó si el ACK fue un replay (`settled:false`); eso hay que comprobar en la fase 2 contra la reserva terminal de Cuenta.

**Qué cambia en los invariantes:** I5 queda **confirmado como hueco real** (reservas sin salida, no solo intenciones). I1 sigue impuesto por Cuenta (`:334`, `:341`) con el ledger de una sola entrada por acción (`ledgerId([...,action])`, `:352`). Preguntas nuevas, de fase 2 y para el dueño: ¿cómo se libera una reserva con llamada admitida cuyo resultado se desconoce (hoy solo manual)? y ¿quién ejecuta el barrido (los drains existen en `cloudFilesRuntime.ts:61,67` pero el comentario de `firestoreAi.ts:146` dice que falta un scheduler)?

## 5. Casos tipo a cubrir (entrada para las fases 1–4)
1. ACK de liberación perdido **antes** y **después** de aplicarse en Cuenta.
2. Doble ACK con historias distintas: hoy deja una incidencia conservadora y puede bloquear al dueño. *(20 nov: el doble ACK con el historial **intacto** ya se reconoce como la misma liquidación y no bloquea; ver [doble ACK](LV-019-B-doble-ack-liquidacion.md). Este caso, con historias distintas, no cambia.)*
3. El estado de Cuenta cambia durante la consulta (J1/J2 sintético): J2 no debe admitirse con la cuenta en revisión.
4. Caída del proceso entre cualquier par de transacciones (Video y Cuenta no comparten transacción).
5. Dos conciliadores con lease vencido y reloj distinto.
6. Datos legados sin marcador de origen o con forma futura: fallan cerrado.
7. Historias borradas o sustituidas conjuntamente (origen + testigos): límite conocido, requiere detección.
8. Llamada ya enviada al proveedor con resultado incierto: nunca se repite automáticamente.

## 6. Preguntas abiertas para el dueño (no son decisiones técnicas)
- Entrega de la alerta (¿correo, panel, otro?) y quién la atiende.
- Si habrá una ruta de reembolso o corrección manual y qué evidencia exige.
- Cuántos reintentos o cuánto tiempo antes de escalar: **se medirá en la fase 2; no se fija un número aquí.**

## 7. Gate de salida de la fase 0
Cada transición documentada con precondición y efecto en saldo (secciones 2–4), revisión T3 con criterio observable y aprobación del dueño. Sin código.

**Estado del gate (19 nov):** revisión T3 hecha (GLM y DeepSeek, ambos PASS sobre un resumen, sin ver código). Criterio observable que ambos pidieron y que se adopta: cada estado y transición con actor, precondición, terminalidad y reapertura; cada invariante I1–I6 trazable a ≥1 prohibición de la sección 4; ninguna transición sin desenlace. Pendiente: que el dueño apruebe la fase 0. No se ha empezado la fase 1.
