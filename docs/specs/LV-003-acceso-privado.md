# LV-003 · Acceso privado desde el teléfono

**Estado:** acceso por 5G, carga, corrección, descarga del SRT y reproducción del MP4 verificados en el Pixel con saldo simulado. Pendientes el cotejo del SRT editado y la aprobación móvil en PayPal Sandbox.

El [piloto local](LV-003-piloto-web-privado.md) ya verificó el retorno de PayPal Sandbox en Chrome, la acreditación y las descargas privadas. La prueba remota utiliza una candidata separada en el puerto 3001, una cuenta de prueba y un clip sintético.

## Acceso y sesión

1. Mantener Node y PostgreSQL en loopback. Dar acceso HTTPS al teléfono del propietario mediante Tailscale Serve sobre una red privada dedicada a LinguistVision. Permitir solo al propietario el destino y puerto de la candidata. El teléfono y Windows deben formar parte de esa red. [Tailscale Serve y sus controles de acceso](https://tailscale.com/docs/features/tailscale-serve)
2. Configurar `LINGUISTVISION_PILOT_PRIVATE_ORIGIN` con el origen HTTPS exacto. Si el proxy cambia el encabezado Host, definir también `LINGUISTVISION_PILOT_PROXY_HOST` con su valor esperado. El servidor valida Host y Origin, ignora las cabeceras reenviadas y forma el retorno de PayPal desde el origen configurado. La cookie HTTPS lleva `Secure`, `HttpOnly`, `SameSite=Strict` y la ruta `/pilot/`. Las pruebas locales simulan el proxy y comprueban estas reglas. TLS real queda por probar en la red privada.
3. Antes de invitar clientes, emitir un código aleatorio con caducidad, revocación y límite de intentos para cada cuenta. Registrar el identificador de la cuenta y el resultado de las comprobaciones. Mantener códigos, cookies, tokens de retorno y archivos fuera de los registros.

## Archivos y retención

- **Primera prueba.** El piloto admite 1 MiB por carga, 20 MiB de entradas por cuenta y tres trabajos activos. El worker usa ffprobe con límite de tiempo y entrada por pipe para validar duración y dimensiones antes de Gemini. Si falla, libera la reserva. Antes de ampliar el límite hay que medir memoria, red móvil y coste.
- **Almacenamiento.** Los bytes de origen y resultado se guardan en PostgreSQL. Una migración permite retirar los bytes conservando las referencias, la deduplicación y el libro de créditos. El MP4 editado se genera en el navegador.
- **Eliminación.** Los artefactos vencen a las 24 horas desde la carga. Desde ese momento quedan fuera de las descargas y el proceso local limpia los bytes cuando los trabajos asociados son terminales. El propietario también puede borrar desde el historial cuando terminan. Verificar copias, WAL y retención del proveedor antes de comunicar un plazo comercial.

## Evidencia requerida

| Prueba | Resultado esperado |
|---|---|
| Teléfono por datos móviles | Chrome o Safari abre el origen HTTPS autorizado. Un teléfono o usuario fuera de la red permitida queda sin acceso. El servidor local conserva su enlace en loopback. |
| Invitación y PayPal | Invitación válida abre solo su cuenta. Comprar y aprobar en el mismo navegador devuelve al origen HTTPS y acredita una vez. Repetir la confirmación mantiene el saldo. Un origen ajeno o cabeceras reenviadas manipuladas se rechazan. |
| Clip y entrega | Un clip válido se procesa. Se edita una frase, se descargan SRT y MP4 y se comprueba reproducción, audio y subtítulo editado en el teléfono. Carga excesiva, archivo mal formado o duración declarada falsa se rechazan. Un fallo terminal devuelve el crédito. |
| Privacidad y borrado | Con una segunda cuenta se rechazan identificadores de entrada y descargas ajenos. Tras borrar o vencer, la descarga deja de estar disponible y el proceso de limpieza elimina los bytes. El historial de cobros se conserva y un reintento no recrea archivos. |

La prueba en el teléfono depende de una red privada de LinguistVision y de la autorización del dispositivo. La preparación local puede comprobar origen, cookie, límites, cuotas y eliminación antes de activar el acceso.

## Preparación de la primera sesión

- Tailscale 1.104.5 se instaló en Windows. La activación requiere autorizar la PC y conectar el teléfono a la red dedicada. Verificar los dispositivos y las reglas de acceso antes de configurar Serve. La prueba usa una publicación exclusiva de la red privada mediante Serve.
- Se preparó un MP4 sintético de 5,2 s y 45.478 bytes. El proxy temporal de prueba entrega esa muestra y conserva el host del piloto. En loopback se comprobaron HTTP 200 para la muestra y la página, HTTP 403 para host u origen ajenos, HTTP 401 sin sesión y cookie `Secure` al entrar. La prueba local envió los encabezados del futuro origen HTTPS. La conexión TLS de Tailscale y el teléfono se comprueban en la sesión real.
- En el teléfono, abrir el enlace privado en Chrome con datos móviles, descargar la muestra y entrar por invitación. Completar PayPal Sandbox y volver al piloto en la misma pestaña. Subir la muestra, corregir una frase, mover el texto, abrir los dos archivos descargados y reproducir el MP4. Registrar el saldo antes y después, la captura, el resultado del trabajo y las observaciones del teléfono.

### Conexión del Pixel

Windows y el Pixel se vieron en Tailscale y respondieron al ping por DERP. La red del propietario incluye otros equipos. Para esta sesión se habilitó Serve HTTPS y un proxy de loopback que acepta solo las dos direcciones Tailscale del Pixel, IPv4 e IPv6. Se verificó en el código de Tailscale 1.104.5 que Serve reemplaza `X-Forwarded-For` con la dirección del dispositivo. La conexión HTTPS desde la PC devolvió HTTP 403, incluso al intentar suplantar ese encabezado. La prueba local del proxy con la dirección admitida devolvió HTTP 200. [Código de Serve](https://github.com/tailscale/tailscale/blob/v1.104.5/ipn/ipnlocal/serve.go)

La primera prueba desde el Pixel con 5G llegó a PayPal Sandbox. PayPal mostró un error en `/pay/app-switch` y las órdenes seguían esperando aprobación, sin captura ni acreditación. El reintento se hace desde Chrome de incógnito, manteniendo la compra y el retorno en la misma pestaña. PayPal documenta el flujo web alternativo en Chrome de incógnito en Android. [Pruebas de App Switch](https://developer.paypal.com/braintree/docs/guides/paypal/testing-go-live/javascript/v4/#app-switch-compatibility)

Los reintentos mantuvieron el bloqueo antes de la aprobación. El registro local mostró siete órdenes y ninguna captura. Se inició una cuenta aparte en modo simulado con cinco créditos de prueba para continuar la carga, edición y exportación en el Pixel con el mismo acceso privado. Este recorrido no acredita que PayPal Sandbox funcione en el teléfono.

La cuenta simulada recibió un segundo paquete desde el piloto y quedó con diez créditos antes de la carga. El trabajo de video iniciado desde el Pixel pasó de reserva a resultado disponible y consumió un crédito. Saldo comprobado de nueve disponibles y cero reservados. Queda comprobar la corrección y abrir ambas descargas en el teléfono.

La captura del editor muestra la frase corregida a los 2,10 s. El MP4 adjuntado desde Descargas del Pixel reproduce el texto «La bicicleta azul tiene dos ruedas». El archivo dura 5,578 s, contiene video H.264 y audio AAC con señal medible. La cuenta simulada registró tres trabajos terminados, tres créditos consumidos, siete disponibles y cero reservados. La lista Descargas del Pixel muestra `linguistvision.srt` de 136 bytes. Queda cotejar su texto y sus tiempos.

### Candidata de pago en el navegador

El modo `LINGUISTVISION_PILOT_PAYPAL_WEB_SDK=1` con credenciales Sandbox abre una pantalla de pago autenticada, separada del editor. PayPal JavaScript SDK v6 se carga únicamente allí. Intenta abrir el pago en una ventana del navegador y usa una ventana integrada si el SDK informa un fallo recuperable. El servidor sigue creando la orden, cotejando comprador autenticado, vendedor, importe y moneda, y aplicando la captura una sola vez. [Modos de presentación de PayPal](https://developer.paypal.com/sdk/js/advanced/)

Chromium con Android emulado abrió el checkout Sandbox en otra pestaña. La pantalla de archivos mantuvo su política sin scripts de PayPal y la pantalla de pago rechazó accesos sin sesión. La orden quedó esperando aprobación con cero capturas. La prueba no establece el comportamiento del Pixel real ni del modo integrado. El modo queda opcional en la candidata hasta probar la aprobación y el saldo desde el teléfono.

Se activó el modo web para el Pixel tras confirmar la sincronía del MP4 corregido. El piloto usa la cuenta de prueba separada de PayPal Sandbox, con saldo inicial cero. Se verificó que la pantalla de pago autentica al usuario y que el piloto mantiene su política sin scripts de PayPal en el editor. Pendiente la aprobación del comprador y la acreditación.

El 8 de noviembre, el Pixel volvió al checkout después de intentar abrir la ventana de PayPal. La orden más reciente seguía en `PAYER_ACTION_REQUIRED` y el saldo en cero. Se corrigió el aviso para describir el cierre sin atribuirlo al usuario. La variante `presentation=modal` solicita la presentación integrada de PayPal. En Chromium Android emulado abrió el formulario web sin bloqueos de la política de contenido. Se activó en el enlace privado con la misma cuenta Sandbox. Pasaron 50 pruebas, tipos y compilación. Pendiente la aprobación en el Pixel físico.

El usuario reprodujo el mismo cierre en el Pixel con la variante integrada. La orden más reciente quedó en `PAYER_ACTION_REQUIRED` y el piloto conservó cero capturas y cero créditos. El cierre ocurre antes de que el servidor solicite la captura. Se preparó un borrador para soporte técnico con el identificador de orden y el `PayPal-Debug-Id` de la consulta posterior. La consulta HTTP no identifica la causa del cierre del navegador. Borrador local en `%LOCALAPPDATA%\LinguistVision\validation\mobile-pilot\paypal-sandbox-support-draft.txt`. [Soporte técnico de PayPal](https://developer.paypal.com/docs/multiparty/troubleshoot/)

### Preparación del reintento de LV-007

PayPal Sandbox respondió HTTP 200 al autenticar la aplicación. Se levantó una candidata aislada con cuenta y cookie propias y saldo inicial cero. La prueba local del filtro devolvió HTTP 403 para un dispositivo ajeno, HTTP 303 para iniciar sesión desde el dispositivo admitido y HTTP 200 en el formulario PayPal autenticado. La API de configuración rechazó solicitudes sin sesión. El enlace nuevo por Tailscale quedó pendiente porque la ejecución que incluía su activación fue rechazada por la política del entorno. Las rutas existentes comprobadas corresponden a otras sesiones de prueba. Queda habilitar el enlace privado y aprobar desde Chrome en el Pixel. Se considerará superado cuando el servidor confirme la captura y acredite cinco créditos una sola vez.

En la siguiente comprobación, Tailscale estaba activo y el Pixel aparecía conectado. El backend de pago escucha en `127.0.0.1:3009` y el filtro de acceso del Pixel en `127.0.0.1:3010`. Las rutas HTTPS existentes siguen ocupadas por otras sesiones. El acceso de pago requiere que el operador habilite una ruta HTTPS privada hacia el filtro del Pixel, con el origen configurado para 8444. Tras verificar el filtro, el comprador debe aprobar en el teléfono y se cotejarán captura, saldo y reintento. La medición del MP4 móvil se hará en la sesión del editor.
