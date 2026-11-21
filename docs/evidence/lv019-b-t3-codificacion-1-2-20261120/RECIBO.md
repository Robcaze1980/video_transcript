# Recibo · Paso 1.2 · Trabajos en duda (`unknown`): resolvedor con plazo (texto) · 21 nov 2026

**Veredicto de Codex (certificación final): CERTIFICADO en local para texto**, con los límites del final. Programó T3 (hilo «1.2 cancelacion y unknown», pruebas primero, implementación y una ronda de correcciones); revisaron de forma independiente T3 con `~z-ai/glm-flash-latest` y `deepseek/deepseek-v4.1-flash` (**ambos respondieron FALLA** a la primera versión; se conservan íntegros); Codex reejecutó las pruebas, la regresión y 14 mutaciones propias. Todo local; nada desplegado.

## Qué cambia

`FirestoreBackend.resolveExpiredUnknown({now, limit, after?})` libera los trabajos de **texto** en `unknown` cuyo plazo (`UNKNOWN_REVIEW_WINDOW_MS` = 6 h, mayor que el piso de 15 min de Cuenta) ya venció: **nunca captura**; con admisión (filas `providerCalls`) envía la liberación con la resolución `unknown_expired` y su evidencia (`unknown_expired:v1:{jobId}:{intento|none}:{quarantinedAtMs}`, SHA-256), sin admisión libera de forma simple; cada fila va en su propia transacción y su propio `try/catch`; el reloj es el `now` inyectado; el cursor avanza sobre todas las filas leídas y da la vuelta (kind `unknown` añadido al candado). Validaciones previas al vencimiento: `quarantinedAtMs` entero seguro ≥ 0 y no futuro más allá de 10 min; `unknownAttemptId` UUID cuando hay admisión. La fila queda `failed` con `resolvedAs: 'unknown_expired'` y el artefacto va a `purging`. Funciones puras exportadas: `classifyUnknownQuarantine` y `unknownExpiredEvidence`.

## Evidencia

| Prueba | Resultado |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| Unitarias (resolvedor, candado, control de drenajes) | 68/68 |
| Emulador del resolvedor con Cuenta real (cancelación antes y después del envío, plazo exacto, liberación con y sin admisión, divergencia de admisión, carreras, cursor, alerta `unknown_age`, voz intacta) y del candado | todo verde (22 + 11) |
| **Regresión financiera completa (Node 24), ya con las suites del resolvedor y del control de drenajes incluidas** | **281 pruebas: 276 aprobadas, 5 pausadas de voz, 0 fallidas** ([resultado](../../../outputs/lv019-b-financial-runs/run-907c8b56-b66b-4688-b791-a38fd3c28a94/result.json)) |
| Mutaciones de T3 | todas detectadas, 0 supervivientes |
| **Mutaciones propias de Codex (14)** | **13 detectadas, 1 superviviente** (`state-recheck-removed`: **equivalente**; la comprobación repetida del estado tras `context()` es redundante con la lectura anterior dentro de la misma transacción) |

## Revisiones independientes y adjudicación

| # | Origen | Hallazgo | Adjudicación |
|---|---|---|---|
| 1 | DeepSeek ALTA / GLM ALTA | El resolvedor no excluye los trabajos de **voz**: los liberaría con K = 0 aunque la política del dueño cobre lo entregado | **Real, adoptado:** un `narration:*` en `unknown` no es elegible (cuenta `notDue`, intacto); prueba de emulador; la voz queda para C2/C3 |
| 2 | DeepSeek ALTA | Una fila corrupta queda `failed` para siempre y retiene saldo sin fin | **Límite declarado:** la alerta `unknown_age` del barrido ya la reporta a cualquier edad y la salida es `reconcile` manual (herramienta de operador, A5); no se añade autoreparación |
| 3 | DeepSeek MEDIA | `windowMs` solo tenía cota inferior (un valor enorme dejaría todo `not_due`) | **Real, adoptado:** solo puede acortar la ventana, `[1000, 6 h]`; pruebas con NaN, Infinity, máximo seguro, 0 y negativos |
| 4 | DeepSeek MEDIA | `classifyUnknownQuarantine` no validaba `windowMs`/`skewMs` (NaN) | **Real, adoptado:** ambos validados (`skewMs` en `[0, 1 h]`); la función pura lanza `invalid` |
| 5 | DeepSeek MEDIA | `admitted` deriva de cualquier fila `providerCalls` sin comprobar el intento | **Límite declarado:** una fila huérfana la cierra Cuenta con `conflict` → `needs_review` con la reserva retenida y alerta (cierra hacia el lado seguro) |
| 6 | DeepSeek BAJA | Pruebas con fila corrupta débiles; faltan voz y cota superior | **Adoptado** (escenario de voz y cotas) |
| 7 | GLM ALTA | `settle` puede capturar o fallar con `unknownAttemptId` inválido | **Refutado/ya cubierto:** `settle` no captura en `failed`; el intento inválido con admisión se rechaza antes por la validación (`failed`, fila intacta) |
| 8 | GLM varios | Sesgo de 10 min pequeño; doble escritura `resolvedAs`/`reconciliationRef`; cursor; `reconcile` concurrente; `context(…, true)` carga recibos | **Verificado sin defecto:** la doble escritura es atómica en una transacción; el cursor avanza sobre todas las filas; la carrera con `reconcile` y la de dos resolvedores terminan en `skipped`; los recibos se cargan (el escenario con admisión pasa) |

## Límites declarados

- Solo **texto**. La voz (cálculo de K por fragmentos, política de recuperación) llega en C2/C3; hasta entonces un trabajo de voz en `unknown` no lo toca este resolvedor.
- Una fila corrupta se reporta (`unknown_age`) pero no se autorrepara; la alerta de un `unknown` ya resuelto sigue abierta (jobs sin conjunto terminal verificable).
- Nada lo ejecuta todavía: el resolvedor se programa como sección del ejecutor periódico (paso 1.6b, segunda parte, en curso).
- `windowMs` y `skewMs` son solo de prueba, acotados y nunca pasados por producción ni alcanzables por HTTP.
