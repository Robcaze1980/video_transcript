# Recibo del paso 1.6c: edad máxima con alerta y constancia de intento del ejecutor periódico

**Estado: certificado en local el 22 de noviembre de 2026 (sin desplegar).** Programó T3 (DeepSeek v4.1 Flash, instancia aislada `linguistvision-openrouter`); revisaron GLM Flash Latest y DeepSeek; certifica Codex. No toca `server/account/*` ni mueve saldo.

## Qué hace

1. **Constancia de intento** (`recordExternalBillingIntentStall`): las tres salidas del drenaje de intenciones que antes hacían `intentsFailed++; continue` sin registrar nada (falta `snapshotVersion`, no hay evidencia de fallo, no hay instantánea de estado) ahora cuentan un intento en la propia intención con espera creciente `min(15 min, 1 s·2^min(n,10))`. Solo cuenta una fila pendiente, **sin arriendo**, con metadatos válidos y **ya vencida** (`nextAttemptAt` ≤ ahora), de modo que dos drenadores no cuentan el mismo intento. Al octavo intento la intención pasa a `needs_review` con alerta y **sin bloquear al dueño**.
2. **Edad máxima** (`escalateStaleBillingRows`, 48 h como punto de partida a ajustar con datos reales): las filas no terminales de `billingIntents`, `billingOutbox` y `billingHoldOutbox` más viejas que el límite pasan a `needs_review` con `reviewReason:'max_age'`. Un milisegundo menos que el límite no se toca; la edad exacta tampoco («más viejo que»). Una transacción por fila que relee el estado y exige exactamente el que vio el escaneo; una fila con arriendo activo se salta; al escalar se borran los campos de arriendo vencidos. `createdAtMs` ausente, no numérico, negativo o futuro cuenta como fallo y deja la fila intacta. No escribe saldo, hold, guard ni bloqueo.
3. **Rotación correcta:** el cursor es un id compartido por las tres colecciones; se ordena por `(id, colección)`, el corte no divide un grupo de ids empatados, una pausa solo avanza hasta el último grupo completo, una página corta termina la rotación y cada consulta lee como máximo `limit` filas por colección y estado.
4. **Sección `age`** del ejecutor (`billingDrainSection.ts`): última sección, con candado vigente, presupuesto propio (reparto por defecto 12 + 26 + 8 + 9 + 5 = 60 s), cursor propio `age` y la misma compuerta antes de cada fila; el latido suma solo el recuento `staleEscalated`.

## Revisiones independientes (se conservan todas)

| Ronda | Revisor | Resultado | Archivo |
|---|---|---|---|
| 1 (1.6b corregido + 1.6c) | DeepSeek | **FALLA** (pausa dentro de un grupo empatado; registrador «inerte», no cierto; comentario de presupuesto obsoleto; índice y arriendos) | [review-1-6c-deepseek.txt](review-1-6c-deepseek.txt) |
| 1 | GLM | **FALLA** (misma pausa en empate; estado exacto; intento contado dos veces; edad exacta, rechazada por el diseño) | [review-1-6c-glm.txt](review-1-6c-glm.txt) |
| 2 (versión corregida) | GLM, primer intento | Falló por `max_output_tokens`, sin respuesta (incidente en `errorlogs.md`) | [review-1-6c-v2-glm.err](review-1-6c-v2-glm.err) |
| 2 | GLM, segundo intento | **PASS**: los cinco hallazgos previos están resueltos; pidió añadir `staleEscalated` a la especificación (hecho) | [review-1-6c-v2-glm-intento2.txt](review-1-6c-v2-glm-intento2.txt) |

Adjudicación de Codex: se aceptaron la pausa en grupo empatado, el estado exacto, el vencimiento del intento y el arriendo activo, más el comentario obsoleto; se rechazaron con evidencia la edad exacta (el diseño dice «más viejo que»), el «registrador inerte» (las pruebas 1 y 2 recorren el drenaje real y muestran el avance de `attempts` y el octavo intento) y el cursor corrupto (`getDrainCursor` ya devuelve `null`). El defecto de orden entre colecciones lo encontró Codex antes de las revisiones, con tres pruebas en rojo ([pruebas](tests-orden-rotacion.mjs.txt)); T3 lo corrigió y añadió una prueba más al descubrir que la de empates de Codex no distinguía una de las mutaciones.

## Evidencia

- `tsc --noEmit` limpio; unitarias focalizadas 110/110 (edad 23, sección 38, candado, bloqueos).
- Emulador con **Cuenta real**: edad 20/20 (incluye una alerta real del barrido), sección del ejecutor 9/9, control de drenaje 11/11, resolvedor de `unknown` 22/22, liquidación C2a 21/21, `firestoreAi` 166/166.
- **Regresión financiera completa: 336 pruebas, 331 aprobadas, 5 pausadas de voz, 0 fallidas** ([resultado](../../../outputs/lv019-b-financial-runs/run-f0fe6cf9-fda6-4541-8d61-6b4237e23281/result.json)); el ejecutor de la regresión incluye ahora la fixture de edad. Corrida sobre el estado combinado con el paso 1.4a.
- Regresión protegida de Cuenta **PASS** ([resultado](../../../outputs/lv019-b-account-full-runs/run-68b92345-2212-444a-bb2a-c863f80c9259)). Suite completa `npm test`: **1659 aprobadas, 113 omitidas (PostgreSQL histórico), 0 fallidas**.
- **Mutaciones propias de Codex sobre la versión final: 25 ejecutadas (24 más una repetida con ancla específica), todas detectadas**, con restauración de los archivos verificada byte por byte ([arnés](mutaciones/mutate_16c_c.py), [repetición](mutaciones/mutate_16c_d.py), [resultado](mutaciones/mut16c_c.txt)). Una primera ronda de 22 sobre la versión anterior ([resultado](mutaciones/mut16c.txt)) dejó una sobreviviente real (la sección de edad corría con el candado perdido) y se cerró con una prueba nueva. T3 añadió además 14 mutaciones propias, todas detectadas.

## Límites declarados

- La edad máxima de 48 h es un valor inicial; se ajusta con datos reales.
- La lectura `state == X` ordenada por documento se sirve con el índice de un solo campo; se confirma en la preparación de nube (A1/A3), no en el emulador.
- Una fila de `unknown` corrupta solo se alerta; los bloqueos no rotan (cursor `holds` sin uso; afectaría a una cuenta con más de 100 vencidos a la vez); `skippedRows` puede contarse dos veces en un caso de borde del tope por cuenta (límites de 1.6b, sin cambio).
- Si una cuarentena falla y además no se puede leer el trabajo, la fila queda sin alerta hasta que la edad máxima la escala (límite del paso 1.4a).
- No se probó contra la nube ni con datos reales; el ejecutor sigue apagado por defecto (`VISTAVO_BILLING_DRAIN`).

## Gasto

Saldo de OpenRouter medido: US$24,95 tras la recarga del 21 nov; US$12,07 el 22 nov a las 12:32, con hasta tres hilos de T3 a la vez y las revisiones de 1.6c y 1.4a incluidas. El costo propio de 1.6c no se puede aislar con la API del proveedor.
