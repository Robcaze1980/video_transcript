# Auditoría independiente del ACK directo de desbloqueo

**FALLA para recuperación tras pérdida o recreación de la solicitud.** El ajuste de `01311439447dc32ef919b651793fc4aeb43131f3` sí corrige los cuatro casos originales. La conservación de `unblock_requested` sigue siendo una dependencia para acreditar la autorización original después de perder el ACK. Dos pruebas en memoria distinguen el reenvío de la operación de una segunda decisión financiera.

## Casos reproducidos

Dos raíces ficticias separan Video y Cuenta. La prueba ejecuta `unblockVideoBilling` y `videoBillingUnblockReceipt` reales de AccountStore sobre un doble transaccional en memoria. Cuenta confirma la decisión y persiste el recibo antes de simular la pérdida de su respuesta. Se conservan el titular, la guardia y la alerta de Video, el incidente, las credenciales sintéticas del mismo operador y los argumentos del reintento. Solo varía el historial del documento de solicitud en Video. El inventario completo de Cuenta tras cada prueba coincide con la primera decisión confirmada, incluyendo saldo, reserva y asiento.

| Solicitud al repetir | Contactos con Cuenta | Resultado de Video |
| --- | --- | --- |
| Original intacta | Una invocación mutante total y una consulta | Cierra. Otro replay queda local. |
| Editada y restaurada en el mismo documento | Una invocación mutante total y una consulta | Conflicto. Conserva guardia, alerta abierta e incidente pendiente. |
| Documento eliminado sin reposición | **Dos invocaciones al puerto mutante**, ninguna consulta | **Cierra.** Crea otra solicitud bajo la clave original y da por revisado el incidente. Cuenta reconoce el replay y conserva un solo recibo. |
| Documento eliminado y recreado con contenido idéntico | Una invocación mutante total y una consulta | **Cierra.** El recibo acredita la decisión de Cuenta pero no acredita la generación original de la autorización de Video. |

Una escritura o pérdida de datos fuera del desbloqueador debe eliminar la solicitud original después de la primera decisión y antes de que una ejecución nueva obtenga su observación de Video. No se identificó un camino de cliente para provocar esa pérdida. El doble cuenta invocaciones al puerto que representa el POST; no se ejecutó HTTP. El contrato de bloqueos §3.3 exige un registro inmutable y establece que la confirmación perdida puede recuperarse sin otra mutación. El problema se limita a la continuidad de ese registro y al cierre que ve el operador. En ningún caso hubo otro movimiento económico.

## Localización y corrección a estudiar

* `server/commercial/billingUnblock.ts:253–291,317–322,353–361`. Sin solicitud, cierre ni liberación previos, el código recorre de nuevo la autorización inicial. Después de crear el registro, puede llamar a la operación mutante sin consultar el recibo anterior. Una clave determinista por sí sola no distingue la primera creación de una reposición.
* `server/commercial/billingUnblock.ts:286–291,332–346,387–390`. El primer snapshot de una ejecución nueva ya contiene la generación recreada. El cotejo de versión entre dos lecturas y la igualdad de creación/modificación del mismo documento son válidos dentro de esa generación. Su versión anterior no se guarda fuera de la solicitud. El informe de implementación ya identifica la recreación anterior a la primera relectura en una ejecución. El experimento extiende el límite a la recuperación por recibo tras reinicio, incluso si la primera llamada **sí llegó a fijar la versión original**.
* `server/account/backend.ts:228–257,271–290`. El recibo de Cuenta va ligado a su titular, incidente, generación y evidencia. Un reenvío exacto responde como replay sin otra escritura. Ese recibo no contiene una referencia a la creación original de Video.
* Para admitir recuperación tras pérdida se requiere una constancia independiente y retenida de la solicitud original, vinculada al incidente, titular, operador, evidencia y plan, con una referencia verificable a su primera generación. Al encontrar una constancia previa con solicitud ausente o recreada, conservar la revisión. Consultar el recibo de Cuenta antes de recrear la solicitud permite evitar el segundo POST cuando Cuenta ya confirmó la decisión. Ante una recreación idéntica se necesita además un testigo durable en otra ubicación que acredite la primera generación y el plan original de Video. Si se decide acotar la propiedad al modelo de escritor inmutable y retención, documentar dicha dependencia para **todas** las reanudaciones y justificarla con evidencia operativa. No se ha diseñado ni probado una recuperación ante destrucción total de evidencia.

## Controles, archivos y alcance

En la rama de diagnóstico `ce4409fd77d93626f1f981c8a670b88c6208cc13` se repitieron sus 37 controles y se observaron los cuatro fallos originales. Con la candidata pasaron sus **40/40**; se verificaron camino inicial, reanudación con `pending`, parcial, confirmación recuperada y cierre completo de replay. En la nueva fixture, cuatro de seis pasaron. Además de los dos controles de la tabla, un segundo coordinador cerró por recibo antes de llegar el primer ACK y un replay completo recuperó ese cierre sin otro POST. El avance legítimo de la fila de hold a `applied` durante la respuesta también permitió el cierre y conservó la evidencia de entrega. Total combinado **44/46**. Las 457 unitarias declaradas en el informe del implementador no se repitieron en esta auditoría focal. Los dos defectos no demuestran regresión causada por el parche: se refieren a una condición de retención persistente que el parche tampoco resuelve.

El doble no verifica IAM, retención efectiva ni aislamiento de Firestore. No se ejecutó emulador, servicio o proveedor. La comprobación no introduce atomicidad entre la última lectura de Video y el POST. El código de ejecución en la copia independiente es idéntico al commit auditado.

| Archivo | SHA-256 |
| --- | --- |
| `server/commercial/unblockContinuityIndependent.test.mjs` (casos desde línea 100) | `d3c26a972fdda3a0eeef0995281afbce63d880e294021f1bb22a8b3eedcbae08` |
| `outputs/ack-audit/independent-final.log` | `4b8be0f6152bcb10c12f6403f1a2f64b455dca03a4b28b9cefa507a28a261bf1` |
| `outputs/ack-audit/ce4409f.log` | `fcf46a002ffa571b1b80ba08aacb5b6548d4aa82634351cde260b61d4aa84cf4` |
| `outputs/ack-audit/preservation-check.log` (repetición antes del commit, 4 verdes y los mismos 2 rojos) | `5ec1616a36d30b2b4a3f1b642d9f3d74a59f5c2343b63c653875db404119ea4e` |

Con Node 24.22.3, usar `node node_modules/vitest/vitest.mjs run server/commercial/unblockContinuityIndependent.test.mjs server/commercial/alertContractReview.test.mjs --maxWorkers=1 --reporter=verbose`. La fixture previa se repite en el worktree separado de `ce4409f` indicando solo `server/commercial/alertContractReview.test.mjs`.

=== RESUMEN FINAL ===
RESULTADO: FALLA
EVIDENCIA: 33/37 sobre el diagnóstico original; 40/40 en la candidata y 4/6 en el contraste nuevo. Un solo recibo y un solo efecto de Cuenta.
NEGATIVOS: La pérdida de la solicitud original permite un segundo envío al puerto mutante. Su recreación exacta permite un cierre sin acreditar continuidad. La edición/restauración in situ sí mantiene la revisión.
BLOQUEOS: Corregir o adjudicar explícitamente la retención y procedencia de la solicitud al reanudar antes de revisión dual; emulador e integración siguen pendientes. Costo no medido.
=== FIN RESUMEN ===
