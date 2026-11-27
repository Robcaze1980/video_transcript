# LV-019.B · Diagnóstico de procedencia del intento de Cuenta

**FALLA para integrar.** El runtime examinado es `d01541c5bde32a92b39b1dbf0274987382773efa` y no cambia en esta rama de diagnóstico. Los dictámenes originales siguen en el checkpoint, en `docs/reviews/LV-019-B-intento-cuenta-d01541c-{GLM,DeepSeek}-20261126.txt`. GLM dio **PASS acotado** con dos observaciones. DeepSeek dio **FALLA** por la recreación coordinada. Sus SHA-256 de respuesta original son `1530ae033f3960df051d97eca4853d15b213422b2daae450a9c412a3326c604f` y `ef0f11b11cb8c6830af5ec172eaf0d39034b28a9d4f3f6b274c8a28d92f1174b`, respectivamente. El [recibo de d015](README.md) conserva los resultados de su corrida anterior.

## Qué se comprobó

| Hallazgo | Contraprueba y observación | Decisión |
| --- | --- | --- |
| Recibo idéntico recreado | Tras confirmar Cuenta y simular pérdida del ACK, la consulta del recibo intacto funciona. La fixture borra solo el recibo y lo recrea con idéntica carga. Comprueba que la nueva creación difiere de la original y que su nueva marca de actualización coincide con su nueva creación. La consulta y la repetición lo aceptan. No aparece una segunda escritura de Cuenta en ese caso. [Prueba](../../../server/account/unblockAttemptReceipt.test.ts#L311) · [Validación](../../../server/account/backend.ts#L366) | Hueco de procedencia confirmado. El cotejo `createTime === updateTime` detecta ediciones en la instancia actual, pero no demuestra conservar el recibo que se escribió al decidir. El incidente aún corrobora la tupla de revisión. Eso acota la observación local y no demuestra riesgo económico nulo si la confirmación llegara a habilitar el cierre en Video. |
| Recreación coordinada | Antes de la primera aplicación, la fixture instala una autorización, conserva la solicitud e inventaría las cuatro creaciones. Un escritor privilegiado simulado reemplaza identidad, incidente y guardia en sus mismas rutas, borra la autoridad y crea otra con la misma tupla. Fija en esa autoridad las nuevas versiones de identidad, incidente y guardia, y en el incidente la nueva creación de la autoridad. Los asserts verifican que los cuatro nacimientos cambiaron y que cada referencia apunta al reemplazo correcto. Conservan UID, dueño, datos de guardia y solicitud lógica. La primera consulta y la aplicación aceptan. La segunda crea **un recibo y quita el guard de A**. El guard de B, saldos, reservas y asientos permanecen iguales. [Prueba](../../../server/account/unblockAttemptReceipt.test.ts#L336) · [Pines](../../../server/account/backend.ts#L354) | Confirma el FALLA de DeepSeek dentro de la precondición sembrada. No depende de igualar fechas entre todos los documentos: basta con recalcular las referencias cruzadas a las nuevas fechas. El caso parte de un incidente activo sin decisión anterior y no demuestra duplicación ni una vía de cliente. Sí muestra que el conjunto puede perder su autoridad histórica y aun así generar una decisión sobre la nueva guardia. |
| Escritura de identidad del mismo titular | Se agrega un campo de mantenimiento por escritura directa a la identidad, antes o después de la decisión, sin cambiar los dos campos de vínculo ni la creación. La lectura normal `me` reconoce al mismo dueño. Ambos métodos de desbloqueo devuelven conflicto y preservan el inventario. El bootstrap repetido y la creación de proyecto reales sirven de control: ninguno escribe la identidad, y la consulta funciona antes y después de decidir. [Prueba](../../../server/account/unblockAttemptReceipt.test.ts#L373) · [Control](../../../server/account/unblockAttemptReceipt.test.ts#L397) · [Escritores](../../../server/account/backend.ts#L146) | El fail-closed es coherente con el pin actual e impide aceptar un ABA de vínculo. Si se incorpora un mantenimiento autorizado que escriba este documento, también interrumpirá la disponibilidad de un permiso o recibo legítimo. En el código inspeccionado, `bootstrap` crea la identidad si falta y la lee si existe. La operación de proyecto modifica otros documentos. No se identificó un escritor normal que reproduzca la actualización de mantenimiento sobre el documento de identidad de Cuenta. |

La escritura privilegiada del arnés actúa directamente sobre el almacén en memoria y vuelve a sembrar la prueba. Los métodos de negocio carecen de esa facultad. El árbol no expone una ruta del intento v2 y las [reglas de Cuenta](../../../deploy/google-cloud/account.rules#L4) deniegan acceso directo de clientes. No se comprobó el IAM efectivo, restauración real ni la existencia de mantenimientos externos. Tampoco se ejecutó una liquidación ni el cierre remoto de Video.

## Condición de integración

Se puede conservar la pieza como prototipo cerrado por `NODE_ENV=test` y sin ruta. Para integrar, hay que preservar una prueba histórica de autorización y decisión cuya autoridad no pueda reconstruirse desde los documentos reemplazados. Si el diseño admite el riesgo de escritores con acceso amplio a esa base, el testigo necesita una frontera efectiva de escritura fuera de su alcance, con vínculo al intento, titular, guard original y decisión/recibo. Otra colección bajo el mismo escritor no establece esa frontera. Si el contrato excluye esos escritores, debe acreditar el retiro y corte, el control de permisos, la retención del recibo y el modo de restaurar y conciliar sin certificar un reemplazo únicamente por sus valores actuales. El emisor autenticado y sus contrapruebas todavía faltan.

Para la identidad hay que definir la inmutabilidad del documento después de bootstrap o introducir una generación durable del vínculo que cambie al cambiar el dueño, incluso A→B→A, y permita los mantenimientos benignos que se autoricen. Comparar solo UID y cuenta actuales perdería detección de ABA. Falta aprobar qué debe hacer el operador ante una identidad revalidada si ya existe una decisión exacta. La única respuesta segura de la candidata en ese caso sigue siendo conflicto. Tampoco hay permiso de reenvío a partir de `pending`.

## Evidencia portátil

Node 24.22.3. En la selección de seis archivos del recibo base, **113 aprobadas y 2 contrapruebas rojas de 115**. Las 110 pruebas anteriores y los tres controles nuevos pasaron. `tsc --noEmit` y la comprobación del diff también pasaron. La prueba coordinada verifica sus precondiciones antes del rojo, y registra en la aserción los dos resultados aceptados, una escritura de recibo y la guardia eliminada. Los registros completos están en `outputs/lv019-b-account-unblock-attempt-20261126/`, fuera de Git.

```powershell
node node_modules/vitest/vitest.mjs run server/account/unblockAttemptReceipt.test.ts -t "provenance audit" --maxWorkers=1 --reporter=verbose
node node_modules/typescript/bin/tsc --noEmit
```

| Registro local | SHA-256 |
| --- | --- |
| `provenance-final.log` | `bdee8c5645365213fac6dd9623434785a5b2df6167cf94bdaa74537c7f94dbb1` |
| `provenance-final-types.log` | `f95e36aca63e3ad1a919542625fc9ff13077d972e04e21b73bdc46269066fc30` |

=== RESUMEN FINAL ===
RESULTADO: FALLA
EVIDENCIA: 113/115 en memoria y tipos correctos. Dos rojos reproducen la aceptación de recibo recreado y de autorización reconstruida por un escritor privilegiado simulado.
NEGATIVOS: Recibo recreado sin segunda mutación local; recreación coordinada habilita una decisión A sin tocar saldo, reserva, asientos o guardia B en el doble. Mantenimiento de identidad genera conflicto. Ruta normal de bootstrap y proyectos conserva el pin.
BLOQUEOS: Mantener el prototipo cerrado. Antes de integrar, demostrar la autoridad histórica, el corte, la retención/restauración y el contrato de versión del vínculo. No se demostró acceso de cliente ni ausencia de riesgo económico posterior. Costo y tokens no medidos.
=== FIN RESUMEN ===
