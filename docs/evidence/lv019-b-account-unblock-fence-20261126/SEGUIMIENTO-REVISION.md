# LV-019.B · Cobertura tras revisión dual del cerco

26 nov 2026 · GLM y DeepSeek dieron PASS estático acotado al paquete de `0e6876b9b1d6e3744afa36ddccfa54780036dd20`. Las copias de los informes quedan en el checkpoint en `docs/reviews/LV-019-B-cerco-cuenta-0e6876b-{GLM,DeepSeek}-20261126.txt`. SHA-256 de las respuestas originales `d42d6110cbce8e2c66b79d1748fabd4213be8cae44aa7791cba64a4b71b5f2c6` y `e7027060df36ced35c9bc554c597a97d55957389bdd7abf2a9cd41b2b3858152`, respectivamente. El [recibo original](RECIBO.md) conserva el resultado de aquel corte. Este seguimiento añade solo controles y no extiende los dictámenes originales.

| Observación | Contraste con el contrato y prueba |
|---|---|
| Autorización de conciliación editada y restaurada | Se reproduce la misma carga con `updateTime` nuevo. Mantiene `conflict` para la conciliación y el predecesor intacto sigue observable por lectura. `backend.ts:385-390` coteja inmutabilidad y tupla. Una recreación privilegiada capaz de producir marcas coherentes no queda cubierta por ese control. |
| Incidente recreado | La copia toma otra versión de creación y no coincide con la inscripción de `backend.ts:369-372`. Se rechazan despacho y conciliación antes de escribir. |
| Recibo de sucesor sin autorización de conciliación | Tras confirmar el sucesor, quitar su autorización conserva el recibo y produce `conflict` en lectura, conciliación y confirmación. La autorización forma parte de la cadena que el código valida antes de recuperar el resultado. Retenerla es una dependencia de disponibilidad. La lectura no fabrica otra autorización. |
| Sucesor con misma época | El cerco cambia qué `attemptId` puede ejecutar y la generación pertenece a la guardia. Con autorización exacta puede cercarse un intento incierto aunque la generación permanezca igual. Se fijó explícitamente esta precondición en la prueba de ACK perdido y POST anterior tardío. Un 409 por cambio real de época exige una nueva autorización que coincida con la guardia vigente. [Contrato](../../specs/LV-019-B-desbloqueo-cuenta-cerco-local-20261126.md) |
| Recibo histórico y guardia nueva | El método `blockVideoBilling` crea otra ocurrencia que vuelve a época 1. El reloj del arnés hace repetir también `createdAtMs`. La recuperación devuelve el recibo antiguo junto con `blocked:true` de la guardia nueva. El nuevo incidente sigue activo, sin escrituras en las dos consultas ni cambios de saldo. El pin de creación de la guardia sí se exige para un despacho aún sin recibo. |
| `incident.createdAtMs` | El incidente puede surgir después de la creación de su guardia compartida. Se acepta un instante válido distinto al de la guardia y se rechaza un valor malformado. El código valida que sea entero y liga el incidente mediante su `createTime` físico. No fija la igualdad del tiempo lógico con una copia histórica separada. El escenario de un escritor privilegiado que reasigna en sitio un valor lógico válido queda fuera del modelo de escritura autorizada. |
| `incidentCount` | `billingHold` exige entero con mínimo 1 antes de `nextGuardReview`, que verifica el contador de revisados. El control de 0 devuelve `invariant` antes de escribir. [Validación](../../../server/account/backend.ts#L85) |

**127/127 pruebas en siete suites**, sin omisiones. Se usó el comando del [recibo original](RECIBO.md) y `tsc --noEmit` volvió a terminar con salida 0. Evidencia en `outputs/unblock-fence-review-20261126/focal.log`, SHA-256 `f937db6ae8daf41cdd1ff3bb102a66af8167fb03b8d57494b1c6342297bbe14a`. Las pruebas ejecutan AccountStore sobre un almacenamiento serial sintético. Costo y tokens no medidos. Sin emulador ni recursos cloud.

=== RESUMEN FINAL ===
RESULTADO: PASS
EVIDENCIA: Siete controles añadidos y una precondición de misma época explicitada sobre `0e6876b`, con 127/127 pruebas y tipos aprobados. Runtime intacto.
NEGATIVOS: Autorización restaurada, incidente recreado o con hora malformada, autorización perdida tras recibo, contador inválido y recuperación conservadora con guardia posterior. La persistencia del grant sigue siendo necesaria.
BLOQUEOS: La cobertura sigue en el arnés local. No prueba autoridad de inscripción, IAM, corte, restauración, migración, producción ni serialización de Firestore real. Los dictámenes externos corresponden al paquete del commit original.
=== FIN RESUMEN ===
