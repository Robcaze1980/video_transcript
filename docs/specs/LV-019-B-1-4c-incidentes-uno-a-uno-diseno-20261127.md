# LV-019.B · 1.4c límites 1, 2 y 3 · Diseño «incidentes uno a uno» (v3, 27 nov 2026)

**Estado: DISEÑO v3 tras dos rondas de revisión doble (v1: GLM INCONCLUYENTE y DeepSeek FALLA; v2: GLM FALLA y DeepSeek INCONCLUYENTE); sin implementar.** Las dos rondas vieron solo fragmentos del código, por eso la siguiente evidencia es la implementación revisada con el código completo. Resuelve los límites 1, 2 y 3 del [plan de 1.4c](LV-019-B-1-4c-limites-plan-20261127.md) con la decisión de Rob del 27 nov: **cada incidente de una guarda se desbloquea por separado, con su propia auditoría, en el orden que elija el operador, y la guarda sobrevive hasta que se revisen todos.** Código que mueve saldo: pruebas primero, mutaciones, regresión completa y revisión de GLM y DeepSeek antes de integrar. Extiende el [diseño de bloqueos y cierres](LV-019-B-bloqueos-y-cierres-diseno.md) (§3.3), que sigue siendo el contrato vigente hasta que este se acepte. Las adjudicaciones de [v1](../evidence/lv019-b-t3-saldo-integracion-20261127/diseno-uno-a-uno/ADJUDICACION-v1.md) y [v2](../evidence/lv019-b-t3-saldo-integracion-20261127/diseno-uno-a-uno/ADJUDICACION-v2.md) explican los cambios.

## 1. Hechos del código actual (verificados el 27 nov)

1. **La guarda de Video nombra solo el último incidente de cada tipo.** `writeBlockedGuard` (`firestoreBackend.ts:622`) fusiona `lastIncidentId` o `lastOutboxIncidentId` y suma 1 al `epoch` cada vez que llega un incidente distinto del ya nombrado en ese campo; `createdAtMs` se conserva.
2. **El desbloqueo solo direcciona lo que la guarda nombra, en dos sitios.** `sameGuard` (`billingUnblock.ts:164`) y `incidentOf` (`:419`) exigen que `incidentKey` sea el nombrado por exactamente uno de los dos campos; `incidentOf` calcula el hold con el `epoch` actual, así que el hold de un incidente anterior no se encuentra.
3. **Un incidente rival impide cualquier desbloqueo.** `freshRecord` lanza `unresolved` si queda una fila sin resolver que no pertenezca al incidente elegido (`unresolvedRows`). Con dos incidentes abiertos cada uno es rival del otro.
4. **La alerta de guarda nombra un solo incidente, con la regla «salida primero».** El estado es `blocked:<epoch>:<createdAtMs>:<incidente>` donde el incidente es `lastOutboxIncidentId ?? lastIncidentId` (`billingPendingReport.ts`, caso `guard`). Se compara en dos sitios con el incidente **elegido** (`sameOpenAlert` `:173` y `freshRecord` `:505`).
5. **Las alertas de generaciones anteriores las reemplaza el barrido**: cuando la fila pasa a otro estado cuya alerta ya está abierta, la anterior queda `superseded` (`billingPendingAlerts.ts`, barrido de cierre).
6. **El hold de un incidente se puede localizar por sus datos.** La fila del hold lleva `sourceKind`, `sourceId` (el incidente), `epoch` y `createdAtMs` (`firestoreBackend.ts:325-337`); `accountRows` ya lee todos los holds de la cuenta.
7. **La fase final ya soporta un resultado parcial y aborta si llega un incidente nuevo.** `clear = !account.blocked && rivales == 0 && !localAccountBlocked`; un incidente nuevo reescribe la guarda, así que el candado de versión `sameVersion(observed.guard, guard)` y la comparación de generación de `recheck` abortan antes de escribir.
8. **Cuenta ya revisa incidentes por separado.** `unblockVideoBilling` (`server/account/backend.ts:303`) acepta el incidente activo que se le nombre con la generación **actual** de su guarda, suma uno a `reviewedCount` y borra la guarda solo al completar. Un recibo de Cuenta por hold permite que un reintento adopte lo ya confirmado.

## 2. Diseño propuesto (v2)

**Incidente abierto.** Un incidente de la cuenta con su fila sin revisar: `billingReviewIncidents` (intención) o `billingOutboxReviewIncidents` (salida); las observaciones de intención cuelgan de su incidente.

1. **Direccionamiento por filas, no por la guarda.** `incidentOf` deja de pedir que la guarda nombre el incidente: lo busca entre las filas abiertas de la cuenta (la clave es la del documento del incidente) y deduce `kind`. Si la misma clave existe abierta en `billingReviewIncidents` **y** en `billingOutboxReviewIncidents`, es corrupción: `conflict` sin llamar a Cuenta (hoy el XOR de la guarda cubre ese caso). `sameGuard` se divide: la parte de **generación** (guarda viva, bloqueada, de la cuenta, mismo `epoch`, `createdAtMs` y versión) se conserva en todos los sitios; la pertenencia del incidente a las filas abiertas se comprueba donde ya se leen las filas (`freshRecord`, fase final). **Orden de una repetición:** primero los registros de auditoría (hecho, solicitado) y el recibo de Cuenta; la comprobación «incidente abierto» solo aplica a solicitudes nuevas o reanudadas, porque tras un resultado parcial las filas del incidente ya están revisadas.
2. **Hold propio, localizado por sus datos.** Se busca en los holds de la cuenta el que tenga `sourceKind` y `sourceId` del incidente y `createdAtMs` igual al de la guarda, y se exige `id === videoHoldId(kind, sourceId, hold.epoch, hold.createdAtMs)`. Debe haber **exactamente uno**, con `sourceKind` igual al tipo del incidente; ninguno, varios o uno malformado es `conflict` sin avanzar filas ni llamar a Cuenta. Un hold de un ciclo anterior de la guarda queda fuera por su `createdAtMs`. Los holds sin generación siguen la ruta heredada (límite 5).
3. **Rivales.** La fase 0 deja de rechazar por otros incidentes abiertos de la cuenta (eso es el resultado parcial). **La fase final no cambia:** sus rivales siguen siendo todo lo sin resolver que no sea del incidente elegido, de modo que desbloquear el último incidente con otro aún abierto es siempre un resultado parcial y jamás borra la guarda. La fase 0 rechaza con `conflict` toda fila sin resolver que no pertenezca a ningún incidente abierto (rival huérfano, también si apunta a un incidente inexistente): sigue sin salida hasta el paso 3.5 (límite 4).
4. **Alerta derivada de la guarda, no del incidente elegido.** El estado esperado de la alerta abierta es `blockedState(epoch, createdAtMs, lastOutboxIncidentId ?? lastIncidentId)` con **una sola función exportada del informe de pendientes** (que también valida los identificadores con `guardIncidentId` y trata una referencia inválida como guarda malformada); el informe y el desbloqueo la usan, para que no puedan divergir; se emplea en los dos sitios (`sameOpenAlert` y `freshRecord`). La alerta que se disposiciona al cerrar es la de la generación actual.
5. **Cuenta.** Se llama a Cuenta con el incidente elegido y la generación actual de **Cuenta**. Si Cuenta ya confirmó y la transacción final aborta (llegó un incidente nuevo), el reintento adopta el recibo de Cuenta por hold y no mueve saldo dos veces; con la generación de Video cambiada el reintento termina en `conflict` y el operador relee.
6. **Auditoría e idempotencia.** `unblockAuditId(incidente, acción, epoch, createdAtMs)` ya incluye el incidente: cada desbloqueo deja su propio par de registros y una repetición idéntica no escribe. Un `unblocked` con la guarda viva es el resultado parcial del **mismo incidente**.
7. **Fin.** Solo cuando no quedan incidentes abiertos ni bloqueo en Cuenta se borra la guarda de Video, se disposiciona la alerta y se crea la marca de reapertura.

## 3. Pruebas primero (deben fallar hoy por el motivo correcto)

| # | Escenario | Resultado esperado |
| --- | --- | --- |
| P1 | Dos incidentes de intención (I1 antiguo, I2 reciente): desbloquear I2 | parcial: filas de I2 avanzadas, guarda y alerta vivas |
| P2 | Después, desbloquear I1 (que la guarda ya no nombra) | cierre: guarda borrada, alerta disposicionada, Cuenta sin guarda |
| P3 | Los mismos dos incidentes en orden inverso (I1 primero) | mismo resultado final; el hold de I1 se encuentra por sus datos |
| P4 | Guarda mixta (intención y salida), ambos órdenes | mismo resultado final; la alerta es la de la salida en los dos casos |
| P5 | Un incidente nuevo llega entre la lectura y la escritura | aborta sin cambios; la repetición lo ve abierto y sigue parcial |
| P6 | Fila sin resolver que no pertenece a ningún incidente abierto | `conflict`, sin llamar a Cuenta |
| P7 | Repetición idéntica de un desbloqueo parcial | repetición sin escrituras |
| P8 | Incidente ya revisado o ajeno a la cuenta | `conflict`, sin llamar a Cuenta |
| P9 | Cuenta responde `blocked:true` por otro incidente | parcial; Video no libera |
| P10 | Guarda recreada con otro `createdAtMs`, y con el **mismo** `createdAtMs` y `epoch` 1 | ambas rechazadas por el incidente o el candado de versión; sin colisión de identificadores |
| P11 | Cuenta confirma y la fase final aborta por un incidente nuevo; reintento | el reintento adopta el recibo; sin segundo movimiento de saldo |
| P12 | Fila huérfana que apunta a un incidente inexistente | `conflict`, sin llamar a Cuenta |
| P13 | Dos holds del mismo incidente | `conflict`, sin avanzar filas |
| P14 | Hold antiguo no localizable | `conflict`, sin avanzar filas |
| P15 | Reintento con la generación de Video ya cambiada | `conflict` sin repetición silenciosa |
| P16 | Un incidente nuevo entra en la guarda de Cuenta entre su lectura y la llamada | `conflict`; Video aborta sin escribir |

| P17 | La misma clave de incidente abierta en las dos colecciones | `conflict`, sin llamar a Cuenta |
| P18 | Hold malformado o con `sourceKind` equivocado | `conflict`, sin avanzar filas |
| P19 | Desbloquear el último incidente mientras otro sigue abierto | parcial; la guarda no se borra |
| P20 | Repetición de un desbloqueo parcial cuando las filas del incidente ya están revisadas | repetición sin escrituras (los registros primero) |
| P21 | Cuenta sin guarda mientras otro incidente de Video espera su hold pendiente | se comporta como parcial de Video; sin reabrir a ciegas |
| P22 | Cambia una relación (salida o admisión) después de la lectura auditada | aborta sin escribir |
| P23 | Referencia de guarda inválida | `conflict` coherente con el informe (guarda malformada) |
| P24 | I2, llega I3 y luego I1 | cada paso parcial salvo el último; auditorías con identificadores distintos |

Cada prueba nueva se verifica por mutación (quitar la condición de «incidente abierto», la de rival huérfano, la búsqueda del hold por sus datos, la unicidad del hold, la alerta derivada de la guarda y la comprobación de `reviewedCount`) y las existentes siguen pasando.

## 4. Preguntas de v1 y su respuesta

| Pregunta | Respuesta |
| --- | --- |
| ¿Qué campos guardan las filas de hold? | `sourceKind`, `sourceId`, `epoch` y `createdAtMs` (hecho 6) |
| ¿Cómo nombra la alerta una guarda mixta? | La salida primero (hecho 4) |
| ¿Qué pasa con las alertas de generaciones anteriores? | El barrido las deja `superseded` (hecho 5); solo se disposiciona la de la generación actual |
| ¿Acepta Cuenta un incidente antiguo con la generación actual? | Sí (hecho 8) |
| ¿Guardas heredadas sin `epoch`? | Quedan en el límite 5; `writeBlockedGuard` las normaliza a 1 al siguiente incidente |

## 5. Fuera de alcance

La ruta y la autenticación del operador y la salida para filas huérfanas (paso 3.5, límites 4 y 6), el diseño de errores de Cuenta (límite 7), la migración de holds heredados (límite 5) y la concurrencia real en producción.
