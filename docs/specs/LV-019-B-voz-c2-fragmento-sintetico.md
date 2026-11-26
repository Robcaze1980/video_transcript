# LV-019.B · C2: admisión local de un fragmento sintético

**Preparación aislada · 26 nov 2026.** Rama `codex/vistavo-voice-c2-20261126` sobre el respaldo `1b122ceb92e7a409dd0fd50ea21a5dd5a076b8b5`. El corte prepara pruebas de un fragmento de una traducción revisada. La voz sigue cerrada. El receptor solo acepta bytes en memoria. Quedan fuera del corte el despacho, las rutas, llamadas al proveedor, el WAV, el almacenamiento, la liquidación y la recuperación general C3.

## Inventario del respaldo

| Área | Pieza existente | Límite de integración |
| --- | --- | --- |
| Proveedor y fragmentos | El adaptador Gemini TTS divide y valida audio. El canon reconstruye bytes, voz, modelo y huella por fragmento. | El worker anterior toma `snapshot.draft`. C1 crea `snapshot: null` y carece de fila de despacho. El canon revisado no está conectado al worker. [Proveedor](../../server/commercial/cloudAiProvider.ts) · [Canon](../../server/commercial/reviewedVoiceCanonical.ts) |
| Admisión | Cuenta distingue una admisión nueva de `receiptOnly`. Video puede registrar el hash de una llamada en `providerCalls`. | Falta comprobar en voz el mismo vínculo durable antes y después del ACK y cercar una sola llamada en vuelo. [Cuenta](../../server/account/backend.ts) · [Video](../../server/commercial/firestoreAi.ts) |
| Archivos | El código puede guardar una generación privada de WAV, validar el manifiesto y cercar escrituras tardías con un marcador de purga. | La subida de voz está cerrada. Falta aplicar la retención de 90 días y el acceso al audio entregado tras cancelación. [Objetos privados](../../server/commercial/gcsObjects.ts) |
| Cancelación y saldo | C2a admite liquidar K de N y devolver N−K en Cuenta, o liberar tras admisión con resolución. | La voz sigue sin cancelación y sin cómputo por fragmentos verificables. La descarga actual exige éxito y captura completa. Mantener la diferencia entre fallo del servicio sin cobro y cancelación por el cliente con cargo proporcional a lo entregado. [Liquidación](LV-019-B-liquidacion-parcial-y-liberacion-posadmision.md) · [Backend](../../server/commercial/firestoreBackend.ts) |
| Recuperación | El worker puede releer evidencia de un artefacto tras perder una respuesta de escritura o cierre. El resolvedor de texto tiene edad máxima. | El resolvedor excluye voz. C3 queda pendiente de B1, B2 y C2, con recibos separados, alerta y marcador antes de liberar al vencer. El plazo de texto no fija el de voz. [Plan integral](LV-019-B-plan-integral-20261120.md) |

## Evidencia y orden

1. **Origen y reserva.** El caso futuro parte de una raíz sintética, un UID verificado en Video y una revisión guardada del trabajo de texto de esa misma cuenta. La fixture C1 usa `AccountStore.reserveVideo` en la raíz separada de Cuenta y conserva el ACK de esa reserva en el intento v2. Verificar revisión y recibo, origen, versión del marcador, dueño, reserva y segundos en el trabajo y en la evidencia de C1. Una reserva visible por `status`, una intención sola o un ACK fabricado no autorizan el fragmento.
2. **Un fragmento y dos lecturas.** Antes de Cuenta, reconstruir con el canon `voice-chunk:0000`. Conservar identidad, tupla y versiones de la lectura original y el hash de los bytes UTF-8 exactos. Impedir otro intento local concurrente. Llamar a `AccountStore.admitVideoCall` una vez con la tupla completa. Al volver, validar el ACK de admisión y confrontar el mismo historial en transacción. Un recibo `receiptOnly` es evidencia de lectura y no habilita el receptor. Solo una admisión nueva confirmada y una cerca local verificable permiten que el receptor en memoria reciba esos mismos bytes.
3. **Efecto y ambigüedad.** La prueba positiva futura exige una admisión nueva, una recepción exacta y cero capturas, devoluciones, movimientos nuevos, escrituras de artefactos y despachos. Si se pierde la respuesta o cambia la historia, conservar la evidencia comprobable y devolver incertidumbre sin un segundo envío ni una atribución a otra cuenta. Los bytes de texto viven solo en la memoria de la fixture.

[C1 y B1](LV-019-B-plan-integral-20261120.md) siguen abiertos. Se puede comprobar localmente el canon y preparar la caracterización del recibo de admisión de Cuenta con la reserva sintética de la fixture. Esa caracterización no constituye un permiso de C2. Las pruebas de extremo a extremo esperan una entrada de prueba que implemente las dos lecturas, conserve la evidencia y entregue el permiso de envío solo una vez. El ACK durable de C1 y su recuperación siguen siendo requisitos para conectarla al flujo liberable.

## Controles

| Caso futuro | Resultado exigido |
| --- | --- |
| UID ajeno o revocado, reserva sin ACK durable, ACK de otra tupla, marca/revisión/recibo ausente | Cero llamadas de admisión y cero recepciones. Mantener la otra cuenta intacta. |
| Cuerpo, modelo, voz u ordinal distinto del fragmento único | Cero admisiones y cero recepciones. |
| La identidad, marca o recibo cambia durante la admisión. Incluir restauración y recreación | Conservar el ACK comprobado y exigir cero recepciones. Sin dueño verificado, ninguna atribución o bloqueo. |
| `receiptOnly`, ACK perdido antes o después de confirmar, dos ejecutores o repetición | El perdedor y el replay no envían. Con evidencia incierta no se repite el POST. En la carrera demostrar un solo ganador, un envío a memoria y ninguna liquidación. |

Archivos de esta preparación: esta especificación, `reviewedVoiceCanonical.test.ts`, la fixture `firestoreReviewedTranslation.emulator.mjs` y el [recibo de pruebas](../evidence/lv019-b-voice-c2-prep-20261126/README.md). [Canon vigente](LV-019-B-voz-canon-v1.md) · [Contrato de integración local](LV-019-B-voz-integracion-local.md).
