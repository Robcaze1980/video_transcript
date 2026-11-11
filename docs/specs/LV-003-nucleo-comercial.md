# LV-003 · Contrato técnico del núcleo comercial

**Alcance de esta actividad:** definir cómo una cuenta compra créditos, envía un trabajo privado y obtiene un archivo. Las tarifas, límites, retención y formatos de la oferta pública se configuran después de LV-001. El contrato admite valores de prueba sin esperar esas decisiones.

## Trabajo y saldo

| Operación | Condición y efecto |
|---|---|
| Crear trabajo | La API verifica cuenta, propiedad del archivo y servicio habilitado. Congela versión, opciones, precio aceptado y referencia a una entrada que no cambia. Reserva créditos y crea el trabajo en cola en una transacción. |
| Tomar trabajo | Un ejecutor reclama un trabajo disponible durante un plazo y recibe un identificador de intento. Renueva el plazo mientras trabaja. Un intento vencido puede reprogramarse. |
| Reintentar | Un fallo recuperable devuelve el trabajo a la cola con espera y un máximo de intentos. Conserva la reserva. El fallo definitivo o la cancelación efectiva liberan el saldo. |
| Publicar resultado | El ejecutor sube un archivo privado por intento, verifica que sea utilizable y confirma resultado y consumo en una transacción. Solo el intento vigente puede publicar. El cliente puede descargarlo después. |
| Limpiar | Se eliminan archivos de intentos descartados y resultados vencidos mediante una tarea que puede repetirse. El vencimiento del archivo conserva el registro del trabajo y del movimiento de saldo. |

Estados del trabajo: `queued → running → succeeded | failed | cancelled`. Un intento recuperable vuelve a `queued`. El estado de la reserva es `held → captured | released`. Guardar en la misma transacción la transición terminal, la actualización de la reserva que sigue en `held`, el movimiento de saldo y la referencia al resultado si existe. Si alguna condición falla, se revierte toda la transacción. Registrar la transición y su causa para auditarla.

Los créditos son unidades enteras no negativas. Conservar movimientos de compra, reserva, consumo y liberación con referencias únicas. La reserva mueve unidades de disponible a reservado. El consumo mueve unidades de reservado a consumido. La liberación devuelve unidades al disponible. La suma de disponible, reservado y consumido coincide con los créditos netos acreditados. Bloquear la fila de saldo al modificarla y respetar el mismo orden de bloqueos en toda operación que también toque un trabajo.

La clave de solicitud la genera el cliente y es única por cuenta autenticada. Comparar la huella de la versión del archivo, el servicio y las opciones normalizadas. La misma clave con la misma huella devuelve el trabajo existente. Si cambia la huella, devolver conflicto. Resolver el duplicado antes de reservar.

## Pago y acceso

- Crear una orden interna con cuenta, paquete, moneda e importe antes de abrir PayPal. Tras la aprobación, persistir la solicitud de captura y cotejar la orden devuelta. Acreditar tras comprobar una captura completada y su orden, vendedor, importe y moneda. Guardar el movimiento y la confirmación de la compra en la misma transacción. Si se pierde la respuesta de captura, reconciliar con Orders v2 antes de reintentar. [PayPal Orders v2](https://developer.paypal.com/api/rest/integration/orders-api)
- El navegador no puede escribir el saldo. La API verifica propiedad antes de emitir cada enlace de descarga de vida breve. El archivo permanece privado y las claves se guardan en el servidor. Dejar de emitir enlaces si se pierde acceso. Un enlace emitido vence por su plazo o al eliminarse el objeto. Los ajustes de una compra revertida necesitan política comercial y conciliación antes de activar cobros reales.
- Usar PostgreSQL para la cola inicial. Reclamar con bloqueo de fila y `SKIP LOCKED` solo trabajos en `queued` que ya están disponibles. Actualizar su estado, intento y plazo en la misma transacción. Ejecutar la llamada externa fuera de la transacción. Tanto la renovación como la publicación exigen estado `running`, identificador de intento vigente y plazo aún válido según el reloj de la base de datos. La reclamación de trabajos vencidos y la publicación se resuelven sobre la misma fila. [Bloqueo en PostgreSQL](https://www.postgresql.org/docs/18/sql-select.html#SQL-FOR-UPDATE-SHARE)

## Contrato de adaptadores

Cada servicio registra un identificador, versión, reglas de entrada y formatos. El adaptador valida la entrada y las opciones, ejecuta el procesamiento y devuelve archivos, diagnóstico y métricas. El núcleo conserva autorización, saldo, reintentos y publicación. El precio aceptado se deriva del catálogo del servidor. Los adaptadores no modifican créditos.

El adaptador de video genera subtítulos. Una salida adicional puede referenciar una revisión concreta de los segmentos, como en LV-008. El adaptador de PDF podrá entregar CSV con el mismo contrato. La cola admite reintentos. Para minimizar llamadas repetidas, el adaptador usa un identificador estable por trabajo cuando el proveedor lo permita.

## Pruebas para la implementación

1. Dos solicitudes simultáneas con saldo para una sola. Solo una reserva. Repetir la solicitud ganadora devuelve el mismo trabajo.
2. Dos confirmaciones simultáneas de una orden acreditan una sola vez. Un vendedor o importe incorrecto y una orden pendiente no acreditan. Un fallo después de capturar permite reconciliar el pago sin duplicar créditos.
3. Un ejecutor cae después de guardar un archivo. Un intento nuevo termina. El intento anterior no publica ni cobra y su archivo se limpia.
4. Un fallo recuperable conserva la reserva. Un fallo definitivo o una cancelación efectiva liberan exactamente una vez. Si cancelación y publicación compiten, solo la transición terminal ganadora produce efectos.
5. Una cuenta no puede ver, procesar ni descargar archivos de otra. El resultado válido es descargable solo tras confirmar su publicación.
6. El adaptador de prueba completa el circuito. LV-006 repetirá el circuito con un PDF sin cambios en las reglas de saldo.

## Revisión de esta actividad

T3 registró la misión `mcp:66b5d52e-c331-4952-9927-769671b64490` en LinguistVision y terminó sin devolver revisión. DeepSeek y Kimi revisaron en paralelo vía OpenRouter. Codex incorporó el invariante de saldo, la deduplicación por cuenta, la recuperación de avisos y la condición de vigencia del intento. La revisión del contrato está cerrada. Las pruebas descritas se ejecutarán en la implementación.

DeepSeek V4.1 Flash, Ionstream, `gen-1794084041-QtojLqyoKkUScZKeBjFb`: US$0.000532521. Kimi K2.6, Crusoe, `gen-1794084041-FXZFNEgnQCCKdaIVodJr`: US$0.003708243. Total confirmado: **US$0.004240764**.

## Implementación de prueba

- El [núcleo](../../server/commercial/jobs.ts) y el [esquema](../../server/commercial/schema.sql) conservan el saldo y el resultado en transacciones de PostgreSQL. La [entrada de Checkout](../../server/commercial/checkout.ts) usa PayPal Sandbox o un simulador local.
- Las pruebas con PostgreSQL 17 verifican concurrencia, idempotencia, aislamiento, reintentos y vencimiento de intentos. Incluyen recuperación tras perder una respuesta de captura simulada y rechazo de vendedores e importes incorrectos. Los adaptadores de subtítulos y PDF consumen el mismo saldo y usan la misma cola.
- Para repetir las pruebas, asignar `LINGUISTVISION_TEST_DATABASE_URL` a una base desechable de LinguistVision y ejecutar `npm test`. La suite crea y elimina un esquema exclusivo. Sin esa variable, las pruebas con base de datos se omiten.
- El [piloto web privado](LV-003-piloto-web-privado.md) ofrece sesión, historial, descargas por cuenta y reconciliación de órdenes PayPal pendientes. Los archivos de prueba de hasta 1 MiB siguen en PostgreSQL. Faltan PayPal Sandbox externo, almacenamiento para archivos mayores y los controles de publicación.
