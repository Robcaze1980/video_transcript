# LV-003 · Piloto web privado y pagos de prueba

**Estado:** retorno automático, captura y entrega verificados con PayPal Sandbox. Tarifa comercial de micropagos pendiente.

## Editor web del piloto

El resultado de video conserva el SRT original y abre el editor con el MP4 de origen y el SRT de esa cuenta. El editor reutiliza la vista de subtítulos y la exportación de LV-008. Permite buscar, saltar al instante, corregir, mover el texto y generar SRT y MP4 en el navegador. Las ediciones viven en la sesión del editor. Descarga los archivos editados antes de cerrar o volver a abrir el resultado original.

El piloto sirve el video de origen en rangos de bytes a la cuenta propietaria y permite borrar los archivos del trabajo desde el historial. La carga de prueba admite hasta 1 MiB. El worker comprueba con ffprobe duración de hasta 30 s y hasta 1920 píxeles por lado antes de enviar a Gemini. Una validación que falla en el worker libera el crédito reservado. La [preparación de acceso privado](LV-003-acceso-privado.md) documenta HTTPS, cuotas y caducidad.

En Chrome, una sesión con pago simulado recibió cinco créditos, procesó un video árabe con Gemini, buscó y corrigió el segundo subtítulo, movió el texto y descargó el SRT y el MP4. El MP4 se inspeccionó con ffprobe y se leyó la frase corregida en un fotograma. La fuente y el SRT devolvieron HTTP 401 sin sesión. Un PDF corrupto liberó su reserva y el saldo quedó en cuatro. Evidencia en `%LOCALAPPDATA%\LinguistVision\validation\pilot-editor-e2e-U87mOq`. Queda repetir este recorrido completo con una compra nueva en PayPal Sandbox.

El [servidor del piloto](../../server/commercial/pilotLocal.ts) se inicia por separado en `127.0.0.1:3001/pilot/`. Usa una base PostgreSQL de prueba exclusiva y habilita una cuenta con código de invitación. El navegador inicia sesión, carga un archivo, reserva saldo al crear el trabajo, consulta el estado y descarga el resultado de su cuenta. El historial conserva las descargas al recargar la página.

| Parte | Entorno y comprobación |
|---|---|
| Acceso | Sesión por cookie opaca, restringida a la ruta del piloto. Se rechazaron el Host inválido, escrituras con origen ajeno y descargas sin sesión o desde otra cuenta. Cerrar sesión invalida la cookie. |
| Pago simulado | El navegador aprueba una orden simulada de 5 créditos. El worker lee y captura la orden antes de acreditar. Repetir la confirmación no duplica el saldo. Una respuesta perdida tras capturar se recupera leyendo la orden completada. |
| Archivos | La API limita cada carga a 1 MiB y verifica propiedad al encolar y descargar. Se rechazó una carga excesiva y un PDF corrupto devolvió el crédito. |
| Entrega real | En la validación anterior del núcleo, la misma cuenta descargó un CSV y un SRT de Gemini en inglés → español. Tras el cambio a PayPal, Chrome repitió el pago simulado y la descarga privada del CSV. El saldo quedó en 4 disponibles y 1 consumido. |

Los archivos del recorrido anterior siguen en `%LOCALAPPDATA%\LinguistVision\validation\pilot-browser-CLwIa5`. El cambio de proveedor se verificó sin cargos reales ni nuevas llamadas de Gemini.

La candidata aislada de PayPal pasó la instalación limpia, la comprobación de tipos, 42 pruebas y la compilación. La descarga de la prueba de Chrome está en `%LOCALAPPDATA%\LinguistVision\validation\paypal-browser-HjQa8g`.

## Repetir en Windows

1. Iniciar PostgreSQL dedicado a LinguistVision, solo en `127.0.0.1` y en un puerto distinto de 5432. Usar una base descartable. El servidor inicializa `lv_private_pilot_paypal_v2`. El esquema anterior conserva sus datos de prueba.
2. Configurar `LINGUISTVISION_PILOT_DATABASE_URL`, `LINGUISTVISION_PILOT_ACCOUNT_ID` con un UUID y `LINGUISTVISION_PILOT_INVITATION` con un código aleatorio de al menos 24 caracteres. Mantener el código en la configuración local. Para simular, dejar sin definir las tres variables PayPal.
3. Ejecutar `npm run pilot:local` para el modo PDF y abrir `http://127.0.0.1:3001/pilot/`. Para incluir transcripción y editor, ejecutar `npm run build`, disponer de `ffprobe` en PATH, activar `LINGUISTVISION_PILOT_USE_GEMINI=1` y arrancar con `node --env-file="<archivo local de LinguistVision>" --import tsx server/commercial/pilotLocal.ts`. Para la prueba árabe → español, activar también `LINGUISTVISION_PILOT_EXPERIMENTAL_LANGUAGES=1`.
4. Para repetir la prueba automatizada HTTP, configurar `LINGUISTVISION_TEST_DATABASE_URL` en una base descartable y ejecutar `npm test`. Las suites crean y eliminan esquemas exclusivos.

## PayPal Sandbox externo

1. Crear o seleccionar una app Sandbox vinculada a una cuenta vendedora de prueba de LinguistVision en el [panel de PayPal Developer](https://developer.paypal.com/dashboard/applications/sandbox). Guardar localmente el Client ID y el Client Secret en `LINGUISTVISION_PILOT_PAYPAL_CLIENT_ID` y `LINGUISTVISION_PILOT_PAYPAL_CLIENT_SECRET`. Configurar el identificador de la cuenta vendedora en `LINGUISTVISION_PILOT_PAYPAL_MERCHANT_ID`.
2. Arrancar el piloto y abrir el botón de compra. Aprobar con un comprador Sandbox y volver a LinguistVision. El piloto coteja la orden devuelta con la cuenta autenticada y consulta al proveedor antes de capturar.
3. Verificar que la captura esté completada y que el saldo suba una sola vez. Repetir la confirmación y simular una pérdida de respuesta para confirmar la recuperación. El piloto reconcilia mediante Orders API desde el servidor local, sin un webhook público. [PayPal Orders v2](https://developer.paypal.com/api/rest/integration/orders-api) · [Idempotencia](https://developer.paypal.com/api/rest/reference/idempotency/)

El 7 de noviembre se confirmó que Node carga las tres variables del archivo local. PayPal Sandbox respondió HTTP 401 con `invalid_client` al solicitar el token, tanto con las variables de Node como con los valores leídos directamente del archivo. Hay que volver a copiar el Client ID y el Secret completos desde la misma app Sandbox antes de crear la orden.

En el reintento, PayPal Sandbox autenticó la app (HTTP 200). El piloto creó una orden de prueba por US$4,95 y confirmó el Merchant ID con Orders API. El usuario aprobó la compra en el navegador y volvió al formulario de invitación porque abrió el enlace desde una sesión separada del piloto. La prueba retomó la orden con una sesión autenticada mediante la API local. PayPal devolvió `COMPLETED` con una captura de US$4,95. Repetir la confirmación conservó los cinco créditos. Un PDF sintético consumió uno, quedaron cuatro disponibles y se comprobó el contenido del CSV descargado. La misma descarga sin sesión devolvió HTTP 401.

Evidencia local en `%LOCALAPPDATA%\LinguistVision\validation\paypal-sandbox-current\evidence.json` y `texto.csv`. La recuperación de una respuesta de captura perdida se verificó con el simulador local.

En una segunda orden Sandbox, Chrome abrió el checkout desde el piloto con sesión y saldo cero. Tras la aprobación, la misma pestaña volvió a LinguistVision. La página solicitó la captura automáticamente (HTTP 202), retiró los parámetros del retorno y mostró «Saldo actualizado» con cinco créditos. Evidencia en `%LOCALAPPDATA%\LinguistVision\validation\paypal-return-yrKeUZ\evidence.json`.

La prueba externa de Sandbox verifica la integración. La tarifa de micropagos de la cuenta comercial requiere habilitación por PayPal y una comprobación separada antes de usarla en el cálculo de margen. El acceso remoto, el almacenamiento para archivos mayores, la retención, la conciliación de reembolsos y la integración con el editor de LV-008 permanecen pendientes.

## Comparación de tarifas

Estimación para pagos nacionales en USD. PayPal publica **4,99 % + US$0,09** para micropagos habilitados. Stripe publica **2,9 % + US$0,30** para tarjetas nacionales con tarifa estándar. Un cobro de US$0,99 da aproximadamente US$0,14 frente a US$0,33. Un paquete de US$4,95 da aproximadamente US$0,34 frente a US$0,44. El cruce matemático es aproximadamente US$10,05 bajo esas tarifas y antes del redondeo. El paquete del piloto sigue siendo un valor de prueba. [PayPal](https://www.paypal.com/us/business/paypal-business-fees#micropayments) · [Stripe](https://stripe.com/pricing)

## Coordinación y costos

T3 recibió `mcp:f4f8128b-dea9-448d-aa8c-af065ccd0c59` en LinguistVision y volvió a agotar el límite de uso compartido de ChatGPT. DeepSeek y Kimi revisaron en paralelo por el OpenRouter autorizado. Sus controles se contrastaron con pruebas HTTP, Chrome y PostgreSQL.

- DeepSeek V4.1 Flash, Cohere, `gen-1794085832-XSicb1LJsEUNYodlh7GT`: US$0.0002898423.
- Kimi K2.6, Cloudflare, `gen-1794085832-3akac0WZqZNZq39Oala1`: US$0.0021983445.
- Total de consultas confirmado por OpenRouter: **US$0.0024881868**.

En la migración a PayPal, T3 volvió a alcanzar el límite en `mcp:44b1e970-4a3c-4ecf-8539-311f2db2c631`. DeepSeek y Kimi revisaron en paralelo por OpenRouter. Se incorporaron el cotejo del vendedor, la comprobación de la orden devuelta y la prueba de reconciliación tras perder la respuesta de captura.

- DeepSeek, Baidu, `gen-1794087129-dsoGCr4PpJuFg4XeKpGg`: US$0.0001732490793.
- Kimi, Crusoe, `gen-1794087130-nNxpYp0RpoTH6dDUJ8pq`: US$0.001514898.
- Total de esta migración: **US$0.0016881470793**.

Para el editor web y la preparación remota, T3 recibió `mcp:d8f3b478-464f-4d65-8954-e328ea04f28d` y volvió a alcanzar el límite de uso compartido. Las consultas de respaldo se ejecutaron en paralelo en OpenRouter de LinguistVision.

- DeepSeek V4.1 Flash, DeepInfra, `gen-1794096920-7eHAJYqc5ljzyiHvO5cV`: US$0.0002253636.
- Kimi K2.6, Crusoe, `gen-1794096920-vSmzR96BscB1KYR95MiS`: US$0.001511433.
- Total confirmado: **US$0.0017367966**. La revisión se contrastó con pruebas de rangos privados, devolución y retención. La confirmación de PayPal usa Orders API y la vista previa de idiomas usa HTTP 200 con `noindex`.
