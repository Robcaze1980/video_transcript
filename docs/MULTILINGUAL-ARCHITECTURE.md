# Arquitectura multilingüe de LinguistVision

El primer lanzamiento cubre diez idiomas según [LV-001](specs/LV-001-plataforma-multilingue.md). La base comercial admite el catálogo de expansión y otros servicios de archivos, como extracción de facturas PDF, con las mismas cuentas, créditos, trabajos, permisos, almacenamiento y descargas. Cada servicio aporta sus reglas, procesador, validación, tarifa y contenido localizado.

## Contrato de idiomas

- Mantener un catálogo versionado con etiquetas BCP 47, nombre local, dirección de escritura, variantes de escritura, equivalencias por proveedor y cobertura comprobada. Guardar por separado el locale de interfaz, el idioma hablado y el de salida. El usuario puede corregir la detección del idioma hablado.
- Localizar el recorrido de compra y uso en cada idioma publicado, incluidas las páginas de producto, precios, cuenta, carga, opciones, progreso, errores, historial, descarga y comunicaciones propias. Verificar aparte el idioma disponible en el checkout alojado y en sus recibos.
- Registrar cobertura de transcripción por idioma de origen y de traducción por par dirigido. Si la promesa es traducir desde cualquiera de los 30 hacia cualquiera de los otros 29, se necesitan 870 pares, además de transcripción en los 30 idiomas. Un idioma disponible en un menú todavía necesita evidencia de calidad.
- Conservar segmentos con tiempo, texto original y texto traducido. Evaluar si conviene traducir en una etapa separada para reutilizar la transcripción cuando el cliente pide otro idioma. Comparar calidad, latencia y costo con el flujo actual de Gemini. Cotizar explícitamente los destinos adicionales.
- Probar Unicode y escritura bidireccional de extremo a extremo. Incluir texto árabe mezclado con números, japonés, chino, diacríticos, nombres propios y cortes de línea. Si se ofrece MP4, verificar fuentes, composición de texto y reproducción; para SRT, abrir en reproductores representativos.

## Plataforma web

Una web pública entrega HTML localizado antes de ejecutar JavaScript y comparte el catálogo con el área autenticada. El servidor registra el servicio, la versión, el precio aceptado y los idiomas de cada trabajo. Un proceso de fondo toma el trabajo, ejecuta el adaptador y publica el entregable validado. Un fallo definitivo libera el crédito reservado. Los archivos y resultados privados se descargan tras verificar acceso.

El catálogo de servicios define tipos de entrada, límites, opciones, tarifa, procesador y formatos de salida. Subtítulos usa el catálogo lingüístico; un extractor PDF puede definir cobertura de OCR y esquemas propios. Mantener identidad, región comercial, moneda e idioma como datos independientes.

## SEO y búsqueda con IA

- Un dominio inicial y rutas estables como /es/subtitulos-video, /en/video-subtitles y /ar/… . Usar un identificador interno de página para vincular versiones aunque cambie el slug. Selector accesible y URL compartible. Sugerir el idioma del navegador y respetar la URL elegida.
- Generar canonical propio por traducción, hreflang recíproco con autoreferencia y x-default, y sitemap con páginas públicas canónicas. Probar enlaces, códigos, respuestas HTTP y contenido visible desde el HTML. El área privada requiere autenticación y queda fuera del sitemap.
- Publicar en los diez idiomas iniciales la oferta, los límites, los formatos y una muestra propia de la salida. Añadir páginas específicas de pares o nichos cuando exista intención de búsqueda y evidencia útil en ese idioma. Mantener precios y cobertura sincronizados con el catálogo.
- Para GEO, publicar ejemplos verificables, una tabla de cobertura y precios legibles, y guías específicas con muestras sintéticas. Permitir rastreo público en robots y CDN según la política aprobada. Medir indexación, clics y conversiones por locale. Separar referencias observables de asistentes y auditorías manuales de citas de la atribución de ventas.

### Verificación local de LV-005

El rastreo privado devolvió HTTP 200 para las diez páginas localizadas, con títulos y descripciones únicos, etiquetas de idioma y dirección, canónica propia, enlaces del selector, diez alternancias recíprocas y `x-default`. El sitemap privado conserva las 30 rutas de inventario con `noindex`. La simulación local de publicación, con evidencia ficticia, generó exactamente diez URL y excluyó borradores. El generador rechazó una publicación sin evidencia. El inventario de comprobación quedó en `%LOCALAPPDATA%\LinguistVision\validation\lv004-field-20261108\lv005-routes.json`.

Cada una de las diez páginas localizadas presenta un ejemplo ficticio de subtítulo de obra, con el mismo intervalo de tiempo y una redacción propia por idioma. El HTML conserva el orden de las marcas de tiempo en árabe. El texto describe revisión y descarga SRT. Las menciones comerciales de MP4, precio y pares se incorporan tras decidir la oferta y verificar sus capacidades. El generador exige un ejemplo en cada paquete público y mantiene las notas de vista previa en la versión privada. Queda una revisión editorial por mercado para comprobar la naturalidad, la intención de búsqueda y las promesas de producto. [Alternancias por idioma](https://developers.google.com/search/docs/specialty/international/localized-versions)

En el cotejo de las diez páginas se revisaron título, descripción, ejemplo y alcance de la oferta. Se ajustó la redacción de inglés, árabe, portugués de Brasil, coreano, mandarín y vietnamita para acercarla al vocabulario de obra y de subtítulos. Español, francés, alemán y japonés conservan el ejemplo y la descripción centrada en SRT. Este cotejo comprueba coherencia editorial del borrador. Sigue pendiente una revisión con hablantes de los mercados objetivo y comprobar la intención de búsqueda.

El 10 de noviembre se volvió a rastrear en localhost el borrador efectivo de las diez páginas. Se verificaron HTTP 200, `noindex` en cabecera y HTML, canónica propia, diez alternancias recíprocas y `x-default`, selector de idioma y ejemplo localizado. El ensayo de publicación con datos de prueba generó un sitemap de diez rutas y rechazó la generación sin evidencia. Pasaron las seis pruebas del sitio en Node 24.13.0.

La ficha privada `revision-por-mercado.html` reúne el título, encabezado, descripción y ejemplo de las diez páginas. Permite devolver observaciones por idioma sobre naturalidad, intención de búsqueda y claridad de la oferta SRT. El informe `cotejo-rutas.json` guarda las rutas y huellas de los archivos utilizados. Ambos están en `%LOCALAPPDATA%\LinguistVision\validation\lv005-revision-mercados-20261110`. La revisión humana de contenido y la atribución entre visita y compra siguen pendientes.

### Medición de LV-005

| Señal | Fuente y unidad | Comprobación |
|---|---|---|
| Indexación | Search Console. Estado de cada una de las diez URL canónicas y clics de búsqueda por página. | Verificar la propiedad del dominio aprobado, enviar el sitemap público e inspeccionar las diez URL. Cotejar canónica seleccionada, estado y fecha de la última comprobación. |
| Visibilidad generativa | Informe de búsqueda generativa de Search Console. Impresiones por URL cuando estén disponibles. | Conservar el período y la página del informe. Mantener la serie separada del total de búsqueda porque las vistas pueden solaparse. |
| Referencia de asistentes | Visitas con origen reconocible. Para ChatGPT, clasificar el valor exacto `utm_source=chatgpt.com` o el host de referencia permitido. | Probar una entrada con señal reconocible y una sin señal. Guardar solo la categoría de origen, el identificador de página y el locale. Las visitas sin señal quedan sin atribuir. |
| Citas observadas | Revisión manual de consultas por idioma. Una fila por consulta, asistente, fecha y URL citada. | Repetir un conjunto fijo de consultas sin datos de clientes. Las citas observadas se informan aparte de las visitas y de las compras. |
| Conversión | Primera entrada por sesión y captura acreditada por orden. Desglose por locale y origen observable de la entrada. | Cotejar el crédito en el servidor con la compra. Una cancelación, una captura pendiente y una repetición de la confirmación deben producir cero conversiones adicionales. |

El recorrido de medición empieza con `landing_view`, una vez por sesión y página de entrada. Cuando exista un destino público para el producto, `product_entry` cuenta su apertura desde la página y conserva el locale de entrada aunque el cliente cambie de idioma en el editor. `purchase_credited` se emite en el servidor al acreditar la captura. Usa el identificador interno de orden para deduplicar y exporta métricas agregadas por período, locale y categoría de origen. Las pruebas y Sandbox se registran por separado. Los parámetros completos de URL, archivos, transcripciones, identificadores de PayPal y datos de cuenta quedan fuera de la medición.

La primera prueba local de la fuente de compras pasó con PostgreSQL y pagos simulados. El piloto aceptó dos confirmaciones concurrentes de una orden, registró una fila en `purchases` y acreditó cinco créditos una sola vez. El ensayo de reconciliación confirmó que perder la respuesta de captura dejó el saldo en cero mientras la orden estaba pendiente y que el reintento registró una acreditación. Informe en `%LOCALAPPDATA%\LinguistVision\validation\lv005-offline-20261108\offline-conversion.json`.

#### Atribución de una visita a la compra simulada

El piloto local puede habilitar esta prueba con `LINGUISTVISION_PILOT_CONVERSION_PREVIEW=1`. Usa un esquema PostgreSQL separado, funciona en loopback con pagos simulados y presenta las diez páginas con `noindex` y un enlace al piloto. Una cookie firmada conserva durante ocho horas el locale de la primera página y una categoría de procedencia. La firma es válida mientras vive el proceso. Al crear la orden se guardan esos dos datos. Se clasifican como `chatgpt` el parámetro exacto `utm_source=chatgpt.com` o el referente del origen permitido. Sin esas señales, la categoría es `unattributed`. No se persisten la URL ni el referente completo.

La vista `pilot_preview_conversions` agrupa por fecha UTC, locale y procedencia. Lee las compras acreditadas unidas a su orden, con una sola compra por orden. La atribución no modifica el cálculo del saldo. El recorrido local en `127.0.0.1:3001` partió de la ruta española con una señal de procedencia de prueba. Antes de la captura había cero conversiones. Dos confirmaciones concurrentes y una repetición posterior devolvieron HTTP 202. El resultado fue una compra, cinco créditos y una conversión `es-419/chatgpt`. También se probó que una segunda página en inglés no reemplaza la primera atribución y que un origen parecido queda sin atribuir. Pasaron 92 pruebas con PostgreSQL, tipos y ambas compilaciones. Evidencia en `%LOCALAPPDATA%\LinguistVision\validation\lv005-conversion-068e8efc\resultado.json`.

#### Embudo local de LV-005

En el mismo modo local, `landing_view` cuenta una vez cada página localizada por sesión de navegador. `product_entry` se registra al pulsar el enlace al piloto y se atribuye una vez por sesión a la página de entrada. Al navegar a otro idioma se registra la visita de esa página y se conserva la atribución original de la apertura y la compra. La vista `pilot_preview_funnel` muestra los tres eventos por día UTC, idioma y procedencia. Las visitas y aperturas se deduplican con una clave de sesión, idioma y evento en PostgreSQL. Las compras siguen saliendo del registro de acreditaciones. Los eventos de navegación guardan un identificador aleatorio de sesión, idioma, categoría de procedencia y hora.

El recorrido en `127.0.0.1:3001` dejó una visita, una apertura y una compra para `es-419/chatgpt`, con una recarga, dos aperturas simultáneas, dos confirmaciones simultáneas y un reintento de confirmación. La vuelta de cancelación se simuló regresando al piloto sin solicitar captura. El trabajador también comprobó una orden con captura solicitada sin aprobación. Ambos casos produjeron cero compras adicionales. La compra completada acreditó cinco créditos. Pasaron 92 pruebas con PostgreSQL, tipos y ambas compilaciones en Node 24.13.0. Evidencia en `%LOCALAPPDATA%\LinguistVision\validation\lv005-embudo-20261110\resultado-embudo.json`.

#### Revisión editorial por mercado

DeepSeek V4.1 Flash y Kimi K3.1 Pro revisaron por T3 los diez borradores en paralelo. Coincidieron en que los ejemplos conservan la instrucción de obra y que el texto promete revisar subtítulos y descargar SRT. Codex simplificó la instrucción de descarga en portugués de Brasil, armonizó la terminología en árabe y aclaró la revisión de subtítulos en mandarín y el carácter ilustrativo del ejemplo en vietnamita. Se conservaron las demás preferencias editoriales para el cotejo humano.

El rastreo local regeneró la ficha `revision-por-mercado.html` en la carpeta de esta ronda. Las diez rutas respondieron con `noindex` y pasaron las comprobaciones de canónica y alternancias. Quedan la revisión humana por mercado, la comprobación de intención de búsqueda y la validación pública. La revisión de modelos no mide demanda. Después de publicar, registrar los estados reales de Search Console y los orígenes observables. [Informe generativo de Search Console](https://developers.google.com/search/blog/2026/06/gen-ai-performance-reports) · [Referencias desde ChatGPT](https://help.openai.com/en/articles/12627856-publishers-and-developers-faq)

### Candidata de la portada y el acceso autoservicio

La vista local usa el generador HTML de LV-005 con diez páginas comerciales. La portada contiene la demostración de obra, los casos de capacitación y comunicación interna, las acciones de alta e inicio de sesión y la explicación del SRT. El clip sintético propio usa una voz en inglés y muestra el idioma de la muestra. El editor público permite corregir el texto y ajustar los tiempos en memoria. Se descargó el SRT editado en el navegador y se comprobó que el texto y el intervalo de 0,500 a 4,000 s coinciden con la muestra de la portada.

El alta y el inicio de sesión usan códigos de ocho dígitos con caducidad de diez minutos y un máximo de cinco intentos. En la candidata, el código llega a un buzón local de pruebas. La verificación crea la cuenta si es nueva y abre una sesión revocable. Se ensayaron por HTTP las diez rutas, verificación, sesión, compras simuladas, acreditación única y atribución. Las órdenes pendientes, rechazadas y sin confirmar conservaron el saldo. Una segunda cuenta recibió HTTP 404 al intentar acceder al video y al proyecto de la primera. Los datos simulados y los de PayPal Sandbox usan esquemas distintos de PostgreSQL. Se comprobó el selector por teclado y el diseño de la portada en escritorio y en pantalla estrecha para árabe de derecha a izquierda.

El generador exige una oferta aprobada, enlaces HTTPS de soporte, privacidad y términos y evidencia de revisión para los diez locales antes de generar la versión indexable. La candidata local usa `noindex`. Antes de publicar quedan la entrega de correo real, la revisión humana por mercado, la matriz de capacidades, la oferta aprobada, el pago en móvil y la comprobación en el dominio definitivo. [Inicio de la vista previa](DEPLOYMENT.md#vista-previa-comercial-de-lv-005).

La portada comercial muestra los [tres paquetes de minutos](specs/LV-007-candidata-comercial.md#alojamiento-y-paquete-candidato) y un ejemplo de saldo compartido en cada locale. Los casos de obra, capacitación y cambio de turno vinculan un problema concreto con una acción del editor. La demostración sintética y el SRT descargable siguen disponibles.

El alta y el inicio de sesión tienen una tarjeta clara con la identidad visual de LinguistVision. El paso de verificación identifica la dirección que recibe el código y permite cambiarla o pedir otro. La vista previa sigue entregando los códigos al buzón local y el formulario se localiza en los diez idiomas, con dirección RTL en árabe.

La integración vigente usa Firebase Authentication propio de LinguistVision. Google real, compra PayPal Sandbox de US$5 y conservación de 50 minutos tras salir y volver a entrar fueron confirmados por el propietario. El servidor vincula el UID verificado a PostgreSQL y protege saldo y archivos con sesión HttpOnly y comprobación de revocación. Se implementaron correo/contraseña, confirmación y recuperación; falta probar la recepción real de los correos. La integración anterior de Supabase queda como antecedente. [Evidencia Firebase](FIREBASE-VALIDATION-2026-11-10.md) · [Login de producción pendiente de dominio](specs/LV-003-login-produccion.md).

## Verificación previa al lanzamiento

1. Confirmar las variantes escritas y mercados iniciales de los diez idiomas aprobados, los pares anunciados y si la oferta incluye MP4.
2. Probar las diez interfaces, los diez idiomas de transcripción y los pares anunciados con muestras autorizadas. Automatizar estructura y tiempos. Usar revisión humana bilingüe en muestras representativas y rutas de mayor riesgo. Medir costo, reintentos y latencia.
3. Completar pago en modo de prueba, reserva y devolución de crédito, proceso real y descarga en idiomas representativos de distintos sistemas de escritura. Confirmar que los diez recorridos conservan los textos de interfaz y la selección de idioma.
4. Validar las diez páginas públicas, hreflang y sitemap. Tras publicar, medir cobertura real en buscadores.
5. Demostrar reutilización con un adaptador pequeño de PDF sin reescribir cuentas, créditos, trabajos ni descargas.

## Fuentes

- [Google Search: sitios multilingües](https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites)
- [Google Search: versiones localizadas](https://developers.google.com/search/docs/specialty/international/localized-versions)
- [Google Search: optimización para búsqueda generativa](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)
- [OpenAI: rastreadores y controles](https://developers.openai.com/api/docs/bots)

## Revisión externa

T3 recibió la misión de coordinación en Robcaze1980/video_transcript, revisión afe2d4c, tarea mcp:25d4b9b9-5213-4c50-9a41-f57168df9183. El proveedor de coordinación falló por el límite de uso compartido de ChatGPT. T3 no reportó coste. DeepSeek y Kimi no devolvieron revisiones y no se hicieron consultas directas. La propuesta es de Codex y queda pendiente de ambas revisiones.

Segundo intento de coordinación, tarea mcp:5c945077-1806-4110-a99c-441c9e63d816: T3 devolvió HTTP 401, token de autenticación vencido. OpenRouter fue autorizado como canal directo. La comprobación de la credencial del perfil de Windows devolvió HTTP 401. No se enviaron solicitudes de generación a DeepSeek ni a Kimi y no hay cargos de inferencia confirmados. Quedan preparadas las dos consultas independientes, a la espera de una clave vigente para LinguistVision.

### Resultados integrados de DeepSeek y Kimi

OpenRouter aceptó la clave propia de LinguistVision. Las consultas iniciales se enviaron en paralelo con un resumen técnico. DeepSeek respondió y Kimi K3.1 agotó el máximo de salida en dos intentos. Kimi K2.6 completó la revisión con razonamiento desactivado. Los importes de las respuestas se contrastaron con el registro de generaciones de OpenRouter, que muestra menos decimales.

| Modelo e intento | Proveedor | Generación | USD |
| --- | --- | --- | ---: |
| DeepSeek V4.1 Flash, propuesta completa | InferenceNet | gen-1794075355-XCHo4SZlNx9R8JnDqkd1 | 0.0010381041 |
| Kimi K3.1 Pro, sin respuesta visible | Morph | gen-1794075355-G4thHs5ixmTkzIO1Fk5J | 0.0245533464 |
| Kimi K3.1 Pro, reintento sin respuesta visible | Relace | gen-1794075398-lnZrb7PxZyTT6QAkcgWe | 0.038645115795 |
| Kimi K2.6, auditoría completa | Baidu | gen-1794075469-1Fotjn2LdEgbcpQR146F | 0.001537277247 |
| **Total** | | | **0.065773843542** |

- **Arquitectura.** Adoptar la propuesta de DeepSeek de un contrato de adaptadores para validar entradas, cotizar, ejecutar y entregar archivos. La plataforma compartida es parte del diseño futuro. Confirmar su reutilización en un entorno de prueba mediante un trabajo de PDF con las mismas cuentas, créditos, cola y descarga. Consumir el crédito cuando se publique un resultado válido y accesible, aunque el cliente lo descargue después.
- **Cobertura lingüística.** Adoptar una matriz verificable de origen y destino, con estados internos por capacidad. Los 30 idiomas siguen siendo obligatorios. Los 870 pares dirigidos requieren una decisión de alcance. Para cada capacidad anunciada, comprobar tiempos y formato, y evaluar fidelidad del texto con muestras de referencia. Priorizar revisión bilingüe para rutas de riesgo y variantes. Una puntuación BLEU fija sobre una retraducción no acredita por sí sola calidad para todos los pares.
- **SEO y GEO.** Automatizar el rastreo de las 30 variantes públicas y verificar respuestas HTTP, canónicas, reciprocidad de hreflang y concordancia con el sitemap. Separar idioma, mercado y región comercial. Publicar ejemplos sintéticos y cobertura medible, y distinguir visitas observadas de asistentes de auditorías de citas. Google no exige llms.txt ni marcado especial para su búsqueda con IA.
- **Privacidad y costo.** Verificar que una cuenta no pueda leer archivos o trabajos de otra, que se borren entradas y salidas según su retención y que se conozca la retención de cada proveedor. Medir costo por trabajo exitoso, par y minuto, incluyendo reintentos y almacenamiento. Para esta fase, no incorporar blockchain ni infraestructura dedicada por empresa sin una necesidad demostrada.

Para futuras revisiones de LinguistVision no se impone un máximo local de tokens por petición ni un tope local de gasto acumulado. Se conserva el registro de costes por intento. La API de OpenRouter confirmó que la clave del proyecto no tiene límite de gasto por clave. Siguen aplicando las restricciones propias de cada modelo y proveedor y el saldo disponible en OpenRouter.

### Rediseño comercial por problemas y compradores · LV-005

El propietario pide una portada con mayor fuerza comercial, SEO/GEO y usos diversos. La candidata mantendrá las diez rutas y el generador existente. La progresión será: propuesta de valor y demostración real del editor sobre un clip sintético propio; seis situaciones de compradores (obra, taller, formación, comunicación interna, creadores y agencias); controles de revisión; proceso en tres pasos; alcance lingüístico Beta; tres recargas y ejemplo de saldo compartido; preguntas y respuestas visibles en HTML.

Los casos son ilustrativos, no testimonios ni clientes reales. No prometer recuperación de voz inaudible, precisión perfecta, seguridad garantizada, ahorro cuantificado o todos los pares verificados. El clip de demo sigue en inglés y se identifica independientemente del idioma de la interfaz. Los límites privados de 30 segundos y 1 MiB y los pagos de prueba aparecen junto a los precios. La publicación indexable conserva sus condiciones de evidencia, oferta y enlaces legales.

SEO/GEO: títulos y descripciones propios, una jerarquía de encabezados, contenido útil servido sin JavaScript, canónicas y hreflang recíproco, x-default inglés y sitemap de diez. Preguntas concretas sobre edición, formatos, precios y cobertura aportan respuestas verificables; no se añade marcado o llms.txt como promesa de visibilidad. [Google sobre búsqueda con IA](https://developers.google.com/search/docs/appearance/ai-features) · [Versiones localizadas](https://developers.google.com/search/docs/specialty/international/localized-versions) · [OAI-SearchBot](https://developers.openai.com/api/docs/bots).

T3 coordinó revisiones paralelas con un resumen saneado: DeepSeek V4.1 Flash, hilo `mcp:5a3f147e-6eba-40d3-9d72-84259a25c22e`, OpenCode `ses_e3718cf23ffeZ4ZJGhIEO4O05z`, US$0.002353035; Kimi K3.1 Pro, hilo `mcp:6349b7e8-f054-4c4c-8ae3-0617761a48b0`, `ses_e3718c86fffekqivRqp43Hq40w`, US$0.073408. Total registrado **US$0.075761035**, pendiente de conciliación con factura. Revisaron el resumen, sin herramientas ni acceso a archivos; no es una auditoría del código final. Codex contrasta e integra y verifica el resultado.

**Resultado local del rediseño.** La candidata de diez páginas está implementada y servida en `127.0.0.1:3001`. Pasaron tipos, 96 pruebas y compilación; Chrome verificó 320 px para los diez locales, escritorio español/inglés y árabe RTL sin desbordamientos ni bloqueos CSP. La muestra SRT conserva 00:00:00,500–00:00:04,000 y el texto corregido. El editor público monta el video; FAQ y selector responden, incluido teclado. Candidata: `%LOCALAPPDATA%\LinguistVision\releases\commercial-landing-20261110`. Evidencia: `%LOCALAPPDATA%\LinguistVision\validation\landing-redesign-20261110` (`layout-final.json`, `keyboard.json`, capturas). Las traducciones nuevas requieren revisión humana por mercado. El dominio y la publicación siguen pendientes; esta entrega no acredita posicionamiento ni citas de asistentes.

### Caso principal de inspección de techos · LV-005

El propietario aclaró la necesidad que dio origen al producto: inspectores que graban en español y necesitan acompañar el video con subtítulos en inglés para su cliente, junto con un reporte elaborado por el profesional. La portada debe conservar el diseño aprobado y hacer visible la secuencia: grabador, destinatario, barrera de idioma, revisión por el usuario y archivo entregado. Se usará un caso anonimizado, sin presentar el nombre de su empresa como testimonio ni cliente publicado.

La voz original permanece en español. La traducción se genera en Beta y el propio usuario revisa nombres, medidas y tiempos. El MP4 se descarga para que el profesional lo envíe manualmente junto al reporte externo; no se anuncia doblaje, creación de reportes, adjunto automático ni revisión humana incluida. La muestra sintética actual sigue siendo de obra con voz inglesa: no se presentará como demostración de una inspección español→inglés. Los demás ejemplos deben tener esa misma precisión y usar direcciones habilitadas con su condición Beta.

#### Contraste T3 del caso y la portada existente

T3 envió dos revisiones independientes en paralelo por `linguistvision-openrouter`. La primera recibió la necesidad real anonimizada y el alcance; el seguimiento único recibió el titular, la introducción y los seis casos vigentes textuales, junto con la propuesta de mejora. DeepSeek preparó copy y Kimi auditó promesas y claridad. Ninguna ronda dio acceso a archivos, herramientas, empresa o medios privados.

Se adopta el titular «Habla en tu idioma. Haz que tu cliente te entienda.», un ejemplo explícito español→inglés junto al titular y un bloque principal de inspección de techos con grabación, revisión y envío manual. Los seis públicos se conservan y sus ejemplos identifican quién habla, quién lee inglés y qué comprueba el usuario. Se añade respuesta explícita sobre conservación de voz. Se descartan «solo ES→EN disponible», duplicar inspectores desplazando creadores, revisión humana implícita, generación/envío de reportes y condiciones MP4 supuestamente aprobadas.

| Ronda | DeepSeek V4.1 Flash | Kimi K3.1 Pro | Total registrado USD |
|---|---:|---:|---:|
| Necesidad y propuesta | 0.002213904 | 0.071870000 | 0.074083904 |
| Texto actual y mejora | 0.001121787 | 0.073894000 | 0.075015787 |
| Total | 0.003335691 | 0.145764000 | 0.149099691 |

Los importes provienen de OpenCode; conciliación con factura pendiente. DeepSeek: hilo `mcp:ebc2d7c8-d02c-4b2f-8288-b1eed8b6d5af`, sesión `ses_e36feab32ffec2WwTf2Cau1YjA`; Kimi: `mcp:597ec6f6-839b-4626-bfd8-7c76ec281211`, `ses_e36fead6effeZKSUtFH0ysFewc`, seguimiento ordinal 2 en ambos. Codex integra y verifica el código; la revisión de modelos fue editorial y de alcance.

**Implementación verificada.** La candidata `commercial-roof-case-20261110` incorpora el caso principal una sola vez y los cinco usos secundarios en las diez páginas. Pasaron tipos, 96 pruebas, compilación y comprobación de 320px, incluidos RTL y CSP. No cambian los precios ni el comportamiento de cuenta/pagos. La captura `mobile-roof-es.png` permite al propietario revisar el contenido desde el Pixel mientras el enlace interactivo privado sigue pendiente. La demo actual en inglés conserva su idioma y sus marcas; el relato de inspección no se presenta como una nueva demostración ya procesada.

### Segmentación por necesidad y cliente · LV-005

La nueva [matriz de ocho segmentos](specs/LV-005-clientes-usos-y-mensajes.md) distingue quién compra, graba/edita y recibe, con dos mensajes por segmento y consultas de búsqueda propuestas sin volumen medido. Inspecciones y talleres son prioridades compartidas de T3; Codex prioriza formación como tercer caso por el recorrido inglés→español. Inmobiliario permanece como hipótesis. Se añaden usos sin traducción (lectura sin sonido y edición de SRT existente), inferidos por Codex desde el editor. Se mantienen diez páginas localizadas y se propone ampliar rutas solo con evidencia y contenido propios.

Esta ronda fue de análisis y planificación, no cambió las páginas servidas. Costes registrados: DeepSeek US$0.003237816 y Kimi K3.1 Pro US$0.091004; total US$0.094241816, factura por conciliar. Las fuentes oficiales y las sesiones están enlazadas en la matriz.
