# LV-019.B · Plan de saldo, video, voz y teléfono

**26 nov 2026 · Plan operativo para los cuatro puntos solicitados.** Detalla el orden del [Master Plan](../../MASTERPLAN.md) y sus puertas; no cambia precios, autorizaciones ni el estado de las tareas. El estado y las pruebas vigentes se consultan en [backlog](../../backlog.md) y [HANDOFF](../../HANDOFF.md). No habilita funciones ni autoriza por sí solo un despliegue.

## Resultado buscado

Desde una computadora o teléfono, una persona inicia sesión, selecciona un video privado en español, ve su duración y precio, obtiene la transcripción, la traduce al inglés y revisa y descarga TXT/SRT. Si elige voz, revisa el texto traducido, selecciona voz femenina o masculina y puede escuchar y descargar el audio. El alcance inmediato contempla el **audio por separado**: montar voz y subtítulos dentro de un MP4 final es una ampliación posterior, con su propia validación.

El texto cuesta **US$0,10 por minuto de video fuente** y la voz opcional **US$0,10 por minuto adicional**. Por ejemplo, para tres minutos: US$0,30 por texto o US$0,60 por texto y voz. El servidor calcula la duración y el saldo en segundos, redondeando la duración hacia arriba. Se muestra el precio antes de confirmar cada servicio. No hay voz sola ni Cloud SQL. El ejemplo español→inglés produce voz en inglés desde su traducción revisada; la salida simultánea acordada en español neutro latinoamericano requiere otro recorrido con traducción al español y revisión propias, además de validar las voces y su calidad.

## 1. Terminar el saldo y su recuperación

1. Partir del diagnóstico de devolución ya probado con cuentas ficticias y resolver los casos en los que se pierde una respuesta, la operación queda esperando o cambia el estado de la cuenta. Investigar el arranque del emulador de metadatos antes de repetir su prueba inconclusa; no presentar el modelo en memoria como implementación de Firestore.
2. Conservar una sola reserva y liquidación por servicio. Si no hay saldo suficiente, no crear el trabajo ni llamar al proveedor. Liberar lo que corresponda al confirmar que el servicio no se realizó; si el resultado es incierto, conservar la reserva y conciliar sin reenviar automáticamente.
3. Aplicar la decisión de Rob ante una incidencia: generar una alerta; permitir terminar el trabajo ya autorizado cuando sea verificable; impedir nuevos videos únicamente de la cuenta afectada cuando se haya identificado, sin detener a las demás. Si el dueño no se conoce, no asignar la incidencia a otra cuenta. Corregir y desbloquear con constancia, sin impedir la devolución debida ni duplicarla.
4. Integrar los cambios de Cuenta y Video en una candidata aislada. Probar dos cuentas y varios trabajos, saldo insuficiente, éxito, fallo, repetición, concurrencia, respuesta perdida, desbloqueo, devolución y recuperación tras caída; repetir la regresión financiera completa sobre el mismo corte. GLM y DeepSeek revisan el cambio de saldo de forma independiente; Codex contrasta sus informes.

**Termina cuando:** las pruebas y ambas revisiones del corte integrado respaldan saldo correcto, devolución única y aislamiento. Los resultados anteriores de una candidata no certifican automáticamente otra.

## 2. Unir la web con el procesamiento privado

1. Completar la lectura de la configuración real de Google Cloud: permisos efectivos, red, cuotas, índices y costos. Preparar el gateway y su identidad conforme al [Master Plan](../../MASTERPLAN.md); la web usa la misma dirección de Vistavo y el servicio de video conserva su acceso privado.
2. Conectar primero en una candidata local la cuenta, la subida privada y los trabajos con proveedores simulados. Después, con contenido sintético y dentro de la autorización de gasto vigente, comprobar los proveedores reales de transcripción y traducción. El servidor verifica la propiedad del archivo y la reserva antes de cualquier procesamiento.
3. Integrar el recorrido: video → transcripción en español → traducción al inglés → revisión guardada → TXT/SRT. Los archivos descargados deben contener la versión revisada y sus tiempos correctos; guardar, reabrir y descargar deben respetar la cuenta y la revocación de acceso.
4. Preparar el procesamiento bajo demanda, sus estados, alertas y recuperación; limpiar archivos temporales de acuerdo con la política. La candidata local puede verificarse antes de G0. La conexión y su prueba restringida en la nube se realizan después de las puertas vigentes, incluida G0 para la voz.

**Termina cuando:** la candidata integrada completa el recorrido con dos cuentas ficticias, niega archivos ajenos, conserva correcciones y supera los fallos y reinicios previstos. Los ensayos locales no sustituyen la prueba restringida en la nube.

## 3. Añadir voz opcional

1. Mostrar al configurar el video la opción de voz y su precio adicional. La persona puede continuar solo con texto o elegir voz; antes de generarla revisa la traducción guardada en el idioma de destino y selecciona una voz femenina o masculina. Cambiar de idea antes de confirmar la voz no crea su reserva. En el recorrido inglés→español se usa la traducción revisada al español, separada del ejemplo español→inglés.
2. Vincular cada solicitud a la revisión exacta y reservar por separado los segundos del video. Conectar el proveedor de voz y guardar el audio privado; no clonar voces. La salida inicial es audio descargable, no un MP4 doblado.
3. Aplicar las decisiones vigentes: si Vistavo falla, no cobrar la voz; ante resultado incierto no repetir el envío ni liberar sin conciliar. Si el cliente cancela después del envío, cobrar solo la parte efectivamente entregada y verificada, proporcionalmente, y liberar el resto. Retención de audio: **90 días** conforme a la política y pruebas de borrado.
4. Completar la revisión pendiente de la integración de voz, sin tratar como aprobada la auditoría interrumpida. Probar voz femenina y masculina, texto modificado, saldo insuficiente, fallo, cancelación, respuesta perdida, privacidad y reproducción. Medir duración, calidad y costo con muestras sintéticas; la prueba online con saldo real conserva el tope autorizado de **US$5** documentado en el [plan integral](../specs/LV-019-B-plan-integral-20261120.md).

**Termina cuando:** los recorridos de voz de lanzamiento en inglés y español neutro latinoamericano están validados con sus traducciones revisadas y voces; el audio corresponde a la revisión seleccionada, se puede escuchar y descargar por su dueño y el saldo refleja únicamente lo que corresponde, con pruebas y revisiones de la candidata integrada.

## 4. Hacer sólido el uso desde el teléfono

1. Ampliar y validar de forma gradual el límite actual de 30 segundos para los videos deseados de **2–3 minutos**. Comprobar MP4 y MOV con muestras reales de cámara, códecs, rotación, video vertical y límites de tamaño y memoria antes de anunciarlos. Medir también las muestras de 1, 5 y 10 minutos del plan general antes de ampliar esos límites.
2. Preparar subidas reanudables, progreso claro y recuperación del proyecto después de suspensión o pérdida de conexión. Volver a seleccionar un archivo debe continuar solo si es el mismo; reintentar no debe iniciar ni cobrar dos trabajos. El backend debe mantener los archivos privados y procesar bajo demanda sin depender de que el teléfono permanezca abierto.
3. Probar el recorrido táctil en iPhone/Safari y Android/Chrome físicos: elegir el video, ver precio y saldo, subir, revisar, descargar TXT/SRT, elegir y escuchar voz, suspender y retomar. Comparar una cuenta con saldo y otra sin saldo; comprobar aislamiento, revocación, falla y devolución, tiempos, memoria y costos observados.

**Termina cuando:** un video real de 2–3 minutos completa el recorrido aceptado en ambos teléfonos, y los escenarios de interrupción y saldo tienen evidencia. No se toma una pantalla simulada como prueba de un dispositivo físico.

## Cierre y publicación

Codex coordina y verifica cada resultado. GLM y DeepSeek revisan cambios de saldo o contratos; GLM revisa los cambios sin saldo según la política vigente. La revisión de migración/backend con `google/gemini-4-hydrogen:batch` permanece en la puerta de integración; se comprobará su disponibilidad antes de esa consulta, sin sustituir el modelo por cuenta propia. Se conservan informes completos, límites y costos observados; no se cambian modelos, credenciales ni presupuestos para este plan.

Completar tipos, compilaciones, regresión financiera, privacidad, observabilidad, restauración y reversión, y las demás puertas del plan integral. Antes de la prueba con saldo real, confirmar que existe una cuenta con saldo legítimo y un mecanismo de acreditación autorizado; no inventar créditos ni asumir que las compras ya funcionan. La primera prueba online es restringida y sigue el presupuesto y las autorizaciones vigentes; el plan integral exige acta y aprobación escrita para el primer despliegue. La apertura general ocurre solo después de superar los criterios y decisiones de publicación ya establecidos. Drive y compras reales continúan en sus líneas independientes; antes de vender en autoservicio habrá que completar también las compras.
