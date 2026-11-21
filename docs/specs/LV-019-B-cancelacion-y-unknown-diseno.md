# LV-019.B · Cancelación del cliente y trabajos en duda (`unknown`) · Diseño del paso 1.2

**Estado (20 nov 2026): DISEÑO v2 tras la revisión T3 (DeepSeek y GLM respondieron FALLA; hallazgos adjudicados en el [recibo](../evidence/lv019-b-t3-diseno-1-2-20261120/RECIBO.md)); pendiente del código.** Paso 1.2 del [plan paso a paso](LV-019-B-plan-paso-a-paso-20261120.md). Depende del paso 1.1 (Video ya envía la liberación con resolución a Cuenta) y de la [liquidación parcial](LV-019-B-liquidacion-parcial-y-liberacion-posadmision.md) (contrato de Cuenta con la resolución `unknown_expired`). Cubre **texto** (traducción). La voz (cálculo de K por fragmentos, sellado de fragmentos) llega en C2 y reutiliza lo que aquí se prueba; ver §7.

## 1. Qué hace el código hoy (hechos)

- `cancelInTransaction` (firestoreBackend.ts): un trabajo `queued` o `running` con `invocationPhase: 'not_started'` se cancela y se libera; un trabajo `running` con la llamada ya iniciada pasa a **`unknown`** (`unknown()`: guarda `unknownAttemptId`, `quarantinedAtMs`, borra `attemptId` y la vigencia, suma 1 a `unknownCount` de la entrada y manda el artefacto a `purging`). La reserva **sigue retenida**.
- Un trabajo `unknown` solo sale por `reconcile(accountId, jobId, 'failed'|'succeeded', evidencia)`, que **solo llaman pruebas y scripts**. Nadie lo ejecuta en producción: la reserva puede quedar retenida sin fin (C-5, B-0, B-3, B-4 del [mapa de caídas](../reviews/LV-019-B-mapa-caidas-video-cuenta-20261120.md)).
- `settle` ya sabe salir de `unknown` (resta `unknownCount`, `attemptId` nulo) y, desde 1.1, envía a Cuenta la liberación con la admisión y la resolución cuando hay llamadas de proveedor registradas.
- La cuenta admite como máximo **3 trabajos activos** (`active >= 3` → `conflict` al crear); un `unknown` cuenta como activo, así que **el límite de `unknown` simultáneos por cuenta ya existe y vale 3**: con tres en duda la cuenta no puede crear otro hasta que se resuelvan.
- El cliente ya ve el estado en revisión: `jobNeedsReview` (cloudCandidateApi.ts) trata `unknown` como «en revisión».
- **Alertas (hecho verificado en la revisión T3 de este diseño):** los documentos `jobs` **no llevan `createdAtMs`** (el literal de `reserve` no lo escribe), de modo que toda fila `job_unknown` sale del informe con edad desconocida y `attentionOf` la clasifica `unknown_age`; `raisePendingAlerts` ya levanta alerta para esas filas **a cualquier edad** (política de `AlertPolicy`: no hay umbral de edad por defecto). Lo que **no** existe es el cierre automático: para `jobs` no hay conjunto terminal verificable (`terminalStates: null`), así que `clearResolvedAlerts` deja abierta la alerta de un `unknown` ya resuelto (límite declarado en §3.1; es ruido para el operador, no riesgo de saldo).

## 2. Decisiones (derivadas de las del dueño del 20 nov; ninguna necesita nueva respuesta)

1. **Cancelación antes de enviar al proveedor:** se libera todo (ya funciona).
2. **Cancelación después de enviar (texto):** el texto no entrega nada parcial, así que lo entregado y verificado es **cero** y no se cobra. El trabajo se sella en `unknown` (el cerrojo `attemptId = null` ya impide que una respuesta tardía se publique) y entra al plazo del §3. No se reintenta.
3. **«No se cobra si fallamos»:** el resolvedor automático **nunca captura**. Solo libera. Capturar un `unknown` solo puede hacerlo `reconcile(...,'succeeded')` por un operador con evidencia, y no es automático.
4. **Plazo máximo de `unknown`:** `UNKNOWN_REVIEW_WINDOW_MS = 6 h` desde `quarantinedAtMs` (constante exportada, mayor que el piso de 15 min de Cuenta `UNKNOWN_RESOLUTION_MIN_AGE_MS`). Durante la ventana: estado visible «en revisión» y la alerta que el barrido A2 ya levanta (§3.1). Al vencer: **liberación con marcador** (§4). El plazo es un valor de partida, ajustable con datos reales (queda registrado como decisión de configuración, no de política).
5. **Límite por cuenta:** el existente (3 activos). Se añade prueba que lo fija y que una resolución libera el cupo.

## 3. El resolvedor automático (llamador de producción)

`resolveExpiredUnknown({now, limit, after?})` en `FirestoreBackend`:

- Lee trabajos con `state == 'unknown'` (consulta de un solo campo, **sin índice compuesto**), en orden de id a partir de un cursor persistente (kind `unknown` del candado del ejecutor), máximo `limit` por pasada. **Regla del cursor:** avanza sobre **todas** las filas leídas (vencidas o no) y da la vuelta al llegar al final; así una fila reciente al frente nunca atasca la pasada y una que vence después de que el cursor la pasó espera como máximo una vuelta (con ≤ 3 `unknown` por cuenta y pasadas de 5 min la vuelta es corta; se declara el límite).
- **Validación antes de decidir vencimiento:** `quarantinedAtMs` debe ser entero seguro ≥ 0 y no estar en el futuro más allá de un sesgo tolerado de 10 min respecto de `now`; y, **cuando hay admisión**, `unknownAttemptId` debe ser un UUID válido (sin él `settle` lanzaría `invariant` en cada pasada y la reserva quedaría retenida sin fin). Cualquier otra cosa (ausente, texto, negativo, futuro, intento inválido) **no se descarta en silencio**: la fila se cuenta `failed`, no se toca y queda reportada (la alerta `unknown_age` ya existe). Un `NaN` nunca puede convertirse en «aún no vence». **Cada fila va en su propio `try/catch`:** cualquier excepción de `settle` (invariante de saldo, cuenta inconsistente) cuenta `failed`, no aborta la pasada y la fila se reintenta en la siguiente vuelta del cursor.
- Cada trabajo se resuelve en **su propia transacción**: relee el trabajo, comprueba que sigue `unknown` y vencido, y llama a `settle(tx, c, 'failed', evidencia, {kind:'unknown_expired', evidenceSha256})` cuando hay admisión (llamadas de proveedor registradas); sin admisión (`unknown` antes de contactar al proveedor) es la liberación simple. Idempotente: un trabajo ya resuelto devuelve `false`.
- `evidencia = "unknown_expired:v1:{jobId}:{unknownAttemptId}:{quarantinedAtMs}"` y `evidenceSha256` es su SHA-256: se reproduce solo con datos ya guardados. Sin admisión no se envía resolución y la evidencia usa `none` en lugar del intento (`unknown_expired:v1:{jobId}:none:{quarantinedAtMs}`), solo para `reconciliationRef`.
- El reloj es el `now` inyectado; ningún reloj se lee dentro de la transacción para decidir vencimiento.
- Devuelve conteos `{scanned, resolved, notDue, failed}` (sin ids de cuenta ni de fila) para el latido del ejecutor.
- Se cablea como **sección del ejecutor periódico** (paso 1.6b) con su propio cursor `unknown` y presupuesto; hasta entonces es invocable y probado, no programado.

### 3.1 Alertas (sin cambio de código en el barrido)

El barrido A2 ya levanta una alerta idempotente por cada fila `job_unknown` (motivo `unknown_age`); este paso **no añade** umbrales de edad ni un motivo nuevo (la política vigente es que solo el dueño puede fijar un umbral). Queda declarado el límite: la alerta de un `unknown` resuelto no se cierra sola (`jobs` no tiene conjunto terminal verificable) y se cierra con la disposición del operador (`recordDisposition`, A5). Una prueba fija ambas cosas: una alerta mientras está en duda y ninguna escritura fuera de `billingPendingAlerts` y `billingPendingAudit`.

## 4. Marcador (tombstone) para artefactos y respuestas tardías

Un `unknown` liberado por plazo puede recibir después la respuesta del proveedor. Reglas:

- El trabajo queda `failed` con `reconciliationRef` = la evidencia y `resolvedAs: 'unknown_expired'` (campo nuevo, solo informativo para la auditoría; la lógica de cobro **no** lo lee).
- El artefacto (texto traducido) ya va a `purging`/`purged` por `settle`; no es descargable. Una respuesta tardía del proveedor, un `stage` o un `finish` del worker son **rechazados** (el trabajo no está `running` ni tiene `attemptId`), y el recibo tardío, si se registra, **no cambia ningún movimiento ni la fila de salida**.
- Nunca se captura tras la liberación por plazo. La fila de salida ya está `settlementProtocol: 3` con `resolutionKind: 'unknown_expired'`.

## 5. Pruebas exigidas (primero rojas, con `AccountStore` real y el emulador)

1. Cancelación antes de enviar libera; cancelación tras enviar sella `unknown` sin cobrar y sin soltar la reserva; ambos dejan `active` coherente.
2. Resolvedor: antes del plazo no toca nada (todos los campos y el saldo idénticos); en el límite exacto `quarantinedAtMs + ventana` resuelve y un milisegundo antes no; con admisión envía `unknown_expired` y la reserva termina liberada en Cuenta con saldo y cupo recuperados; sin admisión es liberación simple; nunca produce captura. **Caso de divergencia de admisión:** el trabajo tiene la fila `providerCalls` en `intent` (Video la escribe **antes** de `AccountBilling.admit`) pero Cuenta no llegó a registrar la admisión: el resolvedor envía la resolución, Cuenta ignora la afirmación sin admisión almacenada (su rama de primera liberación no la exige) y libera; el reintento del mismo drenaje sigue estable. Así queda demostrado que la presencia de `providerCalls` es un superconjunto seguro de la admisión de Cuenta.
3. Idempotencia y carreras: dos resolvedores concurrentes → un solo movimiento terminal; resolvedor frente a `reconcile` manual → uno gana y el otro devuelve `false`. Un `finish`, `stage` o `heartbeat` del worker sobre un trabajo `unknown` o ya liberado es rechazado **estructuralmente** (el trabajo no está `running` y `attemptId` es nulo): la prueba lo fija ejecutando esas llamadas después de sellar y comprobando que ni el trabajo, ni el artefacto, ni el saldo, ni la fila de salida cambian; no pretende simular una carrera real porque no existe un camino que devuelva un `unknown` a `running`.
4. Respuesta tardía tras la liberación: ni artefacto descargable, ni movimiento nuevo, ni cambio en la fila de salida.
5. Límite por cuenta: con **entradas distintas** (el cerrojo `unknownCount` por entrada ya impide dos `unknown` en la misma) se llegan a 3 trabajos `unknown` en una cuenta y el cuarto alta devuelve `conflict` por `active >= 3`; tras resolver uno, el alta sí funciona. Se prueba además el cerrojo por entrada por separado.
6. Cursor y presupuesto: más de `limit` trabajos vencidos se resuelven en pasadas sucesivas sin repetir ni saltar ninguno; una fila no vencida al frente no atasca; una fila que vence después de que el cursor la pasó se resuelve tras la vuelta; `quarantinedAtMs` ausente, de texto, negativo o futuro (más allá del sesgo), y `unknownAttemptId` nulo o no UUID con admisión, cuentan como `failed`, no tocan la fila, no detienen la pasada y no vuelven a considerarse «no vencida»; una fila cuya liquidación lanza una excepción también cuenta `failed` y las demás filas de la pasada se resuelven igual.
7. `unknown_expired` antes del piso de Cuenta (15 min) devuelve `too_early` y la fila reprograma sin contar intentos (comportamiento de 1.1) — comprobado con una ventana artificialmente corta.
8. Alerta (§3.1): un `unknown` sembrado produce una sola alerta aunque el barrido se repita; el barrido no escribe nada fuera de `billingPendingAlerts` y `billingPendingAudit`; se documenta con una aserción que la alerta de un `unknown` resuelto sigue abierta (límite declarado).
9. Mutaciones sobre cada condición (límite del plazo `<=`/`<`, comprobación de estado, tipo de resolución, evidencia, que nunca capture) y regresión financiera completa.

## 6. Fuera de alcance

Cálculo de K y sellado de fragmentos de voz (C2); endpoint o herramienta del operador para resolver a mano (A5); alertas por correo (A3); un cambio de política (por ejemplo cobrar un texto cancelado después del envío: hoy no se cobra y se informa al dueño como decisión **no bloqueante**).

## 7. Qué reutilizará la voz

El sellado de la cancelación de voz usará la misma transición (`unknown` con cerrojo) y el mismo resolvedor; la diferencia es que antes de liberar se calcula K con los fragmentos entregados y verificados y, si K ≥ 1, se envía captura parcial (`capturedSeconds`), que Cuenta ya soporta (etapa 1 de C2a).
