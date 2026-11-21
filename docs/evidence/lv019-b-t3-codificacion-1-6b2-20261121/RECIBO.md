# Recibo · Paso 1.6b (segunda parte) · Sección del ejecutor periódico y su cableado · 21 nov 2026

**Veredicto de Codex (certificación final): CERTIFICADO en local, con una revisión pendiente y los límites del final.** Programó T3 (hilo «1.6b-2 seccion del ejecutor», una ronda de pruebas más implementación y una de correcciones); revisaron de forma independiente T3 con `~z-ai/glm-flash-latest` y `deepseek/deepseek-v4.1-flash` (**ambos respondieron FALLA** a la primera versión; se conservan íntegros); Codex integró el código, reejecutó pruebas y la regresión completa, y le lanzó 22 mutaciones propias. Todo local; **nada desplegado y el interruptor `VISTAVO_BILLING_DRAIN` queda apagado por defecto**.

## Qué se entrega

`server/commercial/billingDrainSection.ts`: `runBillingDrainSection({...})`, sección aislada del mantenimiento que **nunca lanza** y devuelve `ok | partial | error | disabled | skipped`. Toma el candado con arriendo (`holderId` aleatorio por pasada; `skipped: lease_held` sin error ni filas tocadas; `skipped: in_flight` si una pasada anterior sigue viva en el mismo proceso), lo renueva cada 10 s con un temporizador que **siempre se limpia** (`unref`; tenencia acotada al presupuesto de la pasada) y lo libera al terminar (condicionado a `holderId` y token). Antes de **cada fila** de **cualquier** sección comprueba el presupuesto de la sección y que sigue siendo titular con el margen certificado de 15 s; un arriendo perdido (también por una renovación rechazada) corta la pasada (`partial`). Orden: bloqueos, intenciones y salidas (cursores `intents` y `outbox`, persistidos solo del tipo realmente recorrido y solo con el arriendo vivo), bloqueos de nuevo y el resolvedor de `unknown` (cursor `unknown`, con presupuesto y arriendo por fila). Tope de 5 filas por cuenta **por pasada** (un solo mapa compartido) y 100 filas por tipo. Latido: una línea JSON con solo recuentos y el token (`billing-drain`, `unknownResolved` incluido). Cableado en `/internal/maintenance` (`cloudFilesRuntime.ts`): sección independiente, activada solo con `VISTAVO_BILLING_DRAIN=1`, que no cambia el código de estado ni cuenta como `failed`; `maintenanceResponse()` pura fija ese aislamiento. Cambios de apoyo: `resolveExpiredUnknown` acepta `shouldContinue`; `DrainControl.accountUsage` compartido; el resultado del drenaje trae `traversed`.

## Evidencia (sobre el código final integrado en `main`)

| Prueba | Resultado |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| Unitarias (sección 30+, resolvedor, control de drenajes, candado, barrido) | **143/143** |
| Emulador con Cuenta real: sección (dos pasadas simultáneas y una pausada que despierta tarde → **un solo movimiento de saldo**; pasada interrumpida completada por la siguiente; equidad con 50 filas; titular antiguo; resolvedor de `unknown`; interruptor apagado; latido; presupuesto y arriendo del resolvedor; tope compartido) | **9/9** |
| **Regresión financiera completa (Node 24), ya con la sección, el resolvedor y el control de drenajes** | **290 pruebas: 285 aprobadas, 5 pausadas de voz, 0 fallidas** ([resultado](../../../outputs/lv019-b-financial-runs/run-ebdf44d1-7229-4f10-9b24-dfc5aebdd573/result.json)) |
| Mutaciones de T3 | 23/23 detectadas, restauración idéntica |
| **Mutaciones propias de Codex (22)** | **20 detectadas, 2 supervivientes, ambos equivalentes (defensa en profundidad)** |

Supervivientes: `cursor-written-without-lease` (quitar la comprobación `!leaseLost` antes de escribir el cursor; **equivalente**, porque `setDrainCursor` ya exige ser el titular vigente dentro de su transacción) y `unknown-runs-when-lost` (quitar `!leaseLost` antes de la sección de `unknown`; **equivalente**, porque el `shouldContinue` de esa sección devuelve falso ante un arriendo perdido antes de la primera fila).

## Revisiones independientes (primera versión) y adjudicación

| # | Origen | Hallazgo | Adjudicación |
|---|---|---|---|
| 1 | DeepSeek ALTA | El resolvedor de `unknown` corría sin presupuesto ni arriendo por fila | **Real, adoptado:** `shouldContinue` por fila en `resolveExpiredUnknown`; pruebas de corte por presupuesto y por arriendo perdido |
| 2 | DeepSeek ALTA | Tres rutas del drenaje de intenciones hacen `intentsFailed++; continue` sin registrar el intento, de modo que la fila se reintenta en cada pasada sin avanzar; falta además la **edad máxima** (3.4 del diseño) | **Real, preexistente:** **no se cierra aquí; queda como paso 1.6c** (edad máxima con alerta y constancia de intento), anotado en el diseño y el backlog. Mientras tanto la alerta de `needs_review`/edad del barrido es la red de seguridad y las filas no mueven saldo |
| 3 | DeepSeek MEDIA | El tope por cuenta era por drenaje (tres mapas), no por pasada | **Real, adoptado:** mapa único `accountUsage` compartido; prueba de tope 5 en toda la pasada |
| 4 | DeepSeek MEDIA / GLM MEDIA | Los bloqueos no rotan (el cursor `holds` está sin uso) y una cuenta con más de 100 vencidos acapara | **Límite declarado:** los bloqueos son raros (uno por incidente); solo afectaría a una cuenta con más de 100 bloqueos vencidos a la vez |
| 5 | DeepSeek MEDIA / GLM BAJA | Se reescribía a `null` el cursor de un tipo no recorrido (y sin cliente de Cuenta) | **Real, adoptado:** `traversed` por tipo; el cursor solo se persiste si el tipo se recorrió |
| 6 | DeepSeek MEDIA | La pérdida de arriendo desde el temporizador no se propagaba | **Real, adoptado:** `leaseLost` distinto de tenencia agotada y cortocircuito del gate en cualquier sección |
| 7 | DeepSeek BAJA | El latido tiene 13 claves y el diseño enumera 12 | **Diseño actualizado** (se incluye `unknownResolved`) |
| 8 | DeepSeek / GLM BAJA | Prueba de cableado por expresión regular; `skippedRows` puede contar dos veces tras una vuelta | **Aceptado como límite:** el aislamiento se fija con `maintenanceResponse()` pura; `skippedRows` es solo métrica |

## Límites declarados

- **Revisión pendiente de la versión corregida:** los dos revisores leyeron la primera versión; las correcciones son pequeñas y están cubiertas por pruebas y mutaciones, pero la política de revisión por riesgo pide una nueva lectura independiente de la versión final (se hará con crédito de T3; hoy queda sin saldo).
- **Paso 1.6c pendiente:** edad máxima de 48 h con alerta y constancia de intento en las tres rutas de fallo del drenaje de intenciones.
- Nada se ejecuta en la nube: el planificador, los permisos de la identidad de mantenimiento sobre Cuenta y el interruptor se despliegan después (puerta G0).
- La concurrencia «real» de la prueba (a) usa un hilo trabajador con su propio cliente sobre el mismo emulador local; no sustituye una prueba con varias instancias en la nube.
