# LV-005 · Portada comercial, diseño 2

2026-11-11. Integración local verificada; LV-005 sigue en curso. Fuente: `linguistvision-diseno_2.zip` entregado por el propietario. Comparado con el ZIP anterior: cambian Landing, Landing-Movil, Spec-SEO e instrucciones; se añade una ilustración FAQ. Acceso, panel y editor no cambian en este incremento.

Trasladar la portada al renderer existente sin Shadcn ni runtime de diseño: hero de cuatro escenas por etapas/ciclo de 8 s, pasos por ciclo de 7 s, tres recargas en columnas, FAQ con 17 respuestas en cuatro temas y búsqueda, footer con destinos existentes. Mantener diez locales y rutas, metadatos, CSP, noindex y reglas de producto.

No adoptar datos ficticios del prototipo: portugués no queda habilitado por aparecer Beta en el diseño; no existe cotización previa del servidor ni regla de 28 s → 1 min; límites siguen en 30 s / 1 MiB / 24 h y pagos de prueba. No añadir «Recomendado» sin decisión comercial. La ilustración suministrada puede mostrarse en privada; confirmar derechos antes de publicar. Las etiquetas de corrección muestran la revisión del usuario, no una revisión humana incluida en el precio.

Aceptación: HTML y enlaces útiles sin JS; foco/teclado, selección manual, pausa/reanudar y suspensión temporal con hover/foco/video/offscreen/pestaña oculta. Movimiento reducido estático sin autoplay. Sin HTML inyectado ni estilos dinámicos bloqueados por CSP. Comprobar secuencia, tiempos, no saltos, búsqueda entre temas, cero resultados y limpieza de timers. Repetir diez locales a 320/390/768/1280 px, texto al 200 %, condiciones/precios/SEO y regresión de cuenta/editor. Nueva candidata aislada antes de sustituir la candidata de 3001; no publicar.

## Revisión y decisiones

T3 coordinó dos revisiones independientes vía `linguistvision-openrouter`, con el contexto técnico mínimo y sin vídeos, claves ni transcripciones privadas. DeepSeek propuso la traducción mínima al renderer existente; Kimi condicionó el cierre a pruebas de comportamiento, accesibilidad y reglas de oferta. Revisaron el plan, no el código final. La auditoría local de Codex reprodujo y corrigió la pausa del video externo al widget, el contador de búsqueda sin marcador, el foco en una descarga inicialmente transparente y los controles inertes sin JavaScript.

No se adoptó la confusión entre 90 direcciones de traducción y 90 URL: son diez páginas localizadas. Las 24 horas siguen siendo retención del proyecto, no caducidad del pago. Una pausa contextual puede reanudarse al salir de su contexto; una pausa manual permanece hasta que la persona la cambie.

| Revisor | Hilo T3 | Sesión OpenCode | Coste registrado USD |
|---|---|---|---:|
| DeepSeek V4.1 Flash | mcp:776b5820-36a4-40b6-9cd8-55b47a0dbc79 | ses_e34211d25ffellm7rySGmxR0CT | 0.002686236 |
| Kimi K3.1 Pro | mcp:678cf71e-8717-43c8-9116-85d1e1a2a72f | ses_e34211ea7ffevaQqyzYL8ms5BJ | 0.105470000 |
| Total | | | 0.108156236 |

Coste de uso registrado por OpenCode, pendiente de conciliación con factura. No hay ID de generación persistido; no se inventa. Sin llamadas nuevas a Gemini.

Fuente ZIP SHA-256: `DF3E83ECE65286A23E517213B9D27B7ECF83C2CF962D92B17227E9EDADE0886B`.

## Resultado de aceptación

- Node.js 24.13.0. Candidata aislada `%LOCALAPPDATA%\LinguistVision\releases\commercial-v2-20261111`, instalada con `npm ci --include=dev`: 0 vulnerabilidades auditadas. Tipos, 96 pruebas/17 archivos y las dos compilaciones correctas. Se mantiene el aviso previo de tamaño de bundle; no es un error de compilación.
- [Prueba reproducible de portada](../../scripts/qaCommercialV2.ts): 80 combinaciones de diez locales × cuatro anchos (320/390/768/1280) × texto al 100/200 %, 320 cambios manuales de escena, altura estable (variación de 0 px), cero excepciones y cero violaciones CSP. Se verificaron fases automáticas, teclado LTR/RTL, pausas, contador localizado, búsqueda/limpieza y movimiento reducido, sin contenido de paneles ocultos. Sin JavaScript siguen las cuatro escenas, los tres pasos y las 17 respuestas HTML; se ocultan controles que requieren mejora.
- Evidencia y diez capturas: `%LOCALAPPDATA%\LinguistVision\validation\commercial-v2-20261111\run-AfbuNl\acceptance.json`.
- [Regresión de cuenta/editor](../../scripts/qaClaudeDesign.ts): 280 vistas, cero errores; importación sintética → corrección → guardar → reabrir → SRT/MP4. Importar/editar conserva 600 segundos; trabajo sintético de 6 segundos deja 594. Se probaron rechazo de destino pendiente, conservación del par al cambiar interfaz, recuperación de 503 y salida con cambios sin guardar. Esquemas/cuentas temporales; sin tocar la cuenta real ni llamar a Gemini o PayPal. Evidencia: `%LOCALAPPDATA%\LinguistVision\validation\claude-design-20261111\run-44VNSP\acceptance.json`.
- Control del reproductor y reloj: `%LOCALAPPDATA%\LinguistVision\validation\landing-controller-check.cjs` verifica pausa por video externo, hover/foco/viewport, selección manual, bfcache y cambio de preferencia de movimiento.
- Candidata activada únicamente en `127.0.0.1:3001`, PID44604 en esta entrega. Portada ES/EN/PT, registro/acceso, módulo de animación, imagen y SRT responden 200; cuenta sin sesión devuelve 401. La anterior `claude-design-20261111` queda conservada para revertir. Se conservan Firebase dev y PayPal Sandbox; no se habilitan cobros reales.

Pendiente: revisión editorial nativa por mercado, prueba física Pixel del nuevo diseño, perfil/historiales en el backend autorizado posterior, derechos de ilustración antes de publicar, dominio/proyecto Firebase productivo y gates LV-003/LV-004/LV-007. La prueba responsive no sustituye al teléfono físico ni certifica un lector de pantalla. No se anuncia calidad de las 90 direcciones ni publicación.

## Corrección de fidelidad de cabecera y hero · 11 de noviembre

El propietario rechazó las diferencias visuales frente a la captura del ZIP2: marca con icono añadido, navegación distinta, selector desplegable diferente, login sin borde, ancho/saltos del título, botones/iconos y ausencia de la nota de precio/piloto. Este incremento reproduce la cabecera y la introducción del hero a partir de sus medidas originales, con la tipografía Inter alojada localmente. Mantiene rutas, diez traducciones y comportamiento. Comparar al mismo ancho con un fragmento estático del diseño, sin ejecutar su runtime ni publicar. No se amplía backend comercial ni cobertura.

## Sustitución de la reinterpretación por la portada española del ZIP

El propietario amplió la corrección a toda la portada tras comprobar diferencias en el ejemplo y Cómo funciona. La versión española pasa a `claudeLandingEs.ts`: estructura, textos, SVG, medidas y estilos del archivo Landing, con atributos de estilo trasladados a reglas CSP y sin ejecutar DCLogic, support.js ni expresiones del diseño. Los datos de las cuatro escenas y 17 FAQ se extrajeron como literales mediante análisis sintáctico, sin evaluar el script suministrado. Las nueve traducciones anteriores permanecen como borradores; no se certifica una igualdad visual de diez portadas a partir de una referencia española.

La cabecera, hero, ejemplo de tres columnas, Cómo funciona (tres tarjetas), Otros usos, idiomas, precios, FAQ, cierre y pie mantienen el contenido español original. Inter se sirve localmente con su licencia SIL OFL; el título HTML también coincide con el original. Se conservan los destinos reales de registro, acceso, recuperación y páginas localizadas. Soporte/legales sin destino conservan el texto y aspecto, con `aria-disabled`, sin enlaces falsos. Los anclajes anteriores tienen alias sin espacio visual.

La orden actual de respetar todo el contenido incluye la etiqueta visual «RECOMENDADO» del paquete central en la candidata privada. No se convierte en evidencia de ahorro, popularidad ni aprobación de publicación. La tabla conserva expresamente el rótulo «Estados de ejemplo para el diseño»; no habilita portugués ni otra dirección. El consumo 28 s → 1 min del mock y la previsión previa siguen siendo contenido ilustrativo del ZIP; el servidor cobra segundos y no se modificó su cálculo. Antes de publicar se debe sustituir esa ilustración por datos correctos y comprobar las afirmaciones sobre consumo previo, oferta MP4, vigencia de minutos, idioma y soporte/legal. Fidelidad a una maqueta no demuestra esas capacidades.

### Revisión final T3 (distinta de la ronda del plan)

T3 coordinó DeepSeek y Kimi K3.1 Pro en paralelo con fuente, contenido generado, estilos/controlador y mediciones. Ambos respaldan la fidelidad del texto visible español. Codex corrigió la diferencia confirmada de `<title>`; descartó el aviso de Kimi sobre ausencia de `<main>` porque sí está presente. También descartó su interpretación de redondear minutos: el servidor sigue midiendo segundos. Los modelos no recibieron capturas; no se presenta su revisión textual como certificación visual absoluta ni de los diez idiomas.

| Revisor | Hilo T3 | Sesión OpenCode | Coste registrado USD |
|---|---|---|---:|
| DeepSeek V4.1 Flash | mcp:a109fa7b-ba52-4730-9243-a7256a21b41f | ses_e33f6df15ffeJu7GPmvBrchLZG | 0.004679637 |
| Kimi K3.1 Pro | mcp:47b3cf01-4fc4-43de-9d69-d819dbf8347b | ses_e33f6de56ffem88dYXtx0ObAWI | 0.199152000 |
| Total de la revisión final | | | 0.203831637 |

Un intento por modelo. Costes de uso registrados por OpenCode, pendientes de conciliación con factura; sin ID de generación persistido. No hubo llamadas a Gemini ni pagos reales.

### Evidencia final de fidelidad y candidata activa

- Comparación de cabecera/hero a 1120/1440 y de la página completa a 390/1120/1440: 68 medidas, diferencia máxima de 0 px. `validation/header-fidelity-20261111/run-mQyDov/acceptance.json`.
- Comparación píxel por píxel de la página completa ES, estado estático y movimiento reducido, con referencia de marcado/estilos/literales extraídos del ZIP (sin ejecutar DCLogic):390×11324,1120×6176 y1440×6263. **0 píxeles diferentes** en las tres imágenes. `validation/header-fidelity-20261111/run-mQyDov/pixel-comparison.json`. Las adaptaciones de destino/atributos y los envoltorios técnicos sin efecto visual se aplican a la referencia. Esto no compara todos los estados de animación ni otros navegadores.
- Cotejo literal: 17 preguntas/respuestas y todos los valores de las cuatro escenas presentes, sin faltantes ni errores de codificación. `design-import-v2-20261111/content-parity.json`.
- [Prueba de la portada](../../scripts/qaClaudeExact.ts): 50 vistas/diez locales, cero errores/desbordamientos/CSP; las cuatro escenas y los tres pasos seleccionan su panel; búsqueda y 17 FAQ sin JS correctos. Candidata final: `validation/claude-exact-20261111/run-f4fzVS/acceptance.json`. [Comparación con el diseño](../../scripts/qaCommercialHeader.ts).
- 96 pruebas / 17 archivos, tipos y ambas compilaciones correctos en la candidata aislada; instalación con `npm ci --include=dev`, auditoría de 0 vulnerabilidades. Regresión de cuenta/editor: 280 vistas, guardar/reabrir y SRT/MP4 sintéticos correctos, sin llamadas Gemini/pagos externos. `validation/claude-design-20261111/run-nMLGOo/acceptance.json`.
- Activa `%LOCALAPPDATA%\LinguistVision\releases\claude-zip2-exact-20261111`, sólo 127.0.0.1:3001, PID64944. Anterior `commercial-v2-20261111` conservada. HTTP activo: portada/acceso/recuperación/fuentes/módulo/imagen 200, cuenta sin sesión 401, noindex y hash CSP coincidente. `validation/claude-exact-20261111/active-http.json`. Las rutas de evidencia se resuelven bajo `%LOCALAPPDATA%\LinguistVision`.

No se declara «certificación 100 %» de los revisores: el dictamen T3 es textual/de código; la igualdad visual medida la acredita Codex en estas tres capturas estáticas españolas. Las otras nueve portadas siguen como borradores y no se incluyen en esta equivalencia. Continúan las condiciones de publicación ya indicadas.

## Corrección de las tres tarjetas de Cómo funciona

El propietario reabrió los tres estados. La comparación estática anterior con movimiento reducido no demostraba la selección manual con animación normal. Se reprodujo el fallo en los seis casos (390/1280 px × tres pasos): el controlador marcaba selección manual y pausaba el reloj, pero las animaciones CSS de `.q` y `.ty` quedaban en opacidad 0 o con el texto recortado al 100 %. Las tarjetas podían quedar en blanco indefinidamente.

Cambio de producción mínimo: sólo en Cómo funciona y selección manual, `.q`/`.ty` pasan a `animation:none!important`, mostrando el fotograma final completo. Texto, diseño, precios y cobro se conservan. El ciclo automático mantiene sus tres pasos y 7 s por paso.

[Prueba específica reproducible](../../scripts/qaHowCards.ts): utiliza las tarjetas extraídas directamente del Landing del ZIP (no del HTML generado) como referencia y la página de la aplicación como objeto de prueba. Antes: `validation/how-cards-20261111/run-e7hSQt/acceptance.json`, seis fallos de visibilidad. Después: `run-yolzyz/acceptance.json`, cero fallos, dimensiones coincidentes, todos los elementos opacos y sin recorte en cada paso, más 22 s de ciclo automático que recorren los tres. Las capturas están junto a cada JSON. El registro de comparación de imágenes conserva las diferencias de imagen observadas; **no se declara igualdad píxel por píxel de estas seis capturas** ni se reutiliza la afirmación anterior para esos estados.

Candidata `%LOCALAPPDATA%\LinguistVision\releases\claude-how-cards-20261111`, instalada con npm ci; tipos, 96 pruebas / 17 archivos y ambas compilaciones correctos, auditoría de 0 vulnerabilidades. Activada sólo en 127.0.0.1:3001, PID71452. HTTP 200, tres paneles, noindex, regla manual presente y hash CSP del estilo coincidente (`validation/how-cards-20261111/active-http.json`). La candidata anterior se conserva para volver atrás. No hubo pagos reales ni llamadas a Gemini.

T3 revisó el parche y la evidencia en paralelo, de forma textual; ambos revisores aprobaron el arreglo acotado condicionado a las comprobaciones de candidata y CSP que ya pasaron. No inspeccionaron imágenes ni certificaron fidelidad visual absoluta.

| Revisor | Hilo T3 | Sesión OpenCode | Coste nuevo registrado USD |
|---|---|---|---:|
| DeepSeek V4.1 Flash | mcp:e4ec2ca0-0fa0-4da3-abad-56b77090a058 | ses_e33e0f426ffeECwlg8mQULtnAX | 0.001122804 |
| Kimi K3.1 Pro | mcp:2dc4d7c8-d63f-4a57-ad99-72d620e56335 | ses_e33e0f444ffe2n3xX6kADXjwAL | 0.083064000 |
| Total nuevo | | | 0.084186804 |

Un intento por modelo, cero herramientas de los revisores. Uso registrado por OpenCode, conciliación con factura pendiente; sin ID de generación persistido. Esta ronda se registra separada de la anterior.

## Auditoría completa con animaciones activas · 2026-11-11

Esta auditoría sustituye como referencia de fidelidad dinámica las capturas estáticas adaptadas y el parche manual de fotograma final anteriores. Se compara el Landing original del ZIP2, su CSS y callbacks Component mediante un renderizador de pruebas aislado; no se dispone del motor completo de Claude Design. No constituye certificación universal del 100 % ni equivalencia de las otras nueve traducciones.

Correcciones confirmadas: reiniciar clases A/B y HA/HB en selección y pausa/reanudación; conservar el avance automático de Cómo funciona al escoger un paso; reproducir el efecto de la escena elegida aunque se pause el cambio de escenas; reiniciar el intervalo completo después de un callback retrasado; eliminar pausas por foco/hover añadidas a ES; eliminar espacios extra de 24/28 px causados por anclas; aplicar búsqueda FAQ al enviar, singular correcto, restaurar recuadro vacío y enlaces visuales; título OG coherente. Se conservan suspensión fuera de pantalla/documento y movimiento reducido. Soporte/legal sin destino permanecen deshabilitados. Sin cambios de cobro, cuenta ni backend.

[Prueba independiente activa](../../scripts/qaLandingAnimated.ts) y [renderizador de referencia](../../scripts/fixtures/claudeReferenceRuntime.js): 10 secciones ×390/1280 px, geometría coincidente; cuatro escenas y tres pasos ×dos anchos ×cinco instantes =70 pares de fotogramas, propiedades animadas coincidentes. Se verifican 22 s de avance real, pausa/reanudación, retraso de temporizador, FAQ por envío, singular, limpiar, recuadro vacío y movimiento reducido. Cero excepciones y fallos. Evidencia de candidata: `%LOCALAPPDATA%\LinguistVision\validation\landing-active-audit-20261111\run-N1C7A4\acceptance.json`, `frames.json` y capturas. La referencia usa el original, no el marcado generado de producción; su pequeño motor de pruebas no sustituye el runtime propietario. La primera referencia de tabla defectuosa se corrigió antes del cotejo final y se exige que ambas tablas tengan nueve filas.

Candidata `claude-active-audit-20261111`: npm ci, tipos,96/96 pruebas y ambas compilaciones correctos; auditoría activa final sin fallos. Sólo previsualización local en3001; candidata previa conservada. No publicado. Siguen pendientes catálogo real y capacidades anunciables, soporte/legales, traducciones revisadas y gates comerciales/de acceso/pago móvil.

### Revisión T3 de esta auditoría y costes

DeepSeek V4.1 Flash y Kimi K3.1 Pro revisaron en paralelo texto/código; no inspeccionaron imágenes. Codex contrastó sus observaciones contra el original y el navegador, adoptó las confirmadas y descartó inferencias no reproducidas. No se toma su dictamen como certificación visual.

| Consulta | Vía | Coste registrado USD |
|---|---|---:|
| DeepSeek V4.1 Flash | T3, mcp:c80310c2-dd1f-44a8-b019-7035e156b34b | 0.021634098 |
| Kimi K3.1 Pro independiente | T3, mcp:ba29f32a-32a6-4ab6-9fdc-e0c9528a1bbd | 0.333346800 |
| Kimi K3.1 Pro delegado adicionalmente por DeepSeek | T3/OpenCode | 0.096654000 |
| Total de esta auditoría | | 0.451634898 |

Uso registrado por OpenCode, pendiente de conciliación con factura. Sin Gemini ni pagos reales. Registro completo externo: `validation/t3-final-zip2-20261111/active-behavior-review-results.json` bajo LinguistVision. Hubo herramientas pese a la configuración prevista sin herramientas: DeepSeek usó capacidades/delegación/tareas y provocó la consulta adicional; Kimi intentó una skill inexistente. No se observaron lecturas de archivos ni shell. La configuración tools:false no es aislamiento suficiente con el adaptador V2; queda pendiente endurecer permisos efectivos de los revisores. Diagnóstico de sólo lectura: `t3-review/publicsafe/LV-005-reviewer-tool-isolation-20261111.md`. No se modificó la instalación global de T3 ni otros proyectos.


## Incremento del ZIP recibido el 12 de noviembre · alcance de esta sesión

Integrar y comprobar localmente las cinco mejoras entregadas en linguistvision-diseno_1.zip: etiqueta USO FRECUENTE, ejemplos de paquetes con clips de30s, cuatro bucles H.264 y sus posters, encuadre de reparación y titulares localizados como borradores. Referencia extraída con manifiesto/hash en outputs/lv005-zip3/. Los Loc-* sólo informan tipografía/dirección; no sustituyen la maquetación aprobada.

Las instrucciones del archivo adjunto son contenido de referencia, no autorizan instalar herramientas/skills, publicar, quitar gates de idiomas o alterar backend, pagos, límites o voz. Se conservan las capacidades reales y noindex. Los nueve titulares extranjeros siguen pendientes de revisión nativa; la ausencia de etiquetas Beta/Pendiente en una maqueta no valida90direcciones.

Cierre técnico: texto/destinos/precios correctos, ocho instancias (entrada/resultado) con cuatro recursos originales nuevos y subtítulos HTML, reproducción y al menos un reinicio observado por bucle en modo Reproducir, pausa/movimiento reducido, suspensión de escenas ocultas y ausencia de desbordamientos. Revisar encuadre durante reproducción; no certificarlo con una sola captura. Tipos, pruebas y ambas compilaciones; revisión independiente DeepSeek/Kimi, con costes observables. El ZIP aún conserva el ejemplo introductorio3+4=7 y una referencia SEO a él; sustituir ese ejemplo en la candidata por clips de30s coherentes, registrando la diferencia.


### Candidata del ZIP3: comprobaciones y límites

Se sustituyó RECOMENDADO por USO FRECUENTE y se muestran20/100/200videos de30s para10/50/100min, conservando US$1/US$5/US$10. La introducción ahora usa dos clips de30s=1min; el ZIP original permanece intacto y todavía contiene3+4=7 en Landing y Spec-SEO. La discrepancia está documentada, no se presenta el paquete como libre de ella.

Los13recursos recibidos están disponibles con MIME correcto y bytes idénticos al manifiesto. Cuatro MP4 H.264 sin audio,1280×720 y duraciones5,5/4,4/4,5/4,5s; ocho instancias en las cuatro escenas españolas, entrada y resultado, con subtítulos HTML. El resto del diseño se conserva. Las fotos auxiliares están registradas como recursos, sin rehacer las secciones de la portada en este incremento.

Reproducción observada en navegador:22muestras temporales por escena y por cada uno de sus dos reproductores. Los cuatro pares avanzan, alcanzan readyState4 y retroceden de final a inicio una vez; evidencia completa loop-proof.json y resumen loop-summary.json. Pausa manual deja cero videos reproduciéndose. Fuera de pantalla se vacían las ocho fuentes y quedan cero videos activos. Escenas inactivas no tienen src. Las pruebas de política cubren pausa/invisibilidad y rechazo de autoplay; no se emuló realmente prefers-reduced-motion en el SO. No se atribuye esa prueba real a un mock.

Reparación: poster y muestras de reproducción centrados en bomba/depósito, sin cara o placa de la caja visibles en esas muestras. No se certifica reconocimiento exhaustivo de todas las marcas ni derechos por esta inspección.

**Observación visual pendiente:** Inspección todavía tiene una discontinuidad entre extremos, con cambios en los pies y el encuadre. La medición técnica de diferencias y la comparación de primer/último fotograma se conservan en seam-metrics.json e inspeccion-extremos.png. Estas métricas no son una aprobación perceptiva. Se conservó el clip exacto entregado; no se afirmó que el salto fuera imperceptible ni se recodificó silenciosamente. Los otros bucles también requieren aprobación visual final antes de publicar.

Anchos CSS realmente medidos:335/389/768/1280, sin desbordamiento horizontal. El control de viewport del navegador impuso un mínimo medido de335px:320px y texto al200% quedan sin verificar en esta sesión. Los anchos solicitados no se confunden con los medidos. La preferencia temporal de viewport se restauró. Consola sin errores/avisos en la prueba. Captura resultado-web.png y reproducción final en final-playback.json.

290pruebas/40archivos, sin omisiones, tipos y ambas compilaciones correctos. Las13rutas responden200 con hashes iguales al ZIP, Range del MP4 responde206, ocho videos en HTML y hash CSP del estilo coincidente; noindex conservado. Una cuenta, tres proyectos y movimientos tienen huellas idénticas antes/después. Sin llamadas Gemini, compras, cambios de saldo o publicación en este incremento.

El primer intento de aplicar titulares coincidió con la tabla de navegación, no con strings; la comprobación HTTP lo detectó. Se restauró la navegación original y se delimitó el reemplazo a la tabla del hero. Las diez páginas ahora devuelven su H1 esperado; evidencia locale-proof.json y snapshot anterior preservado. No se acepta la primera candidata como correcta.

### Titulares recibidos para previsualización

Los nueve titulares extranjeros siguen siendo borradores pendientes de revisión nativa. No se cambió la disponibilidad real ni se habilitaron pares por quitar estados de las maquetas Loc-*. La portada española conserva su titular aprobado.

| Locale | H1 recibido | Aceptación |
|---|---|---|
| es-419 | Tu video, con subtítulos que tu cliente entiende. | Diseño español vigente |
| en-US | Your video, with subtitles your client understands. | Revisión nativa pendiente |
| pt-BR | Seu vídeo, com legendas que seu cliente entende. | Revisión nativa pendiente |
| fr | Votre vidéo, avec des sous-titres que votre client comprend. | Revisión nativa pendiente |
| de | Ihr Video, mit Untertiteln, die Ihr Kunde versteht. | Revisión nativa pendiente |
| ja | あなたの動画に、お客様が理解できる字幕を。 | Revisión nativa pendiente |
| ko | 고객이 이해하는 자막을 당신의 영상에. | Revisión nativa pendiente |
| ar | فيديوك، بترجمة نصية يفهمها عميلك. | Revisión nativa pendiente |
| zh-Hans | 你的视频，配上客户看得懂的字幕。 | Revisión nativa pendiente |
| vi | Video của bạn, với phụ đề khách hàng hiểu được. | Revisión nativa pendiente |


12 de noviembre · Corrección posterior del propietario: la entrega ZIP3 era parcial. Véanse [contrato completo](LV-005-zip-completo.md) y [matriz](LV-005-matriz-zip.md), que sustituyen cualquier lectura de ZIP3 como aceptación de todo el diseño. No se borran ni amplían retroactivamente sus PASS técnicos.
