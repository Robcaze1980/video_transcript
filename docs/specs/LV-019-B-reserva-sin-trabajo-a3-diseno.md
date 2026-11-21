# LV-019.B · Reserva hecha sin trabajo (A-3) · Diseño del paso 1.3

**Estado (20 nov 2026): DISEÑO v2 de Codex sobre el borrador de T3, tras dos revisiones independientes (GLM y DeepSeek respondieron FALLA al borrador; hallazgos adjudicados en el [recibo](../evidence/lv019-b-t3-diseno-1-3-20261120/RECIBO.md)); sin código.** El borrador original (que creaba el trabajo a partir de `status: reserved` y una comparación exacta de 14 versiones) se conserva en el historial de git y **no es vigente**. Paso 1.3 del [plan paso a paso](LV-019-B-plan-paso-a-paso-20261120.md) («Reserva hecha sin trabajo (A-3): que converja (crear el trabajo con la historia intacta o liberar) y conectar la evidencia de ACK»; cierre: «El ensayo de reserva externa pasa de 7/13 a 13/13; puerta para abrir la reserva externa por HTTP»). Ventana A-3 del [mapa de caídas](../../docs/reviews/LV-019-B-mapa-caidas-video-cuenta-20261120.md). Depende del paso 1.1 (Video ya usa la liquidación parcial y la liberación posadmisión) y del paso 1.2 (sellado de `unknown` y su resolvedor). Alcance: **texto** (`translation:en`). Este documento describe; no cambia saldo, no habilita la ruta HTTP externa y no sustituye al estado vigente (backlog/gantt/plan integral).

## 1. Hechos verificados (archivo:línea)

### 1.1 La ventana A-3 y el documento que queda en cada extremo

A-3 es «A2 hecho (Cuenta reservó), A3 no (Video no creó el trabajo)». En ese instante:

- **Video** tiene, de `beginExternalBillingIntent` (`server/commercial/firestoreBackend.ts:697-733`): `billingIntents/{hash([accountId,requestKey])}` en `state:'reserve_pending'`, con `attempts:1`, `nextAttemptAt:now` (`:728`); `billingIntentWitnesses/{intentId}` con `baseline:'before_reservation'` y `terminalRecovery:{protocol:1,sealPrepared:false,releasePrepared:false}` (`:724-727`); y `billingIntentAdmissionGuards/{intentId}` en `state:'clear'` (`:729`). **No** existen `requests/{intentId}` ni `billingIntentJobMarkers/{intentId}` (`:398`, `:432-433`). `billingGuards/{accountId}` puede no existir: `billingBlocked` interpreta la ausencia como «no bloqueada» (`:477-481`) y la creación normal de la intención no la escribe.
- **Cuenta** tiene `videoReservations/{hash([accountId,reservationId])}` con `state:'reserved'`, `admissionProtocol:2`, **sin** `providerAdmission`, y la cuenta con `available−=seconds`, `reserved+=seconds`, `active+=1` (`server/account/backend.ts:265-268`). La entrada de libro `ledgerId([accountId,reservationId,'reserve'])` existe; **no** hay asiento terminal (`:269-270`).
- Video **no** incrementó `active` todavía: para `externalBilling` lo hace al crear el trabajo (`firestoreBackend.ts:1254`) y lo devuelve al liquidar (`:1413`). Cuenta lo incrementó al reservar. **Los contadores ya divergen en A-3** (mapa de caídas).

### 1.2 Qué observa Video «sin Cuenta», más allá de `status`

`captureDirectObservation(witness,requestKey,source)` (`firestoreBackend.ts:455-464`) lee **14 documentos** (`directDocumentNames`, `:30`; `directObservationRefs`, `:388-390`): `account`, `identity`, `input`, `project`, `intent`, `origin` (testigo de intención), `guard` (`billingGuards`), `intentGuard` (`billingIntentAdmissionGuards`), `request`, `jobMarker`, y las cuatro filas terminales `sealWitness`/`sealRecovery`/`releaseWitness`/`releaseRecovery`. Devuelve una instantánea con `source`, `attemptId` y la **versión** (`createTime`/`updateTime` o ausencia explícita) de cada documento (`:460-462`; `copyDirectObservationSnapshot`, `:192-196`).

`validDirectObservationDocs` (`:396-407`) exige, **en la misma transacción**: cuenta e identidad existentes con `identity.accountId===witness.accountId` y `hash(['firebase',uid])===witness.identityKey`; input de la cuenta; origen válido; `intentGuard` en `clear`; `!billingBlocked(guard)`; y `intent` en `reserve_pending`/`release_pending` (fuente `status`) con `!row.jobId`; y **`!request.exists && !jobMarker.exists`** (`:398`). Es decir, la observación de `status` **ya comprueba más que el estado remoto**: comprueba que la historia local sigue siendo la de una intención sin trabajo.

La evidencia de fallo (`failureEvidence`) se captura **antes** del POST y fija `snapshotVersion` + `intentGuardVersion` + `state` + `witness` (`:776-791`); el drenaje la reutiliza y **no** la refresca después del error (`firestoreAi.ts:188-190`).

### 1.3 Qué hace hoy el drenaje de intenciones con un `reserved`

`drainExternalBilling` (`server/commercial/firestoreAi.ts:178-243`):

- Elige la intención (`:184`), obtiene el testigo original (`:187`), exige `snapshotVersion` (`:188`), captura la evidencia de fallo (`:189`) y una observación `status` (`:191`).
- Consulta `accountBilling.status` (`:204`). Si lanza `not_found`, sella con testigo (`prepareTerminalFromDirectObservation(...,'seal','status_not_found',...)`, `:207`) y llama a `seal` (`:211`).
- Si `held.seconds!==row.seconds || held.state==='captured'` → `recordExternalBillingReview` (`:218-222`). Si `held.state==='released'` → cierra con observación confirmada (`:223-226`).
- Sólo si `row.state==='release_pending'` usa `releaseAfter(statusSnapshot,'status_reserved')`, que prepara la liberación con cerca y llama a `accountBilling.settle(...,'release',...)` (`:194-202`, `:227-229`).
- **En el caso A-3 real (`reserve_pending` + `status:reserved`)** cae a `recordReservedStatusUncertainty(witness,requestKey,statusSnapshot)` (`:230-237`). Ese método (`firestoreBackend.ts:466-476`) devuelve `'unchanged'` si la observación coincide con la historia actual y sólo **reprograma** con `recordExternalBillingIntentFailure(...,'reserved_unconfirmed',...)` (`:236`); si la historia cambió, `preserveDirectUncertainty` escribe incidencia `needs_review`, hold y bloqueo del dueño verificable (`:416-452`). **Nada crea el trabajo ni libera**: el comentario del propio código lo dice («A reserved status is not evidence that the original admission history is still intact. Preserve changes, but do not create a job or release», `firestoreAi.ts:230-232`).
- En el camino interno de `enqueue` (`firestoreAi.ts:99-121`) pasa lo mismo: `reserve` lanza, se captura `status`, y el `reserved` acaba en `recordReservedStatusUncertainty` + `AiFault('unknown')` (`:119-120`).
- La ruta de creación de trabajo desde una instantánea de estado **existe y está cerrada a propósito**: `reserveAs(...,statusSnapshotInput,...)` compara la instantánea (`:1208-1213`) y, **incluso coincidiendo**, devuelve `null` (`:1214-1216`: «Even a matching status observation is not a reserve ACK and cannot authorize creating or replaying a job. No compensating release here.»).

### 1.4 El módulo de evidencia de ACK y su desconexión

`server/commercial/reserveAttemptEvidence.ts` expone dos funciones para una transacción aportada por el llamador:

- `prepareReserveAttemptInTransaction` (`:153-170`): copia estricta del testigo y de las **14 versiones** (`RESERVE_ATTEMPT_DOCUMENTS`, `:12-15`) y crea, sin sobrescribir, `billingReserveAttempts/{attemptId}`; si ya existe y difiere, `conflict`; nunca reconstruye un testigo ausente (`:158-161`).
- `recordReserveAckInTransaction` (`:172-183`): exige el intento previo exacto y una respuesta `{reservationId,seconds,state:'reserved'}` coincidente, y crea una vez `billingReserveAckObservations/{attemptId}` con `source:'reserve_ack'`, `state:'reserved'` y **`attribution:'unverified'`** (`:126-141`). Una repetición idéntica es idempotente.

**Hecho: ningún código no-test lo importa.** `rg -l reserveAttemptEvidence` sólo alcanza `reserveAttemptEvidence.test.ts` y `reserveAttemptEvidence.emulator.mjs`. Ni `firestoreAi.ts` ni `firestoreBackend.ts` lo mencionan; tampoco lo lee el reporte/barrido (`billingPendingReport.ts`, `billingPendingAlerts.ts`). El módulo queda fuera de cualquier camino de producción.

### 1.5 Pruebas que hoy **afirman** la no-recuperación de A-3

- `server/commercial/textAccountReserveIdentity.emulator.mjs:195-209` (`a later reserved status cannot fabricate the lost reserve ACK`): tras perder la respuesta, el status no crea trabajo; `jobs<=1` sólo si el propio `enqueue` acertó. Y `:185-193` (`a lost reservation response remains unknown while status is unavailable`).
- `server/commercial/firestoreAi.emulator.mjs:482-503` (`recovery defers reserved status without an admission receipt, a job or a release`): comprueba explícitamente `jobs.size===0`, `state:'reserve_pending'`, saldo igual, sin incidencias, sin hold, sin testigos terminales.
- `server/commercial/externalReplayStatusFence.emulator.mjs:207-214` (`background status reserved cannot create a job or release balance`): `intentsRecovered===0`, `intentsFailed===1`, `balance.reserved===2`, sin trabajo, sin observaciones de ACK.
- `server/commercial/statusOnlyReserve.emulator.mjs:99-111` (`reserved status without reserve ACK must not create a job`).
- `server/commercial/externalStatusChangedHistory.emulator.mjs:196` (`matching reserved status without ACK returns conflict rather than silently succeeding`) y `:193` (historia cambiada → incidencia).
- `server/commercial/reservedPollBackoffGreen.emulator.mjs:103-117` y `reservedPollBackoff.emulator.mjs:103-118`: el `status:reserved` sólo se reprograma con `reserved_unconfirmed`.
- `server/commercial/externalReserveReplayRace.emulator.mjs:169-186`: un replay con UID retirado o reasignado **no** puede recibir el trabajo.
- `server/commercial/doS` de doble ACK con historias distintas sigue en `needs_review` (`docs/specs/LV-019-B-doble-ack-liquidacion.md`, «Límites»).

## 2. Decisiones (v2)

1. **El drenaje NUNCA crea un trabajo a partir de un `status: reserved`.** Se mantiene la prohibición vigente del código (`reserveAs` devuelve `null`, `firestoreBackend.ts:1214-1216`) y las ocho pruebas que la afirman (§1.5): un estado remoto no es un ACK de esta solicitud ni prueba que la historia local siga siendo la original. Las revisiones demostraron que la alternativa del borrador (versión exacta de 14 documentos) era **inalcanzable** (la propia intención se reprograma, la cuenta cambia con otros trabajos) o, relajada, **insuficiente** (un `status` no identifica quién reservó).
2. **A-3 converge por dos vías, ninguna de las cuales usa el `status` como autorización de crear:**
   - **(a) Repetición de la solicitud (camino del solicitante).** El cliente reintenta con la misma `requestKey`; el solicitante vuelve a reservar (Cuenta es idempotente y devuelve el ACK real), **registra el ACK de forma durable** y solo entonces crea el trabajo. Es el paso **1.3b** (conecta `reserveAttemptEvidence.ts`: intento inmutable antes del POST y observación del ACK después) y cierra los seis casos rojos del ensayo 7/13.
   - **(b) Salida por plazo (camino del drenaje).** Si pasa el plazo sin repetición, el drenaje **cierra la reserva sin trabajo**: libera. Es el paso **1.3a**.
3. **Por qué liberar una A-3 es seguro y consistente con «liberar solo con prueba».** En A-3 **no existe ningún trabajo** en Video (no hay `requests/{id}`, ni marca de trabajo, ni `jobId` en la intención); sin trabajo no hay worker ni llamada a un proveedor, así que no hay admisión posible que liberar «tras la llamada». La prueba es doble y verificable: (i) en Video, la ausencia transaccional de trabajo y marca (la cerca `fenceExternalBillingRelease` ya la comprueba y devuelve `job_created` si apareció un trabajo, `firestoreBackend.ts:886-901`); (ii) en Cuenta, `settleVideo(release)` solo libera una reserva `admissionProtocol: 2` **sin admisión almacenada** y rechaza con `conflict` una reserva heredada o con admisión (`account/backend.ts:381-387`), así que la aceptación es una prueba de Cuenta, no una suposición de Video. Lo que **no** basta (y no se usa) es una revocación local de identidad o el solo paso del tiempo sin las dos pruebas.
4. **Cero capturas.** La salida por plazo nunca captura.
5. **Bloqueo manda (A-5).** Con la cuenta bloqueada no se cierra ni se crea nada: la intención pasa a `needs_review` con alerta; la salida de una reserva bajo bloqueo es del paso 1.4.
6. **Una sola transición atómica.** Crear el trabajo y cercar la liberación son excluyentes dentro de transacciones que releen el estado de la intención y la ausencia/presencia de trabajo (la cerca ya lo hace; `reserveAs` debe comprobar `state === 'reserve_pending'` en su propia transacción: se prueba la carrera y se corrige si hace falta).

## 3. Mecanismo

### 3.1 Paso 1.3a · Salida por plazo (drenaje)

Para una intención `reserve_pending` cuyo `status` devuelve `reserved` con `seconds === witness.seconds` y que **supera el plazo** `A3_REPLAY_WINDOW_MS` (valor inicial de configuración, ajustable con datos; propuesta **30 min**: más largo que el reintento razonable de un cliente y mucho menor que las 48 h de la edad máxima del ejecutor):

1. Hoy: `recordReservedStatusUncertainty` solo reprograma (`firestoreAi.ts:230-237`). **Nuevo:** si la intención ya supera el plazo, el drenaje llama a `fenceExternalBillingRelease` (reserve_pending → release_pending, atómico y con comprobación de trabajo, bloqueo y guarda de admisión). Con `job_created` (apareció un trabajo) no libera y reconcilia como hoy; con bloqueo lanza `conflict` → `needs_review` con alerta.
2. La intención ya en `release_pending` la procesa la maquinaria existente y ya probada (E-1/E-2 del mapa de caídas): `releaseAfter(statusSnapshot,'status_reserved')` prepara el terminal con observación directa y llama a `settle(release)`. Si Cuenta rechaza (`conflict`: reserva heredada o con admisión), la intención va a `needs_review` con alerta y **no se libera nada más**.
3. Cálculo de edad: `now − intent.createdAtMs` con reloj inyectado (nunca dentro de la transacción); `createdAtMs` ausente, no entero, negativo o futuro más allá de un sesgo tolerado de 10 min → no cerca, cuenta como fallo y queda reportada (la alerta `unknown_age` del barrido ya la cubre).
4. Sin cambios en el módulo de evidencia ni en `reserveAs`.

### 3.2 Paso 1.3b · Repetición de la solicitud con ACK durable (solicitante)

Es el trabajo de **conexión de `reserveAttemptEvidence.ts`** (T3 lo programará por separado, con su propio brief y revisión):
1. Antes del POST, en una transacción que relee las versiones **de los documentos que son inmutables en esa ventana** y prepara el intento (`prepareReserveAttemptInTransaction`); esperar el commit antes del POST. Regla de comparación **por documento** (la del borrador era inalcanzable): versión exacta solo para los documentos que nadie reescribe en la ventana (`identity`, `input`, `project`, `origin`/testigo, `intentGuard`, `request`, `jobMarker` y las cuatro filas terminales); valor semántico para `intent` (`state`, `inputId`, `operation`, `revision`, `seconds`, sin `jobId`; se ignoran `attempts`, `nextAttemptAt`, `lastErrorCode`, que la reprogramación cambia) y para `account` (identidad y no bloqueo; el saldo cambia con otros trabajos); `guard` por ausencia o no bloqueo.
2. Tras el POST, el ACK recibido se registra con `recordReserveAckInTransaction` (siempre `attribution: 'unverified'`) **en la misma transacción que crea el trabajo**; un fallo de escritura posterior conserva la observación (caso 6 del ensayo).
3. La revocación o reasignación de identidad entre la prelectura y el POST **impide** el POST (casos 1 y 3) o conserva el ACK sin trabajo (caso 2); un ACK que llega tras una cerca de liberación se conserva sin crear trabajo (caso 4); dos ACK de historias distintas conservan intentos distintos (caso 5).
4. Faltan de este paso, y se marcan como decisiones técnicas o del dueño en §8: la correspondencia del perfil `ai-candidate-v1` con el catálogo vivo (`AI_CATALOG_VERSION`), el formato de identificadores (UUID en minúsculas), las reglas de acceso y retención de las dos colecciones privadas y su lectura por el reporte.

### 3.3 Interacción con el límite `active>=3`

En A-3 Cuenta ya ocupa un cupo y Video no; **tres A-3 sin converger agotan el cupo de Cuenta** (HTTP 429 en la cuarta). La vía (a) alinea los contadores al crear el trabajo y la vía (b) devuelve el cupo al liberar; ambas se prueban en las **dos** bases.

### 3.4 Plazo máximo y alerta

Antes del plazo la intención se sondea con el retroceso existente. Pasado el plazo, la vía (b) la cierra o la manda a `needs_review`; el barrido A2 ya alerta de cualquier `needs_review`. El plazo acota la **observabilidad y el cupo retenido**, no autoriza liberar sin las dos pruebas del §2.3.

## 4. Fuera de alcance

Salida de una reserva **bajo bloqueo** (A-5, E-4 → paso 1.4); cierre de `needs_review` por un operador (A5); alertas por correo (3.3); habilitar la ruta HTTP externa (solo tras 13/13 y revisión T3); voz; migración del decoder v1 de la evidencia (decisión técnica en 1.3b).

## 5. Pruebas exigidas (primero rojas, con Cuenta real de emulador)

**1.3a (salida por plazo):**
1. Intención `reserve_pending` + Cuenta `reserved` **antes** del plazo: sin cambios (campos y saldo idénticos; sigue `reserved_unconfirmed`); **en el límite exacto** del plazo cerca y libera; un milisegundo antes no.
2. Tras el plazo, sin trabajo: la reserva queda **liberada en Cuenta con saldo y cupo recuperados** (ambas bases), la intención cerrada, ningún trabajo creado, ninguna captura.
3. **A-3 real con la intención ya reprogramada** (`attempts` y `nextAttemptAt` cambiados por el sondeo): se resuelve igual (el caso que invalidaba la versión exacta del borrador).
4. Aparece un trabajo (la repetición ganó la carrera) entre la lectura y la cerca: la cerca devuelve `job_created`, **no se libera** y el saldo queda con el trabajo.
5. Cuenta con reserva heredada o con admisión almacenada: `conflict` de Cuenta → `needs_review` con alerta, **saldo intacto**.
6. Cuenta bloqueada: ni cerca ni liberación; `needs_review` con alerta; ninguna llamada de saldo.
7. Dos drenajes concurrentes: un solo cierre y un solo movimiento terminal; el segundo no escribe.
8. `status` posterior `released` o `captured`: se concilia como hoy (cierre confirmado o revisión), sin segunda liberación.
9. Reloj: `createdAtMs` ausente, de texto, negativo o futuro → no cerca, `failed`, pasada intacta.
10. Revocación local de identidad **sin** plazo cumplido: no libera (control del rechazo de T3).
11. Mantener verdes las ocho pruebas de §1.5 que afirman que el drenaje **no crea** trabajo desde `status`.

**1.3b (ACK durable):** los **seis casos rojos del ensayo 7/13** (`textAccountReserveIdentity.emulator.mjs:154, 162, 173, 220, 243, 299`) pasan; los siete verdes siguen verdes; reserva de otro intento con la misma tupla **no** crea trabajo; mutaciones por cada comparación de §3.2; regresión financiera completa.

**Ambas:** mutaciones sobre cada condición nueva y regresión financiera completa; revisión independiente del código.

## 6. Límites

- Todo se prueba con Firestore y Cuenta **emulados**; no acredita IAM, Cuenta real, cobro real ni recuperación entre dispositivos.
- Liberar una A-3 tras el plazo puede dejar a un cliente que reintenta mucho después con una solicitud ya cerrada (debe usar una `requestKey` nueva); es el comportamiento del sellado existente y se informa como estado de la intención.
- El plazo es un valor de partida, ajustable con datos reales.
- La evidencia de ACK es `unverified`: no autentica a Cuenta; la autenticidad la da la vía HTTP autenticada entre servicios, no este módulo.

## 7. Decisiones que dependen del dueño (no bloquean)

1. **Plazo de repetición** antes de liberar una A-3 (propuesta 30 min): configuración, no política.
2. Canal y responsable de la alerta de `needs_review` (fase 0: correo al dueño).
3. Retención de `billingReserveAttempts` y `billingReserveAckObservations`.
4. **Técnica (decide Codex):** perfil del catálogo y formato de identificadores (1.3b).
