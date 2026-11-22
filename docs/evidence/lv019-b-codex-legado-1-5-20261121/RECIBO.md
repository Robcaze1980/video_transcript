# Recibo · Paso 1.5 (reducido) · Historias antiguas, corruptas o de forma futura (legado) · 21 nov 2026

**Veredicto de Codex (certificación final): CERTIFICADO en local, en la versión reducida aprobada por Rob el 21 nov** ([plan eficiente](../../plans/LV-019-B-plan-eficiente-bajo-costo-20261121.md), recorte «1.5 reducido»). Lo hizo Codex solo (sin T3, sin gasto de OpenRouter): es una comprobación de que lo existente falla cerrado, una prueba que fijaba menos de lo debido y documentación. **No cambia código de producción.** Nada desplegado.

## Qué exige el paso reducido

1. **Fallar cerrado** ante una forma que no se entiende (protocolo de liquidación futuro o mal formado, campo nuevo sin su protocolo, fecha ausente o corrupta).
2. **Inventario de fechas** ya existente y documentado.
3. **Dejar por escrito que no hay escritores antiguos que drenar**, porque las bases reales están vacías.

## Evidencia

| Punto | Resultado |
|---|---|
| Protocolo de liquidación futuro o mal formado (`settlementProtocol`) | El código ya lo rechaza (`validOutboxSnapshot`: solo se admite ausente = v1 o exactamente `3`). **Faltaba la prueba con valores concretos**: se añadieron a `firestoreVideoSettlementC2a.test.ts` 14 valores ilegales (`4`, `2`, `1`, `0`, `-1`, `3.5`, `NaN`, `Infinity`, `'3'`, `'4'`, `null`, `true`, `{}`, `[3]`) sobre las cuatro formas de tupla (captura completa, captura parcial, liberación con resolución, liberación simple), en la copia estricta y en la puerta de lectura del snapshot; una fila almacenada con protocolo futuro no coincide con ninguna tupla esperada; una tupla v1 **no** coincide con una fila v3 cuyo **único** campo nuevo sea `settlementProtocol` (captura completa v3, la forma real que escribe Video). |
| Mutaciones propias sobre `firestoreBackend.ts` (5) | **5 detectadas, 0 supervivientes** (quitar la comprobación del protocolo; admitir `4`; que la tupla v1 ignore el protocolo de la fila; que la tupla v3 acepte cualquier protocolo; que el copiado descarte un `null`), con restauración verificada byte a byte. La primera ronda dejó **un superviviente real** (`match-v1-ignores-protocol`: la prueba usaba una fila v3 que además traía `capturedSeconds`, así que el campo auxiliar enmascaraba la comprobación); se añadió la prueba que lo mata. |
| Forma antigua (v1, sin protocolo) | Sigue aceptándose y se compara exacta en ambos sentidos (pruebas ya existentes y las nuevas). |
| Fechas `nextAttemptAt` ausentes, `null`, no numéricas o futuras en las colecciones de saldo | Cubiertas por `billingSelection.test.ts` (ausente, `null` o no numérica cuenta como vencida en intenciones y nunca se selecciona en `retry_wait` del outbox; futura no; límite inclusivo), `billingScheduleInventory.test.ts` (inventario de solo lectura, recuentos sin ids) y las suites de emulador del selector. La edad máxima y `createdAtMs` ausente o corrupto quedan en el **paso 1.6c**. |
| `npx tsc --noEmit` | exit 0 |
| `firestoreVideoSettlementC2a.test.ts` | 14/14 |

## Por qué no hay escritores antiguos que drenar

La [lectura 1C del 19 nov](../../reviews/LV-019-B-lectura-1c-2026-11-19.md) (solo lectura sobre el proyecto real) encontró **cero** documentos en `billingIntents`, `billingOutbox` y `billingHoldOutbox`. Desde entonces **no se ha desplegado nada** a la nube (puerta G0), así que ningún código nuevo ni antiguo ha escrito filas allí. La [propuesta de migración de fechas](../../specs/LV-019-B-migracion-fechas-intenciones.md) queda como referencia y **no se implementa**.

## Límites declarados

- La afirmación «bases vacías» procede de una lectura del 19 nov. **Se vuelve a comprobar con el script A0 antes de cualquier despliegue** (A0 sigue sin ejecutarse: espera el «Sí, autorizo A0» del dueño). Si hubiera filas, se reabre este paso.
- Una fila de `retry_wait` del outbox sin fecha numérica no la recoge ningún selector (límite conocido y medido por el inventario); solo importaría si existieran filas antiguas, y no existen.
- No se prueba el comportamiento en Google Cloud ni con datos reales.
