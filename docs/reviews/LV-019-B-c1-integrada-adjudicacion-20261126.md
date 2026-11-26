# LV-019.B · Contraste de las revisiones C1 integradas

**26 nov 2026.** Corte revisado `a14eb9353d4da7e09cfedefda109168bd8c84158`. Son comprobaciones estáticas y pruebas sintéticas, no una aceptación de la voz para clientes.

## Dictámenes

- [GLM Flash](LV-019-B-c1-integrada-GLM-20261126.txt): **PASS limitado** a C1 sintética. Identificó una posible duplicación de reservas al cambiar el uso de mayúsculas de una clave de texto v1; indicó que los cuerpos de dos auxiliares no estaban en su paquete.
- [DeepSeek](LV-019-B-c1-integrada-DeepSeek-20261126.txt): **INCONCLUYENTE** por definiciones, cuerpos de pruebas e importaciones ausentes en su paquete. Sus restricciones y la evidencia de la respuesta original siguen vigentes.
- [Seguimiento acotado de DeepSeek](LV-019-B-c1-integrada-seguimiento-DeepSeek-20261126.txt): **INCONCLUYENTE**. Contrastó las definiciones y los casos añadidos y no encontró una contradicción en esos fragmentos; confirmó la compatibilidad literal v1. Quedaron por mostrar líneas de la prueba de frontera y permanece la falta de integración del alertador de voz con mantenimiento. No revisó la C1 completa en esa consulta.

## Contraste local

1. En `a14eb93`, `videoReservationId` incluye literalmente `requestKey` en la tupla y `priorExternalRequestForEnqueue` consulta por el hash de la cadena literal. Las dos variantes propuestas por GLM sí producen identificadores distintos. No se presume que un reintento legítimo cambie de escritura: eso requiere comprobar los llamadores y el contrato de integración antes de usar este camino.
2. A diferencia de lo que afirma el informe GLM, el caso 74 de `server/commercial/firestoreReviewedTranslation.emulator.mjs` **sí ejerce expresamente ese comportamiento de texto v1**. Afirma dos trabajos, dos identificadores de reserva y dos asientos para dos cadenas de distinta capitalización; las repeticiones exactas no hacen una nueva reserva. El TAP de la corrida `run-c2031d8d` registra `ok 74` y la suite completa `74/74`. La prueba documenta el comportamiento literal histórico, no demuestra que sea apropiado para toda futura integración. Si una misma operación puede llegar con mayúsculas y minúsculas distintas, debe resolverse antes de habilitarla; no se normalizan claves v1 retrospectivamente sin un plan de compatibilidad. La especificación v2 propuesta fija UUID minúsculo canónico, pero v2 aún no acredita esta integración.
3. El helper `sameTerminalDocumentVersion` ausente del paquete de DeepSeek está en `server/commercial/firestoreBackend.ts:202`: compara existencia y, si el documento existe, ambos tiempos de creación y actualización. Esta lectura local no sustituye el examen del resto de auxiliares ni los controles solicitados por DeepSeek.
4. La repetición local del test de frontera A2 en `a14eb93` pasó **28/28**. Se contrastaron su log SHA-256 `7e30e6164e0c10c19076a8d98f2d0cd6f170edd131578dda36cb8b6505185f29` y el grafo observado SHA-256 `cc46056b03ea681433a840632aad03ff6b3b4f7ea1d0dd7c622c93f81dea8e50`, que contiene cuatro módulos de barrido. Esto no integra el alertador de voz al mantenimiento ni acredita su operación en la nube.

Los hashes Git de `a14eb93` son: fixture `137c1cf34dc80cf3451fc92296f9e594bc58d9f3`, `videoReservationId.ts` `e367c2ef19a8082264881971b2b97d4a68f61944`, `firestoreAi.ts` `f4d1bfe13e5e7f0643e254e08bad335d486b1ace` y `firestoreBackend.ts` `94a2ec6436bf55e3674be882a44f97b9e09cec8b`. TAP SHA-256 `5433e1d448772320c1f5028068a5312d1b61d6ee5d580bd9e51a5c8b382b812a`.

## Pendiente

Los veredictos INCONCLUYENTES de DeepSeek no cambian por esta lectura. Falta atender los límites identificados y conciliar los dictámenes. También faltan una vía de recuperación para operaciones inciertas, el corte financiero final y su regresión, y la integración real de proveedor, audio y teléfonos. La suite C1 no valida C2 ni modifica el dictamen de la auditoría C2 que se interrumpió.
