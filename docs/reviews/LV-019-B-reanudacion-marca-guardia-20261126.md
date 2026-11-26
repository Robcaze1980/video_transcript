# LV-019.B · Hora de guardia y reanudación confirmada

Revisión independiente de 6e2ab223265591dab119dbf898eee63a9f2e6f9b. Contrasta el FALLA de DeepSeek en el recibo c04a0f5ad7debdc65b39f3ef5386b562a88ec40282349bbfea33cecab92d0a81. El informe externo se conserva en el checkpoint. Este contraste solo agrega pruebas y este documento a una copia aislada.

## Decisión y evidencia

DeepSeek observó correctamente que sameGuard no compara updatedAtMs del documento con la hora nombrada en la solicitud. Su lectura extiende la regla de fase 0 (diseño de bloqueos y cierres, §3.3:111) a una reanudación que ya cuenta con autorización durable. Los renglones 114–116 piden entonces que coincidan la solicitud, el operador, el dueño, la ocurrencia y su alerta, además de la decisión de Cuenta y las filas auditadas. El renglón 123 distingue una ocurrencia por su época y marca de creación. El escrito de fase 0 conserva la hora original en el payload.

El escritor de producción vuelve a escribir updatedAtMs cuando confirma el mismo incidente sin cambiar la época ni createdAtMs (firestoreBackend.ts:623–634). Exigir que el marcador actual sea siempre el del payload anterior haría esperar una reanudación legítima después de esa escritura. Entregar el nuevo updatedAtMs tampoco resuelve esa situación porque cambiaría la carga auditada que protege samePayload.

| Momento de escritura | Resultado en la candidata |
|---|---|
| Antes de la primera solicitud, todavía sin unblock_requested | Comparar updatedAtMs con la carga recibida. Una discrepancia rechaza antes de escribir el registro o llamar a Cuenta (billingUnblock.ts:299–305). |
| Ya existe la solicitud. La reescritura legítima de la misma ocurrencia terminó antes de empezar a reanudar | Exigir la carga auditada original, el mismo operador, guardia, ocurrencia y alerta. Adoptar como referencia local la versión que se acaba de leer. El recibo confirmed se consume sin otro POST. Con pending se permite la única mutación condicional del intento de reanudación. |
| Durante la consulta del recibo | Si cambia la versión Firestore updateTime de la guardia entre las dos lecturas, recheck rechaza incluso si se restauró la hora, con la alerta y guardia intactas. La siguiente lectura estable puede recuperar el recibo con la misma solicitud. |

La hora de negocio updatedAtMs de la carga, la generación epoch/createdAtMs de la ocurrencia y la versión Firestore updateTime cumplen funciones distintas. La llamada inicial exige la primera. Una reanudación une la solicitud inmutable a la segunda y coteja la tercera durante su propio intervalo. No se pretende reconstruir versiones ya alteradas y restauradas antes de la primera lectura de esa reanudación. Los caminos de ACK directo y el POST después de pending conservan las ventanas separadas que declara el recibo de la candidata.

La conducta probada encaja con la separación de fases. El hallazgo no demuestra el FALLA contractual del corte confirmed. Conviene aclarar esa separación en una próxima actualización del contrato y conservar el resultado externo original. No se deduce atomicidad entre Video y Cuenta.

## Pruebas en memoria

La suite alertContractReview.test.mjs pasó 36/36. Cinco casos nuevos comprueban solicitud inicial obsoleta, reescritura terminada antes de confirmed y de pending, y alteración durante confirmed tanto persistente como restaurada. Se comprueba que la reanudación no reescribe la solicitud, que un payload actualizado es rechazado, que se preserva el alcance del POST y que el conflicto de versión puede recuperarse después.

Prueba con guard de Node activo y perfil limpio. El doble de Firestore usa cambios de objeto para representar versiones y los dos estados remotos se modelan en memoria. No se reejecutó el emulador ni se comprobó infraestructura real. No se modificó runtime. Salida local en outputs/lv019-b-confirmed-guard-clock-diagnostic-20261126/. stdout SHA-256 0a0fbb85e0edda8305fbd200113f930e81c89ef9cfed986c9dcdde6383686614. stderr SHA-256 73906f0abcf2133aab7c08756a559d17cee5d9249a5593b107c17096789c8124.

=== RESUMEN FINAL ===
RESULTADO: PASS
EVIDENCIA: La comprobación estricta de updatedAtMs rige la primera autorización. El contrato de reanudación preserva el payload y la ocurrencia y la candidata coteja la versión durante su propia consulta. Pruebas 36/36.
NEGATIVOS: Primera solicitud obsoleta, payload actualizado frente al registro inmutable y cambio durante confirmed con y sin restauración. Los positivos antes de reanudar preservan el recibo y las llamadas esperadas.
BLOQUEOS: La evidencia no reconstruye historia previa a la reanudación ni garantiza atomicidad o IAM de nube. Aclaración documental pendiente. Emulador y proveedores no ejecutados. Costo y uso no medidos.
=== FIN RESUMEN ===
