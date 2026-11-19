# Recibo T3 · barrido local B+C · 2026-11-19

Código revisado: `server/commercial/billingPendingSweep.ts` (encadena el reporte de solo lectura y las alertas durables). Vía: T3 local (instancia `linguistvision-openrouter`), servidor cerrado tras cada ronda. Modelos pedidos: `~z-ai/glm-flash-latest` y `deepseek/deepseek-v4.1-flash`; modelo servido, tokens y costo no observables. Se conservan todas las respuestas originales, también las FALLA.

| Ronda | GLM | DeepSeek | Qué se hizo |
|---|---|---|---|
| 1 (`prompt.txt`) | **FALLA**: los pasos `raise`/`clear` devolvían `ok:false` en vez de rechazar; pérdida de contadores si `clear` falla a mitad; `attention` | **FALLA**: `ok` ignoraba alertas corruptas; contadores parciales perdidos | Adoptado: la promesa **solo resuelve si todo salió bien**; cualquier fallo deja una alerta durable y rechaza con `SweepError` (código, etapa y resumen parcial, sin mensajes); una alerta almacenada corrupta produce `sweep_review`; `clearResolvedAlerts` adjunta los contadores parciales al error. No adoptado: `attention` siempre es un arreglo (tipado y probado); `unverified`/`raced` no son fallos (`raced` es normal con barridos solapados; `unverified` ya es una alerta abierta) |
| 2 (`prompt-2.txt`) | PASS (menor: el fallo de lectura no traía resumen) | **FALLA**: lectura de propiedades de un rechazo no-objeto dentro de un `catch` podría lanzar; contratos distintos de parciales | Adoptado: `asRecord` (nunca lanza, aunque el rechazo sea `undefined`/`null`/texto); el fallo de lectura también trae un resumen parcial estándar. No adoptado: unificar la forma de los parciales (ambas funcionan) |
| 3 (`prompt-3.txt`) | **PASS** | **PASS** | Sin cambios; observaciones menores (el `catch` defensivo hoy es inalcanzable con los puntos de lanzamiento actuales; un Proxy hostil escapa a cualquier defensa) |

Limitaciones de la vía: opinión de modelos sobre el fragmento enviado, no prueba.

## Contraste de Codex
- 14 pruebas nuevas del barrido (en la suite: 95 archivos, **1180 aprobadas, 113 omitidas**); tipos sin errores.
- Mutaciones que hacen fallar pruebas: no avisar ante un fallo de lectura, omitir el cierre, ignorar contadores parciales, tragar el fallo de `raise`, perder la opción `audit`, devolver el resumen en vez de rechazar, ignorar la alerta corrupta y perder los contadores parciales de `clear`. (Una mutación para filtrar el mensaje de error no tomó efecto en mi `sed`; la prueba correspondiente se comprobó por lectura, no por mutación.)
- `scripts/checkBillingPendingSweepEmulator.mjs` contra un emulador propio y aislado (datos sintéticos, limpieza verificada): primer barrido alerta solo la fila que lo necesita; dos barridos solapados no duplican; el ejecutor local **rechaza** (código 2) un emulador ausente, un host no local, un proyecto no `demo-*`, la falta de `--root`, una ruta inválida y un umbral 0, sin escribir; con entorno correcto imprime solo contadores; al terminar la fila, el siguiente barrido cierra su alerta tras leerla; cuentas y filas intactas.
- Límites: **nada programa ni despliega este barrido**; el ejecutor solo funciona con emulador local; el barrido no llama a los `drain` existentes (no mueve saldo); el índice de nube para alertas abiertas no está verificado.
