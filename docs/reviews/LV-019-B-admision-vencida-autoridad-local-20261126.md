# LV-019.B · Autoridad de admisión tras una devolución vencida

**Resultado local, 26 nov 2026.** La barrera de entrada por devolución vencida sigue bloqueada por falta de evidencia. Un aviso abierto generado por el barrido puede describir dos situaciones que requieren decisiones de admisión diferentes. Incluso puede señalar como titular a otra cuenta. Por esos motivos se conserva el comportamiento de ejecución y los dos criterios de rechazo siguen en rojo. Base del diagnóstico `1eec63583bc92a4fe3afca44a991b5d1f00a8dbe`. [Contrato de admisión](../specs/LV-019-B-admision-video-devolucion-vencida.md) · [Diagnóstico anterior](../specs/LV-019-B-admision-vencida-contrapruebas-locales.md)

## Qué autoridad existe hoy

El guard financiero de Video se lee dentro de la transacción de `reserve`, que valida una solicitud anterior antes de vetar una admisión nueva y crea la solicitud y el trabajo juntos. El tercer control hizo escribir esa guardia al flujo de revisión de Video con una observación sintética divergente. Se rechazaron la nueva intención y el trabajo nuevo de A, su solicitud previa devolvió el mismo trabajo y B creó otro. Este control establece el comportamiento local de la guardia ya existente. El escenario de hold en Cuenta del diagnóstico previo muestra que una devolución ordinaria puede quedar impedida mientras ese hold siga activo, aunque la consulta de su estado funcione. Reutilizar el hold como guardia exclusiva de entrada introduciría ese impedimento en la reparación. [Transacción de admisión](../../server/commercial/firestoreBackend.ts#L2055) · [Creación de solicitud y trabajo](../../server/commercial/firestoreBackend.ts#L2136) · [Control de guardia activa](../../server/commercial/overdueReleaseEntry.diagnostic.mjs#L226)

## Dos contrapruebas nuevas

| Secuencia sintética | Resultado observado | Consecuencia para la admisión |
|---|---|---|
| Se parte de una misma intención y de una reserva ya creada por Cuenta. En una rama se pierde el avance local de reserva y el estado sigue en `reserve_pending`. En la otra se ejecuta la transición real a `release_pending`. Ambas registran un atasco de consulta a la misma hora de prueba y después vencen. | Antes del barrido se verifican los estados diferentes. Después, los datos de las dos bases en memoria comparan iguales, incluidos origen, fila y aviso abierto. `resolution` devuelve el mismo estado, id y segundos. | El veto reconstruido únicamente desde esos campos bloquearía también una reserva pendiente que jamás pasó a devolución. El barrido sí conoce el estado anterior cuando lo relee, pero su escritura actual lo reemplaza sin registrar la ocurrencia vencida. |
| Se crea y reserva para A, se cerca la devolución y se altera solo el hint `accountId` de la fila a un identificador válido de B antes del barrido. | El origen conserva A, la consulta de A devuelve su reserva y el escritor normal emite una alerta abierta con B. La ruta de trabajo de B permanece disponible. | Usar el titular del aviso como veto bloquearía a B. La prueba inyecta corrupción en el doble de persistencia. No se ha acreditado que un cliente pueda realizar esta escritura. |

La comparación de las dos historias se refiere a los campos accesibles en las fuentes examinadas. Los dobles no modelan tiempos de commit de Firestore. Una versión de la fila puede detectar cambios desde una lectura anterior de esa misma fila; por sí sola no reconstruye el estado que se sobrescribió. El ensayo inicial sin atasco mostró fechas de reintento diferentes. El mismo fallo ordinario de consulta en ambas ramas, aplicado por el escritor de planificación, elimina esa diferencia. [Historias independientes](../../server/commercial/overdueReleaseEntry.diagnostic.mjs#L177) · [Titular del aviso](../../server/commercial/overdueReleaseEntry.diagnostic.mjs#L209) · [Planificación](../../server/commercial/firestoreBackend.ts#L2382) · [Escalamiento](../../server/commercial/firestoreBackend.ts#L2467) · [Creación del aviso](../../server/commercial/billingPendingAlerts.ts#L116)

## Dependencias que mantienen apagada la función

Para filas nuevas, el barrido podría conservar la transición previa y la generación de la ocurrencia en el mismo commit. Esa escritura sola no resolvería el vínculo entre los dos dominios. El origen creado por Video precede la reserva de Cuenta. La respuesta histórica de reserva y la consulta actual de resolución tampoco certifican que una reasignación o revocación de Cuenta no haya invalidado ese vínculo antes del commit futuro en Video. Los controles originales conservan las secuencias A→B→A y revocación después de leer Cuenta. La recuperación D2 y el recibo actual de desbloqueo de un hold prestan servicios distintos. Ninguno acredita conjuntamente al propietario histórico y su vigencia para esta admisión. [Origen de Video](../../server/commercial/firestoreBackend.ts#L1292) · [Resolución en Cuenta](../../server/account/backend.ts#L477) · [Continuidad y revocación](../../server/commercial/overdueReleaseEntry.diagnostic.mjs#L105)

El siguiente corte requiere una ocurrencia canónica idempotente que identifique la devolución vencida, una atribución de reserva emitida por Cuenta con generaciones y una forma de ordenar los cambios de titular con el commit de Video. Entonces las rutas de intención, preparación de envío y creación de trabajo podrán consumir el mismo guard de entrada, aparte del hold financiero. La reparación deberá conciliar el efecto de la reserva y mantener la restricción hasta resolver todas las ocurrencias de la cuenta. Una reserva cuya autorización de envío ya se confirmó puede llegar después del alta del bloqueo. Hace falta recuperar su ACK y resolverla sin repetir un POST incierto. Mientras falte atribución, la alerta sigue disponible para revisión y aún pueden entrar videos del verdadero dueño. [Contrato y límites de las dos bases](../specs/LV-019-B-admision-video-devolucion-vencida.md)

## Verificación reproducible

El diagnóstico usa métodos de `FirestoreBackend` y `AccountStore` en dos mapas en memoria. Los identificadores y saldos son ficticios. El ensayo cubre las fronteras indicadas, sin autenticación de operador, entrega física de POST, emulador ni carreras de Firestore. Los casos de admisión fallidos quedan visibles para la futura implementación. La secuencia del guard financiero no ejecuta un proveedor, una liquidación de trabajo ni una reparación de producción.

```powershell
node --import tsx --test --test-reporter=tap server/commercial/overdueReleaseEntry.diagnostic.mjs
node --import tsx --test --test-name-pattern='^entry authority:' --test-reporter=tap server/commercial/overdueReleaseEntry.diagnostic.mjs
node node_modules/vitest/vitest.mjs run server/commercial/billingPendingAlerts.test.ts server/commercial/billingPendingReport.test.ts server/commercial/firestoreBlocksA.test.ts server/commercial/reserveAttemptEvidence.test.ts --reporter=dot
```

| Verificación | Resultado | SHA-256 de la salida local |
|---|---|---|
| Base anterior, seis casos | 4 aprobados y 2 rojos por ausencia del veto | `b267b6c24ed9b5ffbfd322a32dbdf5cce3c5a40af854a92b56eb14b23d91af06` |
| Nueve casos tras ampliar el diagnóstico | 7 aprobados y los mismos 2 rojos. Ninguna omisión | `37ea57050e94c98bf64b640787d15c6fbef72e0df6a899ea213ff2b7a161f938` |
| Tres controles nuevos, filtrados por nombre | 3 aprobados | `aca4c88b5b5cd99b6798a5dc7ee251c1819332e74b597e13c1d28ff95f385d0d` |
| Cuatro suites unitarias relacionadas | 91/91 | `6344cba65ff0ebbf5daf32c37da8d877d9cdd96ee6ed4e754fdd0181f0587dde` |

Node v24.13.0 se usó para el diagnóstico. Las salidas completas quedan en `outputs/overdue-authority/` del worktree.
