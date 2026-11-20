# Recibo T3 · inventario de solo lectura de `nextAttemptAt` (LV-019.B) · 2026-11-19

Código revisado: `server/commercial/billingScheduleInventory.ts` (completo, con su contrato en el prompt). Vía: T3 local (instancia `linguistvision-openrouter`). Modelos pedidos: `~z-ai/glm-flash-latest` y `deepseek/deepseek-v4.1-flash`; modelo servido, tokens y costo no observables. Se conservan prompt y respuestas.

| Revisor | Resultado |
|---|---|
| GLM | **PASS** (sin bugs reales) |
| DeepSeek | **PASS** (dos observaciones menores) |

**Observaciones de DeepSeek.** (1) Usar `FieldPath.documentId()` en vez de `orderBy('__name__')`: **no adoptado**; `'__name__'` es el nombre documentado del campo de documento y lo ejercitan este chequeo (205 documentos en tres tamaños de página contra el emulador real) y los demás módulos de la serie; si una versión lo rechazara, el chequeo con emulador fallaría. (2) `Object.freeze` solo congelaba el arreglo: **adoptado**, cada fuente y su lista de estados se congelan y una prueba lo comprueba.

## Contraste de Codex
- 36 pruebas (clasificación por tabla de 17 casos, recuentos exactos de tres colecciones, mismo resultado con 7 tamaños de página, solo lectura, proyección de dos campos, salida sin ids ni valores, fallo de lectura que rechaza, reloj y tamaño de página inválidos, fuentes inmutables); suite completa y tipos sin errores.
- 12 cambios deliberados al módulo hacen fallar pruebas (frontera de «vencida», `null` como ausente, fracciones y negativos como válidos, solo la primera página, sin proyección, máximo sobre las vencidas, reloj o tamaño de página sin validar, estados sin lista contados como sin estado, estado vacío aceptado); sin la cota inferior del tamaño de página la prueba se cuelga (bucle infinito), que la validación evita.
- `scripts/checkScheduleInventoryEmulator.mjs`: contra el emulador real, 205 intenciones más cuatro colecciones auxiliares con campo ausente, nulo, texto, futuro, vencido, sin estado y estados terminales; mismos recuentos con paginación de 200, 7 y 1000; el inventario no cambió ningún documento (hash antes y después); sin ids, cuentas ni valores en el resultado; limpieza verificada.
- Límites: no se ejecutó contra datos reales (hace falta la aprobación P0/1C de la propuesta de nube); recorre todos los documentos de las tres colecciones, así que se ejecuta a mano y rara vez; el valor de `maxFuturePerState` solo es útil si se compara con el límite de lote de los selectores, que no se fija aquí.
