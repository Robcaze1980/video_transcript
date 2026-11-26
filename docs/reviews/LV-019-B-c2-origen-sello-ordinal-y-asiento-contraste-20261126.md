# Contraste de Cuenta v3 tras el dictamen GLM y el seguimiento DeepSeek

**FALLA en dos controles de integridad ante pérdida selectiva de documentos en Cuenta.** El sello legacy puede producir evidencia terminal mientras el saldo sigue reservado. La admisión v3 puede autorizar el primer fragmento después de perder únicamente el asiento de reserva. Las pruebas del índice de ordinales sí pasan en el alcance que comprueban. El PASS anterior de la compatibilidad C1 y el PASS limitado de GLM se conservan en su alcance. La revisión del código completo no se cierra.

**Corte y precondiciones.** Runtime congelado en 387f0d27b6622c40f004149117966c9bc690fbb8, con las pruebas de 683ae018b3a467387d69c0ec181c2710d26b6b92 como base. Se ejecuta AccountStore real sobre un doble transaccional de Cuenta, con dos titulares ficticios. A inicia con 30 segundos, reserva tres y mantiene 27 disponibles. B conserva 30. La reserva normal crea su asiento, índice y origen juntos. Los experimentos eliminan un documento después de ese commit, simulando pérdida selectiva o un escritor con permiso administrativo. No identifican un camino de cliente ni un fallo intermedio del commit. La revisión se limita a memoria local y no incluye peticiones HTTP, emulador o entrega al proveedor.

## H1 · Reserva perdida con origen, índice y asiento presentes

1. Con la reserva v3 íntegra, el sello legacy devuelve `reserved, created:false` y el inventario no cambia. Al eliminar únicamente la reserva, el replay v3 de reserva ya rechaza con `conflict`, y la admisión v3 y la resolución de Cuenta devuelven `not_found`. No hay escrituras en ese tramo.
2. `sealVideoReservation` relee identidad, cuenta, reserva y lápida. Al faltar la reserva y la lápida, devuelve `sealed, created:true` y añade **exactamente una lápida**. Origen, índice, asiento, A y B conservan hasta sus versiones previas. Un segundo sello devuelve `created:false`. La consulta de resolución ahora devuelve `sealed`, mientras la consulta ordinaria de estado devuelve `not_found`. La admisión y el replay v3 de reserva quedan en conflicto. A sigue con tres segundos reservados, una reserva activa, cero consumo y un solo asiento. Véanse [sello y reserva](../../server/account/backend.ts#L331) y [resolución](../../server/account/backend.ts#L595).
3. **Efecto adicional a la indisponibilidad.** La pérdida ya impedía reconstruir la reserva operativa. El sello escribe una evidencia terminal que no acredita la ausencia de una reserva económica previa. El recuperador de Video contempla `sealed` como observación de cierre, sujeta también a sus propias comprobaciones de testigo e historia. No se ejecutó un cierre de Video integrado para esta reserva v3. La prueba muestra un estado terminal ambiguo exportado por Cuenta, sin segunda reserva, liberación, consumo ni cambio de titular. [Consumidor de resolución](../../server/commercial/firestoreAi.ts#L219) y [ACK de sello](../../server/commercial/firestoreAi.ts#L309).

La [caracterización con inventarios](../../server/account/voiceOriginAuthority.test.ts#L337) pasa. El [control de seguridad](../../server/account/voiceOriginAuthority.test.ts#L371) queda rojo: esperaba rechazo sin escrituras y observó `sealed` y una creación.

## H3 · Índice persistente y recibo perdido

La [función completa](../../server/account/backend.ts#L101) comprueba que el índice sea un array de 0 a 1000 elementos, que su vaciedad concuerde con la primera admisión, que sus valores sean enteros de 0 a 999 en orden estrictamente creciente y que la presencia del ordinal **consultado** coincida con la existencia de su recibo. En [admisión](../../server/account/backend.ts#L482), si hay primera admisión se comprueban además el primer ordinal, el recibo de la primera llamada y su cerca. El alta escribe el recibo, la primera cerca cuando corresponde y la actualización del índice en la misma transacción.

- Ya existía un [control explícito de pérdida del segundo recibo](../../server/account/voiceOriginAuthority.test.ts#L316). En la auditoría se admiten dos ordinales de A y se retira solo uno de los dos recibos, manteniendo ambos ordinales en la reserva. La repetición de la clave perdida con la misma o con otra huella devuelve `invariant`, sin recrear el recibo ni cambiar otro documento, saldo o asiento. [Pruebas del primer y segundo recibo](../../server/account/voiceOriginAuthority.test.ts#L381).
- Sin el **primer** recibo también se rechaza otra clave nueva. Sin el **segundo**, una tercera clave válida del mismo trabajo e intento sí se admite si están íntegros el primer recibo y su cerca. Se crea un recibo, se actualiza la lista y no se toca el saldo. Su replay no escribe; el segundo ordinal continúa inutilizable. La comprobación es por ordinal solicitado más primera admisión, no un inventario global de todos los recibos. El contrato de fragmentos permite una clave nueva para el mismo intento. Ninguna de estas pruebas autoriza retransmitir un POST incierto.
- También pasan seis controles de índice incoherente, entre ellos recibo sin ordinal, duplicado, elementos desordenados, índice fuera de rango, tipo incorrecto y lista vacía con una primera admisión presente. Cada rechazo conserva íntegro el inventario. [Matriz](../../server/account/voiceOriginAuthority.test.ts#L418). La pérdida coordinada de índice y recibo no es el escenario planteado ni está acreditada aquí.

## DeepSeek 3 · Pérdida aislada del asiento de reserva

Tras la reserva normal se retira exclusivamente el único `ledgerEntries` de reserva, conservando la reserva, el origen y el índice de origen. El replay de reserva comprueba el origen y devuelve la misma referencia con `reserved, created:false`, sin cambiar ningún documento. Para la **primera admisión**, el método devuelve `created:true, receiptOnly:false`. Crea el recibo y la cerca del primer fragmento y actualiza la reserva, tres documentos en total. El asiento permanece ausente. El siguiente replay de esa admisión devuelve `receiptOnly:true` sin escrituras. A y B retienen sus saldos. Por tanto, se pierde una comprobación de la historia económica y se obtiene una autorización nueva pese a la falta del asiento. No se ha demostrado un doble cargo ni despacho de bytes. El origen se coteja con vínculo e índice y el asiento se crea en la reserva inicial, pero no se relee al devolver esa reserva o al admitir. [Verificación del origen](../../server/account/backend.ts#L383) y [creación del asiento](../../server/account/backend.ts#L440).

La [caracterización de los tres efectos](../../server/account/voiceOriginAuthority.test.ts#L436) pasa. El [control de rechazo de primera admisión](../../server/account/voiceOriginAuthority.test.ts#L460) queda rojo: se esperaba un rechazo con cero escrituras.

## Controles para la siguiente candidata

Evaluar una lectura puntual dentro de la transacción del sello antes de crear una lápida, con evidencia durable por el par titular/reserva que permita reconocer la pérdida sin barrer colecciones. En este caso existe un asiento de ID determinista por ese par. Verificar aparte la compatibilidad del sello de una reserva genuinamente inexistente y el comportamiento de filas históricas o corruptas. En v3 evaluar el asiento exacto y su pertenencia a la emisión prevista antes del replay de reserva y de cualquier nueva autorización. Distinguir el acceso a un recibo histórico para conciliación de una autorización nueva y documentar la política si falta evidencia económica. Las coincidencias de contenido o timestamps entre documentos no bastan por sí solas para autenticar a sus escritores.

## Evidencia

Diez suites de Cuenta y frontera: **114/116**, con H1 y DeepSeek 3 rojos. La corrida focal final obtuvo **25/27**; es subconjunto de la anterior. Los 104 controles de base, los ocho nuevos de H3 y los dos de caracterización financiera pasaron. TypeScript con `--noEmit` finalizó con salida 0. No se modificó el runtime. Los archivos locales de evidencia están en `outputs/h1-h3/`. Se conserva el rojo de H1 de la primera corrida anterior a añadir el control DeepSeek.

| Archivo local sin normalizar | SHA-256 |
| --- | --- |
| focal.log | da56f2eb2bcabb519921b767a5171d06d10eca68bec84ae08d69eaa5de5df001 |
| combined.log | e1109f198b9766a0578e6301b7f61298f5479081f9d804beca938acd3b06aa7b |
| ledger-focal.log | defe53d689f42e2c53b3a6d92b849311bdec6390df81a00d25ac684ef012eddc |
| final.log | 671255c098cd7caba08ece0715f70c6c5b56823cf25ce7ec5223a49a962fc85e |
| types-final.log | e05222033cd2c7b46b6fad5ec87b44b62f844dbb6f004476498f71d0e3c9875b |
| voiceOriginAuthority.test.ts | e671c85250d288b701c524dad9cbd8d6af2876074ec43a60e47185ddd01a4a76 |

Con Node 24.22.3, la prueba focal se reproduce con `node node_modules/vitest/vitest.mjs run server/account/voiceOriginAuthority.test.ts --maxWorkers=1 --reporter=verbose`. La combinación usa todos los `server/account/*.test.ts` con `voiceAdmissionOwnershipBoundary.test.ts`, `accountBillingClient.test.ts` y `reviewedVoiceFragment.localFixture.test.ts` de `server/commercial`.

=== RESUMEN FINAL ===
RESULTADO: FALLA
EVIDENCIA: H1 crea una lápida y publica sealed con tres segundos aún reservados. Con el asiento ausente, DeepSeek 3 concede una nueva admisión con tres escrituras. 114/116.
NEGATIVOS: Replays sin cargos extra; índices y recibos faltantes o inconsistentes se rechazan para el ordinal afectado, con el alcance por ordinal descrito.
BLOQUEOS: Cierre del sello legacy y contraste de respaldo económico en v3. Persisten emisor autenticado, traspaso entre bases, pruebas en emulador y revisión dual de una candidata corregida. Costo no medido.
=== FIN RESUMEN ===
