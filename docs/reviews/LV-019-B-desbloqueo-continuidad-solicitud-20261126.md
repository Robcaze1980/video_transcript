# LV-019.B · Continuidad de la solicitud auditada de desbloqueo

Candidata aislada sobre `b47a0ad`. La auditoría independiente reprodujo dos fallos después de que Cuenta guardara el único recibo y se perdiera el ACK. Al faltar la solicitud, Video volvió a invocar el puerto mutante y cerró. Al recrearla idéntica, la consulta del recibo evitó otro envío, pero Video cerró con una autorización de otra generación. Las dos pruebas conservaron saldo, reserva y asiento de Cuenta. [Auditoría independiente](LV-019-B-desbloqueo-ack-directo-auditoria-independiente-20261126.md)

## Barrera de envío y de cierre

- Cuando la solicitud falta y queda el testigo o la constancia de despacho, el flujo termina en conflicto sin enviar ni recrear la solicitud. Cuando no hay evidencia local y la ocurrencia pasa las validaciones, una consulta autenticada de Cuenta permite distinguir un recibo ya confirmado. Ante `confirmed`, error o respuesta incoherente, la ruta fresca conserva la revisión y no escribe la solicitud.
- `pending` indica que Cuenta carece de un recibo en el instante de lectura. Un envío fresco exige además un corte de escritores verificado en la raíz, una guardia creada después del corte y una transacción que descarte cualquier solicitud, testigo, despacho o cierre previo. En esa transacción Video relee el plan auditado y crea juntos `unblock_requested`, el testigo y la constancia irreversible de despacho. Solo la ejecución que confirma esa creación puede invocar la mutación.
- Las dos constancias guardan la huella canónica de toda la solicitud y la clave de la ocurrencia. Para finalizar, se contrastan las tres creaciones y sus versiones originales, el contenido de la solicitud, el titular, la guardia y la alerta en la transacción que avanzaría las filas. Recrear aisladamente la solicitud, el testigo o el despacho cambia su versión de creación y no aporta continuidad.
- Una segunda ejecución puede consultar el recibo y cerrar con `confirmed` si conserva la autorización intacta. Un `pending` mientras el POST original sigue en vuelo no permite reenviar. La barrera también se conserva ante un 409 de Cuenta, ante un error genérico o si la primera ejecución terminó antes de entregar el POST. Estos casos quedan para conciliación.
- El legado ya concluido conserva el replay local sin escrituras ni contactos con Cuenta. Una solicitud antigua pendiente o parcial puede consultar el recibo con la autorización disponible. Ante la falta de testigo, no se autoriza un envío, el avance de filas ni la liberación de Video. La herramienta de conciliación futura decide cómo identificar y resolver estos casos.

## Condición para integrar

El corte es una dependencia de operación. La biblioteca verifica `billingUnblockContinuity/verified-writer-cut-v1`, que solo tendría autoridad después de detener escritores anteriores, conciliar envíos en vuelo y demostrar retención. Exige una creación inmutable del marcador, anterior a la creación de la guardia examinada. La candidata carece de escritor del corte, migración de guardias antiguas o mecanismo para autorizar de nuevo un despacho. Sembrar esa fila en un arnés representa una precondición del ensayo y no acredita un corte real.

Las constancias cubren pérdidas o recreaciones aisladas mientras sobreviva evidencia de la ocurrencia. Si se destruye o reconstruye de forma coordinada toda la historia local, un `pending` tampoco distingue un despacho anterior aún en vuelo. Un `confirmed` sin pruebas locales conserva la revisión. Si desaparecen las tres constancias mientras todavía podría llegar el POST original y el corte sigue presente, la biblioteca carece de una señal local para distinguir un primer envío. La garantía requiere retención y queda fuera de ese borrado coordinado. El doble representa un único tiempo de creación para los documentos que crea la misma transacción. Firestore Emulator debe comprobar esa representación y las carreras reales. La comparación no acredita identidad de escritor Admin ni atomicidad entre bases. Las pruebas cuentan invocaciones del puerto de Cuenta, no reintentos de transporte HTTP.

La candidata cambia el contrato de reenvío tras `pending`. Las fixtures de emulador anteriores preparaban guardias sin el nuevo corte y algunas esperaban reenvío después de un fallo o negativa. Se conservaron en sus versiones para sus respectivas candidatas. Antes de combinar esta rama se requiere preparar pruebas con corte acreditado, verificar y migrar el conjunto de consumidores, contrastar con ambos revisores y ejecutar la regresión financiera final. No se verificó ni activó un corte operativo.

## Evidencia local

Con Node 24.22.3, el contraste de la base reprodujo **44/46** con exactamente los dos fallos. En la candidata pasaron **56/56** casos focales y **473/473** en veinte suites de saldo, alertas y HTTP de Cuenta. Tipos, sintaxis y `git diff --check` pasaron.

Los controles con AccountStore real sobre un doble transaccional preservan un solo recibo y el inventario de Cuenta. Cubren pérdida y recreación de la solicitud y de las constancias, pérdida del par mientras sobrevive el despacho, y pérdida de toda prueba local cuando Cuenta ya confirmó. En otro orden, se observa `pending` mientras el primer envío queda retenido, se rechaza el segundo y se recupera el recibo tras llegar el original. Si durante esa espera se perdió el par, el recibo posterior conserva la revisión de Video. También se probaron 409, corte ausente o posterior a la guardia, legado incompleto con ambos estados de recibo y replay legado concluido.

Se reproduce el foco con `node node_modules/vitest/vitest.mjs run server/commercial/unblockContinuityIndependent.test.mjs server/commercial/alertContractReview.test.mjs --maxWorkers=1 --reporter=verbose`. La evidencia se guarda en `outputs/lv019-b-unblock-continuity-20261126/`, fuera de Git. Solo se ejecutaron procesos locales con datos inventados.

| Registro | SHA-256 |
| --- | --- |
| `audit-original-44-of-46.log` | `4b8be0f6152bcb10c12f6403f1a2f64b455dca03a4b28b9cefa507a28a261bf1` |
| `baseline-2-red.log` | `8b848c3961ba185842c4f4891c17b085e6cb82eb5c8cf62598c81e69be02286e` |
| `focused-final.log` | `d4f7a0c0535f47ad892a7cdb2dd237221230a2cdabc73c4626b5dee4165069e9` |
| `unit-final.log` | `2e26770d609de7a67df552fc1f495044405a0cbfa2bd7a65fc172377495190ad` |
| `types.log` | `2095d5302e465922147e220c0389f7a923ea0c1509a23097f04b3c220798aef8` |

Cambios en [biblioteca de desbloqueo](../../server/commercial/billingUnblock.ts), [pruebas de contrato](../../server/commercial/alertContractReview.test.mjs) y [contrapruebas de continuidad](../../server/commercial/unblockContinuityIndependent.test.mjs). La API y el almacén de Cuenta permanecen fuera del cambio.
