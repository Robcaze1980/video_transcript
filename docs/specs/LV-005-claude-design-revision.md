# LV-005 · Claude Design: una base, diez locales

Fecha: 2026-11-10. Entrega documental para LV-005, acceso LV-003 y editor LV-009–LV-013. Repositorio `Robcaze1980/video_transcript`, HEAD `afe2d4caefd53b8576b066c0f20129095fbcc172` con cambios locales conservados.

El propietario incorporó Claude Design y propuso reutilizar el diseño entre idiomas. T3 revisó el [prompt original íntegro](LV-005-claude-design-prompt-original.md) y esa propuesta. El [prompt actualizado para copiar](LV-005-claude-design-prompt.md) incorpora el dictamen contrastado por Codex. No se han generado todavía pantallas en Claude Design.

## Dictamen y alcance

Ambos revisores respaldan un sistema compartido para portada comercial, acceso y espacio de trabajo. Se diseña el recorrido completo en español y se prueban sus componentes con alemán (expansión), árabe (tres áreas RTL), japonés (editor y tipografía), muestras de coreano y chino simplificado, vietnamita (diacríticos) e inglés (portada y mensaje). No se encargan diez aplicaciones ni diez prototipos completos.

El contenido se separa del diseño, pero la adaptación no es solo sustituir palabras: fuentes, altura, saltos, plurales, importes USD, dirección y texto mixto requieren comprobación. Cada ejemplo comercial parte del idioma de su página y presenta los otros nueve destinos con estado efectivo, conforme al [plan de cobertura](LV-004-plan-90-direcciones.md). Cambiar el locale no altera el audio o los idiomas del proyecto.

DeepSeek propuso el cambio mínimo en entregables y reutilización. Kimi auditó fuentes, RTL/bidi, formatos, independencia de idiomas, teclado/foco y estados. Codex descarta espejar automáticamente línea temporal o progreso multimedia y localizar la sintaxis SRT: el sentido del tiempo y el estándar del archivo se conservan. Las muestras de escritura no sustituyen el cotejo de calidad de LV-004.

## Aceptación del diseño

- Componentes y tokens compartidos; contenido por locale, sin bifurcar pantallas por idioma.
- Dos recorridos completos en español: crear subtítulos y editar/importar/guardar/reabrir/exportar. Pruebas representativas en las demás escrituras.
- Teléfono 320/390 px, tableta, escritorio y zoom 200%; sin recortes, acciones ocultas por teclado ni necesidad de reducir fuente para encajar traducciones.
- Tres áreas árabes y editor con mezcla de pistas/interfaz LTR/RTL; archivos, correos y tiempos legibles, sin invertir semántica multimedia.
- Mensajes, metadatos y ejemplos localizados; nueve destinos por origen derivados del catálogo con disponibilidad real. Los 90 pares son objetivo, no cobertura ya verificada.
- Funciones existentes, interacciones propuestas y decisiones pendientes separadas. Se conservan precios, límites privados, autenticación Firebase propia y condiciones de publicación.

La entrega visual futura precede su integración y las pruebas en candidata privada. Localización editorial y catálogo pueden avanzar en paralelo. No cambian las ventanas orientativas ni los gates de publicación, MP4 comercial o límites finales.

## Evidencia de revisión y coste

Una ronda por modelo en paralelo mediante T3 y `linguistvision-openrouter`. Ambos recibieron el prompt original completo y la idea de reutilización; sin herramientas, credenciales, videos ni transcripciones privadas.

| Modelo | Hilo T3 | Sesión OpenCode | Coste registrado USD |
|---|---|---|---:|
| DeepSeek V4.1 Flash | mcp:834e3702-d1dd-4f32-9412-32c7246c54c0 | ses_e36bc4844ffeg4dRbqdDL22gO7 | 0.002793099 |
| Kimi K3.1 Pro | mcp:4d39ad52-250a-4cf2-a70e-aba2190fc47d | ses_e36bc47b6ffecsTuHOHn08AyAs | 0.054694800 |
| Total | | | 0.057487899 |

Importes registrados por OpenCode, pendientes de conciliación con factura. No se persistió ID de generación de OpenRouter. Sin llamadas a Gemini ni cambios de código, recursos o candidata activa. Se verifican los enlaces documentales; las pruebas visuales quedan para cuando exista el diseño.
