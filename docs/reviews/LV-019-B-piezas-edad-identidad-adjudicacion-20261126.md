# LV-019.B · Constancia de edad e identidad interna

**26 nov 2026.** GLM y DeepSeek revisaron juntas dos piezas aisladas, no integradas. [GLM](LV-019-B-piezas-edad-identidad-GLM-20261126.txt) dio **PASS limitado** a ambas; [DeepSeek](LV-019-B-piezas-edad-identidad-DeepSeek-20261126.txt) dio **INCONCLUYENTE** a edad y **PASS limitado** a identidad. Su resultado global es INCONCLUYENTE. Ningún dictamen autoriza producción.

## Edad · `3b96286`

La candidata guarda una preparación antes de la transición y puede confirmar una respuesta perdida cuando coinciden las constancias leídas. Codex verificó el TAP de **12/12** en el emulador, su manifiesto y recibo; el emulador emitió un aviso de espera de causa no determinada y la JVM propia se terminó por handle. Las **171/171** son pruebas en memoria. Estos resultados no acreditan dueño ni implementan la guarda de admisión.

Ambos revisores observaron que `pending` y `applied` pueden quedar sin reparación; GLM señaló también el caso de acción abortada sin commit. La consulta del lease deja una ventana antes del commit. Faltan inventario, recuperación, IAM, retención, costo y la regresión integrada. No se acepta esta pieza como solución completa de devolución o bloqueo.

DeepSeek sostuvo que Firestore no documenta la monotonía de `updateTime`. La [referencia oficial de Google](https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents) sí la documenta para cambios de un documento y también describe la monotonía de `createTime` tras borrado y recreación. Eso no demuestra por sí solo la continuidad conjunta de tres documentos ni sustituye comprobar quién puede escribirlos. Los revisores recibieron extractos y un resumen de la evidencia, no los logs completos.

## Identidad · `3d2c9bf`

La proyección conserva los claims del token verificado y mantiene la ruta nueva cerrada y la autorización legada. Codex cotejó el log de **133/133** y el diff. Las pruebas usaron claves sintéticas en memoria y el verificador real con certificados de prueba; no consultaron Google. Faltan la política por acción, el emisor autorizado, el acto humano conectado, la procedencia del hold y las pruebas de IAM. El PASS acotado no resuelve las observaciones anteriores del contrato de inscripción.

El paquete se envió sin herramientas por el respaldo OpenRouter autorizado y ocultó los correos de servicio con etiquetas consistentes. GLM sirvió `z-ai/glm-5.3-flash`: **20.955 tokens de entrada, 42.573 de salida, US$0,030231815625**. DeepSeek `deepseek/deepseek-v4.1-flash`: **22.856 de entrada, 20.281 de salida, US$0,01253833317**. Caché de entrada cero; costo de Codex y Google no medido. La auditoría C2 interrumpida quedó fuera del encargo.
