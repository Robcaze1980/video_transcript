# Recibo T3 · plan de conciliación de saldo · 2026-11-19

Pregunta aprobada por el dueño (resumen agregado sin UID/claves/rutas, en `prompt.txt`): casos que dejarían saldo reservado para siempre, doble liberación/captura o bloqueo de la cuenta equivocada; ¿falta alguna fase u otro orden?; criterio observable por fase.

Vía: T3 local (`t3 serve`, instancia `linguistvision-openrouter`). Modelos pedidos: `~z-ai/glm-flash-latest` y `deepseek/deepseek-v4.1-flash`; modelo servido, tokens y costo no observables. Respuestas íntegras: `reply-glm.txt`, `reply-deepseek.txt`. Ambos: PASS (opinión sobre un resumen; no revisa código ni prueba nada).

## Se adopta (ya reflejado en `docs/plans/LV-019-B-plan-conciliacion-saldo-2026-11-19.md`)
| Sugerencia | Origen | Dónde queda |
|---|---|---|
| Observabilidad/auditoría de reservas huérfanas y ACK ambiguo | ambos | nueva fase 2b |
| Verificar el titular antes de bloquear; no esperar a la fase 3 | DeepSeek | registro del titular original como requisito de la fase 1 |
| Marca de idempotencia por reserva antes de la barrera | DeepSeek | fase 0 (diseño) y prueba concurrente de la fase 1 |
| Repetir pruebas de doble ACK después de las fases | GLM | gate de la fase 4 |
| Criterios: transición documentada con precondición y efecto; prueba concurrente sin doble asiento; cero huérfanas tras migrar; estado final por reserva | ambos | columnas «Gate» del plan |

## No se adopta / queda anotado
- **Números arbitrarios:** ninguna respuesta propuso TTL ni topes concretos, y no se adopta ninguno; el tope de intentos y los tiempos se medirán en la fase 2 con evidencia.
- **Reordenar las fases** (titularidad e idempotencia antes de la barrera): se atiende como requisitos previos dentro de las fases 0 y 1, sin reordenar.
- **«Ruta de reembolso»** (GLM): es decisión comercial del dueño; el plan no acredita ni devuelve dinero automáticamente. Solo queda el registro auditable.
- **«Diagrama aprobado» como criterio de la fase 0** (DeepSeek): se sustituye por «cada transición documentada con precondición y efecto en saldo», que es comprobable.
- Ningún modelo vio código: los casos son hipótesis que cada fase debe convertir en prueba antes de adoptarse.
