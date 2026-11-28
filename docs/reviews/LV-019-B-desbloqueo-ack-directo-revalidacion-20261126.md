# LV-019.B · Continuidad de la auditoría al recibir un ACK directo de desbloqueo

Candidata local sobre `5d949a0`. Abarca la primera mutación en Cuenta y la mutación condicional de una reanudación con recibo `pending`. Las contrapruebas independientes de `ce4409f` encuentran alteraciones durante la respuesta a ambos POST. En los cuatro negativos, la base cerró Video después de que Cuenta guardó su único recibo, aun cuando la solicitud auditada tenía otra evidencia o había sido reescrita y restaurada. La decisión de Cuenta, el saldo, la reserva y su asiento permanecieron intactos. [Contrato de desbloqueo §3.3](../specs/LV-019-B-bloqueos-y-cierres-diseno.md)

## Corrección y recuperación

- Antes del primer POST, Video relee el `unblock_requested` confirmado en Firestore y lo coteja con el registro completo de la transacción que lo creó, incluido el plan. Exige que `createTime` y `updateTime` de la misma solicitud coincidan. Una alteración visible o restaurada en el mismo documento antes de la primera relectura se detiene con cero POST.
- Antes del POST condicionado a `pending`, Video vuelve a comprobar la autorización abierta y usa la versión observada en esa relectura. Al consumir el ACK de cualquiera de los dos POST, la transacción final comprueba la misma versión y la inmutabilidad de la solicitud, la vigencia de la guardia y la alerta, y la ausencia de cierres rivales. El cotejo precede el avance de cualquier fila.
- Si se pierde el ACK con la auditoría intacta, una repetición del mismo operador consulta el recibo de Cuenta. La confirmación puede cerrar Video con cero POST de mutación adicionales. Una repetición del resultado ya cerrado carece de contactos adicionales con Cuenta.
- Una auditoría alterada o restaurada durante la respuesta mantiene la guardia de Video, la alerta abierta y la incidencia en revisión. El intento termina en `conflict`. Si una nueva consulta autorizada llega a recuperar el recibo de Cuenta, la historia modificada sigue sin permitir cierre ni otro POST de mutación. Restaurar el contenido mediante una nueva escritura conserva la diferencia de versión. Resolver la auditoría dañada requiere un procedimiento autorizado de conciliación por un operador.

El código usa las versiones de un documento en Firestore de Video. La comprobación local carece de capacidad para impedir una mutación que Cuenta ya recibió. El doble local conserva un recibo de Cuenta en ese orden y comprueba que sus segundos y movimientos permanecen iguales. La ventana previa a la primera relectura todavía presupone un escritor que no borre y vuelva a crear un documento idéntico. En ese caso extremo, los metadatos de la nueva creación pueden coincidir entre sí, sin probar que sea la creación original. Cubrir ese caso requiere evidencia durable adicional. Las contrapruebas ejercen una escritura privilegiada sintética y no identifican una vía de cliente.

## Evidencia

- La base con las pruebas de esta candidata obtuvo **34/40**. Fallaron las cuatro contrapruebas de ACK directo y dos de alteración previa a la primera relectura. Los dos controles intactos y la recuperación de ACK perdido pasaron en la base. El diagnóstico independiente anterior con sus seis adiciones obtuvo **33/37** y se conserva como `ce4409f`.
- La candidata obtuvo **457/457** en 19 suites unitarias de alertas, facturación y el HTTP de Cuenta. La selección de desbloqueo, `pending` y parcial obtuvo **23/23** con 17 casos fuera del filtro. Incluye el control de generación de Cuenta actualizada tras `pending`, los bloqueos ante cambios de guardia, solicitud y alerta, y las consultas parciales bajo autorización válida o alterada.
- Node 24.22.3 verificó la sintaxis de ambos archivos y `tsc --noEmit` terminó con salida cero. El registro inicial de tipos conserva la inferencia corregida de la forma del nuevo registro. La instrumentación inicial de las versiones se ajustó para que sus métodos auxiliares no afectasen la comparación exhaustiva del doble.

Los registros se guardaron en `outputs/lv019-b-direct-ack-revalidation-20261126/`, ignorado por Git.

| Registro | SHA-256 |
| --- | --- |
| `red.log` | `4c1665a80c933beb3cb73a6714c8b30f1bffb8178fb89c7c8add1785acee87bf` |
| `green-final.log` | `323c15dcef123db6bcc122094e00f306bd15200ae9588bec3e8b7d6131d30537` |
| `pending-partial.log` | `4f8ee927dd78881cae4b202d2d70b9937d0f61e734907a3699214db5ad57e78b` |
| `types.log` | `2095d5302e465922147e220c0389f7a923ea0c1509a23097f04b3c220798aef8` |

Se reproducen los casos de la biblioteca con `node node_modules/vitest/vitest.mjs run server/commercial/alertContractReview.test.mjs --maxWorkers=1`. El doble transaccional verifica el orden de los efectos y la forma de los estados. Antes de integrar requiere contraste independiente dual, verificación equivalente con Firestore Emulator y la batería del corte financiero final. Esta candidata usó procesos locales y datos inventados.

## Archivos

- [billingUnblock.ts](../../server/commercial/billingUnblock.ts) comparte el cotejo local entre los dos POST, la confirmación recuperada por recibo y la transacción final.
- [alertContractReview.test.mjs](../../server/commercial/alertContractReview.test.mjs) conserva las contrapruebas con AccountStore, modela las dos marcas temporales y registra la recuperación idempotente.
