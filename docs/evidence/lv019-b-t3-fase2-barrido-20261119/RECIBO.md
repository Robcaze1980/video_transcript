# Recibo T3 · fase 2 (diseño del barrido y la alerta) · 2026-11-19

Pregunta aprobada por el dueño (resumen agregado sin datos privados, `prompt.txt`): riesgos, huecos e interacciones entre B, C y el bloqueo; prueba adicional; criterio observable de cierre; sin números arbitrarios.

Vía: T3 local (`t3 serve`, instancia `linguistvision-openrouter`), servidor cerrado al terminar. Modelos pedidos: `~z-ai/glm-flash-latest` y `deepseek/deepseek-v4.1-flash`; modelo servido, tokens y costo no observables. Respuestas íntegras: `reply-glm.txt`, `reply-deepseek.txt`. Ambos: PASS (opinión sobre un resumen; no vieron código ni probaron nada).

## Se adopta (reflejado en `docs/specs/LV-019-B-conciliacion-fase2-barrido-diseno.md`, §6.1)
| Sugerencia | Origen | 
|---|---|
| Cursor persistente con orden total y desempate; barridos solapados | ambos |
| Distinguir «bloqueada» de «abandonada» para no alertar en falso | DeepSeek |
| Acción terminal fallida → `needs_review` + alerta (hoy solo reintenta) | GLM |
| Deduplicar C por reserva/motivo/estado; re-alertar al cambiar de estado; revalidar al emitir | ambos |
| Alertar también los fallos del barrido; modo degradado sin A | ambos |
| Pruebas: fallo tras admisión, doble resolución, reinicio a mitad de cursor, soak concurrente | ambos |
| Criterio: ninguna no terminal sin alerta o disposición auditada; una alerta y un registro por fallo; umbral desde la distribución medida | ambos |

## Se adopta con matiz
- «El libro debe cubrir la acción de reconciliación» (DeepSeek): la reconciliación **es** captura o liberación, que ya tienen su entrada de libro (`backend.ts:352`); se deja escrito que no habrá una tercera acción.

## No se adopta / queda abierto
- **Números arbitrarios:** ninguna respuesta propuso topes; no se fija ninguno (se miden con B).
- **«D resuelve bajo bloqueo con anulación auditada»:** es decisión del dueño (§7), no se asume.
- Ningún modelo vio código; los riesgos son hipótesis que cada fase debe convertir en prueba.
