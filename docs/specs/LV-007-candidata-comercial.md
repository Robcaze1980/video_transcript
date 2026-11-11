# LV-007 · Candidata comercial y costes

**Estado:** medición inicial. Las decisiones de precio, límites y publicación dependen de muestras representativas y tarifas confirmadas.

## Muestra inicial

El primer clip árabe duró 6,445 s. Gemini 3.8 Flash devolvió 811 tokens de entrada, 142 de salida y 164 de razonamiento. Con la tarifa Standard introductoria publicada, eso estima US$0,00175575 por trabajo y US$0,016345 por minuto de video de origen. La tarifa publicada para enero de 2027 duplicaría esa estimación. La muestra cubre el procesamiento de Gemini. Quedan la factura, reintentos, almacenamiento y transferencia. [Precio del modelo](https://ai.google.dev/gemini-api/docs/latest-model)

El piloto puede registrar el consumo sin contenido con `LINGUISTVISION_PILOT_MEASURE_USAGE=1`. Para cada dirección y tipo de clip, agrupar todos los intentos del trabajo, medir duración, bytes de entrada y salida, tiempo hasta resultado y proporción de fallos. Separar la latencia y transferencia de la exportación MP4, que se ejecuta en el dispositivo. Medir en un teléfono real y verificar audio y subtítulos.

La repetición con el editor web registró 811 tokens de entrada, 142 de salida y 237 de razonamiento. Estima US$0,0020295 por trabajo y US$0,018894 por minuto de origen. Chrome tardó 7,9 s en exportar el MP4 de 96.546 bytes. El archivo contiene H.264, audio AAC y la frase editada incrustada. Son dos mediciones de tokens del mismo clip. El cargo facturado y el coste de almacenamiento siguen pendientes.

## Muestras de LV-014

Una respuesta de Gemini por muestra, sin tokens de caché registrados. La estimación aplica la tarifa Standard de Gemini 3.8 Flash de US$0,75 por millón de tokens de entrada y US$3,75 por millón de tokens de salida y razonamiento. El cargo facturado sigue sin confirmar. [Tarifa oficial](https://ai.google.dev/gemini-api/docs/pricing/)

| Muestra | Entrada | Salida | Razonamiento | Coste estimado |
|---|---:|---:|---:|---:|
| Inglés | 699 | 152 | 235 | US$0,00197550 |
| Español | 523 | 82 | 200 | US$0,00144975 |
| Árabe | 805 | 140 | 85 | US$0,00144750 |
| Total | 2027 | 374 | 520 | US$0,00487275 |

## Muestras de obra y exportación

| Trabajo de Gemini 3.8 Flash | Duración | Tokens de entrada / salida / razonamiento | Coste estimado por trabajo | Coste estimado por minuto |
|---|---:|---:|---:|---:|
| Inglés → español | 28,13 s | 2815 / 252 / 134 | US$0,00355875 | US$0,00759 |
| Español → inglés | 28,13 s | 2815 / 512 / 0 reportados | US$0,00403125 | US$0,00860 |
| Vietnamita → vietnamita | 25 s | 2568 / 495 / 246 | US$0,00470475 | US$0,01129 |
| Total | 81,27 s | 8198 / 1259 / 380 | **US$0,01229475** | |

Son estimaciones de procesamiento a tarifa Standard, con factura pendiente. En el recorrido español → inglés, Chrome en Windows importó el clip y su SRT y generó el MP4 en 1,86 s desde la pulsación hasta la descarga. El MP4 H.264/AAC conservó los 28,13 s, tuvo audio con señal y mostró el subtítulo en un fotograma comprobado. Comparación en bytes: entrada 732.673, SRT 565, MP4 2.732.111. La exportación se ejecutó en el navegador y usó el SRT existente. La medición cubre tiempo y tamaño adicionales en PC. Falta medir el dispositivo móvil, la primera carga de recursos y el coste de transferencia y almacenamiento. Evidencia en `%LOCALAPPDATA%\LinguistVision\validation\lv007-field-mp4-VH4awx`. [Tarifa Standard](https://ai.google.dev/gemini-api/docs/pricing/)

La auditoría inicial reportó seis paquetes afectados. Se actualizó el lockfile sin cambiar el manifiesto y Vite pasó de 6.4.3 a 6.4.5. La auditoría posterior reportó cero alertas. Pasaron los tipos, 63 pruebas con PostgreSQL y la compilación. La medición de MP4 se hizo con esa candidata aislada.

El [cotejo de medidas y sincronía](LV-004-paquetes-de-idioma.md#cotejo-de-medidas-y-sincronía-en-obra) ejecutó cuatro clips y cuatro repeticiones con la opción de sincronía precisa. Gemini Standard se estima en **US$0,031911** por las ocho consultas. La conciliación de facturación queda pendiente. Faster Whisper corrió en la PC para el cotejo independiente.

## Pagos y publicación

PayPal publica para EE. UU. **4,99 % + US$0,09** para micropagos nacionales. Una compra de US$4,95 estima US$0,34 de comisión bajo esa tarifa y US$0,66 con Checkout estándar al 3,49 % + US$0,49. La cuenta comercial de LinguistVision debe obtener la habilitación y confirmar su tarifa aplicable. El paquete Sandbox es un valor de prueba. [Tarifas oficiales](https://www.paypal.com/us/business/paypal-business-fees#micropayments)

Antes de decidir el precio, probar margen por paquete con ambas tarifas, incluyendo trabajos fallidos, almacenamiento y reembolsos. Verificar las diez rutas y capacidades acordadas para la primera versión, el acceso privado en el teléfono y la descarga de archivos. El propietario decide variantes, pares comerciales, MP4, límites, precio y publicación tras esa evidencia.

## Alojamiento y paquete candidato

- **Alojamiento aprobado.** DigitalOcean es el proveedor elegido para LinguistVision. Evaluar el Droplet existente según su capacidad y sus servicios instalados. Usar un Droplet separado si el actual aloja ROBATO. Antes de publicar, verificar cargas simultáneas con videos de 10 minutos, respaldo y restauración.
- **Oferta aprobada.** Tres recargas en USD: US$1,00 por 10 minutos, US$5,00 por 50 y US$10,00 por 100. Los segundos de video de origen se acumulan en la cuenta y se pueden repartir entre varios videos. Medir la duración en el servidor, redondear cada video al segundo entero superior y mostrar el saldo en minutos y segundos. Queda validar los límites comerciales por archivo y el coste con muchos clips cortos. La tarifa nacional de Micropagos aún depende de la habilitación de PayPal.
- **Criterio de LV-003.** Acreditar la compra una vez. Reservar la duración antes de enviar el trabajo a Gemini, consumirla una vez al entregar el resultado y liberarla ante un fallo final. Si el video supera el saldo, pedir que se recorte o se compre más saldo. Probar dos cargas simultáneas que juntas superen el saldo.

Los tres paquetes cuestan US$0,10 por minuto. Las recargas mayores reducen el número de pagos y el peso de la comisión fija. Con todo el saldo consumido, la estimación de contribución después de Gemini y PayPal Micropagos nacional es US$0,63–0,71 para 10 minutos, US$3,53–3,90 para 50 y US$7,15–7,89 para 100. Quedan los costes de operación y el ensayo de 10 minutos distribuidos entre muchos clips cortos. El piloto comercial conserva su límite de 30 segundos y 1 MiB por MP4 hasta validar archivos más largos y el alojamiento.

La candidata usa el mismo catálogo para portada y checkout. La prueba con PostgreSQL acreditó cada paquete una vez, descontó dos trabajos de un mismo saldo, liberó los segundos de un trabajo fallido y rechazó el exceso de saldo en dos solicitudes concurrentes. PayPal Sandbox confirmó tres órdenes en USD por los importes aprobados. Falta la aprobación del comprador de prueba y comprobar la captura y el consumo de su saldo en esa cuenta.

## 2026-11-10 · LV-003 y LV-007 · Google y compra Sandbox de US$5

El propietario confirmó que entró con Google y aprobó la compra Sandbox de US$5; la interfaz mostró 50:00 disponibles y 0:00 reservados. Codex corroboró por lectura de PostgreSQL y consulta GET a PayPal Sandbox: orden COMPLETED, una captura COMPLETED por USD 5.00, una fila de compra, un movimiento de acreditación y una identidad Firebase asociada a la cuenta. La base registra 3000 segundos acreditados, 3000 disponibles, cero reservados y cero consumidos. No se solicitó otra captura ni se alteró el saldo. Es un pago de prueba, no ingreso comercial. Quedan recarga, salida y reentrada con la misma cuenta, recorrido con archivos y prueba en el Pixel. Sin nuevas consultas a revisores ni cargos de LLM.

Actualización posterior de la sesión: el propietario confirmó que salió y volvió a entrar con Google y conservó los 50 minutos. El consumo de dos videos con esa cuenta sigue pendiente. La falta de dominio condiciona la publicación, pero permite continuar la candidata local.
