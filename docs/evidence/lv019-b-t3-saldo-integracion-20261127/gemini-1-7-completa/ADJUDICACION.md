# 1.7 · Auditoría completa de Gemini (arquitectura, rendimiento y costo) · 27 nov 2026

Rob la aprobó con tope bajo. Paquete cerrado sin herramientas de 77 KB ([brief.txt](brief.txt)): diseño del ejecutor, el candado de arriendo, seis métodos de `firestoreBackend.ts`, el bloqueo y el desbloqueo de Cuenta, reglas e índices. Modelo `google/gemini-4-hydrogen` (sincrónico), un solo envío, salida limitada a 6000 tokens, razonamiento bajo. [Script](reviewGeminiFull.mjs) · [Informe](report.txt) · [Recibo](receipt.json).

Resultado: `COMPLETED`, `finish_reason=stop`, entrada **23,502** y salida **4,019** tokens, costo real **US$0.0647**. Veredicto del revisor: **INCONCLUYENTE** (le faltaron el manejador HTTP de Cloud Run, las rutas de creación de trabajos y las definiciones de algunas funciones: el paquete era acotado a propósito). Sin defecto de saldo demostrado.

Costo total de Gemini el 27 nov (tres envíos): US$0.0281 + US$0.0366 + US$0.0647 = **US$0.1294**.

## Adjudicación contra el código

| # | Hallazgo | Decisión de Codex |
| --- | --- | --- |
| 1 | `scanDueRows` filtra `nextAttemptAt <= now` en memoria y recorre páginas de 100 de las filas en el estado hasta juntar `limit` o agotarlas, más hasta 200 lecturas de sondeos por página (`firestoreBackend.ts:1854-1887`) | **Confirmado como limitación de rendimiento a escala, no de saldo.** Es una decisión de diseño documentada (igualdad e id: índice automático, sin índice compuesto). Con muchas filas no vencidas en `release_pending` o `reserve_pending`, cada pasada lee todas hasta agotar el presupuesto de 60 s. Hoy las bases reales están vacías. **Registrada como tarea 1.6d**: medir con el benchmark 1 propuesto y decidir entre un índice compuesto `(state, nextAttemptAt)` (requiere autorización de Rob por ser un cambio de nube) o un tope de escaneo. |
| 2 | `dueRows` lee el documento del cursor en cada llamada (`:1845`) | **Aceptada como mejora menor**: una lectura por llamada. |
| 3 | `pendingExternalHolds` ordena por `nextAttemptAt` sin cursor de rotación (`:1891-1897`) | **Hipótesis, no verificada**: `recordExternalHoldFailure` reprograma la fila; falta confirmar que el reintento siempre adelanta `nextAttemptAt` (se revisa en 1.6d). |
| 4 | El candado de arriendo escribe unas 14 a 16 operaciones por pasada de 60 s (cada 5 min) | **Aceptada**: muy por debajo del límite de una escritura por segundo por documento. |
| 5 | `staleScan` podría escanear todo (`:2420`) | **Refutada con el código**: `staleScan` es `where('state','==',estado).orderBy(documentId).limit(limit)` con cursor `after`; está acotada por página y usa el índice automático (`:2537-2542`). |
| 6 | Cloud Run sin estado y solapamiento de Scheduler | **Sin cambio**: el TTL de 90 s del arriendo libera el candado; el solapamiento devuelve `skipped: lease_held`. El manejador HTTP y los tiempos máximos no se verificaron (fuera del paquete). |

Fórmulas de costo por pasada que propuso (arrendamiento, listados y por fila) quedan como punto de partida para los benchmarks; los precios y el costo por trabajo de video **no están verificados** y no se publican como cifras.

## Benchmarks propuestos (para 1.6d, sobre el emulador con datos sintéticos)

1. Saturación de `scanDueRows` con 5 000 filas en estado de espera (98 % no vencidas) frente a 100 % vencidas como control negativo.
2. Dos ejecutores concurrentes más 50 salidas con fallo local tras el ACK de Cuenta, con p50, p95 y p99 de `quarantineExternalBillingOutbox` y la mutación de un documento de historial como control negativo.
3. Escalamiento de `escalateStaleBillingRows` y `resolveExpiredUnknown` con 1 000 filas mixtas y corte a mitad de página.

## Dictamen

**INCONCLUYENTE, sin defecto de saldo.** Una limitación de rendimiento a escala confirmada (1.6d), dos mejoras menores, una hipótesis por verificar y una refutada. Esta auditoría acotada no sustituye medir en Firestore real; el emulador no impone el límite de escritura sostenida ni los índices compuestos.
