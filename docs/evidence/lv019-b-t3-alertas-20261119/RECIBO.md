# Recibo T3 · alertas durables (pieza C) · 2026-11-19

Código revisado: `server/commercial/billingPendingAlerts.ts` y su prueba. Vía: T3 local (instancia `linguistvision-openrouter`), servidor cerrado tras cada ronda. Modelos pedidos: `~z-ai/glm-flash-latest` y `deepseek/deepseek-v4.1-flash`; modelo servido, tokens y costo no observables. Se conservan todas las respuestas originales, también las FALLA.

| Ronda | Entrada | GLM | DeepSeek | Qué se hizo |
|---|---|---|---|---|
| 1 | `prompt.txt` (archivo completo) | INCONCLUYENTE (dijo no recibir el código) | **FALLA**: la fila se leía fuera de la transacción al cerrar (TOCTOU); reabrir una alerta cerrada borraba su historia; faltaban pruebas de intercalado, reapertura y paginación | Se lee la fila dentro de la transacción; la reapertura conserva `reopenCount` y `previousClearedAtMs`; 3 pruebas nuevas |
| 2 | `prompt-2.txt` | INCONCLUYENTE (vio un fragmento) | **FALLA**: alertas viejas que quedan abiertas para siempre si la fila sigue reportada con otro estado/motivo; cierre sin validar clave↔contenido; `kept` mezclaba causas | Estado `superseded` (solo con sucesora abierta), validación de forma, resultado separado `cleared/superseded/kept/unverified/raced/corrupt` |
| 3 | `prompt-3*.txt` | **FALLA**: la sucesora no se validaba (forma/clave) | INCONCLUYENTE (el mensaje llegó truncado) | La sucesora debe ser una alerta abierta, bien formada y exacta para esa fila, estado y motivo |
| 4 | `prompt-4.txt` (fragmento) | PASS | **FALLA**: el estado de la fila se decidía con el reporte, fuera de la transacción; la alerta original no se revalidaba | Se relee la fila dentro de la transacción y se recalcula con la misma función del reporte; se revalida clave↔contenido de la original |
| 5 | `prompt-5.txt` (fragmento sin la función auxiliar) | FALLA | FALLA | **No confirmadas** por Codex: ambos dijeron que no se validaba clave↔contenido de la original, pero `openAlertState` (fuera del fragmento) sí lo hace; la mutación que lo debilita hace fallar la prueba. Se añadió además una prueba para el camino de sustitución |
| 6 | `prompt-6.txt` (con las funciones auxiliares) | **PASS** | **PASS** | Observación menor sin cambio: `validOpenShape` acepta `cleared`, rama inalcanzable desde `openAlertState` |

Limitaciones de la vía: las respuestas de DeepSeek y GLM se degradan o se truncan con prompts largos; los fragmentos sin sus funciones auxiliares producen falsos positivos (ronda 5). Opinión de modelos, no prueba.

## Contraste de Codex
- 34 pruebas unitarias nuevas entre reporte y alertas (12 + 22); suite completa: 93 archivos, **1154 aprobadas, 113 omitidas**; tipos sin errores.
- Mutaciones que hacen fallar pruebas: deduplicación desactivada, motivos, cierre sin leer estado terminal, relectura de la fila dentro de la transacción y revalidación de clave↔contenido.
- `scripts/checkBillingPendingAlertsEmulator.mjs` contra un emulador de Firestore propio, aislado, datos sintéticos, limpieza verificada: 4 escritores concurrentes cuentan cada avistamiento exactamente una vez; 20 escritores nunca duplican (una primera ejecución abortó por «lock timeout» del emulador y el error se propagó, sin duplicados; las siguientes no abortaron: es no determinista); un solo cierre gana entre 4; las alertas de barrido y las de filas malformadas no se cierran solas; las cuentas y las colas no se modifican.
- Límite: el emulador no exige índices compuestos; que la nube pida alguno para `status == open` ordenado por id **no está verificado**.
