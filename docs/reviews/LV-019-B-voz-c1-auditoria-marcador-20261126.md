# LV-019.B · Auditoría interna de C1: alerta de recibos y versión del marcador

**26 de noviembre de 2026 · FALLA acotada.** El corte conserva y alerta dos recibos válidos si el historial permanece intacto. La verificación de la versión del marcador detecta alteraciones después de preparar el intento. Quedan dos ventanas que impiden aceptar estas garantías como completas.

## Corte revisado

Revisión estática de solo lectura de `vistavo-voice-c1-20261125`. Las rutas y líneas corresponden a ese worktree. Se verificaron las huellas antes y después del contraste.

| Archivo | SHA-256 |
| --- | --- |
| `server/commercial/firestoreBackend.ts` | `3861f33ac72f46618fe15f0dd3f8631239588ac1e7de9b5dd299d888001e5834` |
| `server/commercial/reserveAttemptEvidence.ts` | `a53fef5ca4761943429aad7e9564ba13f3165006fa64891af1359787d0cf1502` |
| `server/commercial/firestoreReviewedTranslation.emulator.mjs` | `2c45e5c10f755379403a3ec05f61d67e8226dc4f863dacc609bc166be65932c3` |

Las 64 pruebas de emulador estaban en curso durante la revisión. El informe se basa en el código y las aserciones de la fixture. Uso y costo no medidos. [Contrato de voz local](../specs/LV-019-B-voz-integracion-local.md) · [Auditoría anterior del NACK](LV-019-B-voz-c1-nack-auditoria-interna-20261126.md).

## Hallazgos

1. **Un ACK tardío puede dejar ambos recibos duraderos sin aviso.** Una vez persistido un NACK válido, `localVoiceNackConflictTarget` exige que las versiones históricas del intento sigan coincidiendo. Una nueva revisión del mismo dueño modifica el proyecto, por ejemplo, y basta para que el método devuelva `null`. El escritor de ACK aún guarda la observación exacta como `unverified`, pero la intención queda en `insufficient`, fuera del reporte. La misma separación puede dejar sin aviso una identidad revocada o reasignada; no corresponde atribuir el incidente al dueño actual en esos casos. En el otro orden, si ya existe un ACK y cambia la historia antes de que llegue el NACK, la validación puede rechazar ese NACK y dejar una intención `reserve_pending` sin vencimiento práctico ni alerta por defecto. Una observación sin evidencia de vínculo no debe convertirse en recibo financiero. El aviso de conflicto puede preservarse de forma independiente, sin dueño cuando la prueba no lo permite. Rutas: `firestoreBackend.ts:809–865,867–891,988–1003`, `reserveAttemptEvidence.ts:321–331`, `billingPendingReport.ts:18,70–75`, `billingPendingAlerts.ts:25–28` y `firestoreReviewedTranslation.ts:526`.

2. **La recreación del marcador antes de la preparación se adopta como versión inicial.** `beginBillingIntent` crea el marcador y la intención en la misma transacción. Si un escritor privilegiado borra y recrea el marcador con su contenido idéntico entre ese commit y `prepareReserveAttempt`, el marcador nuevo tiene sus propios `createTime` y `updateTime` iguales. La preparación comprueba su contenido y guarda esa versión sin compararla con la creación de la intención o del ancla original. La rama permite el POST y podría crear trabajo si el resto de la evidencia coincide. Contrastar el nacimiento del marcador con la intención o el ancla que comparte su commit cerraría esa ventana bajo la hipótesis de escritores confiables. Rutas: `firestoreBackend.ts:775–782,954–970,1274–1284` y `reserveAttemptEvidence.ts:126–133,184–197,209–223`.

## Controles que conserva el corte

- El circuito está cercado al emulador y a la raíz sintética. La preparación y la creación del trabajo releen el UID y su cuenta. La fuente verifica además propietario, vigencia, flags y revisión exacta. Los replays de NACK y trabajo exigen el intento, marcador y recibos vinculados. La transacción que crea trabajo escribe el ACK durable junto al trabajo. `firestoreBackend.ts:87–90,680–688,916–945,1240–1251,1260–1269,1884,1912–1919,1972–1983` y `firestoreReviewedTranslation.ts:174–188,401–422`.
- Con historia intacta, la contradicción en cualquier orden deja ambos recibos y `needs_review`. El ACK tardío y el cambio de estado se escriben en la misma transacción. Los replays no vuelven a reservar. Las pruebas esperan una alerta por defecto, deduplicación, preservación de ambas versiones y ningún hold, guard ni movimiento adicional. La prueba de cuenta ajena espera `not_found`. `firestoreBackend.ts:847–865,988–1004,1260–1269` y `firestoreReviewedTranslation.emulator.mjs:1718–1785`.
- Las pruebas cubren reescritura y restauración del marcador durante ACK y NACK, repetición del NACK, y repetición de un trabajo existente con marcador alterado. La prueba de colisión voz/texto espera un solo reclamo y una sola reserva. Texto v1 conserva claves literales distintas, en mayúsculas y minúsculas, y la repetición literal no reenvía la reserva. No encontré una regresión estática de ese contrato. `firestoreBackend.ts:701–741,766–767`, `reserveAttemptEvidence.ts:229–243` y `firestoreReviewedTranslation.emulator.mjs:1341–1448,1790–1890`.

## Negativos pendientes y límites de confianza

- Confirmar un NACK, cambiar la revisión del mismo dueño y después entregar el ACK del intento mediante el escritor de observaciones. Repetir con reasignación de identidad. Exigir los dos recibos sin cambios, una incidencia durable e idempotente y ninguna atribución a la cuenta ajena, guard, hold, nueva reserva ni movimiento. Repetir con ACK primero, historia alterada y NACK después, conservando el carácter no verificado de la evidencia que haya perdido su vínculo.
- Entre `beginBillingIntent` y `prepareReserveAttempt`, borrar y recrear el marcador exacto en dos commits. Exigir cero POST, recibos y trabajo. Añadir la variante de borrado y recreación durante la llamada. Las pruebas que restauran mediante escritura del documento existente cubren un cambio de `updateTime` en otra ventana.
- La prueba de contradicción llama al escritor interno de ACK y no crea el trabajo mediante el ACK. Falta la intercalación sintética en que el ACK ya confirmó trabajo antes de observar el NACK. Comprobar preservación de la evidencia y cero acciones económicas nuevas sin borrar el trabajo existente. El callback real de la fixture devuelve un único resultado por reserva, por lo que estos controles requieren inyección y no prueban que un cliente pueda originar ambos resultados.
- La clasificación `ack?.state==='insufficient'` confía en el callback y no rechaza campos extra contradictorios de reserva o segundos. El ACK positivo sí coteja esos valores. Probar un NACK con tupla adicional contradictoria y exigir que quede incierto. Los timestamps de Firestore sostienen los vínculos bajo escritores confiables. Un escritor Admin con permiso para reponer o borrar toda la evidencia puede imitar el par durable o eliminar el rastro. El código no demuestra autenticidad de Cuenta, IAM de producción ni continuidad de documentos que estaban ausentes en ambas lecturas. `firestoreBackend.ts:781–806`, `reserveAttemptEvidence.ts:315–331`.

=== RESUMEN FINAL ===
RESULTADO: FALLA
EVIDENCIA: C1 cercada al emulador. El ACK tardío puede dejar ambos recibos sin alerta con historia cambiada (firestoreBackend.ts:875–882,994–996). Un marcador borrado y recreado antes del preflight puede adoptarse y habilitar el POST (firestoreBackend.ts:954–962,1276–1284; reserveAttemptEvidence.ts:126–133).
NEGATIVOS: Los casos existentes cubren ambos órdenes con historia intacta, modificación/restauración tras preparar, UID ajeno y colisiones con texto v1. Faltan ACK tardío con historia alterada, recreación de marcador antes de preparar y contradicción tras crear el trabajo.
BLOQUEOS: Revisión estática acotada. Las 64 pruebas en curso no se certificaron. Quedan autenticidad del NACK, escritores e IAM, continuidad histórica fuera de la fixture y regresión financiera completa.
=== FIN RESUMEN ===
