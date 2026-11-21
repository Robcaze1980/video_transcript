# Recibo · Diseño del paso 1.4 (bloqueos y cierres: C-3/E-3, desbloqueo auditado, D-4, A-5/E-4) · 20 nov 2026

Documento revisado: [diseño](../../specs/LV-019-B-bloqueos-y-cierres-diseno.md). El **borrador lo escribió T3** (DeepSeek, solo lectura del código). Revisiones independientes de T3 con `~z-ai/glm-flash-latest` (`review-1-4-glm.txt`; el propio revisor declara que no releyó el código por límite de presupuesto del entorno, así que sus hallazgos se apoyan en el documento) y `deepseek/deepseek-v4.1-flash` (`review-1-4-deepseek.txt`, contrastado con el código): **ambos respondieron FALLA al borrador**; se conservan íntegros. Codex verificó cada hallazgo y reescribió los puntos afectados (v2). Nada se programó ni se ejecutó contra una base real.

| # | Origen | Hallazgo | Adjudicación (verificada contra el código) |
|---|---|---|---|
| 1 | DeepSeek ALTA | Escribir `blocked:false` en Cuenta no desbloquea: el lector de Cuenta (`billingHold`) exige `blocked === true` y lanza `invariant`, con lo que `reserveVideo`, `admitVideoCall` y `settleVideo` quedan inutilizados; el de Video sí tolera `false` | **Real, verificado** en `server/account/backend.ts:44-48` y `firestoreBackend.ts:477-481`. v2: Cuenta **borra el guard** (nunca escribe `false`); prueba directa de que Cuenta funciona de nuevo tras desbloquear |
| 2 | DeepSeek ALTA | El tope de 8 castigaría a `unavailable` (un corte de infraestructura convertiría filas sanas en `needs_review`) | **Real, adoptado:** `unavailable` sigue exento (como en `recordExternalBillingFailure`); prueba 3c |
| 3 | DeepSeek ALTA | Un ACK divergente se traga en silencio: el `catch` del drenaje absorbe el `invalid` y la fila queda `pending` sin incidente ni alerta | **Real, adoptado** (decisión 3b y prueba 3b: nunca se silencia; se registra la incidencia) |
| 4 | DeepSeek ALTA | El orden Video → Cuenta reabre la divergencia si el segundo paso falla | **Real, adoptado:** **Cuenta primero**, en dos fases con estado intermedio; un fallo deja a Video bloqueado (lado conservador) |
| 5 | DeepSeek MEDIA | «Una sola transacción» es imposible reutilizando `recordDisposition`, que no edita filas de facturación | **Real, adoptado:** operación nueva y propia en cuatro fases; `recordDisposition` queda solo para la alerta |
| 6 | DeepSeek MEDIA / GLM MEDIA | «Guard sin incidente» no es derivable: el reporte no lee `billingGuards` | **Real, adoptado:** nueva fuente `guard` en el reporte y alerta por cuenta y época; guard sin hold ni incidencia = `malformed` |
| 7 | DeepSeek MEDIA | Pruebas verdes con el mecanismo roto; faltan ACK divergente, segundo incidente concurrente y desbloqueo con reservas abiertas | **Adoptado** (pruebas 3b, 3c, 11 y 12b ampliadas) |
| 8 | DeepSeek MEDIA | Decisiones del dueño sin marcar (SLA de `needs_review`; migración del campo de época) | **Adoptado** (§6 Decisiones del dueño) |
| 9 | GLM ALTA | Tras un ACK, reintentar reenvía la liquidación y puede duplicar el movimiento; el ACK vive en memoria | **Parcialmente refutado:** Cuenta es idempotente por (reserva, acción) y repetir el POST devuelve el mismo asiento con `settled:false`; no hace falta un estado `ack_received`. Se documenta en la decisión 3c |
| 10 | GLM ALTA | El desbloqueo de Cuenta puede reabrir una divergencia no resuelta (filas `needs_review` vivas en Video) | **Real, adoptado:** fase 0 exige cero filas `needs_review` sin resolver de esa cuenta |
| 11 | GLM MEDIA | La alerta de D-4 depende de un ejecutor que aún no existe (paso 1.6/3.4) | **Ya declarado** (§1.5 y riesgo 3); la dependencia dura del paso 1.6 queda explícita |
| 12 | GLM MEDIA | E-3: la ruta directa no cuenta intentos ni define espera | **Real, adoptado:** se cuenta en `attempts` de la intención con el código `closure_unverified` |
| 13 | GLM MEDIA | El guard no tiene campo de versión para la idempotencia del desbloqueo | **Parcialmente refutado:** lectura y escritura en la misma transacción la serializan; se añade `createdAtMs` a la identidad del desbloqueo (la época vuelve a 1 tras borrar y volver a bloquear) |
| 14 | GLM BAJA | Doble alerta (fila `needs_review` y guard bloqueado) | **Aceptado como comportamiento:** son avisos distintos (cuenta bloqueada frente a fila detenida), deduplicados por clave |

## Verdicto de Codex sobre el diseño

**Aceptado como v2 para programar por partes** (C-3/E-3 y D-4 primero, que no mueven saldo; el desbloqueo y A5 después, con la herramienta de operador). El borrador queda en el historial de git; este recibo conserva el resultado FALLA y la revisión posterior se hará sobre el código. **El desbloqueo no se pone en marcha sin decisión del dueño** (alcance de A5).
