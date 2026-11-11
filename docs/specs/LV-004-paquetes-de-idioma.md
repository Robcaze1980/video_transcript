# LV-004 · Incorporación de idiomas por paquete

El piloto privado inglés ↔ español sirve para validar el recorrido común. La primera versión pública cubre diez idiomas. La expansión se decide tras publicar y monetizar.

El orden aprobado es completar la app privada con inglés, español y árabe en [LV-014](../../backlog.md#lv-014) antes de completar los diez paquetes de la primera versión. Se conservan el catálogo de expansión y las rutas de borrador existentes. Cada incorporación reutiliza el flujo y añade mensajes, contenido, mapeo y evidencia. Una prueba de humo demuestra que el flujo funciona con una muestra. La cobertura comercial exige revisión lingüística y pruebas por capacidad.

## Rondas planteadas antes del cambio de alcance

1. Mandarín, cantonés, vietnamita, filipino y coreano.
2. Portugués, francés, japonés, alemán, italiano y neerlandés.
3. Polaco, checo, sueco, rumano, ucraniano, ruso y turco.
4. Hindi, bengalí, urdu y punyabí.
5. Indonesio, tailandés, malayo, persa y suajili.

Estas rondas se conservan como referencia histórica. La prioridad inicial se rige por la [selección comercial de diez idiomas](LV-001-propuesta-comercial.md#selección-aprobada-para-la-primera-versión).

### Preparación de la primera ronda

El 8 de noviembre se cotejó la primera ronda con el catálogo de lanzamiento. Los cinco idiomas ya tienen identidad y ruta de borrador. Para cada paquete faltan los mensajes completos de interfaz, el contenido público localizado, la dirección de transcripción privada, una muestra de voz autorizada y la evidencia de aceptación.

| Idioma | Identidad prevista en el catálogo | Comprobación propia del paquete |
|---|---|---|
| Mandarín | `cmn`, `zh-Hans` | Cotejar el texto en escritura simplificada y distinguir el audio de mandarín del de cantonés. |
| Cantonés | `yue`, `yue-Hant` | Cotejar el habla y la escritura tradicional previstas. Conservar la ruta de borrador y dejar pendiente el código de alternancia. |
| Vietnamita | `vi` | Conservar diacríticos en interfaz, SRT y MP4. |
| Filipino | `fil` | Verificar la escritura y registrar cualquier alternancia de idioma presente en la muestra. Dejar pendiente el código de alternancia de búsqueda. |
| Coreano | `ko` | Cotejar hangul y saltos de línea en vista previa y MP4. |

La incorporación sigue el orden aprobado tras LV-014. PayPal Sandbox en el Pixel se aplazó a petición del propietario. La preparación conserva los borradores existentes y separa la prueba de transcripción de la decisión sobre variantes y pares comerciales.

## Contrato

- **Catálogo de interfaz:** etiqueta BCP 47, nombre local, dirección de escritura, mensajes, contenido público y slugs. Usar IDs de página estables para generar alternancias, enlaces y sitemap a partir de las traducciones disponibles.
- **Catálogo de procesamiento:** idioma de voz, variantes y escrituras admitidas, equivalencia del proveedor y estado de validación de transcripción. La dirección de traducción y su estado se registran por separado. Un idioma aprobado para transcribir no activa todos sus pares.
- **Flujo común:** selectores, rutas, cola, créditos y exportación leen la configuración. La web muestra únicamente capacidades aprobadas para el entorno. La configuración sin revisión se puede ensayar en un entorno privado.

## Prueba de aceptación

1. Con inglés y español funcionando, incorporar en un entorno de prueba un tercer idioma, preferiblemente árabe para cubrir escritura de derecha a izquierda. Añadir la entrada, mensajes, contenido y muestras de prueba. Ejecutar el mismo flujo sin editar la lógica de rutas, selectores, Gemini, créditos ni exportación.
2. Comprobar que la interfaz, los selectores y la ruta localizada se generan a partir del paquete. Verificar HTML, canónica, alternancias recíprocas y sitemap. Bloquear la activación si faltan mensajes, metadatos, mapeo del proveedor o cobertura aprobada para la capacidad anunciada.
3. Procesar una muestra autorizada con voz en el nuevo idioma. Abrir el SRT en un reproductor, revisar texto, escritura y tiempos. Probar cada par que se quiera anunciar y, si corresponde, reproducir el MP4 con el texto incrustado.

## Primer incremento

### Siete paquetes del lanzamiento inicial

Se prepararon portugués de Brasil, francés, alemán, japonés, coreano, mandarín con escritura simplificada y vietnamita. La vista previa privada habilita sus interfaces con la misma opción de diez idiomas. Cada paquete tiene mensajes completos, metadatos y página localizada. El sitio de vista previa conserva las 30 rutas con `noindex`. La publicación sigue requiriendo revisión editorial y lingüística.

Se generó un clip con voz sintética por idioma a partir de frases de referencia. La misma candidata procesó los siete mediante la cola privada de Gemini, abrió los proyectos y descargó los SRT. El texto coincidió al normalizar puntuación, espacios y la escritura del número dos en japonés. Chrome cotejó los SRT y comparó un fotograma de cada MP4 H.264/AAC con la vista previa.

La primera pasada detectó subtítulos adelantados en cuatro idiomas. Se añadió una instrucción que alinea cada segmento con las palabras audibles y se repitió el recorrido completo. La diferencia máxima de cada clip se estimó frente a los bordes de voz detectados con FFmpeg a −38 dB. El umbral de esta prueba corta fue 0,50 s.

| Idioma | Diferencia máxima en la segunda pasada | Estado tras la prueba sintética |
|---|---:|---|
| Portugués de Brasil | 0,121 s | Beta |
| Francés | 0,464 s | Beta |
| Alemán | 0,287 s | Beta |
| Japonés | 0,313 s | Beta |
| Coreano | 0,345 s | Beta |
| Mandarín | 0,243 s | Beta |
| Vietnamita | 0,659 s | Solicitar |

Vietnamita conserva su puesto en la lista de diez. El texto y la exportación pasaron. En una consulta aislada la instrucción de alineación dejó los tiempos dentro del umbral, pero el resultado no se repitió en la cola del piloto con la voz sintética. La repetición con voz humana se detalla abajo. Las muestras sintéticas no acreditan la calidad comercial ni direcciones de traducción entre idiomas.

Los insumos y las dos rondas se guardaron en `%LOCALAPPDATA%\LinguistVision\validation\lv004-voice-3fyQ39`, `lv004-speech-MXtqYN` y `lv004-speech-uipDBT`. La vista previa usa `LINGUISTVISION_PILOT_LAUNCH_LANGUAGES=1` con pagos simulados. Los seis idiomas en beta procesan transcripción en el mismo idioma en ese entorno.

T3 respondió HTTP 401 desde esta sesión. Se usó OpenRouter de LinguistVision. DeepSeek redactó los siete paquetes y Kimi K3.1 Pro revisó las etiquetas de estado, pago, edición y páginas de muestra. Se conservaron las variables de cada mensaje y se integraron las correcciones pertinentes.

| Consulta de OpenRouter | Generación | Coste reportado |
|---|---|---:|
| DeepSeek, portugués | `gen-1794201583-kAM1IRBD7mQ8UKpxr7y2` | US$0,0092639943 |
| DeepSeek, francés | `gen-1794201583-jf6RxMZrGTCDgCTTXLts` | US$0,0061758378 |
| DeepSeek, alemán | `gen-1794201583-cQib4HbtpTDdZg8QsXtx` | US$0,00843361101 |
| DeepSeek, japonés | `gen-1794201583-V6t7LUCAtzdOB6O8PIMJ` | US$0,00708773571 |
| DeepSeek, coreano | `gen-1794201583-3GM6lkZJHNybGxo6E9Ih` | US$0,0098684586 |
| DeepSeek, mandarín | `gen-1794201583-nQqNWKZUNeymG7Mz4MVG` | US$0,003857238 |
| DeepSeek, vietnamita | `gen-1794201583-K4MIhxdiFrIybrt1ygeX` | US$0,018980379 |
| Kimi K3.1 Pro | `gen-1794201697-IsMcUcS923nIJD7E7KGz` | US$0,119337372 |
| Total | | **US$0,18300462642** |

Gemini reportó tokens por las dos rondas completas, la prueba aislada de alineación y la generación de los siete clips. La estimación total es **US$0,03634125**. El cargo facturado sigue sin confirmar. [Precios de Gemini](https://ai.google.dev/gemini-api/docs/pricing)

### Voz humana y primeros pares

La cola privada procesó cuatro trabajos aislados con Gemini 3.8 Flash y créditos simulados. Se descargaron los SRT, se compararon con las pistas al abrir los proyectos y se cotejaron las marcas con la voz de referencia. En las dos traducciones se descargaron tanto el original como la traducción.

| Dirección | Muestra y resultado | Diferencia máxima frente a la voz | Estado |
|---|---|---:|---|
| Inglés → español | Dos frases con voz sintética. Se conservaron el sentido y el número tres en ambas pistas. | 0,441 s | Beta privada |
| Español → inglés | Saludo con voz humana. Ambas pistas conservaron el sentido y los mismos tiempos. | 0,124 s | Beta privada |
| Vietnamita → vietnamita | Dos ejecuciones de un clip de 9,57 s con voz de Nghiem Mai Phuong. Ambas conservaron el texto y los diacríticos frente a los subtítulos de referencia, con la variante ortográfica lí/lý. | ≈0,24 s y ≈0,30 s | Beta privada en la vista previa de diez idiomas |

Se aplicó el umbral de 0,50 s. FFmpeg detectó los bordes de voz a −38 dB. Para el vietnamita, se estimó el cambio de frase con la pausa a −29 dB, entre 4,11 y 4,19 s, y se contrastó su orden con los subtítulos publicados. El primer SRT lo marca a 3,95 s y el segundo a 4,14 s. La desviación con la muestra sintética sigue registrada. Queda ampliar la cobertura con otras voces, habla espontánea, terminología del piloto y revisión lingüística antes de declarar capacidades comerciales. [Grabación vietnamita y licencia CC BY-SA 3.0](https://commons.wikimedia.org/wiki/File:Universal_declaration_of_human_rights_VN.ogg) · [Subtítulos vietnamitas de referencia](https://commons.wikimedia.org/wiki/TimedText:Universal_declaration_of_human_rights_VN.ogg.vi.srt)

Evidencia local en `%LOCALAPPDATA%\LinguistVision\validation`. Los dos pares están en `lv004-human-results-kJALix`. Las dos ejecuciones de vietnamita están en `lv004-human-results-PSJhaD` y `lv004-human-results-8RcnBK`. El insumo con atribución está en `lv004-human-source-46ff48c3`.

Gemini reportó 4.977 tokens en total. Las estimaciones por trabajo fueron US$0,00223875, US$0,00104925, US$0,00249075 y US$0,00221700. Total estimado **US$0,00799575**, cargo facturado por confirmar. [Tarifa de Gemini](https://ai.google.dev/gemini-api/docs/pricing)

### Muestras de obra y habla espontánea

Se ejecutaron tres trabajos por separado con Gemini real y saldo simulado. Los SRT descargados coincidieron con los borradores que abrió el editor. Las dos traducciones conservaron sus pistas de origen y destino. Los insumos y artefactos se guardaron bajo `%LOCALAPPDATA%\LinguistVision\validation`, en `lv004-field-20261108`, `lv004-field-results-DCXJvQ` y `lv004-field-results-ewfk6P`.

| Dirección | Cotejo | Estado |
|---|---|---|
| Inglés → español | Testimonio de un carpintero de obra, 28,13 s. Conservó el límite expresado como «más de seis pies» y el término «andamio». La ocupación quedó como «enmarcador de carpintería», poco natural para el contexto. Los bordes de dos bloques de voz quedaron a menos de 0,25 s según FFmpeg. | Beta |
| Español → inglés | Relato de un techador, 28,13 s. Conservó el sentido, incluida la caída, y el término `roofing company`. El primer subtítulo adelantó aproximadamente 0,41 s según el nivel de audio. El recorte termina a mitad de frase y carece de una medida física para verificar la unidad en este sentido. | Beta |
| Vietnamita → vietnamita | Otra voz, 25 s de explicación informal. Cinco segmentos válidos con diacríticos. Queda cotejar palabra por palabra y alinear el intervalo de 14,88 a 16,78 s, donde el SRT deja un hueco y la señal por sí sola no distingue voz de ruido. | Beta |

Se evaluaron por separado cobertura de voz, fidelidad de cifras y vocabulario, y sincronía. La siguiente pasada requiere clips completos con medidas en ambos sentidos y revisión bilingüe con vocabulario de obra. El uso de una licencia CC BY 3.0 indicada por Commons para la muestra vietnamita queda provisional porque el archivo está pendiente de revisión de licencia en ese sitio. No se usará como muestra pública hasta verificar la licencia en origen. [Carpintería, NIOSH](https://commons.wikimedia.org/wiki/File:A_construction_framer_talks_about_protecting_his_crew_from_falls.webm) · [Techado, CDC](https://commons.wikimedia.org/wiki/File:Construcción-_Protéjase_en_el_Trabajo.webm) · [Muestra vietnamita, Tiền Giang Ký Sự](https://commons.wikimedia.org/wiki/File:Ra_Xem_Nhật_thực,_Cách_Xem_Không_Hư_Mắt.webm)

### Cotejo de medidas y sincronía en obra

Se repitieron los pares por separado con cuatro extractos de voz humana que conservan las oraciones evaluadas. Se descargaron los SRT original y traducido y se comprobó que coincidían con el proyecto abierto. El texto se cotejó con las referencias publicadas y los bordes relevantes de voz con FFmpeg y Faster Whisper local. Se ensayaron cuatro repeticiones con la opción de sincronía precisa en una configuración de prueba. El umbral de 0,50 s sigue siendo el criterio de esta ronda.

| Dirección | Texto y unidades | Resultado de sincronía y estado |
|---|---|---|
| Inglés → español | Conservó el límite de más de seis pies y tradujo correctamente el oficio, las cerchas y los puntos de anclaje en los nuevos extractos. En dos ejecuciones escribió `LeBlond` donde la referencia y el rótulo de la ropa dicen `LeBlanc`. | En el segundo extracto, el último segmento terminó entre 0,90 y 1,06 s antes del fin estimado de la voz. **Beta**. |
| Español → inglés | Conservó «casi 20 pies» y «más de 10 pies», incluido el sentido de cada comparación. Tradujo correctamente el revestimiento, las barandas y el andamio de gato. | En la muestra del andamio, el segmento terminó en 9,38 s o 9,49 s frente a un fin de voz cercano a 10,73 s. La diferencia persistió con la opción de sincronía precisa. **Beta**. |
| Vietnamita → vietnamita | El cotejo con Faster Whisper local recuperó los mismos temas y la misma frase alrededor del hueco. La referencia automática sirve para revisar la voz y deja pendiente la evaluación humana. | El segmento de Gemini termina en 14,88 s. Whisper ubicó palabras de esa frase hasta 16,16 s y FFmpeg detectó la pausa cerca de 16,22 s. **Beta**. |

Las pistas de cada traducción conservaron la misma cuadrícula de tiempos. El cotejo distingue la fidelidad de texto de la sincronía con el audio. La opción de sincronía precisa mejoró algunos segmentos y dejó otros por encima del umbral, por lo que el ensayo se mantuvo aislado. Evidencia local en `%LOCALAPPDATA%\LinguistVision\validation\lv004-trades-20261108` y sus carpetas hermanas `lv004-trades-results-*` y `lv004-trades-precise-*`. [Referencia de carpintería](https://commons.wikimedia.org/wiki/TimedText:A_construction_framer_talks_about_protecting_his_crew_from_falls.webm.en.srt) · [Video oficial de OSHA](https://www.youtube.com/watch?v=Nd9RWLvcpUE) · [Transcripción de OSHA](https://www.osha.gov/vtools/construction/scaffolding-fnl-spa-web-transcript) · [Faster Whisper](https://github.com/SYSTRAN/faster-whisper)

### Ajuste local del final de los subtítulos

La candidata privada compara el final del texto original con marcas de palabra de Faster Whisper, ejecutado en la PC. Solo amplía un segmento si encuentra una coincidencia única que empieza dentro del intervalo, la diferencia supera 0,50 s y la ampliación es de hasta 1,60 s. Conserva los inicios, textos y segmentos siguientes. Las dos pistas se generan a partir del mismo tiempo final.

Se repitieron ocho trabajos HTTP con el audio original y las respuestas de Gemini guardadas. Se volvieron a descargar los SRT y se cotejaron con los proyectos.

| Caso | Fin anterior | Fin ajustado | Diferencia frente a la referencia |
|---|---:|---:|---:|
| Español → inglés, andamios | 9,38 s | 10,58 s | 0,15 s |
| Español → inglés, andamios con opción precisa de Gemini | 9,49 s | 10,58 s | 0,15 s |
| Vietnamita espontáneo | 14,88 s | 16,16 s | 0,06 s |

Los cinco controles conservaron sus finales. Incluyen dos clips de inglés → español, el clip español de revestimiento y dos pruebas cortas de ambos sentidos. En carpintería, el cotejo de palabras ubica el fin de la voz cerca de 20,30 s, frente a los 20,36 s del SRT normal. La medición anterior de 21,26 s marcaba el fin de la señal de audio y no el de la última palabra.

Se repitieron además los clips de andamios y carpintería con dos respuestas nuevas de Gemini. Las pistas descargadas quedaron en 10,58 s y 20,30 s en los finales evaluados. La lectura local añadió entre 3,73 y 5,06 s en esta PC. Gemini estimado **US$0,00852525**, cargo facturado pendiente. Evidencia local en `lv004-sync-live-XWK6Mp`. [Tarifa de Gemini](https://ai.google.dev/gemini-api/docs/pricing/)

La corrección queda habilitada solo con configuración expresa en la candidata. Si falta una coincidencia o la lectura local del audio falla, se conservan los tiempos de Gemini. Los pares siguen en Beta hasta ampliar la validación con clips nuevos, audio desplazado, voces superpuestas y grabaciones con varias pistas, además de revisar el nombre propio pendiente en inglés. Evidencia local en `%LOCALAPPDATA%\LinguistVision\validation\lv004-sync-http-jWSLOP`. [Configuración de la candidata](../DEPLOYMENT.md#ensayo-privado-de-sincronía).

### MP4 con el índice al final

El lector mantiene la entrada por pipe como primera opción. Si la lectura falla, permite un reintento con acceso directo a una copia de hasta 1 MiB dentro del mismo plazo. FFmpeg conserva bloqueadas las referencias externas. La copia se elimina tras el cierre de FFmpeg incluso al cancelar. La terminación forzada del proceso puede interrumpir la limpieza.

El mismo clip de andamios, con su índice al comienzo y al final, produjo 62 marcas de palabra idénticas. El MP4 con índice al final reprodujo el fallo por pipe. El reintento entregó en ambas pistas el fin corregido de 10,58 s, a 0,15 s de la referencia. Nueve repeticiones por HTTP con respuestas de Gemini guardadas confirmaron los finales corregidos y los cinco controles. Se comprobó el borrado de la copia en la salida normal y al cancelar después de observar su creación. Evidencia en `%LOCALAPPDATA%\LinguistVision\validation\lv004-seekable-20261109` y `lv004-seekable-http-pyySsK`.

### Matriz de audio y grabación móvil

El 9 de noviembre se probaron el lector local y el adaptador con respuestas de Gemini guardadas y tiempos de entrada controlados. Se volvieron a leer los SRT original y traducido para comprobar que conservaran el texto y compartieran el mismo intervalo.

| Caso | Resultado |
| --- | --- |
| Control de obra | El final pasó de 9,38 s a 10,58 s. Diferencia de 0,15 s frente a la referencia de 10,73 s. |
| Una pista desplazada 1,20 s | El final pasó de 10,58 s a 11,78 s. Diferencia de 0,15 s frente a la referencia desplazada de 11,93 s. |
| Voces superpuestas | El ajuste conservó 9,38 s. El final sigue adelantado 1,35 s y supera el límite de 0,50 s. |
| Dos pistas, con la segunda como predeterminada | La versión anterior extendió por error un final de 10,58 s a 11,78 s usando la primera pista. La candidata omite el ajuste local y conserva 10,58 s en ambos SRT. Queda comprobar qué pista usa Gemini con archivos nuevos. |
| Grabación de teléfono | Un clip público grabado con Google Pixel 8 Pro se convirtió a MP4 para caber en el piloto. La inspección y la lectura de audio local funcionaron con 24 s y 562.188 bytes. La muestra se usó para compatibilidad, sin referencia anotada de voz. [Martin Vasco, CC BY-SA 4.0](https://commons.wikimedia.org/wiki/File:Encendido_del_letrero_del_Teatro_de_la_Casa_de_la_Cultura_N%C3%BAcleo_del_Azuay.webm). |

Evidencia local en `%LOCALAPPDATA%\LinguistVision\validation\lv004-audio-matrix-20261109`. Los pares siguen en beta. Queda cotejar clips nativos del teléfono y nuevas muestras con voces superpuestas en ambos sentidos. Coste externo nuevo **US$0**.

### Segunda lectura con voces superpuestas y selección de pista

La lectura del clip completo omitió las últimas palabras al superponer dos voces. En archivos de una pista, la candidata permite hasta dos reintentos locales dentro del plazo total de 30 s. Lee un tramo corto solo si detecta la primera palabra del final esperado cerca del corte y falta la secuencia completa. Extiende el subtítulo si reaparecen las cinco palabras exactas en una sola coincidencia y el nuevo final respeta el máximo de 1,60 s de extensión, el siguiente segmento y la duración del clip.

| Entrada de prueba | Final antes | Final corregido | Diferencia frente a 10,73 s |
| --- | ---: | ---: | ---: |
| Mezcla de voces con el intervalo anterior | 9,38 s | 10,56 s | 0,17 s |
| Misma mezcla con una respuesta nueva de Gemini | 9,10 s | 10,48 s | 0,25 s |

Nueve recorridos HTTP con respuestas guardadas completaron el procesamiento y la descarga. En la mezcla, los dos SRT comparten intervalos y conservan el texto y los tiempos de los otros dos segmentos. Cinco controles conservaron sus tiempos. La candidata pasó 69 pruebas con PostgreSQL, tipos y compilación. Esta prueba cubre la mezcla de obra español → inglés y mantiene en beta la cobertura de otras mezclas y del sentido inverso. Descargas de prueba en `%LOCALAPPDATA%\LinguistVision\validation\lv004-sync-http-JpDAFx`.

Para identificar la pista se enviaron a `gemini-3.8-flash` dos MP4 sintéticos con las mismas dos frases, cambiando únicamente qué pista era predeterminada. FFprobe confirmó las marcas y Gemini transcribió en ambas solicitudes la frase de la primera pista, la de la escalera morada. El resultado se limita a los MP4 y el modelo probados. Se mantiene la protección que omite el ajuste local con varias pistas.

Las tres solicitudes nuevas reportaron 3.950 tokens de entrada y 4.122 de salida, incluido razonamiento. Estimación Standard **US$0,01842**, factura por confirmar. No hubo consultas nuevas a los revisores. Evidencia en `%LOCALAPPDATA%\LinguistVision\validation\lv004-overlap-20261109`. [Tarifa de Gemini](https://ai.google.dev/gemini-api/docs/pricing?sid=4323e669-367d-4e2f-b0be-2b51d68ae70f#gemini-3.8-flash).

### Cotejo de cuatro mezclas nuevas

Se prepararon cuatro mezclas de una pista, dos por sentido. Se combinaron voces humanas de obra con una voz secundaria humana o sintética en el mismo idioma o en el otro. El cotejo se centró en la voz principal de cada mezcla. La referencia provino de la voz principal aislada, con marcas de palabra de Faster Whisper local y bordes de voz contrastados con FFmpeg. En las cuatro ejecuciones nuevas de Gemini 3.8 Flash se abrió el proyecto y se descargaron y leyeron los dos SRT. Las pistas tienen los mismos intervalos en los 12 segmentos y el ajuste local conservó los tiempos de Gemini. [Grabación en inglés de NIOSH](https://commons.wikimedia.org/wiki/File:A_construction_framer_talks_about_protecting_his_crew_from_falls.webm) · [Material en español de OSHA](https://www.osha.gov/vtools/construction/scaffolding-fnl-spa-web-transcript).

| Dirección y mezcla | Segmentos | Diferencia máxima de inicio o fin | Resultado con 0,50 s |
| --- | ---: | ---: | --- |
| Inglés → español, segunda voz en inglés | 2 | 0,30–0,68 s | Inconcluso. El final de la última palabra no se separó con precisión del ruido. |
| Inglés → español, segunda voz en español | 4 | 0,98 s | Falla. La frontera entre los segmentos 2 y 3 quedó a 8,00 s frente a 8,98 s. |
| Español → inglés, segunda voz en español | 3 | 0,36 s | Pasa en esta muestra. |
| Español → inglés, segunda voz en inglés | 3 | 0,38 s | Pasa en esta muestra. |

La mezcla inglés → español con fallo temporal conservó «puntos de anclaje», pero tradujo *trusses* como «vigas». En la otra mezcla de esa dirección se conservaron los seis pies. La mezcla española de revestimiento conservó los casi veinte pies. El ajuste actual evita extender un final sobre el segmento siguiente. En el fallo de carpintería, ambos segmentos comparten una frontera adelantada y corregirla requiere cotejar también el inicio del siguiente. Ambos pares siguen en beta.

El cotejo nativo queda pendiente hasta contar con los archivos originales de cámara con voz autorizada. La muestra pública del Pixel 8 Pro se probó anteriormente convertida. El archivo publicado es WebM de 122,2 MiB y queda fuera del MP4 de hasta 1 MiB del piloto. [Ficha de la muestra del Pixel](https://commons.wikimedia.org/wiki/File:Encendido_del_letrero_del_Teatro_de_la_Casa_de_la_Cultura_N%C3%BAcleo_del_Azuay.webm).

Las cuatro solicitudes reportaron 6.254 tokens de entrada y 1.811 de salida, incluido razonamiento. Estimación Standard **US$0,01148175**, factura por confirmar. Sin consultas a revisores en esta tanda. Mezclas y referencias en `%LOCALAPPDATA%\LinguistVision\validation\lv004-independent-20261109`. Ocho SRT, respuesta de Gemini y matriz por segmento en `%LOCALAPPDATA%\LinguistVision\validation\lv004-independent-http-Ltu4a2`. [Tarifa de Gemini](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-flash).

### Recepción de los clips nativos en inglés y español

Se recibieron dos originales MP4 de cámara con video HEVC de 1920 × 1080 y audio AAC estéreo. El clip en inglés dura 6,67 s y pesa 16.872.085 bytes. El clip en español dura 4,97 s y pesa 12.525.828 bytes. Ambos superan el límite de 1 MiB del piloto.

Se prepararon copias locales H.264 de 326.501 y 239.797 bytes. FFmpeg confirmó que cada copia conserva el mismo hash de audio que su original. La referencia de palabras se obtuvo localmente de los originales.

Con autorización del propietario, se procesaron las dos copias con Gemini 3.8 Flash por el piloto local. Se abrieron los proyectos y se cotejaron los cuatro SRT descargados. Las pistas original y traducida tienen los mismos tiempos en los tres segmentos. La comprobación de los extremos usó coincidencias del texto original con las palabras de referencia, sin publicar el contenido de los clips.

| Dirección | Segmento | Referencia | Ambos SRT | Desviación máxima |
| --- | ---: | --- | --- | ---: |
| Inglés → español | 1 | 0,00–3,90 s | 0,00–3,84 s | 0,06 s |
| Inglés → español | 2 | 3,90–6,60 s | 3,84–6,10 s | 0,50 s |
| Español → inglés | 1 | 0,00–4,84 s | 0,00–4,937 s | 0,097 s |

El clip español pasó con margen. El inglés quedó justo en el límite medido y conviene repetirlo con una pausa final más larga, porque la grabación termina cerca de la última palabra. Los resultados corresponden a las copias con el audio de cámara intacto. La aceptación directa de los originales sigue limitada por el tamaño y ambos pares siguen en beta por la frontera de la mezcla inglesa de carpintería.

Evidencia privada en `%LOCALAPPDATA%\LinguistVision\validation\lv004-native-http-v5eaPK`. Gemini reportó 1.612 tokens de entrada y 508 de salida, incluido razonamiento. Coste Standard estimado **US$0,003114**, factura por confirmar. [Tarifa de Gemini](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-flash).

### Corrección de una frontera compartida

La candidata puede retrasar el final de un segmento y el inicio del siguiente cuando comparten un corte adelantado. El lector local debe encontrar coincidencias únicas a ambos lados, con las palabras en orden y sin solapamiento. La separación de voz entre las coincidencias puede ser de hasta 0,25 s. El movimiento se limita a 1,60 s y conserva una duración mínima para el segmento siguiente. La búsqueda admite una variación interior de artículo inglés en el inicio de la segunda frase. Si las cinco palabras finales son demasiado cortas, exige una sexta palabra exacta.

| Respuesta de Gemini para la mezcla de carpintería | Tiempos corregidos en ambos SRT | Desviación máxima tras el ajuste |
| --- | --- | ---: |
| Respuesta que reprodujo el fallo de 0,98 s | Corte entre segmentos 2 y 3 de 8,00 s a 8,98 s | 0,45 s |
| Solicitud nueva con otra segmentación | Cortes de 2,50 a 3,10 s, de 5,90 a 6,86 s y de 9,90 a 11,18 s. Fin de 14,80 a 15,32 s. | 0,45 s |

Se repitió la solicitud nueva guardada con la candidata final para comparar el mismo texto y la misma segmentación. En ambas respuestas, la mayor diferencia restante fue el inicio del primer segmento. La mezcla inglés → español con segunda voz en inglés conserva su final inconcluso. Sigue pendiente el cotejo bilingüe de términos de obra. La solicitud nueva volvió a traducir *trusses* como «vigas».

La candidata pasó 72 pruebas con PostgreSQL, tipos y compilación. Completó 16 recorridos HTTP con respuestas guardadas y comprobó texto, tiempos comunes y descargas. Nueve controles conservaron sus intervalos, incluidos los dos clips de cámara. El clip de carpintería sin mezcla también corrigió una frontera de 9,44 a 10,16 s, donde empieza la siguiente frase en la referencia. Descargas en `%LOCALAPPDATA%\LinguistVision\validation\lv004-boundary-http-SFtDER`.

La solicitud nueva reportó 1.675 tokens de entrada y 542 de salida, incluido razonamiento. Coste Standard estimado **US$0,00328875**, factura por confirmar. No se hicieron consultas nuevas a revisores. Evidencia privada de la solicitud en `%LOCALAPPDATA%\LinguistVision\validation\lv004-boundary-live-08wxcs`. [Tarifa de Gemini](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-flash).

### Repetición de la mezcla inglesa y terminología de obra

Se repitió la mezcla con dos voces en inglés. En la respuesta nueva sin glosario, el último segmento terminó a 9,10 s. Su distancia máxima a la ventana estimada de la última palabra (8,82–9,209 s) fue 0,28 s. El mayor desvío del clip fue 0,46 s al inicio del último segmento. El cotejo pasa incluso con esa incertidumbre de final.

La candidata añade contexto solo a la traducción inglés → español del piloto. En obra estructural, usa «cercha» para *truss*, «viga» para *beam* y «punto de anclaje» para *anchor point*, conservando valores y unidades. La guía bilingüe de OSHA también usa «armadura de techo» para *roof truss*. [Guía en español](https://www.osha.gov/residential-fall-protection/guidance-sp) · [Guía en inglés](https://www.osha.gov/residential-fall-protection/guidance).

| Solicitud nueva con la indicación | Cotejo del texto | Cotejo del tiempo |
| --- | --- | --- |
| Carpintería con segunda voz en español | *Trusses* salió como «cerchas» y se conservaron los puntos de anclaje. | El final quedó a 14,88 s frente a la referencia de 15,47 s. Desvío de 0,59 s. |
| Mezcla inglesa con segunda voz en inglés | Conservó los seis pies, la protección contra caídas y el andamio. | El final quedó a 9,40 s. Su distancia a la ventana de referencia va de 0,19 a 0,58 s. Inconcluso. |
| Control sintético con *beams* y *roof trusses* | Distinguió «dos vigas de acero» de «cerchas de techo» y conservó el punto de anclaje y seis pies. | Control de terminología con tiempos idénticos entre pistas. |

Se abrieron los cuatro proyectos, se cotejaron los ocho SRT y sus intervalos coincidieron por pista. Pasaron 72 pruebas con PostgreSQL, tipos y compilación. Se conserva la mejora terminológica en la candidata. El resultado de sincronía varió entre solicitudes y los pares siguen en beta.

DeepSeek V4.1 Flash y Kimi K3.1 Pro revisaron en paralelo por T3 con la instancia OpenRouter de LinguistVision. DeepSeek propuso una indicación contextual y un control con vigas reales. Kimi pidió medir contra el audio independiente y dejar inconcluso un borde cuya incertidumbre cruza el umbral. OpenCode registró **US$0,002295276** y **US$0,068292** respectivamente, total **US$0,070587276**. Las cuatro solicitudes de Gemini reportaron 5.008 tokens de entrada y 1.777 de salida, incluido razonamiento. Coste Standard estimado **US$0,01041975**, facturas por conciliar. Evidencia en `%LOCALAPPDATA%\LinguistVision\validation\lv004-terms-20261109`, `lv004-terms-base-REoh9S` y `lv004-terms-candidate-KO9MFC`. [Tarifa de Gemini](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-flash).

### Estabilización del último segmento inglés

La candidata conserva la indicación terminológica. Para el último segmento de inglés → español, coteja el final con la lectura local de palabras. Prefiere una coincidencia exacta. Cuando los reconocedores difieren en palabras funcionales inglesas, solo acepta una secuencia única de tres palabras de contenido que llega al final de la referencia local. Conserva el texto y aplica un margen de 0,20 s, acotado por la duración del clip. Ignora cambios de hasta 0,25 s y limita los recortes a 0,50 s. Este ajuste solo modifica el final del último segmento.

| Mezcla | Final previo → corregido al repetir la respuesta anterior | Final con solicitud nueva | Error máximo del clip con la solicitud nueva |
| --- | --- | --- | --- |
| Carpintería, segunda voz en español | 14,88 → 15,52 s | 15,52 s, a 0,05 s de la referencia | 0,50 s |
| Obra, segunda voz en inglés | 9,40 → 9,02 s | 9,02 s, a un máximo de 0,20 s dentro de la ventana de referencia | 0,36 s |

Se cotejaron inicios y finales en los dos SRT de cada mezcla. Las respuestas anteriores repetidas también quedaron dentro de 0,50 s. La solicitud nueva conservó «cerchas» en carpintería y «seis pies» en la mezcla inglesa. El control mantuvo «vigas de acero», «cerchas de techo», «punto de anclaje» y «seis pies». Nueve recorridos de descarga con respuestas guardadas comprobaron los tiempos y el texto de ambos SRT. Los controles español → inglés y el control sintético conservaron sus tiempos. En la repetición privada del clip de cámara inglés, el final pasó de 6,10 a 6,667 s, a 0,067 s de la referencia. Pasaron 74 pruebas con PostgreSQL, tipos y compilación. Los dos pares siguen en beta mientras se amplía la muestra. El clip de carpintería quedó justo en el límite por un corte interior.

T3 coordinó la revisión en paralelo con OpenRouter de LinguistVision. DeepSeek propuso separar el umbral de aceptación de la corrección local. Kimi señaló el riesgo de recortar una palabra que el lector local hubiera omitido. Se mantuvo la coincidencia obligatoria y se limitó el recorte. OpenCode registró **US$0,002587434** para DeepSeek V4.1 Flash y **US$0,0944264** para Kimi K3.1 Pro. Las tres solicitudes nuevas a Gemini reportaron 3.866 tokens de entrada y 1.486 de salida, incluido razonamiento. Coste Standard estimado **US$0,008472**. Facturas por conciliar. Evidencia en `%LOCALAPPDATA%\LinguistVision\validation\lv004-tail-20261109`, `lv004-tail-live-tImbQ0` y `lv004-tail-http-XQKVGP`. [Tarifa de Gemini](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-flash).

### Voces nuevas de obra en ambos sentidos

Se fijaron antes de llamar a Gemini las referencias de dos extractos humanos de NIOSH y dos controles sintéticos. Los extractos cubren voz espontánea en inglés y español. Los controles cubren piezas y medidas que los extractos humanos no incluyen. Se abrieron cuatro proyectos, se descargaron ocho SRT y se cotejaron los 13 segmentos. Los intervalos original y traducido coincidieron en todos los segmentos. El límite de diferencia frente al audio fue de 0,50 s.

| Muestra | Dirección | Cotejo del contenido | Desviación y resultado |
| --- | --- | --- | --- |
| Relato sobre una caída durante el desmontaje de un techo | Inglés → español | Conservó el techo y el sistema de detención de caídas. | 0,60 s de máximo en la referencia inicial. Una lectura corta confirmó al menos 0,56 s de retraso al cerrar una frase. Falla. |
| Techador de Arizona | Español → inglés | Conservó cinco o siete años, cuatro años y diez años. El nombre transcrito difiere del nombre de la ficha de NIOSH. | Inicio de «cinco» estimado a 5,74 s y SRT a 7,56 s. Una segunda lectura situó el fin de la palabra antes de 6,72 s, al menos 0,84 s antes del subtítulo. Falla. |
| Control de cerchas y viga de acero, medidas imperiales | Inglés → español | Conservó «cerchas» y «viga de acero», 24 pulgadas entre centros y 12 pies y 6 pulgadas. | 0,743 s. El último SRT termina a 7,60 s y la voz a 6,857 s. Falla. |
| Control de cerchas y viga de acero, medidas métricas | Español → inglés | Distinguió *roof trusses* de *steel beam* y conservó 60 cm entre ejes y 3,5 m. | 0,277 s de máximo. Pasa. |

El resultado confirma la terminología y las medidas en los dos controles, con fallos de sincronía en ambas direcciones con voz humana. Los pares siguen en beta. El próximo cotejo debe cubrir bordes interiores alrededor de pausas y finales que sobran más de 0,50 s, preservando los casos alineados. [Voz inglesa de NIOSH](https://commons.wikimedia.org/wiki/File:Fall_protection_allows_his_men_to_go_home_at_the_end_of_the_day.webm) · [Voz española de NIOSH](https://commons.wikimedia.org/wiki/File:Trabajador_de_la_construcci%C3%B3n_se_protege_de_las_ca%C3%ADdas_de_techo.webm).

Cuatro solicitudes nuevas a Gemini 3.8 Flash reportaron 5.833 tokens de entrada y 2.099 de salida, incluido razonamiento. Coste Standard estimado **US$0,012246**, factura por confirmar. No se hicieron consultas nuevas a revisores. Referencias en `%LOCALAPPDATA%\LinguistVision\validation\lv004-newvoices-20261109` y SRT y matriz de cotejo en `lv004-newvoices-http-r0Ah5c`. [Tarifa de Gemini](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-flash).

### Cortes interiores y final tardío

En inglés ↔ español, la candidata puede realinear inicios interiores y acortar finales interiores cuando la lectura local aporta una coincidencia única cercana. El cotejo normaliza algunos números españoles únicamente para comparar palabras. Los ajustes se descartan si generan solapamientos o invalidan la duración. Para acortar un final inglés entre 0,50 y 1,00 s, se exige que dos lecturas locales encuentren la misma terminación exacta. La combinación escrita `ft` e `in` también se interpreta al buscar esa coincidencia. Los dos SRT conservan su texto y sus unidades.

| Muestra | Respuesta anterior repetida con la candidata | Nueva respuesta de Gemini, repetida con la candidata final |
| --- | --- | --- |
| Voz humana inglesa | Cierres 11,80 → 11,20 s y 14,80 → 14,20 s. Máximo 0,48 s. | Cierre de la primera frase 3,40 → 2,28 s. Máximo estimado 0,40 s. |
| Voz humana española | El inicio de «cinco» pasó de 7,56 a 5,76 s frente a una referencia de 5,74 s. El cierre de la frase anterior pasó de 7,42 a 5,76 s. También se ajustaron los bordes posteriores a 9,26 y 10,46 s. | Cierre antes de la pausa 9,77 → 9,26 s. El final de la presentación a 2,75 s queda inconcluso porque los reconocedores discrepan sobre el nombre y su último borde. |
| Control inglés | Final 7,60 → 6,92 s, a 0,063 s del borde acústico. | Final 7,64 → 6,92 s. El inicio quedó a 0,518 s de la voz y sigue fuera del límite. |
| Control español | Conservó los tiempos, máximo 0,277 s. | Máximo 0,327 s. |

En los controles se conservaron la distinción entre cerchas y vigas, 24 pulgadas entre centros, 12 pies y 6 pulgadas, 60 cm y 3,5 m. Pasaron 77 pruebas con PostgreSQL, la comprobación de tipos y la compilación. Los 14 recorridos de descarga con respuestas guardadas comprobaron que se conserva el texto en las dos pistas y que sus intervalos coinciden. Los siete controles anteriores conservaron sus tiempos. Descargas y comparaciones en `%LOCALAPPDATA%\LinguistVision\validation\lv004-interior-replay-YFWVWX`. Los pares siguen en beta.

T3 coordinó las consultas en paralelo con OpenRouter de LinguistVision. Kimi recomendó una segunda evidencia antes de acortar el final y rechazar solapamientos. DeepSeek pidió los fragmentos de código y revisó las salvaguardas en una segunda consulta. OpenCode registró **US$0,002118975** y **US$0,002199774** en las dos consultas a DeepSeek V4.1 Flash y **US$0,1010136** en la consulta a Kimi K3.1 Pro. Las cuatro solicitudes nuevas a Gemini reportaron 5.833 tokens de entrada y 1.878 de salida, incluido razonamiento. Coste Standard estimado **US$0,01141725**. Facturas por conciliar. Evidencia en `%LOCALAPPDATA%\LinguistVision\validation\lv004-interior-20261109` y `lv004-interior-live-KNx44q`. [Tarifa de Gemini](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-flash).

### Prueba fija con voces reservadas

El control inglés tenía silencio inicial hasta 0,512–0,526 s según tres umbrales acústicos. El lector local ahora puede refinar la primera marca cuando detecta silencio limpio seguido de un inicio sostenido. La candidata mueve el primer subtítulo solo si su comienzo coincide de forma única con las primeras palabras reconocidas. Con la misma respuesta guardada, el inicio pasó de 0,00 a 0,51 s y el final se mantuvo en 6,92 s. El peor desvío de los dos SRT del control fue 0,257 s. Se conservaron cerchas, vigas y las medidas imperiales y métricas en los controles.

En la presentación española, la ficha de NIOSH identifica al hablante como Osvi Arrizon. El SRT guardado transcribe «Osby Harrison», una diferencia de fidelidad independiente del tiempo. El fin del nombre en el audio se estima entre 2,02 y 2,30 s, con voz débil y ruido de fondo. El fin del SRT, 2,75 s, queda a entre 0,45 y 0,73 s de esa ventana. Se deja inconcluso y se conserva el borde. [Ficha de NIOSH](https://commons.wikimedia.org/wiki/File:Trabajador_de_la_construcci%C3%B3n_se_protege_de_las_ca%C3%ADdas_de_techo.webm).

Se congelaron los hashes de los clips y sus referencias de audio antes de enviar dos solicitudes nuevas. El clip en español es una grabación distinta de un hablante que ya se había usado en inglés. Se abrieron dos proyectos y se cotejaron los cuatro SRT. Los diez segmentos compartieron tiempos entre original y traducción.

| Clip reservado | Peor borde de inicio o fin | Resultado |
| --- | --- | --- |
| Inglés → español, responsable de carpintería residencial | 0,54 s confirmado en el inicio del segmento 2. El siguiente inicio se estima en 0,68 s, con incertidumbre por una muletilla. El final del segmento 5 queda sin correspondencia léxica fiable. | Falla. Conservó «cercha» y cuatro horas. |
| Español → inglés, capacitación de techadores | 0,47 s en el inicio del primer segmento. | Pasa en este clip. Conservó capacitación y equipo de protección. |

Los dos pares siguen en beta. El clip reservado inglés volvió a fallar con palabras omitidas o repetidas entre frases y una pausa que los segmentos no reflejan. La candidata conserva las correcciones reproducidas. DeepSeek propuso una alineación monotónica de la secuencia completa de palabras. Kimi pidió medir la confianza de cada borde y conservar el tiempo original cuando hay varias correspondencias plausibles. El código actual ya rechaza solapamientos. El fallo reproducido está en las correspondencias de palabras, por lo que el siguiente ensayo comparará ambos métodos sobre el mismo conjunto congelado y otra muestra reservada. Criterios del ensayo: peor desvío por borde, tiempos idénticos en los dos SRT, texto intacto y conservación de los controles ya alineados.

Pasaron 78 pruebas con PostgreSQL, tipos y compilación. Los 14 recorridos con respuestas guardadas conservaron los textos y los intervalos comunes, incluidos los controles anteriores. Referencias en `%LOCALAPPDATA%\LinguistVision\validation\lv004-fixed-20261109`, descargas de repetición en `lv004-fixed-replay-jNT6aP` y resultados reservados en `lv004-fixed-holdout-59FKDK`. [Fuente inglesa de NIOSH](https://commons.wikimedia.org/wiki/File:The_owner_of_a_residential_framing_company_designs_safety_into_each_of_his_job_sites.webm) · [Fuente española de NIOSH](https://commons.wikimedia.org/wiki/File:Las_Ca%C3%ADdas_Cuestan;_La_Historia_de_un_%E2%80%9CSafety_Man%E2%80%9D.webm).

T3 coordinó dos revisiones paralelas con OpenRouter de LinguistVision. OpenCode registró **US$0,003121944** para DeepSeek V4.1 Flash y **US$0,0758004** para Kimi K3.1 Pro. Las dos solicitudes de Gemini reportaron 3.767 tokens de entrada y 1.219 de salida, incluido razonamiento. Coste Standard estimado **US$0,0073965**. Facturas por conciliar. [Tarifa de Gemini](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-flash).

### Comparación del prototipo de secuencia completa

El prototipo alinea todas las palabras de los subtítulos con la lectura local en su orden global. Un borde solo puede cambiar si los caminos de coste similar coinciden en una palabra y hay apoyo de palabras vecinas. Los bordes ambiguos, sin evidencia o en conflicto conservan el tiempo de Gemini. Se rechazan los cambios que generen solapamientos. El prototipo vive en `server/commercial/pilotSequenceAlignment.ts` y queda aislado del adaptador del piloto.

Se compararon los 14 recorridos fijos, dos clips reservados anteriores y un testimonio nuevo de NIOSH. Para cada caso se reutilizó la misma respuesta de Gemini entre ambos métodos. El clip nuevo y la referencia se congelaron antes de la única solicitud nueva. En los 17 casos, el original y la traducción conservaron el texto y compartieron intervalos. Los casos sin referencia fiable en algún borde se registraron como inconclusos, salvo cuando otro borde ya demostraba un fallo.

| Método | Pasan 0,50 s | Fallan | Inconclusos |
| --- | ---: | ---: | ---: |
| Candidata | 13 | 1 | 3 |
| Prototipo | 12 | 3 | 2 |

El prototipo mejoró la mezcla de carpintería inglés → español de 0,50 a 0,15 s. El corte confirmado del clip reservado inglés permaneció a 0,54 s en ambos métodos. La mezcla inglesa con segunda voz inglesa pasó de 0,36 a 0,82 s cuando la marca local asignó demasiado tiempo a una palabra corta. En el clip humano español anterior, un conflicto conservó el inicio original de 7,56 s y reapareció el desvío de 1,82 s que la candidata había corregido. En el clip nuevo se conservaron 35 años y 21 pies. Cuatro bordes se pudieron puntuar y coincidieron con la referencia en el prototipo, frente a un máximo de 0,44 s con la candidata. Otros cuatro quedaron inconclusos por discrepancias de palabras en los extremos.

Se conserva la candidata del piloto. Una correspondencia léxica única no garantiza que el lector local haya fechado con precisión esa palabra. Para otra comparación, medir la confianza acústica del borde y comprobar por separado la política de respaldo cuando la candidata ya tiene un ajuste válido. Los pares siguen en beta.

Pasaron 82 pruebas, tipos y compilación. Se contrastaron 961 pares cortos con un enumerador independiente de caminos, incluida la transición de borrado que señaló DeepSeek. Kimi destacó los límites del desplazamiento y la necesidad de un cotejo por borde. T3 coordinó ambos en paralelo por OpenRouter de LinguistVision. OpenCode registró **US$0,002849916** para DeepSeek V4.1 Flash y **US$0,1349436** para Kimi K3.1 Pro. La solicitud de Gemini reportó 1.988 tokens de entrada y 585 de salida, incluido razonamiento. Estimación Standard **US$0,00368475**. Facturas por conciliar. Referencia congelada, scripts, SRT y matriz en `%LOCALAPPDATA%\LinguistVision\validation\lv004-sequence-20261109`. [Fuente del clip nuevo de NIOSH](https://commons.wikimedia.org/wiki/File:Take_Pride_in_Your_Job_-_Fall_Protection.webm) · [Tarifa de Gemini](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-flash).

### Comparación del híbrido con respaldo de la candidata

El híbrido de prueba conserva los tiempos de la candidata salvo cuando la alineación global identifica una correspondencia léxica inequívoca y el audio muestra una transición sostenida de energía junto al borde propuesto. Aplica cambios de más de 0,10 s y hasta 0,75 s, con una tolerancia de 40 ms para detectar la transición. Si el conjunto propuesto produce solapamientos o intervalos inválidos, se conservan los tiempos de la candidata.

Se repitieron los mismos 17 casos con las respuestas guardadas y las referencias congeladas. Se regeneraron 34 SRT y se comprobó que ambas pistas conservaran sus textos, incluidas las medidas y la distinción entre cerchas y vigas donde ya constaba. Las dos pistas de cada caso tienen intervalos idénticos.

| Método | Pasan 0,50 s | Fallan | Inconclusos |
| --- | ---: | ---: | ---: |
| Candidata | 13 | 1 | 3 |
| Híbrido | 13 | 1 | 3 |

El híbrido cambió 15 bordes en siete casos. Evitó los dos fallos adicionales del prototipo global. La mezcla inglesa con segunda voz inglesa quedó en 0,389 s frente a 0,36 s con la candidata. El clip humano español mantuvo el máximo medible de 0,47 s y un borde inconcluso. En el clip reservado inglés, el inicio del segundo segmento quedó en 3,24 s frente a la referencia de 3,78 s. La coincidencia ambigua conservó ese tiempo y ambos SRT siguen 0,54 s adelantados. La transición de energía por sí sola no identifica qué voz pronunció la palabra.

El híbrido queda aislado y ambos pares siguen en beta. El próximo ensayo debe resolver la atribución de voz en el borde inglés y contrastar los bordes inconclusos con referencias independientes. Pasaron 85 pruebas con PostgreSQL, la comprobación de tipos y ambas compilaciones en Node 24.13.0. Scripts, matriz por borde y 34 SRT en `%LOCALAPPDATA%\LinguistVision\validation\lv004-hybrid-20261109`. Cero solicitudes nuevas a Gemini y cero consultas externas. Coste de esta ronda **US$0**.

### Cotejo acústico de los cuatro casos abiertos

Se reabrió el audio guardado de los cuatro casos con una lectura local por ventanas y mediciones de energía y periodicidad. Las dos respuestas del clip español usan la misma grabación. La lectura por ventanas reutiliza el mismo reconocedor local, por lo que sirve para detectar marcas inestables y requiere corroboración cuando discrepa.

| Caso | Evidencia nueva | Decisión |
| --- | --- | --- |
| Inglés reservado | El tramo fuerte empieza entre 3,76 y 3,80 s y tiene voz periódica desde 3,82 s. Hay una señal débil entre 3,22 y 3,28 s. La lectura completa marca un solo «the» a 3,80 s, cerca de la referencia de 3,78 s. Las lecturas recortadas asignan marcas distintas al mismo artículo. | Se conserva 3,24 s. La diferencia frente a la referencia fija sigue siendo 0,54 s y la frase con el artículo repetido aún requiere confirmación fonética para cambiar el borde. También siguen abiertos el inicio con la muletilla y el final de «headfirst». |
| Español humano y su segunda respuesta | Las lecturas recortadas terminan el nombre entre 1,99 y 2,02 s y discrepan sobre su escritura. La voz periódica se debilita hacia 2,06 s y queda energía aperiódica hasta la siguiente intervención. Los SRT cierran la presentación a 2,44 y 2,75 s. | Se mantiene inconcluso el final en ambas respuestas. El nombre y la atribución del sonido residual se evalúan por separado. |
| Inglés nuevo | El primer corte dudoso está entre «rig floor» y «bounced once». Las lecturas discrepan al separar esas palabras. En el segundo corte, «so» se alinea alrededor de 12,13–12,37 s, pero la lectura local fusiona el «it» repetido y le asigna un intervalo amplio. | Los cuatro bordes siguen inconclusos. Se conservan los tiempos de ambas pistas. |

La revisión acústica no justificó cambiar el alineador ni los SRT. Se mantiene la matriz anterior de 13 casos dentro de 0,50 s, uno fuera según la referencia fija y tres inconclusos. La repetición completa queda para un ajuste que se pueda justificar con una referencia fonética o una escucha independiente. Scripts y mediciones en `%LOCALAPPDATA%\LinguistVision\validation\lv004-border-audit-20261109`. Coste externo **US$0**.

### Escucha independiente y matriz de voz humana

La hoja local `%LOCALAPPDATA%\LinguistVision\validation\lv004-escucha-20261109\escucha.html` incluye tres recortes para los cuatro casos abiertos y un cuarto recorte para vietnamita espontáneo. Los recortes conservan el reloj de cada video de prueba. Chrome comprobó que carga el audio, permite ajustar el punto de escucha en pasos de 50 ms y exporta las marcas en JSON. La hoja oculta los tiempos del SRT y las referencias previas. Los resultados deben registrarse antes de compararlos con la candidata. Si la palabra o el borde no se pueden atribuir, registrar la duda y conservar el tiempo de la candidata.

La matriz separa la evidencia de voz humana del recorrido básico con voz de prueba. Para verificar una capacidad de transcripción, guardar la procedencia de la muestra, la variante de voz, la referencia independiente, el SRT descargado y abierto, el cotejo de escritura y texto, y la peor diferencia en los bordes que se puedan medir. Aplicar 0,50 s en este cotejo y registrar por separado cualquier borde inconcluso. Si se ofrece MP4, comprobar su reproducción y la escritura en pantalla. Las muestras breves de inglés y español en traducción aportan evidencia sobre el texto de origen, pero se registran como pruebas de esa dirección.

| Idioma | Evidencia disponible | Pendiente para validar transcripción con voz humana |
| --- | --- | --- |
| Inglés de EE. UU. | Transcripción corta del piloto. Voz humana en grabación nativa y obra, con pistas originales descargadas. | Cerrar el borde del recorte A y los cortes del C. Confirmar el recorrido monolingüe con voz humana y un SRT cotejado. |
| Español latinoamericano | Transcripción corta del piloto. Voz humana en grabación nativa y obra, con pistas originales descargadas. | Cerrar el borde del recorte B. Confirmar el recorrido monolingüe y documentar la variante de la muestra. |
| Árabe | Saludos en transcripción y traducción de prueba. Se comprobó la visualización de derecha a izquierda. | Muestra humana autorizada de la variante que se evalúe, texto de referencia y cotejo del SRT. |
| Portugués de Brasil | SRT de prueba sintético, 0,121 s. | Voz humana brasileña y cotejo de ortografía, cifras y unidades. |
| Francés | SRT de prueba sintético, 0,464 s. | Voz humana de la variante que se evalúe y cotejo de acentos y segmentación. |
| Alemán | SRT de prueba sintético, 0,287 s. | Voz humana y cotejo de compuestos, mayúsculas y cifras. |
| Japonés | SRT de prueba sintético, 0,313 s. | Voz humana y cotejo de escritura, lectura de números y cortes de frase. |
| Coreano | SRT de prueba sintético, 0,345 s. | Voz humana y cotejo de hangul, espacios y cortes de frase. |
| Mandarín, escritura simplificada | SRT de prueba sintético, 0,243 s. | Voz humana en mandarín y cotejo de caracteres simplificados, números y cortes de frase. |
| Vietnamita | Dos ejecuciones con voz humana leída dentro del umbral. En habla espontánea, el SRT guardado con ajuste cierra a 16,16 s y el tramo siguiente abre a 16,78 s. | Prioridad. El recorte V permite marcar ambos lados de la pausa y contrastar el texto y los diacríticos con una persona que entienda vietnamita. El uso público de esa muestra sigue pendiente de verificar la licencia. |

Evidencia previa de [los siete paquetes](#siete-paquetes-del-lanzamiento-inicial), [muestras cortas del piloto](LV-009-plan-del-editor.md#muestras-con-voz), [clips nativos](#recepción-de-los-clips-nativos-en-inglés-y-español) y [ajuste vietnamita](#ajuste-local-del-final-de-los-subtítulos). El paso siguiente es recoger las marcas independientes y preparar muestras humanas autorizadas donde solo hay controles de voz de prueba. El código, los SRT y las etiquetas de cobertura conservan su estado mientras llega esa evidencia. Coste externo **US$0**.

### Primera devolución de la escucha

Se recibieron las marcas de los cuatro recortes. Ninguna traía una selección de confianza. Se contrastaron con los intervalos de los SRT y la lectura acústica, conservando su condición de observaciones.

| Recorte | Marcas recibidas | Cotejo |
| --- | --- | --- |
| A | 4,000 s | Cae dentro del «the» que el lector local sitúa aproximadamente entre 3,78 y 4,04 s. Apoya que allí se oye el artículo. Sigue abierta la atribución de la señal breve anterior cerca de 3,24 s. |
| B | 1,081 s | Coincide con «nombre» en la lectura local y precede al nombre propio. No se usa como fin de la presentación en ninguno de los dos casos. |
| C | 4,671 / 5,171 s y 12,593 / 13,575 s | La marca de 4,671 s queda cerca del corte actual de 4,640 s. La de 5,171 s cae dentro o después de «once» según la ventana de lectura local. En la segunda transición, la lectura ubica «so» hasta 12,34–12,37 s y asigna un intervalo amplio al «it» repetido. Quedan abiertas las dos fronteras. |
| V | 16,502 / 18,397 s | El final propuesto difiere 0,342 s del SRT ajustado. La segunda marca cae 1,617 s después del inicio de ese subtítulo. Falta confirmar qué palabras corresponden a cada marca con una escucha en vietnamita. |

Las marcas aportan corroboración parcial para A y el primer final de C. Se conservan los tiempos y la matriz de 17 casos hasta resolver la atribución de palabras. Para A, la pregunta que decide el ajuste es si la señal breve previa contiene un primer artículo inteligible. Cero consultas externas y coste **US$0**.

### Comparación del posible primer artículo

Se aisló la señal temprana de 3,12 a 3,52 s y se comparó con el artículo posterior de 3,68 a 4,08 s. El archivo original de la grabación contiene el mismo evento temprano. La correlación de la forma de onda entre original y clip de prueba fue 0,998 en el tramo cotejado.

En ventanas de 40 ms, la señal temprana cerca de 3,24 s fue breve y careció de periodicidad sostenida. La voz posterior muestra una sucesión de ventanas periódicas desde 3,82 s. En los tramos medidos, la señal posterior tuvo aproximadamente 25 dB más de nivel medio. El contraste favorece el comienzo posterior, pero la medición por sí sola deja abierta la identidad del sonido temprano.

Se conservan los tiempos de la candidata hasta distinguir si el sonido temprano contiene un artículo inteligible. Se preparó un comparador local con el contexto, los dos recortes al mismo volumen y una copia amplificada 15 dB del primero. Chrome mostró los cuatro reproductores. La comparación y las mediciones están en `%LOCALAPPDATA%\LinguistVision\validation\lv004-article-20261109`. Cero llamadas a Gemini y coste externo **US$0**.

En el recorte de contexto, la posición marcada visualmente por el usuario cae cerca de 4,04 s del video de prueba. Es una estimación por la posición del control y coincide con su marca anterior de 4,000 s para el artículo posterior. El evento temprano de 3,24 s quedaría unos 0,60 s después del inicio del recorte de contexto. Su identificación sigue pendiente.

### Ajuste del inicio tras la escucha aislada

El usuario escuchó solo ruido en el recorte temprano amplificado. Esa escucha y el inicio de voz sostenida justifican probar el artículo posterior como comienzo del segmento. Se añadió una excepción al híbrido aislado para un «the» repetido en un inicio ambiguo. Exige una sola coincidencia con las dos palabras siguientes, una transición acústica clara y ausencia de energía sostenida en el intervalo previo. La prueba unitaria distingue un ruido breve de una señal sostenida.

Se repitieron los 17 casos con respuestas guardadas y se regeneraron los 34 SRT. Ambas pistas conservaron el texto y tienen los mismos intervalos. Comparado con el híbrido anterior, el único cambio fue el inicio del segundo subtítulo del inglés reservado, de 3,240 a 3,800 s. Su diferencia frente a 3,780 s bajó de 0,540 a 0,020 s. La comprobación del caso completo sigue inconclusa. El primer inicio puede diferir entre 0,43 y 0,53 s y otros dos bordes carecen de referencia fiable.

| Método | Dentro de 0,50 s | Fuera confirmado | Inconclusos |
| --- | ---: | ---: | ---: |
| Híbrido anterior | 13 | 1 | 3 |
| Híbrido con ajuste | 13 | 0 | 4 |

Pasaron 86 pruebas con PostgreSQL, tipos y ambas compilaciones con Node 24.13.0. La candidata activa sigue usando su alineador actual. Ambos pares siguen en beta. Los SRT y la matriz por borde están en `%LOCALAPPDATA%\LinguistVision\validation\lv004-article-replay-20261109\comparison`. Cero llamadas nuevas a Gemini y coste externo **US$0**.

### Muestras humanas preparadas y revisión del primer inicio inglés

Se preparó una grabación humana con texto de referencia por cada uno de los diez idiomas. Las grabaciones pertenecen a la partición de desarrollo de FLEURS. Se emparejaron los WAV con el texto por nombre de archivo y se fijaron las huellas SHA-256 antes de ejecutar la candidata. Los MP4 conservan el audio como pista y añaden una imagen fija. Todos caben en el límite actual de 1 MiB. Los insumos y el manifiesto están en `%LOCALAPPDATA%\LinguistVision\validation\lv004-next-20261109\fleurs`. Los códigos del corpus identifican la muestra de prueba y no fijan variantes comerciales. El habla leída de FLEURS complementa el cotejo pendiente del vietnamita espontáneo. [Ficha y licencia de FLEURS](https://huggingface.co/datasets/google/fleurs) · [Artículo del corpus](https://arxiv.org/abs/2205.12446).

En el clip inglés reservado se midió el primer comienzo, que había quedado con una referencia de 0,43–0,53 s. El original y el recorte muestran voz periódica desde 0,02 s y caída de nivel alrededor de 0,46–0,53 s. Algunas lecturas del recorte atribuyen «and» al bloque temprano, pero al cambiar la ventana la marca se desplaza. La referencia previa puede estar próxima al final de ese bloque. Se conserva el inicio de 0,00 s y se mantiene inconclusa la atribución fonética. Mediciones y recortes en `%LOCALAPPDATA%\LinguistVision\validation\lv004-next-20261109`.

La lectura automática local de FLEURS sirve como comprobación previa y no acredita la salida de LinguistVision. El siguiente paso es pasar los clips congelados por el piloto, descargar y abrir cada SRT y cotejarlo con su referencia. La matriz de 17 casos y las etiquetas comerciales mantienen su estado. No se hicieron solicitudes a Gemini ni revisiones externas. Coste **US$0**.

### Piloto con diez voces humanas de FLEURS

La candidata de prueba ejecutó diez transcripciones monolingües con Gemini 3.8 Flash, desde la carga por HTTP hasta la descarga del SRT. Se abrieron los diez archivos guardados en UTF-8 y se verificó que cada proyecto reabierto por la API del piloto contuviera el mismo borrador. Los intervalos fueron válidos, ordenados y sin solapamientos. Se consumieron diez créditos simulados y quedaron cero reservados. La sesión se ejecutó en loopback con un esquema de PostgreSQL aislado.

Se comparó la escritura con la referencia de FLEURS, ignorando puntuación, espacios y mayúsculas en el recuento de caracteres. Para medir un borde se exigió una coincidencia de texto entre la referencia, el SRT y la lectura local de palabras. Los extremos del clip se contrastaron además con detección local de voz. Si la diferencia de esos métodos cruzaba 0,50 s o faltaba una coincidencia fiable, el borde quedó inconcluso. Solo se convirtió a escritura simplificada el texto del lector local para encontrar marcas de mandarín. El SRT exportado se cotejó directamente con la referencia simplificada.

| Idioma | Texto y escritura | Sincronía respecto a 0,50 s |
| --- | --- | --- |
| Inglés | Conservó el sentido. Contrajo «you are» a «you're». | Inconcluso. El fin puede diferir entre 0,412 y 0,700 s y dos inicios quedan sin referencia fiable. |
| Español | Coincidencia tras normalizar puntuación y mayúsculas. Conservó el nombre y los acentos. | Pasa. Máximo 0,428 s. |
| Árabe | Coincidencia tras normalizar puntuación. Conservó la escritura árabe. | Fuera. El fin del segundo subtítulo quedó aproximadamente 0,68 s tarde. |
| Portugués de Brasil | Conservó texto y acentos salvo una letra en el nombre propio frente a la referencia. | Pasa en tiempos. Máximo 0,256 s. |
| Francés | Coincidencia tras normalizar puntuación. Conservó acentos. | Pasa. Máximo 0,300 s. |
| Alemán | Coincidencia en el texto. Conservó la escritura. | Inconcluso. El inicio carece de acuerdo entre lectura de palabras y detección de voz. |
| Japonés | Coincidencia en el texto. Cambió la puntuación al dividir la frase. | Inconcluso. Tres bordes dentro de 0,230 s y un inicio sin coincidencia fiable. |
| Coreano | Conservó el hangul. Escribió dos millones con cifra y unidad coreana. | Fuera según la marca local del primer final, 0,520 s. Dos inicios quedaron inconclusos. |
| Mandarín | Coincidencia en escritura simplificada. | Inconcluso. Tres bordes dentro de 0,354 s y un final sin coincidencia fiable. |
| Vietnamita | Conservó diacríticos. Omitió una repetición de «phải» presente en la referencia. | Fuera. El primer final quedó 0,820 s tarde y el segundo inicio 0,650 s tarde frente a la lectura local. |

Tres muestras pasan todos los bordes. Tres tienen al menos un desvío medido y cuatro quedan inconclusas. El nombre portugués requiere cotejo independiente aunque sus tiempos pasaron. Las muestras de lectura y sus resultados mantienen el alcance de beta. Sigue pendiente el cotejo de vietnamita espontáneo y los pares de traducción se evalúan por separado.

Gemini reportó 12.254 tokens de entrada, 1.694 de salida y 2.659 de razonamiento en diez solicitudes. Al aplicar la tarifa Standard del modelo vigente al 9 de noviembre de 2026, el coste estimado es **US$0,02551425**. El cargo real queda pendiente de conciliar con la facturación. SRT, matriz por borde y estimación por solicitud en `%LOCALAPPDATA%\LinguistVision\validation\lv004-fleurs-live-BudB6g`. [Tarifa de Gemini 3.8 Flash](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-flash).

### Corroboración acústica y repetición de los diez SRT

Se revisaron el audio y las lecturas por ventanas de las tres muestras con desvíos. En vietnamita, la última palabra del primer subtítulo termina hacia 4,92–4,93 s en las lecturas locales. La energía cae de forma sostenida cerca de 5,04 s. El segundo bloque de voz empieza cerca de 5,58–5,60 s. La marca local anterior para ese segundo inicio cayó dentro de la pausa. Con la referencia acústica, el inicio del SRT a 5,95 s queda a 0,35–0,37 s. El último final vietnamita sigue inconcluso y se conserva.

En árabe, dos lecturas parciales sitúan el final de la última palabra en 9,82–9,83 s, en acuerdo con la detección local de voz. En coreano, las lecturas sitúan la frontera en 3,62 s, pero la bajada acústica se concentra entre 3,74 y 3,88 s. Frente al corte de 4,14 s, el rango plausible de desvío es 0,26–0,52 s. El corte coreano se conserva como inconcluso.

El ajuste se aplica a finales monolingües de árabe y vietnamita cuando está habilitada la lectura local. Exige un final de frase identificado por una coincidencia única de palabras y una caída de energía sostenida. Se añadió un margen de 0,10 s al umbral de ajuste para preservar los casos cercanos al límite. La evaluación de aceptación conserva el límite de 0,50 s.

| Borde confirmado | Antes | Después | Desvío máximo tras el ajuste |
| --- | ---: | ---: | ---: |
| Primer final vietnamita | 5,74 s | 5,04 s | 0,12 s |
| Último final árabe | 10,50 s | 9,82 s | 0,004 s |

Se repitieron los diez trabajos por HTTP con las respuestas guardadas. Se descargaron y reabrieron los diez SRT y se comprobó que el texto y los proyectos coincidieran. Solo cambiaron los dos finales de la tabla. Con la referencia acústica actualizada hay tres muestras dentro de 0,50 s, cero fuera confirmadas y siete inconclusas. Pasaron 87 pruebas con PostgreSQL, la comprobación de tipos y ambas compilaciones. El ajuste se verificó en una sesión aislada. Cero llamadas a Gemini y coste **US$0**. Mediciones en `%LOCALAPPDATA%\LinguistVision\validation\lv004-monolingual-borders-20261109` y SRT y matriz en `lv004-fleurs-replay-7LUQdA` bajo la misma carpeta de validación.

### Revisión de siete casos y voces reservadas

Se cotejaron los siete SRT inconclusos con ventanas de lectura local, energía y detección de voz. El inicio árabe de la muestra guardada se acotó a 1,08–1,12 s y el alemán a 2,32–2,54 s. Ambos casos pasan ahora el criterio de tiempos. Se confirmaron los inicios ingleses, el primer inicio vietnamita y el primer inicio coreano, con los tiempos existentes.

| Caso todavía inconcluso | Evidencia que falta |
| --- | --- |
| Coreano | La lectura coloca la frontera cerca de 3,62 s y la caída de energía aparece después. El intervalo de desvío todavía cruza 0,50 s. |
| Vietnamita de lectura | El último final queda entre 0,354 y 0,570 s tarde según los bordes plausibles. |
| Inglés | El último final queda entre 0,412 y 0,740 s tarde según los bordes plausibles. |
| Japonés | La lectura parcial no confirma el inicio exacto de la segunda frase. |
| Mandarín | La lectura parcial ubica los caracteres del borde, pero no confirma la frase precedente completa. |

En el vietnamita espontáneo, dos ventanas leen las últimas palabras de la frase hasta 16,13–16,15 s y la detección de voz termina ese bloque hacia 16,256 s. El SRT ajustado a 16,160 s queda dentro de 0,10 s. La siguiente señal de voz aparece cerca de 17,00 s. Falta confirmar las palabras de la reanudación y la fidelidad lingüística con una escucha independiente.

Se probaron otras dos voces de la partición de prueba de FLEURS, con texto, audio y referencias locales fijados antes del envío. El vietnamita conserva el texto tras normalizar puntuación. El primer final queda inconcluso y el segundo inicio de 6,84 s coincide con la reanudación acústica dentro del límite. En árabe, el corte compartido de 4,20 s precedía al cambio de frase en aproximadamente 1,02 s. Las lecturas por ventanas y una caída de energía cerca de 5,22 s respaldaron corregir ese corte.

El ajuste árabe requiere una coincidencia única de la última palabra de la primera frase y las tres primeras de la siguiente, con caída de energía cerca del borde. Mueve juntos el final y el inicio. El corte compartido de la muestra reservada quedó en 5,22 s en el SRT regenerado. La muestra completa sigue inconclusa porque el final del nombre propio carece de referencia fiable.

Se repitieron por HTTP los dos trabajos nuevos y los diez guardados sin llamar a Gemini. Se reabrieron los SRT y los proyectos. Los diez SRT del lote guardado coinciden byte a byte con la repetición anterior. Con las referencias mejoradas, cinco quedan dentro de 0,50 s y cinco inconclusos. Pasaron 88 pruebas con PostgreSQL, tipos y ambas compilaciones. El ajuste se verificó en una sesión aislada.

Solo los dos clips nuevos usaron Gemini 3.8 Flash. Registró 2.281 tokens de entrada, 394 de salida y 383 de razonamiento. Coste Standard estimado **US$0,0046245**, con **US$0,0021105** para vietnamita y **US$0,002514** para árabe. Facturación pendiente de conciliación. Evidencia local bajo `%LOCALAPPDATA%\LinguistVision\validation` en `lv004-seven-audit-20261109`, `lv004-heldout-live-Eaumqs`, `lv004-heldout-replay-swws17` y `lv004-fleurs-replay-MXGG1c`. [Corpus FLEURS](https://huggingface.co/datasets/google/fleurs) · [Tarifa Standard](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-flash).

### Cotejo con un segundo reconocedor y clips de obra reservados

Se añadieron lecturas locales independientes de Faster Whisper con SenseVoice para coreano, japonés, mandarín e inglés, y Zipformer para vietnamita. Los tiempos de tokens sirven como apoyo y se contrastaron con el audio y la detección de voz. Los SRT guardados conservaron sus bytes. Se volvieron a puntuar sus tiempos con estas referencias.

| Caso | Resultado |
| --- | --- |
| Coreano | La segunda lectura sitúa el inicio de la palabra siguiente en 3,84–3,88 s, junto a la caída y reanudación de la señal. El corte de 4,14 s queda dentro del umbral. Máximo del clip 0,46 s. |
| Japonés | La segunda lectura y la reanudación de voz ubican el inicio de la segunda frase dentro del umbral, aunque los lectores locales discrepan en los caracteres de esa palabra. El SRT coincide con el texto de FLEURS tras normalizar puntuación. Máximo 0,42 s. |
| Mandarín | Los dos últimos caracteres de la primera frase y los dos primeros de la siguiente se reconocen alrededor del corte. El SRT conserva la escritura simplificada de la referencia. Máximo 0,354 s. |
| Inglés | El segundo lector confirma la última palabra. Su final todavía depende de si el sonido débil posterior pertenece a la palabra. El rango de desvío del SRT es 0,412–0,740 s. |
| Vietnamita de lectura | El segundo lector confirma la última palabra, pero su marca es de inicio. La caída de nivel y el detector de voz dejan un rango de desvío de 0,354–0,570 s para el último final. |

El lote de diez queda en ocho muestras con todos los bordes dentro de 0,50 s y dos inconclusas. En vietnamita espontáneo, Zipformer y Faster Whisper coinciden en el sentido de la indicación de usar una hoja de papel. El segundo lector recupera una interjección cerca de 16,92 s y la voz se reanuda cerca de 16,99 s. El inicio de ese subtítulo a 16,78 s queda dentro del umbral. El final ajustado de 16,16 s también queda dentro del rango respaldado por ambas lecturas y el audio. El cotejo automático detectó discrepancias de grafía y muletillas en otros fragmentos. La fidelidad literal aún requiere cotejo humano.

Se congelaron dos MP4 con sus huellas, marcas locales, intervalos de voz y vocabulario esperado. El clip inglés → español dura 21,25 s y cubre 15 pies, tragaluz y tejas. El clip español → inglés dura 27,42 s y cubre seis pies o más, tejas y componentes de protección contra caídas. Ambos están por debajo de 1 MiB y mantienen completas las frases seleccionadas. Estos clips quedan reservados para la prueba de los dos SRT por dirección. Se guardaron las lecturas, la matriz y el manifiesto en `%LOCALAPPDATA%\LinguistVision\validation\lv004-independent-close-20261109`. Cero llamadas a Gemini, coste externo **US$0**. T3 queda para el cierre. [Material inglés de OSHA](https://www.osha.gov/vtools/construction/skylight-fnl-eng-web-transcript) · [Material español de OSHA](https://obis.osha.gov/dts/vtools/construction/reroofing_fnl_spa_web_transcript.html) · [SenseVoice](https://k2-fsa.github.io/sherpa/onnx/sense-voice/pretrained.html) · [Zipformer vietnamita](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/offline-transducer/index.html).

### Traducción de los dos clips de obra reservados

La candidata de prueba procesó los dos clips reservados de OSHA con Gemini 3.8 Flash en un piloto aislado. Se descargaron y abrieron los cuatro SRT. Cada dirección produjo seis segmentos con los mismos intervalos en el original y la traducción. También se comprobó el borrador al reabrir cada proyecto. Se consumieron dos créditos simulados y quedaron cero reservados.

| Dirección | Texto, medidas y vocabulario | Tiempos de ambos SRT |
| --- | --- | --- |
| Inglés → español | El original conservó «15 feet». La traducción conservó el número, «tragaluz», «tejas» y «sin protección», pero dejó la unidad en inglés. La entrega esperada es «15 pies». | Fuera de 0,50 s. El segmento 3 empieza a 5,900 s frente a 6,443–6,464 s y el segmento 5 a 12,800 s frente a 13,321–13,344 s. El peor desvío es 0,564 s. |
| Español → inglés | Conservó «6 feet or more», «shingles», «full body harness» y los componentes del sistema de protección. | Dentro de 0,50 s en este clip. El máximo fue 0,480 s en el final del quinto segmento. |

Las marcas de palabra se cotejaron con detección de voz y silencios de FFmpeg a −40, −46 y −50 dB. En los dos inicios ingleses, la marca local puede incluir el silencio previo a la palabra. El comienzo de voz se mantuvo estable a través de los tres niveles y se usó como referencia. Se guardaron las cuatro descargas, las mediciones y la matriz por segmento en `%LOCALAPPDATA%\LinguistVision\validation\lv004-work-live-CpL76L`. Ambos sentidos siguen en beta. Se registraron los fallos para una corrección posterior.

Las dos solicitudes reportaron 4.960 tokens de entrada, 944 de salida y 356 de razonamiento. Coste Standard estimado **US$0,008595**, con **US$0,00345825** para inglés → español y **US$0,00513675** para español → inglés. El cargo facturado queda pendiente de conciliación. [Tarifa oficial de Gemini](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-flash).

### Corrección de medidas e inicios en inglés → español

La indicación de traducción distingue conservar la unidad física de traducir su nombre. La salida española localiza «feet» como «pies» cuando el mismo valor numérico aparece con esa unidad en el original. No altera la pista original. Para los inicios interiores de inglés → español, la corrección exige una coincidencia única de las primeras palabras, silencio entre el tiempo actual y el comienzo de la voz, y señal sostenida en ese comienzo. Solo cambia un inicio si el adelanto supera 0,50 s.

Los dos clips de obra se repitieron por HTTP con las respuestas guardadas. Se abrieron los cuatro SRT y se verificaron los tiempos comunes y los borradores reabiertos. Solo cambiaron los tres puntos previstos. El segmento 3 pasó de 5,90 a 6,44 s, el 5 de 12,80 a 13,32 s y la traducción de la medida quedó en «15 pies». El peor desvío del clip corregido bajó de 0,564 a 0,460 s. Español → inglés conservó texto e intervalos y quedó en 0,480 s. También se repitieron los 17 controles bilingües y diez monolingües sin Gemini. Los bilingües conservaron los textos e intervalos de su candidata de referencia y los monolingües conservaron sus SRT byte a byte.

Se probó una voz nueva de NIOSH, Bill Hayes, con referencia y huella fijadas antes de la solicitud. Los dos SRT comparten los tiempos y la traducción conservó 35 años, andamio, trampilla y barra suelta. El segmento 6 empezó a 20,82 s frente a 21,38–21,536 s. Ese inicio queda fuera de 0,50 s. Dos comienzos más quedaron inconclusos. En esa grabación hay señal de fondo y el reconocimiento local discrepa sobre las primeras palabras del sexto segmento. La regla conservadora mantuvo el inicio. La corrección de los fallos conocidos pasa, pero esta voz deja abierta la validación con otros ambientes acústicos. [Fuente de la voz nueva](https://stacks.cdc.gov/view/cdc/181916).

En paralelo se repitieron las mediciones de los dos finales monolingües con un filtro de paso alto y varios niveles de silencio. Las señales débiles al final del inglés y del vietnamita leído siguen dejando rangos que cruzan 0,50 s. Se conservan como inconclusos y sigue pendiente el cotejo literal humano del vietnamita espontáneo.

Pasaron 90 pruebas con PostgreSQL, tipos y ambas compilaciones. El piloto se ensayó de forma aislada y las dos direcciones siguen en beta. Solo hubo una solicitud nueva a Gemini 3.8 Flash, con 2.628 tokens de entrada, 534 de salida y 259 de razonamiento. Coste Standard estimado **US$0,00494475**, pendiente de conciliación. Evidencia bajo `%LOCALAPPDATA%\LinguistVision\validation` en `lv004-work-replay-Qwww5r`, `lv004-work-controls-G3Us4T`, `lv004-fleurs-replay-i2lyqs`, `lv004-work-fix-20261109` y `lv004-work-new-live-vmbwBB`. T3 queda para el cierre. [Tarifa de Gemini](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-flash).

### Inicio del segmento 6 con ruido de fondo

La respuesta guardada de Gemini sitúa el sexto subtítulo en 21,68 s. La traza del adaptador mostró que la alineación interior lo adelantó a 20,82 s al asignar 0,76 s a un «and». En el tramo temprano predomina señal de fondo. La energía sube de forma sostenida cerca de 21,50 s. Las marcas de palabra y de voz sitúan el inicio entre 21,38 y 21,536 s.

El ajuste conserva el inicio anterior a la alineación interior cuando el reconocedor estira un «and» sobre el fondo, la energía aumenta al final de esa marca y el tiempo original queda cerca. Se conserva un adelanto si hay señal comparable de voz al principio. En la repetición del clip, el inicio pasó de 20,82 a 21,68 s y el desvío máximo bajó de 0,716 a 0,300 s. Se descargaron y reabrieron ambos SRT. El texto y los demás tiempos se conservaron. Quedaron diez bordes dentro de 0,50 s y dos inicios inconclusos en ese clip.

También se repitieron los dos clips de obra, 17 controles bilingües y diez monolingües. Sus 48 SRT fueron idénticos byte a byte a los de la repetición anterior. Evidencia en `lv004-work-replay-YexrIX`, `lv004-work-controls-Nh1DRv` y `lv004-fleurs-replay-FiulXR`.

La repetición y la traza se guardaron en `%LOCALAPPDATA%\LinguistVision\validation\lv004-work-noise-replay-nBbj0k`. Se verificaron 91 pruebas, tipos y ambas compilaciones. Cero llamadas a Gemini y coste **US$0**. El ajuste se probó en una sesión aislada.

### Cotejo de los inicios de los segmentos 2 y 3

En el segmento 2, SenseVoice ubicó el «in» del andamio en 4,91–4,92 s en tres ventanas. Faster Whisper desplazó el comienzo de esa palabra según el recorte y lo adelantó a 4,10 s en la lectura completa. La señal distingue el final de la frase anterior, un tramo de fondo y una reanudación de voz cerca de 4,86 s. Con la referencia conservadora de 4,84–4,96 s, el inicio de 4,10 s estaba adelantado al menos 0,74 s.

El ajuste recupera el inicio anterior a la alineación interior si una marca estirada de «in» cruza un corte compartido, coincide con las dos palabras siguientes y la señal muestra una pausa seguida de voz. Conserva el final del segmento anterior. En ambos SRT, el inicio del segmento 2 quedó en 4,640 s, a un máximo de 0,320 s. Para el segmento 3, las marcas de palabra y la subida acústica acotan el inicio a 10,080–10,260 s. El SRT se conserva en 9,760 s, con un máximo de 0,500 s. El umbral se comprobó en milisegundos enteros. Los 12 bordes pasan en ambas pistas. Solo cambió el inicio del segmento 2, y todo el texto coincide con la exportación anterior.

La última palabra del inglés leído y la del vietnamita leído se reconocen en las ventanas completas. Las marcas locales y la señal débil al final todavía dejan intervalos que cruzan el umbral de 0,50 s. Se conservan los finales en 5,980 s y 10,050 s, respectivamente, y ambos casos siguen inconclusos. En vietnamita espontáneo, las lecturas corroboran la indicación de usar una hoja de papel y apoyan la lectura «khoét». Persisten diferencias de grafía, muletillas y literalidad entre las lecturas y el SRT. Hace falta cotejo por una persona que hable vietnamita.

Los 29 controles produjeron 48 SRT idénticos byte a byte. Pasaron 91 pruebas con PostgreSQL, tipos y ambas compilaciones en Node 24.13.0. Hubo cero llamadas a Gemini y cero consultas externas. El coste de esta ronda fue **US$0**.

Evidencia privada en `%LOCALAPPDATA%\LinguistVision\validation`, en `lv004-pending-edges-20261109` para las lecturas y `lv004-work-noise-replay-jHPwWo` para los dos SRT y sus 12 bordes. Los controles están en `lv004-work-replay-QZ5OoJ`, `lv004-work-controls-MKfjfA` y `lv004-fleurs-replay-uJlbPA`. La muestra inglesa pasa en la candidata aislada. La promoción comercial sigue en beta y la revisión por T3 queda para el cierre.

### Segunda lectura del vietnamita espontáneo

Se comparó la lectura aportada para el audio C con los cinco segmentos del SRT guardado. Coinciden la secuencia de instrucciones, el tercer segmento salvo puntuación y la palabra que describe la acción de hacer el orificio. Hay tres muletillas omitidas en el SRT, una variante de grafía regional, una discrepancia de una palabra breve y otra en la forma de una expresión repetida. La puntuación y la segmentación de las interjecciones se evaluaron por separado.

La lectura adicional apoya la fidelidad del sentido. Las diferencias literales requieren corroboración independiente y este resultado no aporta marcas de tiempo. El SRT se conserva y la transcripción vietnamita sigue en beta.

### Marcas aportadas para los finales de A y B

- **A, inglés leído.** La palabra final coincide con la lectura local. La marca aportada de 1,60–1,80 s en el recorte equivale a 5,60–5,80 s en el original. Frente al final del SRT de 5,980 s, ese intervalo da un desvío de 0,180–0,380 s. La lectura local termina la palabra cerca de 5,26 s y la señal posterior es débil. Como la discrepancia entre referencias cruza el límite de 0,50 s, se conserva el SRT y el borde queda inconcluso.
- **B, vietnamita leído.** La palabra final coincide con las lecturas locales. La marca aportada de 2,20–2,50 s excede los 2,00 s del recorte y queda excluida del cotejo temporal. Se conserva el SRT y el borde queda inconcluso.

### Cotejo de los finales con el reloj de los WAV

Se verificó por huella que cada recorte coincide con el tramo del original. Se midió la señal directamente sobre las muestras PCM en ventanas de 20 ms con pasos de 10 ms y se contrastó la energía en tres bandas. Los tiempos de esta tabla se cuentan desde el inicio de cada WAV.

| Audio | Final del SRT en el WAV | Fin de voz más temprano que cumple 0,50 s | Resultado |
| --- | ---: | ---: | --- |
| A, inglés leído | 1,980 s | 1,480 s | La señal baja antes del umbral y queda una cola débil cerca de 1,46–1,52 s. La marca aportada de 1,60–1,80 s cae en una zona de señal débil. Falta atribuir la cola al cierre de la palabra o al fondo. Inconcluso. |
| B, vietnamita leído | 1,850 s | 1,350 s | La energía baja de forma marcada alrededor de 1,28–1,32 s y quedan señales débiles a ambos lados de 1,350 s. Falta distinguir la consonante final del fondo. Inconcluso. |

Se conservaron los SRT en 5,980 s y 10,050 s en el reloj original. Para cerrar, hace falta una marca de escucha fonética sobre cada WAV que sitúe el final de la última palabra por completo a un lado del umbral. La medición, el script y las huellas están en `%LOCALAPPDATA%\LinguistVision\validation\lv004-escucha-final-20261110`. Cero llamadas a Gemini y coste de esta comprobación **US$0**.

En esa misma carpeta, `escuchar-finales-ab.html` reúne los dos recortes con volumen normal y amplificación fija de +18 dB sin saturación. En Chrome se comprobó que el salto marca 1,480 s en A y 1,350 s en B, que el cambio de volumen conserva la posición y que se puede avanzar en pasos de 10 ms.

El usuario oyó solo un sonido parecido a estática en ambos recortes al retroceder 10 ms desde el punto de cotejo y reproducir. La observación apoya que cerca del umbral solo queda fondo audible. La escucha del tramo aislado no fija el fin de la consonante en el contexto de la palabra. Se conservan ambos SRT y los finales siguen inconclusos.

El propietario aprobó apartar A y B de la ronda activa el 10 de noviembre. Permanecen inconclusos en la matriz y se conservan sus SRT. Se retomarán si aparece una referencia que distinga el final de la voz o si se reproduce el problema en una muestra representativa de clientes. LV-005 sigue en paralelo. Las capacidades de LV-004 mantienen el estado respaldado por su evidencia.

### Piloto original de tres idiomas

El primer corte de desarrollo localiza el piloto privado en inglés, español y árabe. La interfaz cambia de idioma dentro de la sesión y conserva el par de procesamiento y el borrador de subtítulos. Cada idioma admite transcripción en el mismo idioma. La validación privada inicial también conserva inglés ↔ español y árabe → español. Los pares comerciales se deciden con evidencia de calidad.

El [catálogo de subtítulos local](../../config/subtitleLanguages.ts) alimenta los selectores de Windows. En el piloto web, [los paquetes de interfaz](../../server/commercial/web/locales/) son módulos independientes y [el registro](../../server/commercial/web/pilotLocales.js) comprueba que todos contienen las mismas claves de mensajes. Para añadir otro idioma, agregar su módulo y registrarlo. El [catálogo de direcciones](../../config/pilotLanguageDirections.ts) gobierna los pares que se muestran y que el adaptador acepta.

El piloto toma el idioma de interfaz de `?lang=es|en|ar`, de la preferencia guardada en el navegador o del español inicial, en ese orden. Cambiarlo actualiza `lang`, `dir`, etiquetas, estados y editor dentro de la misma sesión. El par y el borrador se mantienen durante ese cambio. Los pares con árabe se habilitan en la candidata privada con `LINGUISTVISION_PILOT_EXPERIMENTAL_LANGUAGES=1`.

El [generador de páginas del piloto](../../server/pilot-site/render.ts) ya acepta paquetes de inglés, español y árabe. La prueba agrega el paquete árabe sin editar el generador y comprueba HTML de derecha a izquierda, canónicas, alternancias, selector y sitemap. El paquete separa el locale de interfaz del código de búsqueda: `es-419` en HTML y `es` en `hreflang`. [Códigos admitidos por Google](https://developers.google.com/search/docs/specialty/international/localized-versions#supported-language-and-region-codes)

El paquete privado árabe → español usa el mismo selector y adaptador de video. Con un MP4 de prueba de 6,445 s, Gemini devolvió dos subtítulos que se cotejaron con los saludos esperados. La prueba de humo deja pendientes la validación de variantes y los umbrales lingüísticos. Evidencia local en `%LOCALAPPDATA%\LinguistVision\validation\lv004-arabic`.

El mismo paquete se probó desde el selector del piloto en Chrome con saldo simulado, Gemini real, corrección y exportaciones SRT y MP4. El flujo se activó por configuración y usó la cola y el editor comunes. Quedan muestras más largas, transcripción de salida en árabe y revisión de variantes.

El rastreo HTTP de la vista previa devolvió 200 para las 30 rutas con `noindex`. Tres tienen contenido localizado y las otras 27 muestran un borrador explícito. El control de publicación exige HTTPS, los diez paquetes aprobados y sus revisiones editorial y de transcripción. Solo los diez entran en el sitemap y las alternancias de una publicación. [Informes de búsqueda generativa de Google](https://developers.google.com/search/blog/2026/06/gen-ai-performance-reports)

La [lista de 30 idiomas aprobada](../../config/launchLanguages.ts) es la fuente de identidades y locales. Para locales sin correspondencia verificada en `hreflang`, como cantonés y filipino en el catálogo inicial, el generador admite una página con canónica, selector y sitemap sin asignarle otro idioma de búsqueda.

## Revisión del primer corte

T3 recibió la tarea `mcp:b6fd8f85-e148-4f00-b0e0-1fc7c64e2153` en LinguistVision y devolvió el límite de uso compartido. OpenRouter ejecutó ambas revisiones en paralelo con un resumen técnico.

- DeepSeek V4.1 Flash, CoreWeave, `gen-1794103122-dwf5XmPHjklOG8s5sN5T`. US$0.0003965247. Propuso conservar sesión, par y borrador al cambiar idioma y cotejar SRT y MP4 de salida árabe.
- Kimi K2.6, Crusoe, `gen-1794103122-KBov3Lvlt3iayv3D5CWj`. US$0.004183641. Señaló la necesidad de separar la evidencia móvil de pagos, la preferencia de interfaz y la calidad de traducción.
- Total confirmado **US$0.0045801657**. El bloqueo de PayPal en el Pixel se mantiene en LV-E10 como criterio del piloto comercial. La candidata de tres idiomas se verifica en privado con saldo simulado.

Gemini produjo SRT de transcripción en inglés y español con muestras cortas, con las frases esperadas. La muestra española adapta el audio de Fibonacci con una imagen fija y pausas bajo CC BY-SA 2.5. [Fuente de la muestra](https://commons.wikimedia.org/wiki/File:Es-buenos_d%C3%ADas.ogg) · [Licencia](https://creativecommons.org/licenses/by-sa/2.5/)

En Chrome con saldo simulado, la candidata procesó árabe → árabe con Gemini, editó el segundo subtítulo y alternó árabe, inglés y español conservando sesión, par y edición. Pasó el ancho de 360 px y conservó la preferencia al recargar. Se cotejó el SRT UTF-8 con el segundo segmento de 3,030 a 5,400 s y se verificó el texto editado en un fotograma del MP4 H.264/AAC. La candidata aislada pasó instalación, tipos, compilación y 49 pruebas con PostgreSQL. Evidencia local en `%LOCALAPPDATA%\LinguistVision\validation\pilot-editor-e2e-5RIwyj` y `lv004-three-language`. Quedan el Pixel con esta candidata y muestras representativas para cada capacidad comercial.

## Prueba privada en el Pixel

La candidata de tres idiomas se activó en el enlace HTTPS privado del Pixel sobre el puerto local 3001. Conservó la cuenta simulada con siete créditos iniciales y se habilitaron las direcciones experimentales árabe → español y árabe → árabe. Los tres módulos de interfaz, el editor y el clip árabe respondieron HTTP 200 a través del proxy de prueba. El acceso HTTPS desde la PC con encabezado de origen falsificado devolvió HTTP 403. El reinicio renueva la sesión de navegador con la misma invitación. El trabajo y las exportaciones del Pixel se registran cuando haya evidencia.

El Pixel completó un trabajo árabe → español. La base registró el resultado y el consumo de un crédito. La captura del editor mostró «La paz sea con ustedes» y «Buenos días». El saldo quedó en seis disponibles y cero reservados. Sigue pendiente el recorrido móvil con salida en árabe y exportaciones.

El Pixel completó también árabe → árabe y abrió el editor con la interfaz en español. La captura muestra `السلام عليكم.` en la vista previa y dos frases con inicios a 0,35 s y 2,90 s. La base registró un SRT de 111 bytes y cinco créditos disponibles, cero reservados. Capturas posteriores mostraron la frase editada `صباح الخير يا أصدقاء` en el video y el mismo borrador al cambiar la interfaz de español a árabe, con controles de derecha a izquierda. Queda cotejar las exportaciones árabes del Pixel.

El primer MP4 árabe adjuntado desde el Pixel contiene H.264 y AAC con señal, y muestra la frase original `صباح الخير.`. La captura de la exportación también muestra la frase original en el editor. Se verificó la exportación de subtítulos árabes con audio. Falta exportar y cotejar la versión editada desde el editor que contiene el borrador.

El usuario compartió la lectura de `linguistvision (1).srt` desde el Pixel. Reportó `السلام عليكم.` de 0,350 a 1,750 s y la frase editada `صباح الخير يا أصدقاء` de 2,900 a 5,300 s. Ambos intervalos son consecutivos sin solapamiento y caben en el clip de 6,445 s. Se registró como contenido reportado. El archivo SRT no estuvo disponible localmente para comprobar sus bytes.

El segundo MP4 árabe adjunto desde el Pixel sí contiene la frase corregida `صباح الخير يا أصدقاء` incrustada y audio AAC con señal. Se verificó el archivo mediante fotogramas y análisis de audio. El contenedor mide 7,421 s frente a 6,445 s en el clip de origen. Queda revisar esa diferencia y el ajuste temporal del MP4 móvil.
