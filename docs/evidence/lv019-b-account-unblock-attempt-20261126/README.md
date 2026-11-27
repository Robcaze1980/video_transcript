# LV-019.B · Cuenta · Confirmación y consulta de un intento de desbloqueo

Corte aislado sobre `aa1d16b961c0635aa81b9700f1b6bc5fe9608d2d`. Este incremento prueba una sola parte de la [conciliación propuesta](../../specs/LV-019-B-desbloqueo-conciliacion-intento.md): aplicar una vez un intento que Cuenta ya autorizó y recuperar su recibo exacto si se pierde la respuesta. Los métodos se cierran fuera de `NODE_ENV=test` y carecen de ruta y llamador de runtime. La fixture prepara la autoridad local como precondición, sin simular la autenticación de un emisor ni el corte.

## Qué garantiza la pieza

- [AccountStore](../../../server/account/backend.ts#L327) obtiene al dueño desde su identidad vigente de Cuenta. Lee guardia, incidente, autorización previa y recibo bajo ese dueño. La solicitud debe repetir exactamente el incidente, intento, huella de autorización, referencia de revisión y generación de la guardia. La ausencia de autorización, incidente enrolado o cualquiera de sus marcas históricas causa conflicto antes de escribir.
- En una transacción, la aplicación crea un único recibo por dueño e incidente, revisa ese incidente y actualiza o quita exclusivamente la guardia de Cuenta según su conteo. Saldo, reserva y libro quedan fuera de las escrituras. El replay exacto y la consulta devuelven el recibo conservado si concuerda con la prueba y la decisión. Si ya llegó otra guardia, el resultado informa el bloqueo de Cuenta observado y conserva la generación aceptada por el recibo. Si se pierde el recibo después de revisar, se conserva el conflicto.
- La consulta nunca aplica la decisión. Su `pending` representa un intento acreditado que todavía carece de recibo en esa lectura. No prueba que no exista un POST en vuelo ni habilita una llamada. La aplicación requiere la generación original; un avance legítimo hace conflicto antes de decidir. No hay método para cambiar la generación o cercar y crear un sucesor.
- Los accesos legacy de recibo y mutación rechazan un incidente o recibo versionado. Una fila sin la marca sigue el contrato antiguo, probado en la misma selección. Las dos familias comparten la clave del recibo por incidente, con una sola decisión. El corte que retira ejecutables anteriores y protege las marcas de enrolamiento sigue pendiente.

## Procedencia de las versiones originales

La autorización previa de esta pieza es un documento inmutable `videoBillingUnblockAuthorities` cuya clave es el hash del dueño resuelto por Cuenta y el incidente. Guarda la tupla autorizada, `identityVersion`, `incidentVersion` y `guardVersion`. El incidente conserva de forma independiente `unblockAuthorityVersion`, fijada antes de habilitar el envío.

Un escritor futuro autorizado de **Cuenta** tendría que comprobar primero la ocurrencia atestiguada por Video, el operador, el vínculo y el corte. Dentro de su propia lectura transaccional obtendría `identity.updateTime`, `incident.createTime`, `guard.createTime`, época y fecha lógica desde los snapshots de Cuenta. Esas versiones se persistirían en la autorización inmutable. Después de crear la autorización, el escritor leería su `createTime` ya materializado, comprobaría que el contenido y la historia siguen siendo los autorizados, y fijaría esa versión en el incidente bajo una transacción que vuelve a validar el conjunto. Mientras falte el puntero, esta pieza permanece cerrada. El enrolamiento debe estar coordinado con el retiro de escritores viejos antes de habilitar actividad.

El lector compara valores históricos ya guardados con snapshots actuales. El cliente no propone esas versiones ni puede convertir dos tiempos actuales iguales en prueba de procedencia. El guard de un intento activo conserva su creación física, época y fecha lógica. Se permite el avance del conteo al resolver un rival bajo la misma generación. El recibo se crea con la revisión y comprueba su tupla y su integridad en el almacenamiento autorizado. La pieza presupone retención de esos registros y no acredita el historial ante recreación coordinada por un escritor privilegiado. Si faltan confianza del emisor, retención o atribución, permanece la revisión.

## Evidencia y límites

Pasaron **110/110** pruebas focales de seis archivos con Node 24.22.3, incluidas **17/17** de la [nueva suite](../../../server/account/unblockAttemptReceipt.test.ts). `tsc --noEmit` y `git diff --check` pasaron. Se ensayaron ambos órdenes de lectura y aplicación, rechazo de commit sin publicar, ACK perdido después de publicar, replay desde instancia nueva, cruce de dos cuentas incluso con el mismo ID de incidente, guardia nueva, rival en la misma guardia, autorización ausente o recreada, versión antigua, ABA de identidad, recibo ausente o alterado, tupla distinta, contador inconsistente y compatibilidad legacy. En los caminos confirmados se conservaron saldo, reserva y asiento de ambas cuentas.

```powershell
$tests = @(
 'server/account/unblockAttemptReceipt.test.ts',
 'server/account/videoBalanceIdentity.test.ts',
 'server/account/videoReservationIdentity.test.ts',
 'server/account/accountReadIdentity.test.ts',
 'server/commercial/unblockContinuityIndependent.test.mjs',
 'server/commercial/alertContractReview.test.mjs'
)
node node_modules/vitest/vitest.mjs run @tests --maxWorkers=1 --reporter=verbose
node node_modules/typescript/bin/tsc --noEmit
```

Evidencia local en `outputs/lv019-b-account-unblock-attempt-20261126/`.

| Archivo | SHA-256 crudo |
| --- | --- |
| `focal-final.log` | `9c83dbcc983a92395269a6e0e571532f31b621955fee3bb4afbdf93eb5c70807` |
| `types-final.log` | `f95e36aca63e3ad1a919542625fc9ff13077d972e04e21b73bdc46269066fc30` |

Los dos dictámenes de consulta sobre `708c414` conservan sus resultados en el checkpoint. Coinciden en que `pending` no demuestra ausencia de envío. El reenvío explícito sugerido por GLM carece de autoridad sin cerco, reconciliación y corte. El intento durable y 409 estructurado discutidos por DeepSeek son piezas aún pendientes. Los controles nuevos usan AccountStore real sobre un doble serial en memoria. No se ejercitaron Firestore, HTTP, IAM ni el protocolo entre bases. Sigue abierto el caso de ACK perdido antes del primer POST, el avance de generación sin permiso vigente y la conciliación/migración de incidencias legadas. Esta pieza carece del emisor autenticado y del escritor de altas y permisos. No se ejecutó T3.

=== RESUMEN FINAL ===
RESULTADO: PASS
EVIDENCIA: 110/110 focales, 17/17 nuevas, tipos y diff check. Un ACK perdido después de decidir se recupera por consulta exacta con un efecto de bloqueo y sin cambios en saldo, reserva o libro.
NEGATIVOS: Dos titulares aislados, historial y generación no coincidentes, permiso/recibo ausente, replay y tupla incorrecta, legacy y ambiente distinto de pruebas. Pending no cambia estado ni da derecho a reenviar.
BLOQUEOS: Falta escritor/emisor, cerco, contrato de operador y HTTP, corte, migración, Firestore y verificación independiente. PASS limitado al incremento en memoria. Costo y tokens no medidos.
=== FIN RESUMEN ===
