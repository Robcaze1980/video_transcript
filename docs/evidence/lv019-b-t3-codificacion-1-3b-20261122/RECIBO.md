# Recibo del paso 1.3b: repetición de la solicitud con ACK durable (camino del solicitante de A-3)

**Estado: certificado en local el 23 de noviembre de 2026 (sin desplegar).** Programó T3 (DeepSeek v4.1 Flash, instancia aislada `linguistvision-openrouter`) en un hilo nuevo con una entrega y una corrección; revisaron GLM Flash Latest y DeepSeek; certifica Codex. Contrato: [diseño v2](../../specs/LV-019-B-reserva-sin-trabajo-a3-diseno.md) (secciones 1.4, 2, 3.2, 3.3, 5 y 6). Con este paso A-3 converge por sus dos vías (1.3a: salida por plazo; 1.3b: repetición con ACK durable).

## Qué hace

1. **Intento inmutable antes del POST** (`prepareExternalReserveAttempt`): en una transacción relee los 14 documentos de la historia, rechaza una identidad revocada o reasignada, una guarda bloqueada, una intención que ya no está `reserve_pending`, cualquier trabajo existente (solicitud o marca) y cualquier fila terminal de sello o liberación, y crea el intento inmutable. **Sin intento confirmado no hay POST a Cuenta.**
2. **El POST queda atado al intento:** `FirestoreAi.enqueue` exige, antes de enviar, que identidad, `reservationId` y segundos del POST coincidan con el testigo preparado; si difieren falla cerrado sin POST.
3. **Ventana por documento** (`reserveAttemptWindow.ts`), comprobada dentro de la transacción que crea el trabajo: versión exacta para los 11 documentos que nadie reescribe en esa ventana (identidad, entrada, proyecto, origen, guarda de admisión, solicitud, marca de trabajo y las cuatro filas terminales), valor semántico para la intención (`reserve_pending`, entrada, operación, revisión, segundos, sin `jobId`; la reprogramación no la invalida) y para la cuenta (existe, piloto y solo simulación; el saldo cambia con otros trabajos) y la guarda por ausencia o no bloqueo.
4. **ACK y trabajo en una sola transacción** (`stageReserveAck`, siempre `attribution:'unverified'`), con la tupla del ACK validada con las mismas reglas que el registro independiente (T3 cerró el hueco de que un ACK ajeno podía aceptarse). Si el commit local falla, o la identidad se revocó, o apareció una cerca de liberación, **el ACK se conserva sin trabajo** (`recordExternalReserveAck`).
5. **Contadores `active`** alineados en las dos bases al crear el trabajo, probado en ambas. Nunca se crea un trabajo a partir de un `status`.
6. Decisiones técnicas del diseño (7.4), tomadas por Codex: el perfil persistido sigue siendo el v1 `ai-candidate-v1` y hoy coincide con el catálogo vivo (prueba centinela que falla si el catálogo cambia sin migración); identificadores UUID en minúsculas; las dos colecciones privadas quedan bajo la regla de denegación total, fuera del reporte; la retención es decisión pendiente del dueño y no se borra nada.

## Revisiones independientes (se conservan todas)

| Ronda | Revisor | Resultado | Archivo |
|---|---|---|---|
| 1 | GLM | **FALLA** (una ALTA, una MEDIA, una BAJA) | [review-1-3b-v1-glm.txt](review-1-3b-v1-glm.txt) |
| 1 | DeepSeek | **FALLA** (dos ALTA, dos MEDIA, dos BAJA) | [review-1-3b-v1-deepseek.txt](review-1-3b-v1-deepseek.txt) |

**Adjudicación de Codex (verificada contra el código):**
- **Aceptado y corregido:** atar el POST al intento preparado (MEDIA de ambos revisores; prueba roja y mutación detectada); el comentario desalineado de la preparación.
- **Rechazado con evidencia:** banderas de cuenta no ligadas al intento (`enabledForUid` las comprueba justo antes del POST y la transacción del trabajo las vuelve a comprobar; el peor caso es una reserva sin trabajo que la salida por plazo libera); el ACK que no se guarda (el error se relanza, la intención queda `reserve_pending` y 1.3a la libera); la deriva de `reservationUuidFor` (haría fallar los 13 casos de integración); la prueba del commit perdido (sí afirma `countPosts` igual a 1).
- **Límite declarado:** DeepSeek pidió la invariante «`externalBilling` implica intento y ACK» en `reserveAs`. La ruta pública para clientes (`enqueueForUid`) sigue deshabilitada y la firma directa de `reserve` es la «ruta interna heredada» que usan muchas pruebas; endurecerla exige migrarlas. **Pendiente antes de abrir la ruta a clientes.**
- No se hizo una segunda revisión completa tras la corrección: es de una condición, con prueba roja, mutación detectada y regresión completa.

## Evidencia

- `tsc --noEmit` limpio. Ensayo de referencia congelado `textAccountReserveIdentity` por su lanzador protegido: **13/13** (antes 7/13; los seis rojos 2, 3, 4, 8, 10 y 12 pasan). Suite de T3 `textAccountReserveAckWindow` con **Cuenta real**: 25/25 (14 de T3 y 11 de Codex).
- Suites existentes y protegidas desde main: `firestoreAi` 166/166, `firestoreA3Exit` 27/27, `firestoreBlocksA` 27/27, liquidación C2a 21/21, `reserveAttemptEvidence` (lanzador) PASS, `externalReplayStatusFence` PASS, `statusChangedHistory` PASS, `silentAccount` y las variantes verdes de sondeo y de solo-estado confirmadas (las variantes rojas históricas ya no reproducen el defecto: INCONCLUYENTE esperado), carrera de reserva externa PASS.
- **Regresión financiera completa: 403 pruebas, 398 aprobadas, 5 pausadas de voz, 0 fallidas** ([resultado](../../../outputs/lv019-b-financial-runs/run-c5feb6ac-b96c-43bf-93a4-9c40088ec433/result.json)); el ejecutor incluye ahora las fixtures de 1.3b y la de carreras de historia de liquidación.
- Regresión protegida de Cuenta **PASS** ([resultado](../../../outputs/lv019-b-account-full-runs/run-7f55d561-40bf-4fe1-ab8c-235fcd8f08f4)); `npm test`: **1680 aprobadas, 113 omitidas, 0 fallidas**.
- **Mutaciones propias de Codex: 29**, más las repeticiones tras añadir pruebas. 18 murieron al primer intento (cableado, preparación y condiciones semánticas de la ventana). De las 11 sobrevivientes, **cinco eran huecos reales de pruebas** (guarda bloqueada entre la captura de evidencia y la preparación; par terminal completo existente; y la versión exacta de identidad, entrada y proyecto, porque la sonda de T3 reemplazaba el documento y el cambio se detectaba por contenido, no por versión), cerrados con 11 pruebas de Codex y detectados al repetirlos; **seis son equivalentes** (otra comprobación cubre lo mismo: la cuenta de la identidad la comprueba `verifiedUidAccountInTransaction`; el `reservationId` lo cubre la igualdad previa al POST; solicitud y marca de trabajo las rechaza el propio módulo de evidencia y la creación del trabajo; la guarda de admisión, su validación estricta de contenido). [Arnés](mutaciones/mutate_13b_codex.py), [resultados](mutaciones/mut13b_codex.txt), [repetición](mutaciones/mut13b_codex_b.txt), [pruebas](mutaciones/test_13b_guard_race.txt). T3 añadió 34 mutaciones propias, todas detectadas.

## Desfases de pruebas que el barrido de seguridad destapó y se corrigieron

Una lectura de T3 («una suite falla igual en HEAD») llevó a barrer las 28 suites de emulador que manejan el drenaje, que no estaban todas en mi regresión. Tres expectativas eran de pasos anteriores o de este y se actualizaron sin tocar producción: la prueba de una intención heredada sin guarda esperaba la fila intacta, pero desde **1.6c** el drenaje registra un intento (ahora afirma que solo cambian los metadatos de programación); la variante `outbox` de las carreras de historia esperaba incidencia, pero desde **1.4a** esa escritura inocua es un fallo transitorio; y el doble de `firestoreAiBilling` no tenía los métodos nuevos de 1.3b. **Lección:** 1.4a y 1.6c se certificaron sin esas dos suites; la de carreras de historia entra ahora en la regresión oficial y la de admisión se corre aparte.

## Límites declarados

- La atribución del ACK es siempre `unverified`; la retención de las dos colecciones privadas es del dueño; `enqueueForUid` externo sigue deshabilitado; el envoltorio `reserveWithReserveAck` no tiene llamadores.
- **Entorno:** desde el 22 nov las suites que usan el transporte REST de Firestore (`preferRest`) se quedan colgadas contra el emulador local, aunque gRPC y `curl` responden. Afecta a `billingIntentAdmissionGuard` (15/15 antes del problema, con la expectativa corregida; fuera de la regresión oficial hasta resolverlo). No es un defecto de producción.
- Todo se probó con Firestore y Cuenta **emulados**: no acredita IAM, Cuenta real, cobro real ni recuperación entre dispositivos.

## Gasto

Saldo de OpenRouter medido: **−US$0,13 el 23 nov a las 15:55 (agotado)**, desde US$6,06 el 22 nov a las 22:15; el hilo de T3 de 1.3b, su corrección y las dos revisiones gastaron unos US$6. Con el saldo agotado T3 queda bloqueado (error 402) hasta que el dueño recargue, decisión suya.
