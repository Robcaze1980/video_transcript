# LV-019.B · Doble ACK de liquidación (segundo drenador sobre una fila ya liquidada)

**Estado (20 nov 2026): criterio decidido por Codex e implementado y verificado en local (emulador, mutaciones, regresión financiera 222 aprobadas / 5 pausadas / 0 fallidas, T3 con adjudicación en el [recibo](../evidence/lv019-b-t3-doble-ack-20261120/RECIBO.md)); sin desplegar.** Es una decisión técnica, no comercial. No cambia el cobro ni el saldo: solo evita que una carrera inocente bloquee a un dueño.

## Problema

Dos drenadores pueden leer la misma fila `pending` de `billingOutbox`, validar el mismo historial y pedir a Cuenta la misma liquidación. Cuenta es idempotente (una entrada de libro por acción y reserva), así que ambos reciben el mismo ACK. El primero registra `settled`. El segundo ya no puede (`markExternalBillingSettled` exige `pending` o `retry_wait`) y llama a `quarantineExternalBillingOutbox(... phase:'after_ack')`, que hoy crea una incidencia `needs_review` y, si el dueño es verificable, bloquea su cuenta y pasa la intención a revisión (`firestoreBackend.ts`, `quarantineExternalBillingOutbox`). El tipo de resultado ya admite `already_settled` y el drenador ya lo trata como no fallo, pero el backend nunca lo devuelve. La revisión T3 del 17 nov lo registró como negativo: [doble ACK sobre fila ya settled crea incidencia y bloquea al dueño](../reviews/LV-019-B-liquidacion-historia-final-GLM-T3-2026-11-17.txt).

## Decisión

En la fase `after_ack`, `quarantineExternalBillingOutbox` devuelve `{state:'already_settled',ownerBlocked:false}` **sin escribir nada** solo si se cumplen **todas** estas condiciones, comprobadas en la misma transacción:

1. Hay una instantánea previa al POST (`settlementSnapshot`) y su tupla coincide con la esperada.
2. El ACK remoto ya fue validado: misma reserva, mismos segundos y estado coherente con la acción (`captured` para captura, `released` para liberación).
3. La fila de `billingOutbox` existe, está en `settled`, su tupla (trabajo, cuenta, proveedor, identidad, reserva, segundos, acción y, en capturas, intento) coincide con la esperada y es **el mismo documento** que se leyó antes del POST (mismo `createTime`; solo su `updateTime` pudo moverse). Una fila borrada y recreada con la misma tupla no cuenta (añadido tras la revisión T3 del 20 nov).
4. Releídos ahora los 14 documentos de la instantánea, los **13 distintos de `billingOutbox`** conservan exactamente su versión (existencia, `createTime`, `updateTime`) de antes del POST. Solo la fila de salida pudo cambiar, y el único cambio legítimo es `pending → settled` por el primer drenador.

Si falla cualquier condición se conserva el comportamiento actual: incidencia, fila terminal sin reescribir, bloqueo del dueño verificable.

**Por qué es seguro.** El ACK es la prueba de que Cuenta aplicó la acción una vez; la fila `settled` con la misma tupla es el registro local de ese mismo hecho; y los otros 13 documentos sin cambios muestran que el historial que se validó antes del POST sigue intacto. Un historial alterado entre medias (cuenta, trabajo, movimiento terminal, artefacto, clasificación, reserva simulada, identidad, petición, intención, barreras, testigo de origen o marca del trabajo) sigue produciendo incidencia, como ya prueban las pruebas «changed … after capture send».

## Límites

- No resuelve dos ACK con historias distintas: ese caso sigue siendo incidencia y bloqueo.
- No autentica al primer drenador: la fila `settled` es evidencia local, no un testigo de Cuenta. Lo que la respalda es el ACK que acaba de llegar.
- **Consecuencia sobre el `catch` del drenador.** Si `markExternalBillingSettled` hace commit y lanza error después (respuesta perdida), el `catch` llama al mismo método y ahora tampoco queda incidencia con el ACK ni bloqueo: el registro durable es la fila `settled` con historial intacto, y ya no se distingue commit propio de ajeno. El drenador sigue contando ese intento como `failed`. T3 lo discutió ([recibo](../evidence/lv019-b-t3-doble-ack-20261120/RECIBO.md)); una marca durable no bloqueante queda como mejora posible, no adoptada.
- Las versiones solo cubren los 14 documentos del contrato de liquidación; no detectan cambios fuera de ellos (límite ya registrado el 17 nov).
- No cuenta el duplicado como liquidación nueva (`settled` del drenador no sube) ni como fallo.
- Solo local; sin despliegue, sin escrituras reales, sin movimiento de saldo.

## Pruebas exigidas

- Carrera de dos ACK concurrentes: una liquidación, cero incidencias, dueño sin bloquear, intención en `job_created`.
- Para cada uno de los otros 13 documentos, un cambio posterior a la liquidación mantiene la incidencia.
- Fila `settled` con tupla distinta, instantánea ausente y fila aún `pending`: incidencia como hoy.
- Mutaciones sobre cada condición del criterio; regresión financiera completa y revisión T3.
