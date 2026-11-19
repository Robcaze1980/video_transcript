# LV-019.B · Índices de video · 18 nov 2026

Una consulta de solo lectura con `gcloud firestore indexes composite list` al proyecto `vistavo-prod`, base `(default)`, devolvió **ocho índices compuestos, todos `READY`**. Corresponden a `fileOutbox`, `uploads`, dos de `outbox`, dos de `artifacts` y dos de `jobs`; sus campos y estados quedaron en `outputs/lv019-b-direct-status-design-20261117/video-index-readback-20261118.json`. No se modificó ningún recurso.

**El grupo `billingHoldOutbox` no aparece** entre los ocho, por lo que el índice previsto en [el manifiesto](../../deploy/google-cloud/billing-hold.indexes.json) no figura en la respuesta. La consulta de `pendingExternalHolds` filtra `state` y ordena/rango por `nextAttemptAt`; requiere verificar y crear el índice apropiado antes de activar ese recuperador. No se creó durante esta comprobación.

Las consultas actuales de `billingIntents` y `billingOutbox` filtran por un solo campo y luego filtran fechas en memoria; la ausencia de un índice **compuesto** para esos grupos no demuestra que fallen sus consultas ni acredita la configuración de índices de un solo campo. Su límite previo al filtrado puede afectar equidad y recuperación y sigue pendiente de diseño/prueba.

Este inventario no acredita la totalidad de las consultas futuras, latencia, IAM o conectividad. La salida del comando y su error estándar se preservan en `outputs/lv019-b-direct-status-design-20261117/video-index-readback-20261118.json` y `.err`.
