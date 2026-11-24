# Recibo T3 · corrección de los selectores de la cola de saldo · 20 nov 2026

Alcance: cambio local en [`firestoreBackend.ts`](../../../server/commercial/firestoreBackend.ts) (`dueRows`, `interleave`, `pendingExternalBillingIntents`, `pendingExternalBilling`). No toca la nube, no escribe datos, no mueve saldo.

Vía: T3 local (`~/.t3/bin/t3.cmd`, instancia `linguistvision-openrouter`), un solo prompt con el código completo de las tres piezas ([`prompt-a.txt`](prompt-a.txt), 428 palabras, sin truncar). Modelos pedidos: `~z-ai/glm-flash-latest` y `deepseek/deepseek-v4.1-flash`. El modelo efectivamente servido no es observable en la respuesta; se registra el alias pedido. Costo y uso real: no observables desde el CLI; no se supone ninguno.

| Revisor | Respuesta | Resultado declarado | Clasificación de Codex |
| --- | --- | --- | --- |
| GLM Flash Latest | [`reply-a-glm.txt`](reply-a-glm.txt) | PASS | PASS con una observación de costo |
| DeepSeek v4.1 Flash | [`reply-a-deepseek.txt`](reply-a-deepseek.txt) | PASS | PASS con tres observaciones, ninguna bloqueante |

Observaciones y decisión de Codex:

1. **Costo no acotado (ambos).** Con un estado grande y pocas filas vencidas, cada llamada recorre todo el estado en páginas de 100. Es cierto: antes el techo era 100 lecturas por tipo; ahora es el tamaño del estado. Se mantiene a propósito, porque un tope de páginas reintroduciría filas ocultas, que es el incidente que se corrige. Hoy las colas reales están vacías (lectura 1C del 19 nov), así que el costo real es cero. Queda documentado como límite; la salida limpia es un índice compuesto `(state, nextAttemptAt)` más la migración de fechas ausentes, que necesita autorización expresa del dueño. No se adoptó el filtro por rango que sugirió GLM: dejaría fuera las filas sin fecha que hoy cuentan como vencidas.
2. **Desperdicio ~2× (DeepSeek).** Cada parte lee hasta `limit` filas y `interleave` aprovecha cerca de la mitad de cada una. Es un costo de lectura, no de corrección. Se acepta.
3. **Cambio de orden de fecha a id (DeepSeek).** Intencional; los consumidores revalidan cada fila en transacción. Sin dependencia de orden por fecha encontrada en el código.

Pruebas citadas por el prompt y ejecutadas aparte: 13 unitarias de [`billingSelection.test.ts`](../../../server/commercial/billingSelection.test.ts) con sus mutaciones, la comprobación contra el emulador real y la regresión financiera (ver bitácora del 20 nov).
