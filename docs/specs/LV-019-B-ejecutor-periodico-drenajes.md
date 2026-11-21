# LV-019.B · Ejecutor periódico de los drenajes de saldo (paso 1.6)

**Estado (20 nov 2026): DISEÑO v2 tras la ronda 1 de T3 (GLM FALLA y DeepSeek FALLA; hallazgos adjudicados en el [recibo](../evidence/lv019-b-t3-ejecutor-20261120/RECIBO.md)); sin código.** Paso 1.6 del [plan paso a paso](LV-019-B-plan-paso-a-paso-20261120.md). Nada se despliega (puerta G0): este documento define el contrato local que luego se programará (T3 codifica, Codex certifica) y se llevará a la nube con el primer despliegue.

## 1. Problema (evidencia)

Los drenajes que resuelven el saldo en duda existen pero **nadie los ejecuta de forma periódica**:
- `drainExternalBilling` (reservas recuperadas, liberaciones y liquidaciones) y `drainExternalHolds` (bloqueos) solo corren en el modo `billing` (`cloudFilesRuntime.ts`), que es un trabajo puntual **sin planificador** (la lectura P0 del 19 nov confirmó que ningún trabajo ni servicio está configurado en ese modo), o como cola tras una ejecución del worker de IA, que se omite si esa ejecución falla.
- La pasada de mantenimiento de cada 5 minutos (`POST /internal/maintenance`) drena archivos y despacha IA, pero **no** ejecuta los drenajes de saldo.
- Consecuencia: una respuesta perdida o una caída entre Video y Cuenta no se recupera sola; el invariante I5 («toda reserva llega a estado final o a revisión con alerta») no se cumple. El barrido de alertas (A2) solo detecta, no resuelve.

## 2. Qué debe garantizar

1. **Vivacidad:** toda fila de intención, salida o bloqueo que pueda avanzar avanza, o llega a `needs_review` con alerta, en un tiempo acotado y sin intervención.
2. **Seguridad:** nunca hay un segundo movimiento de saldo por la misma reserva y acción. La garantía **no depende** de ningún candado: la dan la idempotencia de Cuenta (un asiento por acción y reserva) y las comparaciones atómicas de Video. El candado solo evita trabajo redundante y falsos positivos.
3. **Equidad:** una cuenta con muchas filas vencidas no deja sin turno a las demás.
4. **Trabajo acotado:** tiempo y número de filas por pasada.
5. **Aislamiento:** un fallo del drenaje no rompe los archivos ni la IA, y al revés.
6. **Observable:** cada pasada deja una línea de registro con solo recuentos (latido), incluso cuando no hay nada que hacer o falla.
7. **Apagable:** un interruptor de configuración externo, apagado por defecto.

## 3. Diseño

**3.1 Dónde corre.** Un sub-manejador aislado dentro de la pasada de mantenimiento existente (la misma identidad privada y el mismo planificador de 5 minutos; sin un segundo planificador). Cada sección de la pasada (archivos, IA, drenaje de saldo y, después, el barrido de alertas) tiene su propio `try/catch` y presupuesto de tiempo; la respuesta resume el estado de cada una.

**3.2 Candado con arriendo.** Documento `billingDrainLease/current` en la base de Video: `{holderId, token, expiresAtMs}`. Se adquiere en una transacción si no existe o venció; `token` crece en cada adquisición; el arriendo dura 90 s y se renueva cada 10 s durante la pasada; se libera al terminar. Si otro lo tiene, la pasada devuelve `skipped: lease_held` sin error. El token se registra en el latido. **El candado es una optimización** (ver 2.2); una pasada que despierta tarde tras una pausa no puede duplicar un cobro. La renovación y la liberación son **condicionales a `holderId` y `token`** (un titular antiguo no puede renovar ni borrar el arriendo del nuevo), y antes de **cada fila** la pasada comprueba que sigue siendo la titular con un margen de al menos 15 s; si perdió el arriendo, termina limpiamente sin tocar más filas. La tenencia máxima es el presupuesto de la pasada (60 s): no se renueva sin progreso.

**3.3 Orden y límites de una pasada.** Igual que el modo `billing` de hoy: bloqueos pendientes, intenciones, salidas y bloqueos de nuevo. Presupuesto de 60 s repartido por sección (por ejemplo 15 s para bloqueos antes, 15 s intenciones, 20 s salidas y 10 s bloqueos después) para que ninguna agote el de las demás; al agotarse no se toman filas nuevas de esa sección. Hasta 100 filas por tipo (ya existente) y **un máximo de 5 filas por cuenta y pasada**. **Rotación:** un cursor persistente por tipo (en el mismo documento del arriendo) hace que cada pasada empiece después de la última fila atendida y dé la vuelta, de modo que las mismas primeras cuentas no acaparen los turnos; las liberaciones y los bloqueos siguen yendo primero (alternancia ya existente).

**3.4 Fallos.** Por fila: reintento con espera creciente (ya existente) y, tras el tope de `conflict` del paso 1.1, `needs_review` con alerta. `too_early` reprograma sin contar. **Toda ruta de error de una fila deja constancia de un intento** (y la espera creciente); ninguna fila puede fallar repetidamente sin avanzar en su contador. Una **edad máxima** (valor a fijar con datos; propuesta inicial 48 h) lleva la fila a `needs_review` con alerta aunque el motivo sea de infraestructura. Un error al adquirir el arriendo no cambia filas y se refleja en el latido. Con el arriendo vigente, las versiones de los documentos solo cambian por la propia pasada; una pasada que lo pierde a mitad de fila puede provocar una cuarentena evitable (la reconciliación del doble ACK la cubre cuando el historial sigue intacto), por eso la comprobación previa a cada fila.

**3.5 Latido y señales.** Una línea estructurada por pasada con `{event:'billing-drain', startedAtMs, durationMs, outcome, settled, failed, intentsRecovered, intentsFailed, holds, skippedRows, unknownResolved, leaseToken}` donde `outcome` es `ok`, `partial`, `error`, `disabled` o `skipped` (`disabled` y `skipped` son estados sanos); solo recuentos, sin identificadores ni contenido. Alertas, todas evaluadas por Cloud Monitoring fuera del servicio: **sin latido**, `outcome:error` sostenido, `failed > 0` sostenido y **edad de la fila pendiente más antigua** (la entrega el barrido de alertas, paso 3.4).

**3.6 Interruptor.** `VISTAVO_BILLING_DRAIN=1` activa el sub-manejador; sin él devuelve `disabled` y registra el latido igualmente. Es independiente del interruptor del proveedor y del de voz.

## 4. Pruebas exigidas (primero en rojo)

Candado: adquirir, renovar, vencer, liberar, dos titulares a la vez (solo uno entra), token creciente. **Seguridad:** dos pasadas simultáneas y una pasada pausada que despierta tarde sobre las mismas filas producen **un solo movimiento de saldo en Cuenta real**, sin incidentes ni bloqueos. Una pasada interrumpida a mitad deja las filas en un estado que la siguiente completa. Equidad: una cuenta con 50 filas vencidas no impide liquidar la de otra en la misma pasada. Presupuesto de tiempo por sección y tope de filas respetados. **Cursor de rotación** (varias pasadas recorren todas las cuentas). **Titular antiguo** tras vencer el arriendo no renueva ni libera y se detiene antes de la siguiente fila. **Caída del proceso justo después de la respuesta de Cuenta** y antes de escribir en Video: la siguiente pasada concilia sin segundo cargo. Un error de infraestructura persistente avanza el contador y llega a `needs_review` por edad. Interruptor apagado. Latido emitido con trabajo, sin trabajo, con error, desactivado y omitido. Aislamiento: un drenaje que lanza error no afecta a las secciones de archivos e IA. Mutaciones sobre cada condición; regresión financiera completa; revisión T3 del diseño y del código.

## 5. Fuera de alcance

El trabajo de Cloud Scheduler y los permisos de nube (se despliegan después, G0), la alerta de Monitoring (paso 3.3), el barrido de alertas (paso 3.4) y cambiar a dónde apuntan las identidades. Una ejecución periódica real no se prueba en la nube hasta el primer despliegue restringido.

## 6. Estado de implementación (21 nov 2026)

- **1.6a candado:** certificado ([recibo](../evidence/lv019-b-t3-codificacion-1-6a-20261120/RECIBO.md)).
- **1.6b parte 1, control de los drenajes** (`shouldContinue`, tope por cuenta, cursor con vuelta, `maxRows`): certificado ([recibo](../evidence/lv019-b-t3-codificacion-1-6b-20261120/RECIBO.md)).
- **1.6b parte 2, sección del ejecutor y cableado** (`billingDrainSection.ts`, `VISTAVO_BILLING_DRAIN`): programada por T3 y verificada por Codex (regresión financiera completa 288 pruebas, 283 aprobadas, 5 pausadas, 0 fallidas); **dos revisores respondieron FALLA** y se aplica una ronda de correcciones (presupuesto y arriendo por fila en el resolvedor de `unknown`, tope por cuenta compartido por pasada, cursores solo del tipo recorrido). Certificación pendiente de esa ronda ([evidencia](../evidence/lv019-b-t3-codificacion-1-6b2-20261121/)).
- **Pendiente (paso 1.6c, no implementado):** (a) la **edad máxima** de la sección 3.4 (una fila que no avanza llega a `needs_review` con alerta a las 48 h aunque el motivo sea de infraestructura) y (b) la constancia de intento en las tres rutas del drenaje de intenciones que hoy hacen `intentsFailed++; continue` sin registrar el fallo (falta `snapshotVersion`, evidencia de fallo o instantánea de estado): una fila así se reintenta en cada pasada sin avanzar. (c) Límite declarado: los bloqueos se ordenan por `nextAttemptAt` y **no rotan** (el cursor `holds` del candado queda sin uso); solo afectaría a una cuenta con más de 100 bloqueos vencidos a la vez.
