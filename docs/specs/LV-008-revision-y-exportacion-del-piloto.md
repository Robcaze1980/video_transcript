# LV-008 · Revisión y exportación de subtítulos en el piloto

**Estado:** cerrada. Implementación local verificada con subtítulos sintéticos, una transcripción real de Gemini y reproducción del MP4 en un teléfono físico.

El piloto privado inglés ↔ español debe permitir que un taller o contratista revise el texto sobre su video, corrija una medida y descargue el resultado desde la misma pantalla.

## Recorrido y criterios de aceptación

| Paso | Comportamiento | Evidencia de aceptación |
|---|---|---|
| Vista previa sincronizada | Al terminar de generar los subtítulos, mostrar el texto activo sobre el video y la lista de segmentos al lado o debajo, según el tamaño de pantalla. | En clips vertical y horizontal, reproducir, pausar y saltar entre dos segmentos. El texto mostrado corresponde al instante reproducido y desaparece en un tramo sin subtítulos. |
| Buscar y corregir | Buscar una frase en el original o la traducción. Al elegir un resultado, saltar al inicio de su segmento y permitir editarlo. | Con una muestra autorizada o sintética, buscar «dos pies», elegir la coincidencia correcta y corregir una cifra o unidad cotejándola con el audio. Confirmar que el cambio se refleja sobre el video y en la descarga, y que el segmento conserva sus tiempos. Comprobar búsqueda con tildes. |
| Mover el texto | Arrastrar el subtítulo sobre la vista previa. Guardar la posición relativa al área visible del video. El piloto usa una posición común para todos los segmentos. | Mover el texto para despejar una parte del encuadre, reproducir otro segmento y confirmar que la posición se conserva. El clip mantiene escala, posición, recorte y duración. Redimensionar la vista y comprobar que el texto sigue dentro del video. |
| Descargar SRT | Exportar los textos y tiempos revisados en UTF-8. | Abrir el SRT, comprobar la corrección y cotejar los tiempos con el video. La posición del texto pertenece a la salida visual y no al SRT. |
| Descargar MP4 | Como complemento del piloto, exportar el clip con subtítulos incrustados a partir de la misma revisión. | Abrir el MP4 en un reproductor y en un teléfono. Comparar posición, legibilidad, texto y sincronización con la vista previa en dos segmentos y un tramo sin texto. Verificar que conserva el encuadre y el audio del clip. Medir tiempo y coste incremental. |

## Diseño y alcance

La lista, la búsqueda, la vista previa y las exportaciones leen la misma revisión de los segmentos, con ID, inicio, fin, texto original y traducción. Exportar desde una revisión concreta para que una edición posterior no altere un render en curso. Guardar la posición como propiedad del subtítulo y mantenerla separada de la transformación del clip.

CapCut aporta la referencia de vista sobre el video y lista de revisión. Las decisiones sobre pistas bilingües, controles de video, audio y velocidad, efectos, muletillas y resaltado están registradas en el [plan completo del editor](LV-009-plan-del-editor.md). LV-008 conserva la evidencia de las funciones del piloto.

Se puede preparar la interfaz y verificar la edición y las exportaciones con segmentos sintéticos mientras se resuelve LV-002. El cierre de extremo a extremo exige una transcripción real y la comprobación de ambas salidas. La disponibilidad y el precio de MP4 en la oferta pública se deciden con la evidencia del piloto.

## Revisión externa

DeepSeek y Kimi recibieron en paralelo un resumen de las funciones observadas en CapCut, desde generación y edición de captions hasta los controles separados del clip. Se compartieron observaciones técnicas. Las capturas, el video y su transcripción quedaron locales.

DeepSeek propuso una sola revisión compartida por lista, vista previa y salidas. Kimi señaló los riesgos de perder cifras y unidades, desincronizar el video y cambiar la posición al renderizar. Codex convirtió esos hallazgos en las pruebas anteriores. Las capturas de CapCut sirven como referencia de diseño. La aceptación corresponde a pruebas de LinguistVision.

Consultas vía OpenRouter de LinguistVision por el bloqueo documentado de T3. DeepSeek V4.1 Flash, Baidu, `gen-1794079655-UoFGsZy53H8mQmyP5ppk`: US$0.0002781804663. Kimi K2.6, Baidu, `gen-1794079655-sNaxGpuRnptnlKwVr5Oh`: US$0.001377673308. Total confirmado: **US$0.0016558537743**.

## Evidencia local con subtítulos sintéticos

- Node 24.13.0. Comprobación de tipos, 28 pruebas y compilación de producción correctas. La prueba se hizo en Chrome contra `127.0.0.1:3001`, con Gemini deshabilitado y sin llamadas de procesamiento a la API.
- Dos recorridos completos con clips de unos 5,2 s: horizontal de 320 × 240 en escritorio y vertical de 240 × 400 en una ventana de tamaño móvil. La búsqueda sin tilde encontró la frase con tilde. La selección saltó al inicio de la frase y pausó la reproducción. Corregir «dos pies» a «tres pies» conservó los tiempos y actualizó la vista previa y el SRT.
- Se arrastró el subtítulo en ambos ejes sin cambiar el rectángulo del video. Su posición se mantuvo al pasar al siguiente segmento y al redimensionar la ventana.
- Los dos MP4 descargados conservaron las dimensiones y audio audible, con video H.264 y audio AAC. Se cotejaron los píxeles de subtítulos de dos instantes contra el dibujo de la vista previa y se confirmó que el intervalo sin subtítulos quedó vacío. Duraciones de 5,283 s y 5,300 s, con exportaciones locales de 5,836 s y 5,785 s. Son resultados de dos muestras cortas, sin estimación de coste de producción.
- Chrome falló al grabar MP4 directamente. La ruta probada graba WebM y lo convierte a MP4 con FFmpeg servido por la app. Los resultados sintéticos están en `%LOCALAPPDATA%\LinguistVision\validation\lv008-PFLgPY`.

## Evidencia con transcripción real

- Se buscó «bicicleta» en el resultado de Gemini. La selección saltó al inicio del segmento, en 2,150 s, y pausó el video. Se cambió «bicicleta azul» por «bicicleta de color azul». El SRT revisado mantuvo los tiempos originales y la medida de tres ruedas.
- Se arrastró el subtítulo sin desplazar el clip. El MP4 descargado mantuvo las dimensiones de 240 × 400, video H.264 y audio AAC audible. Se decodificó y cotejó la posición del texto en dos fotogramas con la vista previa. La exportación tardó aproximadamente 6,1 s para esta muestra.
- Los tres archivos están en `%LOCALAPPDATA%\LinguistVision\validation\lv008-real-MiN1TZ`.

## Confirmación en teléfono

- El usuario reprodujo en su teléfono una copia privada del MP4 de prueba. Confirmó que se oía el audio y que el texto de los subtítulos se leía correctamente. Esta confirmación cierra la verificación móvil de LV-008.
## Integración en la web privada

LV-003 reutiliza la vista de subtítulos y la exportación de LV-008 con video de origen y SRT de la cuenta autenticada. La prueba de Chrome buscó, corrigió, movió el texto y exportó ambos formatos tras un trabajo real de Gemini. [Evidencia del editor web](LV-003-piloto-web-privado.md#editor-web-del-piloto)

### Sincronía de la exportación del piloto

El MP4 árabe del Pixel medía 7,421 s frente a 6,445 s del original. La correlación de dos tramos de audio mostró +0,433 s. Al medir fotogramas, los subtítulos que debían entrar a 0,350 y 2,900 s aparecieron a 1,109 y 3,855 s.

La candidata web usa el MP4 original y superpone imágenes transparentes de los subtítulos en sus intervalos. Reutiliza el dibujo de la vista previa, incluida la escritura árabe. FFmpeg procesa el archivo en el navegador y toma el audio del original. El flujo de exportación de escritorio conserva su implementación.

Con el mismo clip y tiempos de referencia, Chrome a 360 px produjo un MP4 de 6,445 s. El audio coincidió sin desplazamiento medible en ambos tramos y los subtítulos aparecieron en 0,367–1,767 y 2,900–5,300 s. Se mantuvo el espacio sin texto entre los segmentos. Evidencia local en `%LOCALAPPDATA%\LinguistVision\validation\timed-pilot-e2e-1Y4wRz\timing.json`. Queda repetir y medir la exportación en el Pixel.

La candidata pasó 49 pruebas, tipos, compilación y los recorridos de exportación horizontal y vertical de escritorio. Se activó el exportador corregido en el piloto privado del Pixel y se verificó que sirviera el nuevo módulo. Se puede exportar de nuevo desde el historial con el mismo trabajo y sin consumir otro crédito.

El nuevo MP4 adjunto del Pixel mide 6,445 s, igual que el clip original. La comparación de dos tramos de audio devolvió cero desplazamiento medible a 8 kHz. Los subtítulos incrustados aparecieron en 0,300–1,400 y 3,200–5,167 s frente a 0,300–1,400 y 3,200–5,150 s del SRT original de ese trabajo. El máximo error medido fue 17 ms. El segundo subtítulo incrustado coincide con la repetición descrita en el SRT editado por el usuario. El SRT original del trabajo contiene una sola instancia del saludo. Evidencia local en `%LOCALAPPDATA%\LinguistVision\validation\mobile-pilot\timing-pixel.json`.
