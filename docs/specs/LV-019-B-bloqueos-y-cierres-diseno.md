# LV-019.B · Bloqueos y cierres: C-3/E-3, desbloqueo auditado, D-4 y A-5/E-4 · Diseño del paso 1.4

**Estado (20 nov 2026): DISEÑO v2 de Codex sobre el borrador de T3, tras dos revisiones independientes (GLM y DeepSeek respondieron FALLA al borrador; hallazgos adjudicados en el [recibo](../evidence/lv019-b-t3-diseno-1-4-20261120/RECIBO.md)); el paso 1.4a (C-3, E-3, 3b y la alerta D-4) está implementado y certificado en local el 22 nov ([recibo](../evidence/lv019-b-t3-codificacion-1-4a-20261121/RECIBO.md)); el estado del desbloqueo auditado y A-5/E-4 (paso 1.4b) se sigue en el [backlog](../../backlog.md).** El borrador de T3 (solo lectura del código) se conserva en el historial de git y **no es vigente**. **Paso 1.4** del [plan paso a paso](LV-019-B-plan-paso-a-paso-20261120.md), que exige: «que un fallo transitorio tras un ACK no deje un bloqueo permanente (C-3, E-3: reintentos acotados antes de la cuarentena; el bloqueo permanente solo con una divergencia demostrada); protocolo auditado de desbloqueo; alerta de bloqueo solo en Video (D-4); salida para reservas de una cuenta bloqueada (A-5, E-4)». Depende del paso 1.1 (Video ya usa la liquidación parcial y la liberación posadmisión) y del [doble ACK](LV-019-B-doble-ack-liquidacion.md) (ya corregido). La evidencia de partida es el [mapa de caídas Video↔Cuenta](../reviews/LV-019-B-mapa-caidas-video-cuenta-20261120.md). **Codex adjudica; otros revisores lo contrastarán.** Nada se despliega (puerta G0).

## 0. Aviso de fiabilidad

El [mapa de caídas](../reviews/LV-019-B-mapa-caidas-video-cuenta-20261120.md) declara que solo cinco puntos fueron verificados por Codex y que «el resto de las filas no se ha verificado de forma independiente». En este documento marco cada hecho con `archivo:línea`; los que provienen del mapa y no he reconfirmado llevan **(mapa, sin reconfirmar)**. Los números de línea pueden variar con el tiempo.

---

## 1. Punto de partida del diseño (20 nov; histórico)

Esta sección conserva las observaciones usadas para redactar el diseño. Algunas carencias ya tienen implementación local; no describen por sí solas el estado actual. Consulta [backlog](../../backlog.md) y las secciones posteriores para el corte vigente.

### 1.1 El bloqueo y su carencia de desbloqueo

- **Video** escribe el bloqueo del dueño en el documento `billingGuards/<accountId>` con `{accountId, blocked:true, lastIncidentId|lastOutboxIncidentId, updatedAtMs}` desde `quarantineExternalBillingOutbox` (`server/commercial/firestoreBackend.ts:1569`), desde `recordExternalBillingReview` (`:964`) y desde las dos rutas de incertidumbre directa (`:450`, `:1022`). En el código examinado no se escribe `blocked:false` fuera de pruebas. El lector actual trata un documento ausente o `blocked:false` con el dueño correcto como no bloqueado; un documento presente sin el campo, con dueño distinto o con valor no booleano provoca `invariant` (`firestoreBackend.ts`, `billingBlocked`).
- **Cuenta** bloqueaba con `blockVideoBilling`, idempotente por incidente, y entonces carecía de un método de desbloqueo. El protocolo auditado se implementó después en local; su estado y pruebas se siguen en el backlog. El guard de Cuenta define el predicado `billingHold`, que exige `blocked===true`.
- El mapa inicial registró como riesgo que no hubiera una escritura de desbloqueo. La implementación posterior no acredita por sí sola recuperación completa ni apertura a clientes.

### 1.2 C-3 · fallo transitorio tras un ACK que se vuelve bloqueo permanente

- El drenador de salidas hace: `markExternalBillingSettled` y, si devuelve `false`, `quarantineExternalBillingOutbox(..., {phase:'after_ack', ...})` (`server/commercial/firestoreAi.ts:261-262`, dentro del bucle `:244-269`).
- `markExternalBillingSettled` exige relectura idéntica de la instantánea de 14 documentos y que la fila siga en `pending|retry_wait` (`firestoreBackend.ts:1502-1513`, condiciones en `:1506-1507` y `:1510`).
- `quarantineExternalBillingOutbox` en `after_ack` (con dueño verificado) escribe: incidencia `needs_review` (`:1559-1564`), fila `needs_review` si no estaba `settled` (`:1566`), evento de hold (`:1568`) y **guarda bloqueada** (`:1569`). Devuelve `{state:'needs_review',ownerBlocked:true,incidentId}` (`:1572`).
- La corrección de doble ACK **sí** exime el caso «otro drenador ya liquidó esta misma fila con su historia intacta»: `already_settled` sin escribir nada (`:1536-1539`), y se prueba que en `after_commit` no hay incidencia ni bloqueo (`billingSettlementAckPersistence.emulator.mjs:113`).
- **Lo que sigue siendo C-3:** si el fallo es transitorio pero la fila aún no quedó `settled` (por ejemplo, la escritura local no llegó a commit), el mismo `after_ack` crea incidencia y bloquea al dueño en el primer intento, sin reintento previo. La prueba `before_commit` afirma justamente estado `needs_review` con ACK (`billingSettlementAckPersistence.emulator.mjs:110`).

### 1.3 E-3 · cierre local hecho con respuesta perdida que bloquea por «cierre no verificado»

- `confirmedIntentObservation` intenta cerrar y, si el cierre lanza (respuesta perdida tras commit), reintenta por la vía de observación confirmada (`firestoreAi.ts:76-85`).
- En `resolveConfirmedIntentObservation` (`firestoreBackend.ts:971-1027`), la ruta **directa** (fuentes `status`/`release_ack`/`seal_ack`) calcula `historyMatched` con `matchingDirectObservation` (`:1001-1003`), y `validDirectObservationDocs` **exige** que la intención esté en `reserve_pending`/`release_pending` (`:402`). Si el cierre ya se escribió y quedó `closed`, esa comprobación falla, `canClose` es falso (`:1009`) y se registra la revisión `remote_ack_closure_unverified` (`:1012`) con bloqueo del dueño (`:1022`). El comentario del propio código lo declara: «even an apparently identical direct retry goes to review» (`:1004-1007`).
- Las pruebas lo afirman como bloqueo permanente: «a locally committed release with a lost response remains under review» (estado `closed` + guard `blocked:true` + razón `remote_ack_closure_unverified`, `firestoreAi.emulator.mjs:903-911`) y su gemela de sellado (`:914-923`). La ruta de recuperación por `resolution_status` sí tiene su salida `already_closed` (`:1008`), pero **no** la directa: ese es el hueco E-3.

### 1.4 Reintentos y topes que ya existen

- `EXTERNAL_BILLING_ATTEMPT_LIMIT = 8` (`firestoreBackend.ts:49`), alias `EXTERNAL_BILLING_CONFLICT_ATTEMPT_LIMIT` (`:51`). Retardo `min(15 min, 1 s·2^min(n,10))` (`:1452`, `:1481`, `:1109`).
- Tope de intentos solo en `recordExternalBillingFailure` (`:1456`, todo código salvo `unavailable`), con `unavailable` exento («transient infrastructure», comentario `:1453-1455`) y `too_early` que reprograma `UNKNOWN_RESOLUTION_MIN_AGE_MS` sin contar (`:1440-1441`, `:1451`). `server/account/settlementContract.ts:15` con `15*60_000`.
- **Huecos de tope:** `recordExternalHoldFailure` (`:1098-1111`) incrementa `attempts` con la misma fórmula pero **sin tope**; el registro de fallo de intención (`:1461-1483`) tampoco tiene tope; y `recordExternalBillingFailure` devuelve `false` sin contar cuando el guard está bloqueado (`:1475`), de modo que bajo bloqueo una liberación debida no avanza ni cuenta.

### 1.5 D-4 · bloqueo en revisión sin bloqueo en Cuenta y sin alerta

- Una fila de hold cae a `needs_review` local sin llegar a bloquear Cuenta en `authorizeExternalHold`, que escribe el motivo en la propia fila (`firestoreBackend.ts:1075` `invalid_scheduling_metadata`, `:1076` `invalid_due`, `:1079` `invalid_event`, `:1084` `owner_or_incident_unverified`) y devuelve `{state:'needs_review'}` — **no toca el guard**. Se prueba que no hay llamada a Cuenta y la fila queda `needs_review` (`firestoreAi.emulator.mjs:1686-1691`).
- El reporte de solo lectura **ya** lista esas filas: `billingHoldOutbox` con estados `['pending','needs_review']` (`billingPendingReport.ts:20`), y `attentionOf` las marca `needs_review` (`:52`).
- La alerta durable **ya** existe y es idempotente: `alertKey(kind,rowId,state,reason)` con hash (`billingPendingAlerts.ts:22-23`), una transacción por alerta (`:50-57`), sin umbral de edad por defecto (`:5`, `:18`), cierre solo si la fila se relee terminal dentro de la transacción (`:143-152`). El barrido que las encadena es `runPendingSweep` (`billingPendingSweep.ts:30`).
- **El hueco D-4** es que ese barrido/alerta «nada los invoca» (mapa, sección «estados que pueden quedarse para siempre»): una fila de hold `needs_review` sin bloqueo en Cuenta queda invisible hasta que alguien ejecute el barrido. El ejecutor periódico es el paso 1.6 y su candado ya existe (`server/commercial/billingDrainLease.ts`).

### 1.6 A-5 y E-4 · reservas y liberaciones de una cuenta bloqueada

- **Cuenta bloquea la entrada y la salida por igual:** `reserveVideo` rechaza si `blocked` (`server/account/backend.ts:262`), `admitVideoCall` rechaza si `blocked` (`:311`) y **`settleVideo` rechaza tanto captura como liberación si `blocked`** (`:381`, rama `state==='reserved'`). El mapa lo resume en P2: «el hold bloquea también capturas y liberaciones».
- **Una reserva `reserved` de una cuenta bloqueada no tiene salida** por código: `settleVideo` es el único camino y falla en `:381`; no hay TTL ni vencimiento (mapa, P1). Retiene saldo `reserved` y un cupo `active` (`maxActiveVideoReservations = 3`, `backend.ts:11`; `:263` devuelve `quota` al llegar).
- En **Video**, la cerca y la preparación del cierre también fallan cerradas bajo bloqueo: `fenceExternalBillingRelease` (`firestoreBackend.ts:886-899`, guardia en `:805`), `prepareTerminalFromDirectObservation` (`:830`, guardia en `:803`); y la captura de evidencia directa devuelve `null`/`false` si el guard está bloqueado (`validDirectObservationDocs`, `:400`). Por eso A-5 registra «la captura de evidencia devuelve null si está bloqueada» y E-4 «liberación debida con un bloqueo: sin prueba».
- **Contadores que pueden divergir:** Video lleva `active` en su propia cuenta y lo decrementa al terminar (`firestoreBackend.ts:1253` y `:1413`), Cuenta lleva `active` aparte (`backend.ts:263`, `:388-391`) (**mapa, sin reconfirmar** en el detalle).

### 1.7 Piezas ya construidas que este diseño reutiliza

- **Protocolo de disposición auditada (ya existe):** `recordDisposition` (`server/commercial/billingPendingAudit.ts:43-69`) crea un registro de auditoría inmutable y actualiza la alerta **en la misma transacción**: `acknowledge` deja la alerta abierta, `resolve` (exige `evidenceRef`, `:38`) la cierra `dispositioned`; una repetición idéntica es `replayed:true` sin escrituras (`:51-55`), cualquier carga distinta para la misma alerta/acción es `conflict`; el `auditId` es determinista (`:28-30`). El módulo declara que **no mueve saldo, no llama a Cuenta y no edita filas de facturación** (`:4-7`) y que las precondiciones para el endpoint —autor autenticado en lista permitida y reloj del servidor— no las puede verificar él (`:11-14`).
- **Endpoint de operador (futuro A5):** `billingOperatorHttp.ts` expone `list`/`detail`/`acknowledge`/`resolve` (`:70-73`), responde 404 en todo salvo configuración completa (`:79`), y llama a `recordDisposition` (`:129`). La configuración falla cerrada desde entorno (UIDs de operador, secreto, ventana de reautenticación, limitador) con lista de variables faltantes, nunca valores (`billingOperatorConfig.ts:5-9`, `:44-60`). El plan lo reserva para el paso 3.5 (servicio de operador nuevo, ingreso `all` sin invocadores públicos, IAM + token Firebase + UID del dueño).
- **Candado del ejecutor (1.6a):** `billingDrainLease.ts` con arriendo `billingDrainLease/current`, token creciente, TTL 90 s, margen 15 s, renovación 10 s, tenencia máxima 120 s y cursores `['intents','outbox','holds']` (`:17-18`, `:29`, `:31`, `:33-39`); declarado explícitamente como **optimización, nunca la garantía de seguridad** (`:4-7`).

---

## 2. Decisiones

1. **Transitorio no bloquea; divergencia demostrada sí.** Un fallo tras un ACK que solo prueba una avería local (escritura que no llegó a commit, respuesta perdida) **no** debe crear bloqueo permanente: se reintenta acotado y, si el historial sigue intacto, se resuelve solo. El bloqueo permanente solo se conserva cuando la relectura **demuestra** que la historia cambió respecto de la instantánea previa al POST.
2. **La prueba de divergencia es la versión de los documentos.** El discriminador es el que ya usa el doble ACK: los 13 documentos distintos de `billingOutbox` deben conservar exactamente su versión (existencia, `createTime`, `updateTime`) de antes del POST (`firestoreBackend.ts:1537-1538`). Si alguno cambió, hay divergencia demostrada y se mantiene incidencia + bloqueo.
3. **Reutilizar el tope y la espera que ya existen** antes de inventar otros: `EXTERNAL_BILLING_ATTEMPT_LIMIT = 8` y `min(15 min, 1 s·2^min(n,10))`. Los mismos números para las filas de hold (que hoy no tienen tope) y para el cierre E-3. **`unavailable` sigue exento del tope** (infraestructura transitoria: un corte de Firestore o de Cuenta de unos minutos no puede convertir filas sanas en revisión manual; lo acota la edad máxima del ejecutor, paso 1.6); cuentan los fallos que prueban un problema de la fila (`invalid`, `conflict`, historia distinta, cierre no verificable).
3b. **Un ACK divergente nunca se silencia.** Si la liquidación llega y `markExternalBillingSettled` o la relectura lanzan `invalid` (p. ej. el ACK no corresponde a la acción de la fila), el drenaje **registra la incidencia** (`needs_review`, sin captura ni liberación nueva) en vez de absorber el error: hoy el `catch` del drenaje (`firestoreAi.ts:266`) deja la fila `pending` sin alerta. Se prueba con una captura cuya reserva ya estaba liberada.
3c. **Re-enviar tras un ACK no duplica saldo.** Cuenta es idempotente por (reserva, acción): repetir el POST devuelve el mismo asiento con `settled:false`. Por eso el reintento acotado del caso transitorio (§3.1) puede volver a pasar por el envío sin riesgo; no hace falta un estado intermedio nuevo (`ack_received`). La observación del ACK ya recibido se conserva en la propia fila si la relectura lo permite; si no, el reenvío reproduce el ACK idéntico.
4. **Un solo operador, el dueño, y solo por la herramienta de operador (A5).** El desbloqueo es una acción **humana auditada**, no automática; la ejecuta únicamente el dueño mediante la herramienta de operador del paso 3.5, con la misma forma que `recordDisposition`. Nunca desde el cuerpo de la petición: la identidad sale de IAM + token Firebase + UID en lista permitida (`billingOperatorConfig.ts:5-9`).
5. **Alerta de bloqueo solo en Video.** La alerta que anuncia un bloqueo o una fila de hold en revisión se deriva del reporte de pendientes de Video (`billingPendingReport.ts`) y la levanta el barrido de Video (`billingPendingAlerts.ts` + `billingPendingSweep.ts`), **sin depender de Cuenta** y sin llamarla. Cuenta no alerta.
6. **De una cuenta bloqueada: nunca capturar; solo liberar, con prueba.** Una reserva `reserved` sin admisión de proveedor se libera con la liberación simple; una con admisión almacenada exige la admisión + la resolución (`no_speech`/`not_delivered`/`unknown_expired`) que Cuenta ya soporta (`backend.ts:383-387`, `settlementContract.ts:6`). Capturar exige trabajo `succeeded` con intento coincidente (`firestoreBackend.ts:1447`) y no ocurre bajo bloqueo.
7. **Una liberación debida bajo bloqueo se pausa, no se pierde.** Se detiene sin contar intentos y se reanuda tras el desbloqueo auditado; la alerta de «liberación debida» viene del reporte de Video (intención `release_pending`, salida `pending|retry_wait`, `billingPendingReport.ts:18`, `:21`).
8. **El desbloqueo no depende del candado del ejecutor.** El arriendo serializa pasadas, no decisiones humanas; exigir el candado para desbloquear haría que un drenaje atascado bloqueara también la recuperación.

---

## 3. Mecanismo propuesto

### 3.1 C-3 · reintentos acotados antes de la cuarentena

**Discriminación (dentro de `quarantineExternalBillingOutbox`, fase `after_ack`).** Antes de crear incidencia y bloquear, releer la instantánea completa:

- **Caso ya cubierto (`already_settled`):** la fila está `settled` con la tupla esperada y los 13 documentos conservan su versión → devolver `{state:'already_settled',ownerBlocked:false}` sin escribir (`:1536-1539`). Sin cambio.
- **Caso transitorio (nuevo):** la fila **no** está `settled`, pero la relectura de los 13 documentos devuelve versiones **idénticas** a las de la instantánea previa al POST y la fila sigue `pending|retry_wait` con la tupla esperada. Esto prueba que la historia no cambió y que solo falló el marcado local. **No** se crea incidencia ni bloqueo: se incrementa `attempts` y se reprograma `retry_wait` con `nextAttemptAt = now + min(15 min, 1 s·2^min(n,10))`, igual que `recordExternalBillingFailure` (`:1452`).
- **Caso divergencia demostrada (se conserva el comportamiento actual):** cualquier documento distinto de `billingOutbox` cambió de versión, o la tupla de la fila difiere, o el ACK no coincide con la acción. Incidencia `needs_review` + hold + guard bloqueado (`:1559-1572`). Esto cubre los casos que ya prueban las pruebas «changed … after capture send» y `billingSettlementOwnershipDuringAck.emulator.mjs:102-113`.
- **Tope:** al agotar `EXTERNAL_BILLING_ATTEMPT_LIMIT`, la fila pasa a `needs_review` **con alerta** (reporte de Video) y **sin** bloqueo del dueño: mismo patrón que `recordExternalBillingFailure` (`:1453-1456`, probado en `firestoreVideoSettlementC2a.emulator.mjs:434-449`, y `:537` «needs_review must not block the owner»). El bloqueo permanente queda reservado a la divergencia demostrada.

> Distinción explícita: **fallo transitorio** = avería local que la relectura desmiente (versiones intactas, fila aún no terminal). **Divergencia demostrada** = la relectura prueba que la historia cambió.

### 3.2 E-3 · cerrar la salida de un cierre directo ya verificado

La ruta de recuperación ya tiene `already_closed` (`firestoreBackend.ts:1008`). Para la ruta **directa**, la decisión es aceptar el cierre idéntico cuando la intención **ya** está `closed` con la misma tupla y la evidencia directa se puede atestiguar:

- Permitir que `validDirectObservationDocs` (o su llamador) acepte `row.state === 'closed'` **solo** en la comprobación de «ya cerrado» cuando: (a) la intención es la misma (`id`, `accountId`, `requestKey`, `inputId`, `operation`, `revision`, `matchesExternalBilling`), (b) los campos de confirmación coinciden con la observación (`releaseConfirmed`/`releaseReservationId`/`releaseSeconds` o `sealConfirmed`/`sealReservationId`/`sealSeconds`, la forma que ya usa `identicalClosed` en `:1000`), y (c) no hay solicitud ni marca de trabajo (`jobless`, `:998`).
- Resultado: `{state:'already_closed',ownerBlocked:false}`. Es el mismo criterio que la ruta de recuperación (`:1008`), aplicado a la directa; no inventa autoridad nueva, solo reconoce un cierre ya escrito que la relectura reproduce.
- Si la tupla **no** coincide (otra reserva, otros segundos, otra acción, o un cierre sin confirmación), se mantiene `needs_review` + bloqueo como hoy.
- Mientras no se aplique, un cierre directo reintentado se comporta como transitorio (§3.1): reintento acotado antes de la cuarentena, con el mismo tope. **Dónde se cuenta:** este camino corre por `resolveConfirmedIntentObservation`, que **no** pasa por `recordExternalBillingFailure`; se cuenta en `attempts` de la propia **intención** con el código `closure_unverified`, la misma espera `min(15 min, 1 s·2^min(n,10))` y el mismo tope de 8, tras el cual la intención pasa a `needs_review` con alerta (y, solo si la relectura prueba historia distinta, con bloqueo).
### 3.3 Desbloqueo auditado (quién, evidencia, escrituras, auditoría, unicidad y orden)

La operación de Cuenta está certificada en local ([recibo de la pieza 1](../evidence/lv019-b-t3-codificacion-1-4b-20261123/RECIBO-pieza-1.md)). El estado de la integración con Video y la salida bajo bloqueo se registra en el [backlog](../../backlog.md) y en el [plan maestro](../../MASTERPLAN.md).

**Quién lo ejecuta.** Solo el dueño, por la herramienta de operador (paso 3.5), reutilizando `recordDisposition` (`billingPendingAudit.ts:43`) y sus precondiciones declaradas: `authorizedBy` **proviene de un principal autenticado en lista permitida, nunca del cuerpo**, y `nowMs` es el reloj del servidor (`:11-14`; config en `billingOperatorConfig.ts:44-60`).

**Evidencia exigida.**

- La alerta objetivo debe existir y estar `open` (`billingPendingAudit.ts:49`, `:56`).
- `evidenceRef` es **obligatorio** para `resolve` y acotado a 200 caracteres sin controles (`:37-38`): la referencia durable a la evidencia revisada (por ejemplo, el `incidentId` del bloqueo o la captura de Cuenta que muestra la reserva ya terminal).
- La operación de desbloqueo exige además el **identificador exacto del incidente** que causó el bloqueo (`lastIncidentId`/`lastOutboxIncidentId`, `firestoreBackend.ts:1569`, `:964`) y la **época** del guard.

**Qué escribe, en orden (Cuenta primero, dos fases).** `recordDisposition` por sí solo **no puede** editar filas de facturación (`billingPendingAudit.ts:4-7`), así que el desbloqueo es una operación nueva y propia, en dos fases con estado intermedio visible, y **se desbloquea primero Cuenta y después Video** (el orden contrario dejaría a Video habilitado mientras Cuenta sigue bloqueada y sin compensación si falla el segundo paso; en este orden, un fallo en Video deja a Video bloqueado, que es el lado conservador):

1. **Fase 0 · Precondiciones (Video, lectura transaccional).** Comprobar: la alerta objetivo está `open`; `evidenceRef` presente; el guard sigue en la misma época y `updatedAtMs` que nombra el operador (relectura dentro de la transacción); y **no quedan filas `needs_review` de esa cuenta sin resolver** (salidas, intenciones, holds ni incidencias) salvo las que el propio desbloqueo nombre con su relectura coincidente. Si queda una divergencia sin resolver, **no se desbloquea**: el bloqueo se creó justamente para impedir mover saldo sobre ella.
2. **Fase 1 · Registro auditado en Video** (`unblock_requested`). Una clave determinista por incidente, época, fecha de creación del bloqueo y acción identifica el registro, que preserva el dueño, autor autenticado, evidencia, nota, primera generación consultada de Cuenta y filas revisadas.
3. **Fase 2 · Cuenta.** La mutación exige la generación exacta de Cuenta, revisa el incidente y guarda un recibo inmutable en una sola transacción. Cuenta elimina su bloqueo cuando se revisa el último incidente. Cada nuevo bloqueo del mismo origen lleva un identificador distinto.
   - Al reanudar, Video comprueba que corresponden la solicitud, el operador, el dueño, la ocurrencia del bloqueo y su alerta. La solicitud conserva el `updatedAtMs` que el operador comprobó en la primera autorización; no se exige que la hora actual sea idéntica si una escritura idempotente volvió a nombrar el mismo incidente sin cambiar su época ni `createdAtMs`. La reanudación exige la carga auditada original y la misma ocurrencia; cuando se consume un recibo confirmado, compara además las versiones de guardia y solicitud observadas durante esa reanudación antes de cerrar Video. Esto no reconstruye cambios anteriores a su primera lectura ni implica atomicidad entre bases. El principal de liquidación consulta `/api/internal/video/billing-holds/unblock-receipt` con la identidad, el incidente exacto de Cuenta y la referencia de evidencia. La lectura valida el dueño, el incidente revisado y su recibo y devuelve la generación aceptada junto con el estado del bloqueo de Cuenta observado en esa transacción. Una confirmación perdida se recupera sin otra mutación.
   - Para un incidente activo sin recibo, Cuenta devuelve un estado explícito `pending`. Ese estado no demuestra que una solicitud anterior haya terminado: por sí solo no autoriza reenviar la mutación al reanudar. En la candidata local, el primer envío requiere una solicitud nueva y un reclamo durable registrado antes del envío; esto no demuestra por sí solo la exclusión de todos los escritores. Si ya existe el reclamo y el recibo continúa pendiente, Video conserva el bloqueo. Resolver ese estado requiere una conciliación y garantías entre escritores que aún no están implementadas. Un error de lectura, una evidencia diferente o un resultado incoherente también deja el bloqueo en revisión. En un desbloqueo parcial ya registrado, Video requiere que la generación confirmada coincida con la que guardó.
4. **Fase 3 · Video** (`unblocked`). Tras confirmar Cuenta, Video comprueba en una transacción el dueño, el incidente y la generación del bloqueo, la alerta y las filas auditadas. Registra la generación que aceptó Cuenta y avanza solo las filas de ese incidente. Conserva el bloqueo si Cuenta reporta otros incidentes abiertos o si Video detecta otras filas pendientes. Si ya adelantó las filas, una reanudación confirmada puede registrar `video_released` y cerrar la alerta cuando desaparezcan ambos impedimentos. Cuenta sigue siendo la autoridad para reservar y liquidar saldo.

**Registro de auditoría que deja.** Uno por (incidente, acción), inmutable, con autor, evidencia, nota y marca de tiempo del servidor — estructuralmente igual a `billingPendingAudit` (`:65`), más el `epoch` del guard desbloqueado.

**Qué impide un desbloqueo duplicado o fuera de orden.**

- **Duplicado:** el `auditId` determinista (`:28-30`) hace que una repetición idéntica sea `replayed:true` **sin escrituras** (`:51-55`); una carga distinta es `conflict`.
- **Fuera de orden:** el guard lleva `epoch`/`incidentCount` que crecen con cada incidente (`backend.ts:196-200`); el desbloqueo debe nombrar la época **y** el `createdAtMs` del guard (al borrarlo en Cuenta y volver a bloquear, la época vuelve a 1: sin `createdAtMs` un desbloqueo antiguo podría coincidir por accidente) y solo aplica si ambos coinciden, de modo que un desbloqueo antiguo no puede limpiar un bloqueo más nuevo. En Video basta la lectura y escritura dentro de la **misma transacción** del guard (Firestore la serializa): un bloqueo concurrente entre la lectura y la escritura aborta y reintenta, no se pisa.
- **Re-bloqueo:** un nuevo incidente vuelve a crear/incrementar el guard (comportamiento actual, `:199-200`); el desbloqueo no lo impide, solo deja rastro.

### 3.4 D-4 · alerta de bloqueo solo en Video, idempotente con el barrido A2

- La alerta se deriva del **reporte de Video**: `billingHoldOutbox` en `pending|needs_review` (`billingPendingReport.ts:20`) y, en general, cualquier fila no terminal que necesite atención. `attentionOf` marca `needs_review` (`:52`) y `raisePendingAlerts` levanta la alerta (`billingPendingAlerts.ts:74-80`). **Sin llamada a Cuenta.**
- **Idempotencia con A2:** la clave `alertKey(kind,rowId,state,reason)` (`:22-23`) hace que la misma fila, estado y motivo generen **una sola** alerta aunque el barrido se repita; `raiseOne` corre en una transacción y bajo concurrencia solo un escritor crea y los demás cuentan un avistamiento (`:49-57`). El cierre es solo tras releer la fila terminal **dentro** de la transacción (`:143-152`); `superseded` cubre el cambio de estado con relevo (`:124-140`).
- **Caso D-4 explícito:** una fila de hold que va a `needs_review` por `invalid_scheduling_metadata`/`invalid_due`/`invalid_event`/`owner_or_incident_unverified` (`firestoreBackend.ts:1075-1084`) **sin** bloquear Cuenta produce alerta por la vía anterior, porque el reporte la ve como `needs_review`. Lo que falta no es la alerta, es **quien ejecute el barrido** (pasos 1.6/3.4).
- **Alerta de bloqueo propiamente dicha:** `PENDING_SOURCES` ya incluye `guard` y consulta `billingGuards` con `blocked == true`. El barrido puede generar una alerta de la ocurrencia bloqueada, distinta de las alertas de sus filas y deduplicada por su clave. Las verificaciones de forma detectan referencias presentes inválidas y evitan atribuir un titular dudoso; un identificador con forma válida no demuestra que exista o pertenezca al titular el documento referenciado. La consulta ordinaria tampoco descubre una alerta persistente cuyo estado tenga un tipo inesperado. El inventario de integridad separado sigue pendiente. El reporte lee solo una raíz de Video y no llama a Cuenta. [Límites y pruebas](../reviews/LV-019-B-sondeo-alerta-auditoria-local-20261126.md).
### 3.5 A-5/E-4 · salida para reservas de una cuenta bloqueada

- **Nunca capturar.** Bajo bloqueo no hay trabajo `succeeded` con intento coincidente que autorice una captura (`firestoreBackend.ts:1447`) y la política es «no se cobra si fallamos» (decisión del dueño; contrato en la [liquidación parcial](LV-019-B-liquidacion-parcial-y-liberacion-posadmision.md)).
- **Liberar con prueba:**
  - Reserva `reserved` **sin** admisión de proveedor → liberación simple (la rama `reserved` con `previous===null` no exige admisión, `backend.ts:383-387`).
  - Reserva `reserved` **con** admisión almacenada → exige la admisión suministrada que coincida **más** la resolución de Video `{kind, evidenceSha256}` (`backend.ts:384-386`, `settlementContract.ts:18`); para `unknown_expired`, la edad mínima `UNKNOWN_RESOLUTION_MIN_AGE_MS` (`:386`, `settlementContract.ts:15`).
  - La **prueba** que habilita la liberación es el propio documento de la reserva (estado, admisión almacenada, resolución) releído dentro de la transacción que mueve el saldo (`:388-396`), más la evidencia durable de Video en el hash.
- **Una liberación debida bajo bloqueo** (intención `release_pending`, o salida de liberación `pending|retry_wait`) se **pausa**: `fenceExternalBillingRelease`/`prepareTerminalFromDirectObservation` fallan cerradas bajo bloqueo (`:805`, `:803`) y `recordExternalBillingFailure` devuelve `false` sin contar (`:1475`). Decisión: tratarla como **diferida sin contar intentos** y reanudarla tras el desbloqueo; su visibilidad y alerta vienen del reporte de Video (§3.4). Nunca se convierte en `needs_review` por reintentos mientras el único obstáculo sea el bloqueo.
- **Cupo `active>=3`:** una reserva atrapada retiene un cupo (`backend.ts:11`, `:263`); con hasta tres atrapadas la cuenta no puede crear trabajo. Al desbloquear y liberar, `active` decrementa en Cuenta (`:390`) y en Video (`firestoreBackend.ts:1413`); el desbloqueo comprueba coherencia con `accountReconciliationCounts.ts` (`reservedMismatch`/`activeMismatch`) y con el reporte de Video para no dejar los contadores divergentes.

### 3.6 Interacción con el candado del ejecutor (1.6) y con `active>=3`

- **Candado:** el desbloqueo es una decisión humana; **no** toma `billingDrainLease` (que es «optimización, nunca la garantía», `billingDrainLease.ts:4-7`). Los drenajes que reanudan trabajo tras el desbloqueo sí pasan por el candado, y un hipo del candado no puede impedir la recuperación.
- **`active>=3`:** el desbloqueo y la liberación deben devolver el cupo; se prueba que tras liberar una reserva atrapada la cuenta vuelve a poder crear trabajo y que `active` coincide en ambos lados.

---

## 4. Pruebas exigidas (primero en rojo), una por ventana del mapa, con sus negativos

Todas con `AccountStore` real y el emulador (`FIRESTORE_EMULATOR_HOST=127.0.0.1:8185`), como exige el plan.

**C-3 (transitorio vs permanente)**

1. `after_ack` con fallo local y **versiones intactas** → `retry_wait` con `attempts+1` y `nextAttemptAt` futuro; **cero** incidencias, guard sin `blocked`. **Negativo:** el mismo intento con **una** versión de los 13 documentos cambiada → incidencia + guard `blocked:true` (cubre `billingSettlementOwnershipDuringAck.emulator.mjs:102-113`).
2. Al agotar `EXTERNAL_BILLING_ATTEMPT_LIMIT` con versiones intactas → `needs_review` **con alerta** (reporte) y **sin** bloqueo; la fila nunca se reintenta después.
3. `after_commit` (la escritura sí llegó, respuesta perdida) → `settled`, sin incidencia, sin bloqueo (ya probado en `billingSettlementAckPersistence.emulator.mjs:113`; se conserva como negativo).

**E-3 (cierre directo con respuesta perdida)**

4. `finishExternalBillingRelease`/`finishExternalBillingSeal` commitean y lanzan; el reintento → `already_closed`, **sin** bloqueo. **Negativo:** la misma llamada con tupla distinta (otra reserva/segundos/acción) → `needs_review` + bloqueo (hoy `firestoreAi.emulator.mjs:903-911`, `:914-923`).
5. Replay directo idéntico sobre una intención `closed` → `already_closed`; replay con la intención `closed` pero con confirmación ausente → `needs_review` (negativo).

3b. **ACK divergente no se silencia:** una captura cuya reserva ya está liberada en Cuenta: el ACK no corresponde a la acción, el drenaje registra la incidencia `needs_review` (una sola) y no deja la fila `pending` sin alerta; **ninguna** captura ni liberación nueva.
3c. **`unavailable` no castiga:** un corte simulado de Firestore o de Cuenta con más de ocho pasadas deja la fila en `retry_wait` (sin `needs_review`, sin bloqueo); un error permanente sí lo hace al octavo intento.

**D (bloqueo y holds)**

6. D-4: fila de hold a `needs_review` por `invalid_scheduling_metadata`/`invalid_due`/`invalid_event`/`owner_or_incident_unverified` → **una** alerta derivada del reporte de Video, **cero** llamadas a Cuenta (`firestoreAi.emulator.mjs:1686-1691` como base). **Negativo:** ejecutar el barrido dos veces no duplica la alerta (una creación, N avistamientos).
7. Hold con dueño no verificado → `needs_review` sin bloquear a nadie (`firestoreAi.emulator.mjs:1703-1708`); un hold corrupto huérfano no bloquea la cuenta nombrada solo en el evento (`:1695-1701`).

**A-5 (reserva de cuenta bloqueada)**

8. Cuenta bloqueada con reserva `reserved` **sin** admisión → al desbloquear, liberación simple: saldo y cupo recuperados, `active` coherente en ambos lados. **Negativo:** con admisión almacenada y **sin** resolución → `conflict`, no mueve nada (contrato `backend.ts:384-386`).
9. Bloqueo que llega tras el recheck y antes de crear reserva → la cuenta queda bloqueada y la reserva **no** se captura nunca; evidencia directa devuelve `null` mientras dure el bloqueo (`firestoreBackend.ts:400`, base `firestoreAi.emulator.mjs:445-456`).

**E-4 (liberación debida bajo bloqueo)**

10. Intención `release_pending` con guard bloqueado → la fila se **pausa sin contar intentos** y sigue visible/alertada por el reporte; tras el desbloqueo, la liberación se aplica una sola vez. **Negativo:** sin bloqueo, la misma fila se libera de inmediato.

**Desbloqueo auditado**

11. Desbloqueo completo (con Cuenta real): registro de auditoría de Video → **Cuenta borra el guard (no escribe `blocked:false`)** → Video lo libera y avanza solo las filas del incidente; después, `reserveVideo`, `admitVideoCall` y `settleVideo` funcionan de nuevo en Cuenta (prueba directa del `invariant` que el borrador pasaba por alto); segunda llamada idéntica → `replayed` **sin** escrituras; carga distinta → `conflict`. **Negativos:** `evidenceRef` ausente → `invalid`; alerta inexistente o no `open`; **quedan filas `needs_review` de la cuenta sin resolver → no se desbloquea**; un segundo incidente que llega entre la lectura y la escritura aborta el desbloqueo y no se pisa; **falla la fase de Cuenta → Video sigue bloqueado**; falla la fase de Video tras Cuenta → Video sigue bloqueado, la repetición lo completa.
12. Un desbloqueo que nombra una época o un `createdAtMs` antiguos del guard (incluido el caso de época 1 repetida tras borrar y volver a bloquear) → rechazado. **Negativo:** el desbloqueo con la época y la fecha vigentes sí aplica. 12b. **Alerta de cuenta bloqueada** (fuente `guard`): una alerta por cuenta y época, sin duplicar al repetir el barrido; un guard sin hold ni incidencia se marca `malformed`.

**Candado y cupo**

13. El desbloqueo funciona con el candado del ejecutor retenido por otro (`billingDrainLease/current` ocupado) — no lo exige; y una pasada de drenaje que despierta tarde no puede mover saldo dos veces tras un desbloqueo (seguridad por idempotencia de Cuenta, `billingDrainLease.ts:4-7`).
14. `active>=3`: con tres reservas atrapadas la cuenta devuelve `quota`/`conflict` (`backend.ts:263`, `firestoreBackend.ts:1253`); tras liberar una, vuelve a admitir; los contadores no divergen.

**Mutations y regresión**

15. Mutar cada condición nueva (el discriminador de versiones, el tope, la aceptación de `closed`, la exigencia de evidencia, la época del guard) y comprobar que alguna prueba lo detecta; después, **regresión financiera completa** en emulador.

---

## 5. Fuera de alcance

- El ejecutor periódico y su cableado (paso 1.6b); el barrido en la nube (paso 3.4) y la entrega por correo (decisión del dueño).
- El servicio de operador alojado (paso 3.5; hoy solo existe el endpoint local) y los permisos IAM (los hace el dueño).
- La captura parcial de voz y el plazo de `unknown` (pasos 1.1/1.2 y C2/C3).
- Cualquier movimiento de saldo nuevo: este diseño **no** captura y **no** cambia la política de cobro.
- La migración de datos legados y el inventario de fechas (paso 1.5).
---

## 6. Límites y riesgos (los cinco mayores)

1. **El mapa no está verificado en su mayor parte.** Solo cinco puntos los reconfirmó Codex (`docs/reviews/LV-019-B-mapa-caidas-video-cuenta-20261120.md`, cabecera). Las ventanas A-5/E-4 y la divergencia de contadores `active` provienen de filas no reconfirmadas; el diseño se apoya en el código que sí leí, pero los números de línea pueden cambiar.
2. **El desbloqueo es una capacidad nueva y sensible.** Hoy **no existe** ninguna escritura de desbloqueo en código no-test (`firestoreBackend.ts` solo escribe `blocked:true`; `backend.ts` no tiene método). Añadirla crea un camino que devuelve saldo y cupo: exige la herramienta de operador autenticada (A5) y la lista de UIDs, y es una **decisión del dueño** ponerla en marcha (marcada, no bloqueante).
3. **La alerta depende de que alguien ejecute el barrido.** D-4 se resuelve «solo en Video», pero mientras nada invoque `runPendingSweep`/`raisePendingAlerts` (pasos 1.6/3.4, hoy sin planificador), una fila `needs_review` sigue siendo invisible en la práctica: la alerta existe, pero no se levanta sola.
4. **El desbloqueo de Cuenta puede chocar con reservas abiertas.** Si el dueño no tiene reservas abiertas, borrar el guard es seguro; si las tiene, el orden importa (liquidar primero) o el saldo vuelve a quedar atrapado. La prueba 8 lo fija, pero el orden operativo es una **decisión del dueño**.
5. **Divergencia de contadores `active` entre Video y Cuenta.** Video decrementa antes que Cuenta (mapa, «3 reservas activas»); un desbloqueo mal secuenciado podría liberar cupo de un lado y no del otro. Mitigación: comprobar coherencia con `accountReconciliationCounts.ts` antes de cerrar, pero la conciliación fina podría necesitar su propio paso.

### Decisiones que dependen del dueño (marcadas, sin bloquear)

- **Poner en marcha el desbloqueo** (y por tanto la herramienta de operador A5) es una decisión de alcance comercial; hasta entonces, el bloqueo permanente sigue sin salida.
- **El canal de alerta** (el correo ya está recibido; el panel no) y quién atiende la alerta.
- **El orden operativo** de liquidar reservas atrapadas antes de borrar el guard en Cuenta.
- **Los valores de configuración** (tope de intentos 8, espera máx. 15 min, TTL del candado 90 s) son de arranque, ajustables con datos reales; no son política.
- **Atención a un `needs_review`:** el tope convierte fallos en revisión manual; sin un umbral de edad que fije el dueño, un `needs_review` solo se anuncia por la alerta ya existente (correo). Quién lo atiende y en cuánto tiempo es del dueño (paso 3.8).
- **Migración:** la época y `createdAtMs` del guard obligan a que los guards ya escritos (ninguno en producción hoy, las bases están vacías) los tengan; se verifica en el inventario del paso 1.5.

---

## 7. Cierre exigido por el plan

Cumplir el paso 1.4 exige: pruebas por **cada** ventana del mapa (C-3, E-3, D-1 a D-4, A-5, E-4 y el desbloqueo), mutaciones que rompan cada condición nueva y sean detectadas, **regresión financiera completa** en emulador, y revisión T3 de diseño y de código conservando todas las respuestas, también las FALLA. La evidencia se enlazará desde la bitácora y se registrará el estado en backlog, Gantt y HANDOFF en el mismo cambio.

