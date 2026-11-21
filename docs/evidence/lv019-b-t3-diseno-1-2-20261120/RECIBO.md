# Recibo · Diseño del paso 1.2 (cancelación y trabajos en duda) · 20 nov 2026

Documento revisado: [diseño](../../specs/LV-019-B-cancelacion-y-unknown-diseno.md). Revisiones independientes de T3 con `deepseek/deepseek-v4.1-flash` (`review-1-2-deepseek.txt`) y `~z-ai/glm-flash-latest` (`review-1-2-glm.txt`, modelo servido por el alias dinámico, no observable). **Ambos respondieron FALLA sobre la versión 1**; se conservan íntegros. Codex contrastó cada hallazgo contra el código y reescribió el diseño (v2). Nada se programó ni se ejecutó contra una base real.

| # | Origen | Hallazgo | Adjudicación (verificada contra el código) |
|---|---|---|---|
| D1 | DeepSeek ALTA | §3.1 partía de un hecho falso: los documentos `jobs` no llevan `createdAtMs` (el literal de `reserve` no lo escribe), así que `unknown` ya sale como `unknown_age` y **ya alerta a cualquier edad**; el motivo nuevo `unknown_overdue` duplicaría la alerta, y las alertas de `jobs` nunca se cierran (`terminalStates: null`) | **Real y era un error mío.** Verificado en `firestoreBackend.ts` (literal de `reserve`) y `billingPendingAlerts.ts`. Se elimina el umbral y el motivo nuevo; se declara como límite que la alerta de un `unknown` resuelto no se cierra sola |
| D2 | DeepSeek ALTA | `quarantinedAtMs` corrupto se descartaba en silencio (`NaN` → «aún no vence») | **Adoptado**: validación explícita; inválido → `failed`, fila intacta y reportada |
| D3 | DeepSeek ALTA | La «admisión» de Video no es la de Cuenta (la fila `providerCalls` `intent` se escribe antes de `admit`); el resolvedor enviaría una resolución sin admisión y Cuenta lanzaría `conflict` | **Refutado en el código de Cuenta**: en la primera liberación sin admisión almacenada (`backend.ts`, rama `state==='reserved'`) la afirmación se ignora; el `conflict` que cita solo ocurre en la **repetición** si la resolución almacenada difiere. La premisa de orden (Video escribe la fila antes de `admit`) hace que las filas de Video sean un superconjunto seguro. **Se añade una prueba de divergencia** que lo fija |
| D4 | DeepSeek MEDIA | Cursor por id frente a vencimiento por fecha | **Adoptado**: regla explícita (avanza sobre todas las filas leídas y da la vuelta) y límite declarado |
| D5 | DeepSeek MEDIA | Umbral de 30 min contradice «no hay umbral de edad por defecto» | **Adoptado** (se elimina el umbral con D1) |
| D6 | DeepSeek MEDIA | Pruebas que pasan aunque falle: el límite por cuenta se confunde con el cerrojo por entrada; el `finish` tardío es trivialmente verde | **Adoptado**: entradas distintas; el `finish` tardío se declara estructural (no existe un camino de `unknown` a `running`) y la prueba fija «no cambia nada» sin fingir una carrera |
| G1 | GLM ALTA | `unknownAttemptId` sin validar: con admisión y el intento nulo o no UUID `settle` lanza `invariant` en cada pasada y la reserva queda retenida sin fin | **Real, adoptado**: validación previa; inválido → `failed` y reportado |
| G2 | GLM MEDIA | Una excepción de `settle` por una causa no prevista podría abortar la pasada entera | **Adoptado**: `try/catch` por fila, cuenta `failed`, reintento en la siguiente vuelta |
| G3 | GLM BAJA | Evidencia con el literal `null` cuando no hay admisión | **Adoptado**: formato `none` definido |

## Verdicto de Codex sobre el diseño

**Aceptado como v2 para que T3 lo programe** (pruebas primero), una vez comitado el paso 1.1 que lo precede. La versión 1 queda en el historial de git; este recibo conserva el resultado FALLA y la revisión posterior se hará sobre el código.
