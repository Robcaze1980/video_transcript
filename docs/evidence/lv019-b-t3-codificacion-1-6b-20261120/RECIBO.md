# Recibo · Paso 1.6b (primera parte) · Control de los drenajes de saldo · 21 nov 2026

**Veredicto de Codex: CERTIFICADO en local como primera parte; la revisión independiente se hará junto con la segunda parte (sección y cableado del ejecutor), que es su único consumidor.** Programó T3 (hilo «1.6b control de drenajes», pruebas primero y una implementación; el servidor de T3 se reinició a mitad y retomó sin pérdida). Codex reejecutó las pruebas rojas, las verdes, la regresión financiera completa y 15 mutaciones propias. Todo local; nada desplegado.

## Qué cambia

`drainExternalBilling(limit, control?)` y `drainExternalHolds(limit, control?)` aceptan un segundo argumento **opcional** `control` (`shouldContinue`, `perAccountCap`, `after`, `maxRows`) que decide hasta dónde llega una pasada y cómo se recorre la cola, **sin cambiar lo que hace cada fila**. Sin `control` el comportamiento, el resultado y las consultas son los de antes. `shouldContinue` se consulta antes de cada fila (falso o excepción → corte limpio, `stopped: true`, nunca se propaga); `perAccountCap` limita las filas por cuenta y pasada (las excedentes se cuentan en `skippedRows` y no se tocan); `after` es un cursor de rotación por tipo (id de documento: empieza estrictamente después y da la vuelta, de modo que una rotación sirve cada fila vencida como máximo una vez) y `next` devuelve la última fila atendida; `maxRows` sustituye al `limit` (1 a 100). Los lectores `pendingExternalBillingIntents` y `pendingExternalBilling` ganan el parámetro `afterId`.

## Evidencia (sobre el código final copiado del worktree)

| Prueba | Resultado |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| Unitarias `firestoreDrainControl.test.ts` | 10/10 |
| Emulador `firestoreDrainControl.emulator.mjs` (Cuenta real) | **11/11** (sin `control` idéntico a hoy; corte por `shouldContinue`; tope por cuenta con 50 filas frente a una; cursor en tres pasadas y vuelta; dos drenajes simultáneos y un drenaje pausado → **un solo movimiento de saldo**; pasada interrumpida completada por la siguiente; holds) |
| **Regresión financiera completa (Node 24)** | **248 pruebas: 243 aprobadas, 5 pausadas de voz, 0 fallidas** ([resultado](../../../outputs/lv019-b-financial-runs/run-6ede9f0e-962f-4442-a47e-bc63cb2304b3/result.json)) |
| Mutaciones de T3 | 12/12 detectadas, restauración idéntica |
| **Mutaciones propias de Codex (15)** | **13 detectadas, 2 supervivientes**: `maxrows-bound` y `unknown-cursor-throws` |

**Supervivientes, adjudicados.** (1) `maxrows-bound` (quitar la validación de `maxRows` del drenaje): **equivalente en la práctica**, porque los lectores `pendingExternal*` y `pendingExternalHolds` ya validan `limit` entre 1 y 100 y lanzan `invalid` (otro tipo de error); se conserva como defensa en profundidad. (2) `unknown-cursor-throws` (quitar la comprobación de existencia del cursor): el cursor de un id que no es de la colección pasaría a actuar como **posición** y no como «empezar por el principio»; ambos comportamientos son aceptables y la prueba exige solo que **no falle**; la elección de T3 (reiniciar desde el principio) es la más conservadora. Un cursor mal formado (por ejemplo con `/`) lanzaría un error de ruta; no puede llegar desde el candado, que solo guarda ids planos validados, y la sección del ejecutor lo trata como cursor ausente (se exige en el encargo de la segunda parte).

## Límites declarados

- Con las dos colas entremezcladas (reservas y liberaciones; pendientes y reintentos) un solo `after` por tipo sirve a ambos flujos: orden por id y sin repetidos, no se fija el orden entre estados. Una vuelta **parcial** devuelve en `next` la última fila atendida.
- Una fila omitida por el tope por cuenta que quede antes del cursor espera a la siguiente vuelta; la equidad es de rotación, no de turno exacto.
- La revisión independiente (dos modelos, por ser ejecutor) queda pendiente y se hará junto con la sección de la segunda parte.
