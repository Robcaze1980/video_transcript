# Recibo del paso 1.3a: salida por plazo de una reserva hecha sin trabajo (A-3)

**Estado: certificado en local el 22 de noviembre de 2026 (sin desplegar).** Programó T3 (DeepSeek v4.1 Flash, instancia aislada `linguistvision-openrouter`) en un hilo limpio tras abandonar el primero; revisaron GLM Flash Latest y DeepSeek; certifica Codex. **Queda para el paso 1.3b** el ACK durable del solicitante. Contrato: [diseño v2](../../specs/LV-019-B-reserva-sin-trabajo-a3-diseno.md) (secciones 1, 2, 3.1, 3.3, 3.4, 5.1.3a y 6).

## Qué hace

1. **Plazo** (`classifyA3ReplayWindow`, `A3_REPLAY_WINDOW_MS` = 30 min, configuración y no política): con un reloj inyectado (`DrainControl.now`, por defecto `Date.now()` al inicio de la pasada), una intención `reserve_pending` es `due` desde el límite exacto; un `createdAtMs` ausente, no entero, negativo o futuro más allá de 10 min de sesgo es `invalid`, cuenta como fallo de esa fila y **nunca cerca**. Antes del plazo el comportamiento es exactamente el de antes (`reserved_unconfirmed`).
2. **Cerca con dueño único** (`claimExternalBillingRelease`; `fenceExternalBillingRelease` delega y conserva su contrato): la transición atómica `reserve_pending` → `release_pending` informa si **esta** llamada la hizo; dos drenajes concurrentes eligen un solo dueño de la liberación, el perdedor no contacta a Cuenta. Si apareció un trabajo (`job_created`) no libera y reconcilia como antes. El drenaje **nunca crea un trabajo a partir de un status y nunca captura**; solo libera si Cuenta informa `reserved` con los mismos segundos, después de la cerca.
3. **Cierre a revisión sin bloquear al dueño** (`closeA3ReservationForReview`): cuenta bloqueada o rechazo de Cuenta (reserva heredada o admisión almacenada) llevan la intención a `needs_review` con una incidencia, **sin hold, sin guard nuevo y sin mover saldo**; el barrido A2 alerta. Si el fallo de evidencia no es por bloqueo (carrera inocua, trabajo ya creado, arriendo ajeno), la fila conserva el comportamiento de antes. La incidencia registra la procedencia de la tupla (`firstObservedProvenance`: `expected_from_intent` o `account_status`).
4. Una caída entre la cerca y la liberación deja la fila `release_pending`, y la pasada siguiente la termina por la maquinaria existente con **una** sola liberación.

## Revisiones independientes (se conservan todas)

| Ronda | Revisor | Resultado | Archivo |
|---|---|---|---|
| Hilo anterior | T3 | Sin entrega tras más de 8 000 pasos; se abandonó y se reinició (ver bitácora) | [estado-hilo-anterior.patch](estado-hilo-anterior.patch) |
| Lectura de Codex | Codex | Defecto de alcance: la rama de evidencia no capturada cerraba a revisión toda intención vencida, no solo con cuenta bloqueada | [brief-3-correccion-plazo.txt](brief-3-correccion-plazo.txt) |
| 1 (tras corrección 1) | GLM | **PASS** con una MEDIA y tres BAJA | [review-1-3a-v1-glm.txt](review-1-3a-v1-glm.txt) |
| 1 | DeepSeek | **FALLA** (tres MEDIA y una de cobertura) | [review-1-3a-v1-deepseek.txt](review-1-3a-v1-deepseek.txt) |

**Adjudicación de Codex (verificada contra el código):**
- **Aceptado y corregido:** la procedencia de la observación en la incidencia (señalada por ambos revisores); la prueba de la caída entre la cerca y la liberación; la idempotencia concurrente en la vía de cuenta bloqueada; y dos pruebas que fijan lo discutido.
- **Rechazado con evidencia:** DeepSeek 1, «el error dentro del `catch` aborta la pasada»: falso, esa excepción cae al `catch` externo **de la fila**, que la cuenta como fallida y sigue; lo fija una prueba. DeepSeek 2, «una fila cerrada se reescribe»: falso, `recordExternalBillingIntentStall` relee el estado y no escribe sobre una fila no pendiente; lo fija una prueba. GLM 4, `.catch` uniforme: el `catch` externo ya registra el fallo.
- No se hizo una tercera revisión completa tras la corrección 2: el cambio de producción es una constante y un campo de la incidencia, con prueba y mutación detectada, más 3 pruebas de Codex.

## Evidencia

- `tsc --noEmit` limpio; unitarias de A-3 5/5; emulador con **Cuenta real** `firestoreA3Exit` **27/27** (24 de T3 y 3 de Codex); suites existentes que tocan estas rutas: `firestoreAi` 166/166, bloqueos 27/27, instantánea 22/22, liquidación C2a 21/21, resolvedor de `unknown` 22/22, control de drenaje 11/11, edad 20/20, sección 9/9.
- **Regresión financiera completa: 364 pruebas, 359 aprobadas, 5 pausadas de voz, 0 fallidas** ([resultado](../../../outputs/lv019-b-financial-runs/run-f6160faa-e48b-4b4e-9346-29d1f94846d8/result.json)); el ejecutor de la regresión incluye ahora la fixture de A-3.
- Regresión protegida de Cuenta **PASS** ([resultado](../../../outputs/lv019-b-account-full-runs/run-c80330d1-4c2b-49b7-9d49-92ff4b9b5e22)); suite completa `npm test`: **1664 aprobadas, 113 omitidas (PostgreSQL histórico), 0 fallidas**. Una primera corrida de ambas en paralelo agotó tiempos de pruebas sensibles al reloj (pasaron en aislamiento y al repetirlas de una en una con un emulador nuevo).
- **Mutaciones propias de Codex: 21 sobre el código final.** 17 detectadas al primer intento; **tres sobrevivientes eran huecos reales de pruebas** (el cierre no probaba el estado de la fila dentro de su transacción, ni que no reabre una fila ya cerrada, ni que rechaza una intención con trabajo creado), cerrados con tres pruebas de Codex y detectados al repetirlas; **una sobreviviente es equivalente** (quitar la condición de estado del drenaje, que repite por dentro `closeA3ReservationForReview`: defensa en profundidad sin cambio observable). [Arnés](mutaciones/mutate_13a.py), [resultado](mutaciones/mut13a.txt), [repetición](mutaciones/mut13a_b.txt), [pruebas](mutaciones/test_a3_state_race.txt). T3 añadió 13 mutaciones propias en sus tres entregas (8 + 4 + 1); las dos que sobrevivieron en la primera se cerraron con pruebas en la corrección 1.

## Límites declarados

- El lector `pendingExternalBillingIntents` solo devuelve filas con `nextAttemptAt` vencido: una fila reprogramada se sondea al vencer su espera (máximo 15 min después del plazo). Decisión conservadora de T3, adjudicada.
- El plazo de 30 min es un valor inicial, ajustable con datos reales.
- No se probó contra la nube ni con datos reales; el ejecutor sigue apagado por defecto.
- Si el cierre a revisión no se puede escribir, la fila queda reintentable y el `catch` por fila lo cuenta como fallo; no hay riesgo de saldo.

## Gasto

Saldo de OpenRouter medido: US$12,90 a las 19:11 del 22 nov (tras una recarga de US$15) y US$6,82 a las 21:44, con el hilo limpio, dos correcciones y dos revisiones. Hallazgo del 22 nov: el revisor automático de aprobaciones de T3 (`codex-auto-review`, 196 hilos de «guardian») pesa cerca de la mitad del gasto diario y cuesta más que el programador (ver bitácora); además, una auditoría de otro proyecto salió de esta misma clave.
