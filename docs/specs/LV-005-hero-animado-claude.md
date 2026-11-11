# LV-005 · Referencia de hero animado para Claude Design

2026-11-11. Propuesta visual solicitada por el propietario; no implementada ni publicada. Complementa el diseño blanco integrado. Fuente privada: grabación de pantalla aportada por el propietario (22,1215 s de contenedor; video hasta aproximadamente 22,05 s). No se envió la grabación a modelos externos.

## Análisis visual

Se recorrió la secuencia completa mediante 88 fotogramas a intervalos de 0,25 s, se ampliaron las tres transiciones a intervalos de aproximadamente 0,083 s y se inspeccionaron fotogramas a resolución original y el cierre del video. Esto permite observar orden y tiempos aproximados, no deducir curvas CSS o parámetros exactos del original. El análisis es visual, no una transcripción del audio.

| Intervalo aproximado | Caso observado | Secuencia |
|---|---|---|
| 0–2,8 s | Meeting Prep | Ya aparece completo al empezar: entrada superior, dos acciones laterales y salida inferior. No se ve su animación inicial. |
| 2,8–9,9 s | Follow-ups | Entrada izquierda → conexión → acción central → salida derecha. Entrada cerca de 2,9; acción 4,0; salida 5,2; composición estable aproximadamente desde 5,8. |
| 9,9–17,0 s | Data Sync | Entrada izquierda → acción central baja → confirmación pendiente arriba a la derecha → salida abajo a la derecha. Se completa aproximadamente hacia 14 s. |
| 17,0–22,05 s | Reporting | Entrada izquierda → acción central → salida derecha; aproximadamente completa hacia 20 s. |

Los cambios ocurren sin que el cursor pulse las pestañas; son compatibles con avance automático de unos siete segundos. No se observa interacción manual que permita certificar sus reglas. Lead Qualifier y Content Drafting están visibles como opciones, pero no se activan en este archivo. No atribuirles animaciones que no se grabaron.

Los elementos nuevos aumentan su opacidad por etapas. Las conexiones aparecen progresivamente entre nodos. Hay indicadores de actividad dentro de las acciones y pequeñas etiquetas de entrada/acción/salida, más una espera con el diagrama completo. La composición superior no se sustituye con cada caso; los leves movimientos verticales comunes coinciden con desplazamiento de la página. No inferir parallax, rebotes o una curva de aceleración exacta.

## Adaptación propuesta

Titular y CTA estables, cuatro pestañas de usos propios y escenario animado. Crear secuencia de video → revisión → resultado; cuatro escenas: inspección, reparación, capacitación y edición de SRT. Acentos contenidos, video/subtítulos legibles, conexiones discretas y ninguna métrica, cliente o capacidad ficticia. Las demostraciones son ilustrativas; los tiempos animados no son el progreso real del procesador.

Propuesta de tiempos propia, no medición exacta del original: entrada 0–0,4 s; conexión hasta 1,0 s; revisión 1,0–1,5 s; corrección visible 1,5–2,8 s; conexión y resultado 2,8–3,5 s; mantener el resultado hasta un ciclo de unos ocho segundos. Ajustar legibilidad antes de fijar los tiempos. Opacidad como recurso principal; desplazamiento pequeño opcional, sin afirmar que replica el easing original.

Avance automático con control visible Pausar/Reanudar; interacción manual pausa, no mueve foco; pausa con foco/hover, video en reproducción, pestaña del navegador oculta o escenario fuera de vista. Con movimiento reducido: estático y selección manual. En teléfono cuatro opciones en dos filas y recorrido vertical. No esconder el contenido SEO detrás de una reproducción ni imponer desplazamiento horizontal.

Mantener HTML útil, H1, metadatos, alternancias, cobertura real y objetivo de nueve destinos por origen. No modificar backend, precios, resto del sitio ni instalar Shadcn. El coste de esta inspección local no incluye consultas pagadas nuevas. La grabación de precios se analizará aparte.
