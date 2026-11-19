# Recibo T3 · fase 0 (máquina de estados) · 2026-11-19

Pregunta aprobada por el dueño (resumen agregado sin datos privados, en `prompt.txt`): qué transiciones o estados faltan o son ambiguos, qué transición prohibida añadir y un criterio observable para la fase 0.

Vía: T3 local (`t3 serve`, instancia `linguistvision-openrouter`), cerrado al terminar. Modelos pedidos: `~z-ai/glm-flash-latest` y `deepseek/deepseek-v4.1-flash`; modelo servido, tokens y costo no observables. Respuestas íntegras: `reply-glm.txt`, `reply-deepseek.txt`. Ambos: PASS (opinión sobre un resumen; no vieron código ni probaron nada).

## Se adopta (reflejado en `docs/specs/LV-019-B-conciliacion-fase0-maquina-de-estados.md`, §4.1, §4.2 y §7)
| Sugerencia | Origen | Dónde queda |
|---|---|---|
| Prohibir `release_pending → reserve_pending` | GLM | §4.1 |
| Prohibir admitir reserva nueva en cuenta bloqueada sin reapertura auditada (formulado como guard, no como «estado blocked→reserved») | DeepSeek | §4.1 |
| Incierto → conservar reserva, reprogramar, `needs_review` con alerta | ambos | §4.1 |
| Tabla de terminalidad, salidas y reapertura; cola agotada → `needs_review` | ambos | §4.2 |
| Criterio observable: cada estado/transición con actor, precondición, terminalidad y reapertura; cada invariante trazable a una prohibición | ambos | §7 |

## Queda como pregunta abierta (no se inventa respuesta)
- Qué ocurre cuando una reserva `reserved` vence sin sello; efecto de `hold: applied` sobre la reserva; significado exacto de `settled`. Se leen del código en la fase 1.

## No se adopta
- **Números arbitrarios:** ninguna respuesta propuso topes; no se fija ninguno (se miden en la fase 2).
- **«Tabla con actor» completa ahora:** el documento ya lista estados y transiciones con su fuente; el actor por transición se completa en la fase 1 al leer el código, sin suponerlo.
- Ningún modelo vio código: todo lo anterior son hipótesis que cada fase debe convertir en prueba.
