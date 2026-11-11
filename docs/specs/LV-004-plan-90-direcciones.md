# LV-004 · Plan de diez orígenes y nueve destinos por origen

Estado: revisado por T3 con DeepSeek y Kimi; luz verde para implementar en candidata privada, con activación y publicación sujetas a evidencia. Objetivo aprobado por el propietario: cada idioma de los diez puede dirigirse a los otros nueve, con un ejemplo comercial que parte del idioma de cada página. Son 90 traducciones dirigidas y diez modos monolingües; no 90 páginas públicas. [Alcance](LV-001-plataforma-multilingue.md#ejemplos-por-idioma-y-destinos-aprobados) · [Mensajes](LV-005-clientes-usos-y-mensajes.md).

## Situación real y alcance de esta revisión

`config/launchLanguages.ts` contiene la selección de diez. El catálogo del piloto habilita inglés↔español, define árabe→español experimental y modos monolingües, incluidos siete adicionales Beta. Las banderas de entorno condicionan la disponibilidad real. Que una entrada diga `experimental: false` no la convierte en calidad Verificada. La matriz completa todavía no está implementada o acreditada.

Esta entrega revisa el plan. No llama a Gemini, activa pares, amplía límites, modifica precios, mueve cuentas ni publica. La próxima implementación reutiliza el editor y procesador existentes, manteniendo los datos de cada versión y una candidata aislada.

## Secuencia y dependencias

| Fase | Tareas | Evidencia para avanzar |
|---|---|---|
| 1. Catálogo único | LV-001/LV-004: derivar las 90 direcciones y diez modos monolingües desde IDs estables. Separar idioma de interfaz, voz y salida. Conservar correspondencias de IDs antiguos. | 10×9 sin auto-traducción, duplicados o faltantes; 10 modos monolingües aparte. Migración aditiva o compatibilidad comprobada con proyectos existentes. |
| 2. Estado efectivo por dirección | LV-003/LV-004: pendientes, Beta habilitadas, Verificadas; asociar evidencia y versión. Intersectar catálogo con configuración del entorno, disponibilidad del adaptador y autorización del servidor. | Ninguna opción se considera utilizable solo por existir en la lista o por usar una bandera. Sin estado conocido, rechazar; poder retirar una dirección sin borrar sus trabajos. |
| 3. API y editor | LV-003: API, selector, adaptador y trabajos usan el mismo estado efectivo. El usuario elige origen y destino independientemente del locale de interfaz. | La API rechaza un destino pendiente o manipulado antes de reservar saldo o enviar contenido a Gemini. Se preservan idioma, pistas, cuenta y permisos al guardar/reabrir y reintentar. |
| 4. Ejemplos y nueve destinos | LV-005: el ejemplo francés parte de francés, el árabe de árabe, etc. Elegir un destino ilustrativo distinto y listar exactamente los otros nueve con nombres localizados y estado real. | Para un origen sin destino habilitado, el ejemplo se identifica como previsto y no inicia una compra para una capacidad no disponible. No forzar idioma de audio por el idioma de la página. Mantener la demo inglesa actual identificada como tal. |
| 5. Verificación por dirección | LV-004/LV-007: usar clips propios o autorizados y registrar referencia antes del procesamiento. Aplicar checks estructurales y cotejo lingüístico; separar humo funcional de calidad. | Aplicar el mínimo Beta por dirección descrito abajo. Para elevar a Verificada, exigir además la evidencia lingüística y temporal de LV-004, incluido el máximo de 0,50 s en bordes confirmados y la declaración de ambigüedades. Comprobar MP4 cuando forme parte de la capacidad o entrega anunciada, sin convertir su oferta comercial pendiente en requisito universal de SRT. Coste y latencia registrados. |
| 6. Activación gradual | LV-004: activar únicamente cada dirección que cumpla su criterio Beta. LV-005 y API reflejan el mismo estado. LV-007 verifica capacidad de archivos/servidor y cobro. | No inferir el sentido inverso ni calidad de los 90 a partir de un idioma monolingüe o una muestra. Poder revertir activaciones sin perder cuentas, saldos o proyectos. |
| 7. Publicación | LV-001/LV-005/LV-007: reconciliar cobertura anunciada, oferta MP4, límites, dominio, cuenta de producción, PayPal, fuentes y textos. | Evidencia exigida para lo anunciado, revisión humana por mercado, pruebas privadas y aprobación del propietario. No publicar un alcance menor a los nueve destinos por idioma como si cumpliera el compromiso; cualquier cambio de alcance se consulta. |

Fases 1–3 preceden la activación; se puede redactar la nueva copia y preparar muestras en paralelo. La emisión comercial de mensajes «traduce a los otros nueve» depende de disponibilidad real y evidencia, no de terminar solo el texto de la portada. El cronograma conserva sus ventanas orientativas y se reestima por lotes una vez disponible la candidata.

## Significado de los estados

- **Pendiente:** dirección objetivo del catálogo; no admite procesamiento ni compra atribuida a esa capacidad. Puede mostrarse como destino previsto con un estado claro.
- **Beta habilitada:** dirección realmente conectada que superó las comprobaciones mínimas del lote. La traducción requiere revisión del usuario; no implica perfección, revisión profesional incluida ni cobertura verificada de toda la familia.
- **Verificada:** dirección con evidencia lingüística, temporal, escritura, exportación y muestras representativas conforme a LV-004. El expediente registra muestras, versión, responsables, fecha y pendientes. Una mejora de modelo o alineación exige evaluar regresión antes de conservar el estado.

**Mínimo para activar Beta.** Registrar para cada dirección una prueba real de extremo a extremo con clip propio o autorizado: origen y destino correctos, llamada aceptada por el proveedor, dos pistas SRT UTF-8 no vacías con texto y tiempos estructuralmente válidos, descarga que abre, ausencia de defectos críticos conocidos en esa muestra y revisión del resultado contra una referencia preparada. Comprobar selector y autorización real, reserva/consumo únicos y devolución ante fallo con el mismo circuito. Registrar límites, versión, coste, latencia y defectos pendientes; no activar por haber aprobado solo pruebas simuladas o el sentido inverso. Los casos temporales o lingüísticos inconclusos no permiten afirmar calidad Verificada. Cuando se anuncie o pruebe exportación MP4, cotejar voz original y escritura del destino; si la entrega del lote es solo SRT, mantener esa distinción visible.

**Evidencia adicional para Verificada.** Aplicar la rúbrica de LV-004 sobre muestras representativas e independientes, términos, nombres, cifras/unidades, legibilidad y bordes temporales confirmados con desviación máxima <=0,50 s en ambas pistas. Registrar quién cotejó, qué se pudo confirmar y qué sigue abierto. No sustituir revisión bilingüe con estructura válida o retraducción automática.

Los umbrales concretos de fidelidad, legibilidad, coste y latencia del lote deben quedar documentados antes de evaluarlo; el estado no sustituye ese criterio. Si una muestra o borde no puede confirmarse, se conserva el resultado de la candidata y el caso permanece inconcluso.

## Pruebas de aceptación previstas

1. Catalogar exactamente 90 traducciones y diez transcripciones, con nueve destinos distintos por origen. No mezclar el modo de transcripción consigo mismo en el conjunto de nueve.
2. Comprobar estados desconocidos, banderas de entorno y solicitudes de API manipuladas: cero llamadas a Gemini y cero reservas/cargos ante direcciones pendientes.
3. Recorrer los diez locales, nombres de idioma y árabe RTL. Cambiar el idioma de interfaz sin alterar los idiomas elegidos o guardados en el proyecto.
4. Comprobar cada dirección habilitada con salida bilingüe válida, concordancia de ambas pistas y archivos descargados que abren, con audio original y escritura correcta en el MP4.
5. Conservar proyectos, presets y saldos anteriores. Validar concurrencia de trabajos y compras, reserva única, consumo único y devolución tras fallo final con las mismas reglas aprobadas.
6. Repetir inglés↔español como regresión y probar destinos de sistemas de escritura diferentes, sin usar esa selección como sustituto de revisar las restantes direcciones anunciadas.
7. Mantener las diez rutas localizadas, sus canónicas y alternancias; no generar una landing por cada par. No convertir un cambio de copy en prueba de que Gemini procesó ese par.

## Decisiones y condiciones de salida

El propietario ya aprobó la selección de diez y el objetivo de nueve destinos por idioma. Siguen por definir variantes comerciales concretas, inclusión de MP4, límites finales, producción/dominio y publicación. Una revisión favorable de T3 autoriza avanzar técnicamente dentro del alcance aprobado; no acredita las 90 direcciones ni sustituye esas decisiones del propietario.

La revisión distingue tres dictámenes: implementar, activar direcciones y publicar. Los resultados y costes están registrados a continuación.

## Dictamen de revisión independiente

| Decisión | DeepSeek | Kimi K3.1 Pro | Decisión Codex |
|---|---|---|---|
| Implementar catálogo, API, selector, ejemplos y pruebas en privada/Sandbox | Luz verde | Luz verde con estados efectivos | Adoptado. Es la siguiente actividad técnica lista. |
| Activar las 90 en bloque | No | No | Activación por dirección tras el mínimo Beta y registro del lote. |
| Publicar ahora | No | No | Sigue el gate de LV-007 y la aprobación del propietario. |

Se incorporaron compatibilidad de IDs, cambios aditivos/idempotentes, disponibilidad efectiva, rechazo de pendientes antes de reservar y reversión sin eliminar datos. La reciprocidad del catálogo es estructural: nunca hereda estado ni calidad al sentido inverso. Los diez monolingües conservan evidencia propia.

Codex contrastó tres errores puntuales: el límite de 0,50 s significa medio segundo (Kimi lo interpretó incorrectamente), `ar-ar` sigue experimental en el código (DeepSeek lo describió como no experimental) y hebreo no está entre los diez (se descartó la mención). Estos errores no se incorporan al plan. Tampoco se adoptó una afirmación sin evidencia de que alcanzar Verificada fuera imposible.

| Modelo | Hilo T3 | Sesión OpenCode | Coste registrado USD |
|---|---|---|---:|
| DeepSeek V4.1 Flash | mcp:14307069-37c4-4771-9402-bf6e23b9ea05 | ses_e36cbb7cbffeoQoIAYgCvo4B55 | 0.002553873 |
| Kimi K3.1 Pro | mcp:bf16ab76-ed69-44a3-834a-e11f9b6d0aec | ses_e36cbb7edffeQwPunX3EKvB8Af | 0.106970000 |
| Total | | | 0.109523873 |

Vía: T3 con `linguistvision-openrouter`. Una ronda paralela, con extractos públicos de LV-001/LV-005 y plan saneado. Cero herramientas/lecturas para los modelos y sin nombre de empresa, claves, medios o transcripciones privadas. Costes registrados por OpenCode, pendientes de conciliación con factura. No se persistieron IDs de generación. El plan operativo se precisó con los hallazgos; no se envió el código final para una auditoría nueva.
