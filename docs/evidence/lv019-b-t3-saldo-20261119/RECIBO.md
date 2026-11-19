# Recibo T3 · reserve_pending diferido · 2026-11-19

Pregunta aprobada por Rob: con `reserve_pending` local, status remoto `reserved`, sin job ni recibo y liberación diferida, ¿qué casos dejan saldo reservado para siempre o liberan dos veces? Criterio observable. Máx. 140 palabras; sin UID, claves ni rutas (prompt en `prompt.txt`).

Vía: T3 local (`t3 serve`, instancia `linguistvision-openrouter`). Modelos pedidos: `~z-ai/glm-flash-latest` y `deepseek/deepseek-v4.1-flash`. Modelo efectivamente servido, tokens y costo: no observables en la salida. Respuestas íntegras: `reply-glm.txt`, `reply-deepseek.txt`. Ambos: PASS (opinión; no es evidencia de código).

## Qué se adopta (criterio de aceptación para pruebas futuras)
1. Como máximo un movimiento de liberación por reserva, aunque haya timeout, reintento concurrente o barrido simultáneo (idempotencia por reserva).
2. Toda reserva diferida llega a un estado observable acotado: liberada/reconciliada, o alerta/escalamiento en auditoría tras N intentos o TTL, sin crear movimiento.
3. Un reintento durable sobrevive a un crash (el `nextAttemptAt` persiste).
4. Con remoto `reserved` indefinido, `reserve_pending` es correcto (UNKNOWN conserva reserva); lo que falta es el tope/alerta, no cambiar de estado.

## Qué no se adopta
- Nada que libere automáticamente por inferencia: coincide con el rechazo previo de liberar por evidencia local.
- Son sugerencias de modelos sin ver código; Codex clasifica el resultado como orientativo. Casos 2 y 3 son huecos por verificar en código, no hallazgos probados.
