# LV-005 · Clientes, usos y mensajes

Fecha: 2026-11-10. Estado: propuesta editorial analizada por T3 y contrastada por Codex. La portada ya implementada conserva su diseño; esta ronda amplía la estrategia, sin crear rutas, cambiar la oferta o publicar. [Plan maestro](../../MASTERPLAN.md) · [Backlog](../../backlog.md#lv-005).

## Decisión de mensaje

Claude Design preparará una base de diseño compartida, con recorrido completo en español y pruebas representativas de expansión, RTL y escrituras. T3 revisó el prompt íntegro; [dictamen y costes](LV-005-claude-design-revision.md) · [prompt actualizado](LV-005-claude-design-prompt.md). No se duplican diez diseños ni se sustituye la revisión por idioma.

Mantener «Habla en tu idioma. Haz que tu cliente te entienda.» para el recorrido de traducción. Dar espacio también a dos necesidades diferentes: hacer legible un video sin sonido y corregir subtítulos existentes sin volver a transcribir. La portada debe ayudar al visitante a reconocerse en una situación, en vez de mostrar solo nombres de sectores.

Cada caso identifica: quién paga, quién graba o edita, quién recibe, qué dificulta comunicar el mensaje, qué revisa el usuario y qué archivo obtiene. Un sector puede tener varios usos; un mismo uso puede servir a varios sectores. El caso de inspección surge de la necesidad real del propietario; los demás son hipótesis de encaje, no pruebas de demanda, clientes reales o casos de éxito.

## Matriz de segmentos

| Segmento | Comprador / usuario / destinatario | Escenario principal | Segundo escenario y entrega |
|---|---|---|---|
| Inspecciones de techos y propiedad | Empresa o inspector / inspector / propietario | El inspector graba hallazgos en español y prepara subtítulos en inglés para el dueño. Revisa materiales, medidas y tiempos. | Explicar una recomendación después de la visita. El profesional descarga el video y lo envía junto al reporte que redacta por separado. |
| Talleres de reparación | Dueño o encargado / mecánico / cliente | El mecánico explica en español qué pieza cambió; el cliente lee subtítulos en inglés. Revisa nombres de piezas y recomendaciones. | Enseñar un cuidado posterior a la reparación en un clip grabado. El taller descarga y envía el video; presupuestos y diagnósticos son externos. |
| Formación de operarios | Responsable de operaciones o formación / instructor / operarios | Una explicación grabada en inglés necesita subtítulos en español para la cuadrilla. Se comprueban términos y sincronía. | Un nuevo compañero repasa un paso de un procedimiento ya grabado. Se entrega SRT o video subtitulado; no formación en vivo ni certificación. |
| Remodelación e instalación | Contratista o instalador / encargado / propietario | Un recorrido en español explica un trabajo a un cliente que lee inglés. Se revisa que el texto conserve alcance, materiales y medidas. | Explicar qué incluye una reparación antes de que el cliente lea el presupuesto preparado aparte. El video acompaña ese documento; la app no lo crea. |
| Entrega de turno | Empresa / supervisor / cuadrilla entrante | El supervisor registra pendientes en inglés y prepara subtítulos en español para el equipo siguiente. | Una instrucción se repasa sin sonido en el lugar de trabajo. Se descarga y comparte el clip; no hay seguimiento automático de tareas. |
| Creadores y profesionales que enseñan | Creador / mismo o editor / audiencia | Un tutorial grabado recibe subtítulos en el mismo idioma para verlo sin sonido. Se ajustan texto, tiempos y estilo. | Una audiencia que habla otro idioma recibe una versión subtitulada en un par Beta habilitado. Se exportan SRT o MP4 para publicación manual. |
| Inmobiliarias | Agencia o agente / agente / posible visitante | El agente graba un recorrido en español y revisa subtítulos en inglés para el visitante. Se comprueban habitaciones, nombres y medidas. | Responder una pregunta sobre un espacio con un clip grabado. El agente envía el archivo; la app no redacta anuncios ni documentos de compraventa. |
| Agencias y editores | Agencia o profesional / editor / cliente final | El cliente ya entrega un SRT. El editor lo importa, corrige frases y tiempos y exporta sin volver a transcribir. | Comparar original y traducción, mantener estilo y reabrir el proyecto para cambios. Se entregan archivos; no se publica automáticamente en plataformas. |

## Mensajes por cliente

| Segmento | Mensaje principal | Mensaje de apoyo |
|---|---|---|
| Inspecciones | Graba la inspección en español. Tu cliente puede leerla con subtítulos en inglés. | Revisa materiales, medidas y tiempos; envía el video junto al reporte que preparas aparte. |
| Talleres | Explica la reparación con tu voz. Añade subtítulos para tu cliente. | Enseña qué pieza cambiaste y revisa la traducción antes de enviar el video. |
| Formación | Explica el procedimiento en inglés. Prepara subtítulos en español para tu equipo. | Deja un paso grabado que cada compañero pueda repasar mientras lee. |
| Remodelación | Muestra qué vas a reparar y acompaña tu explicación con subtítulos para el propietario. | Comparte el recorrido junto al presupuesto que preparas por separado. |
| Turnos | Deja el pendiente explicado en video para la siguiente cuadrilla. | Revisa los subtítulos en su idioma antes de compartir el clip. |
| Creadores | Haz que tu tutorial también se pueda seguir sin sonido. | Corrige frases, ajusta el estilo y descarga el video para compartirlo. |
| Inmobiliarias | Recorre la propiedad en tu idioma. Añade subtítulos para tu visitante. | Revisa las descripciones y medidas antes de enviar el recorrido. |
| Agencias | ¿Ya tienes un SRT? Corrígelo sin volver a transcribir. | Ajusta texto, tiempos y estilo; guarda el proyecto para la próxima revisión. |

Estos son borradores de contenido. No se han medido comprensión, disposición a pagar, tráfico o conversión. Los mensajes no implican que todos los idiomas o pares estén verificados ni que la revisión humana esté incluida: revisa el propio usuario.

## Prioridad propuesta

1. Inspecciones: hay una necesidad concreta aportada por el propietario y un destinatario claro. Es el caso principal de la portada.
2. Talleres: encaja en una explicación breve del profesional al cliente, utilizando el flujo actual. La demanda sigue sin medir.
3. Formación: aporta el sentido inglés→español y distingue comprador, instructor y receptor. Codex lo prioriza por variedad de necesidad y encaje funcional, no por tamaño de mercado demostrado.
4. Creadores y editores: incluir como caminos de producto sin exigir traducción. Ver sin sonido e importar SRT son inferencias de Codex basadas en funciones actuales; no fueron conclusiones desarrolladas por ambos modelos.
5. Remodelación y turnos: variantes dentro de trabajo de campo/equipos; aprovechar secciones, sin forzar páginas casi idénticas.
6. Inmobiliarias: hipótesis de exploración. DeepSeek lo propuso como tercero; Kimi prefirió formación. No hay datos de demanda que resuelvan esa diferencia.

## SEO: intención antes que multiplicación de páginas

Las consultas siguientes son hipótesis para investigación, no palabras clave con volumen acreditado.

| Necesidad | Consultas candidatas | Pregunta que debe responder la página |
|---|---|---|
| Explicar una inspección a otro idioma | subtítulos para videos de inspección; Spanish roof inspection video English subtitles | ¿Cómo envío una inspección en español con subtítulos en inglés junto a mi reporte? |
| Explicar una reparación | subtítulos para explicación de reparación; mechanic video English Spanish subtitles | ¿Puedo mantener mi voz y traducir solo el texto? |
| Preparar formación grabada | traducir capacitación inglés español; subtitles for recorded employee training | ¿Cómo reviso términos y tiempos de una instrucción para mi equipo? |
| Acompañar un presupuesto externo | video de obra con subtítulos; subtitled contractor walkthrough | ¿El video se puede enviar junto a un presupuesto que ya preparé? |
| Relevo de equipo | subtítulos para entrega de turno; bilingual shift handover video | ¿Pueden leer el pendiente sin activar el sonido? |
| Publicar tutorial con captions | subtitular tutorial sin sonido; add captions to a recorded tutorial | ¿Qué descargo para compartir un video con el texto visible? |
| Recorrido de propiedad | subtítulos para recorrido de propiedad; real estate video translated subtitles | ¿Cómo reviso nombres de espacios y medidas antes de enviarlo? |
| Corregir archivo existente | editar SRT online; fix SRT timing without retranscribing | ¿Puedo importar mi SRT y corregirlo sin volver a usar la transcripción? |

Mantener las diez páginas localizadas existentes. Primero agrupar necesidades en la portada y usar anclas o secciones claras. Crear una página específica solo cuando aporte su propio caso, pasos, demo y muestra descargable, además de respuestas diferentes. Las traducciones deben conservar ese valor y adaptarse al mercado; el número de interfaces no obliga a generar ocho casos por diez idiomas por cada par.

Las posibles familias editoriales son: explicar un trabajo al cliente, formar/coordinar un equipo, preparar contenido para una audiencia y corregir subtítulos existentes. Los sectores se conectan con esas necesidades, evitando páginas que solo cambien una profesión en el titular. No se anuncian nuevas rutas en esta entrega.

Google recomienda contenido útil para una audiencia concreta y advierte contra producir variantes principalmente para manipular resultados o respuestas generativas. Se contrastó con [contenido útil](https://developers.google.com/search/docs/fundamentals/creating-helpful-content), [guía de búsqueda generativa](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide) y [políticas de spam](https://developers.google.com/search/docs/essentials/spam-policies). Las versiones equivalentes conservan canónicas, alternancias recíprocas y x-default: [documentación](https://developers.google.com/search/docs/specialty/international/localized-versions).

## GEO: una respuesta que se pueda comprobar

Para cada necesidad, colocar en HTML una respuesta breve, el recorrido y un ejemplo verificable. Una ficha útil distingue idioma de voz, idioma del subtítulo, quién revisa, archivo descargado y qué ocurre fuera de la aplicación. Por ejemplo: «Puedes conservar la voz en español y revisar subtítulos en inglés antes de exportar el video. Tú lo envías junto al reporte que preparas por separado».

Respaldar el caso con una muestra propia o autorizada para publicación, su SRT y las condiciones de la capacidad. No reutilizar videos privados de clientes como marketing. La demo actual inglesa de obra no demuestra una inspección español→inglés: para ese contenido se preparará una muestra pertinente antes de anunciarla como demo del flujo.

Preguntas esenciales: ¿cambia la voz?, ¿quién revisa la traducción?, ¿qué diferencia hay entre SRT y MP4?, ¿puedo corregir un SRT existente?, ¿qué pares están habilitados?, ¿qué duración/tamaño admite?, ¿la app genera o envía el reporte? No repetir la misma FAQ bajo cada oficio ni añadir marcado o archivos de IA como promesa de citas. Las respuestas claras ayudan a explicar el servicio; no garantizan aparición, posiciones o recomendaciones.

## Comprobación comercial y próximos cambios

- Validar primero que el mensaje describe una tarea que el usuario realiza y un destinatario concreto. Registrar qué graba, qué idioma necesita el receptor, qué archivo envía y qué corregiría antes de enviarlo.
- Preparar demostraciones breves acordes al piloto, que sigue en 30 segundos y 1 MiB por archivo. No promover clases largas, videos extensos o cargas comerciales mayores hasta verificarlos.
- Separar evidencia funcional de demanda comercial: las pruebas del editor no acreditan compras repetidas de talleres, agencias o inmobiliarias. El pago Sandbox del propietario tampoco mide demanda.
- Proponer identificadores de uso anónimos (p. ej. inspection, repair, training, silent_video, existing_srt) para comparar visita → demo → alta → compra acreditada → primer trabajo válido → repetición. Las mediciones por segmento están propuestas, no implementadas. Mantener pruebas separadas de compras reales y deduplicar confirmaciones.
- Revisar qué tres casos ayudan más a elegir el servicio antes de añadir rutas. Las entrevistas son una opción, sin cuota obligatoria ni supuesto significado estadístico.

## Revisión T3 y costes

Una ronda en paralelo por `linguistvision-openrouter`, con texto vigente y contexto técnico mínimo saneado. Cero herramientas o lecturas de archivos para ambos revisores; sin nombre de empresa, claves o medios privados.

| Modelo | Hilo T3 | Sesión OpenCode | Coste registrado USD |
|---|---|---|---:|
| DeepSeek V4.1 Flash | mcp:3dec2817-1084-4b28-a8ca-e468ef878fea | ses_e36decc38ffe0Po3t93Gq0Gyon | 0.003237816 |
| Kimi K3.1 Pro | mcp:b336bbdd-b267-4a90-9d4c-f24bba408e29 | ses_e36debb2affexHK7UzzFybiG65 | 0.091004000 |
| Total | | | 0.094241816 |

Importes registrados por OpenCode, pendientes de conciliación con factura. No se persistió ID de generación de OpenRouter y no se inventa uno. DeepSeek propuso segmentación y mensajes; Kimi revisó límites y prioridades de forma independiente. Codex conserva los ocho segmentos, prioriza formación frente a inmobiliario por encaje funcional y añade los usos monolingüe/SRT existente. Se descarta multiplicar subrutas de poco valor o suponer que una traducción equivale a cobertura verificada.

Esta entrega es documental: no modifica precios, código, cuentas, archivos, las páginas servidas ni la publicación. [Candidata comercial](../MULTILINGUAL-ARCHITECTURE.md#caso-principal-de-inspección-de-techos--lv-005).

## Aclaración posterior: el ejemplo parte del idioma de cada página

El propietario aprobó que la página francesa describa un video grabado en francés, la alemana uno en alemán y así con los diez idiomas. Cada una presentará los otros nueve como destinos objetivo del producto, con el estado real de habilitación/validación. Los ejemplos anteriores ES→EN se conservan como referencia de origen del producto; no deben repetirse literalmente en todos los mercados. El idioma de interfaz del editor no determina el idioma real del archivo cargado.

La implementación debe derivar los destinos del catálogo único y comprobar cardinalidad nueve, exclusión del origen y reciprocidad de las 90 direcciones. Solo se anuncian como utilizables las opciones efectivamente habilitadas; las demás se identifican como pendientes. No es necesaria una nueva página por cada par. Esta aclaración no modifica todavía las páginas servidas ni habilita nuevos pares en el procesador.
