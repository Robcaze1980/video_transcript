# Contraste de la segunda propuesta · 27 nov 2026

**No aplicada.** El autor la dejó INCONCLUYENTE y no ejecutó código. Codex identificó tres problemas adicionales que deben resolverse antes de llevarla a una candidata:

1. El lector de recibos propuesto para la prueba lee documentos de Cuenta por separado y no usa el método transaccional real. Una prueba verde con ese sustituto no demuestra el contrato real. Se solicitó estudiar la lectura cercada real ante cambio de epoch, conservando que `pending` nunca autoriza un nuevo envío.
2. En una reapertura parcial, `record` es el cierre `done`; construir el claim del sucesor con ese documento puede diferir del claim creado desde la solicitud original. Debe derivarse del documento durable correcto y probarse.
3. Si la confirmación previa ocurre entre la lectura pendiente y la conciliación, Cuenta puede devolver el recibo del intento anterior. El borrador lo rechaza: es necesario comprobar ambos órdenes de carrera sin volver a enviar.

Se pidió una tercera propuesta con método real, pruebas de ambos órdenes, dos cuentas, claim ausente/manipulado y estado parcial. Esa solicitud está en curso. Ningún comentario certifica IAM, emisor, corte de escritores, producción o rojo→verde.
