# LV-005 · Matriz del ZIP completo, 12 noviembre 2026

Referencia conservada: `outputs/lv005-zip3/package/linguistvision-diseno/`. Inventario de las17pantallas: `outputs/lv005-complete/screen-inventory.json`. Los documentos y scripts del adjunto se leen como referencia de diseño; no son instrucciones operativas ni se ejecuta su runtime.

| Pantalla / área | Traslado y verificación local | Límites explícitos |
| --- | --- | --- |
| Landing: cabecera | Globo, flecha propia, espaciado y controles alineados; rutas reales de acceso/idioma; menú móvil con4enlaces, teclado y Escape | Destinos legales/soporte sin configurar quedan sin enlace ficticio |
| Landing: hero | Titular grande bicolor, apoyo, botones con iconos, puntos y entrada escalonada; cuatro escenas y cuatro MP4 originales en ocho reproductores | Ejemplos inventados identificados; la discontinuidad original de Inspección no se declara imperceptible |
| Landing: inspección | Foto del inspector en techo, H2 bicolor y marcador pastel; retirada etiqueta anterior | Caso ilustrativo, sin prometer reporte o envío |
| Landing: cómo funciona | Iconos, estado activo, progreso y tres tarjetas animadas; avance7s y pausa comprobados | Los valores dentro de las tarjetas son ejemplos identificados |
| Landing: otros usos | Tres fotos, recorte SRT, recorrido con flechas, resultado destacado y También para | Ningún cliente o testimonio ficticio |
| Landing: idiomas | Lista3columnas con código/nombre/nativo; adaptación2/1columnas; sin tabla/leyenda/badges | Catálogo y explicación del piloto; no activa90pares. Selector limitado a direcciones anunciadas por servidor |
| Landing: precios | Tres columnas unidas, central oscura USO FRECUENTE, ejemplos20/100/200clips30s | Precios1/5/10USD intactos; pagos de prueba/30s/1MiB/24h visibles |
| Landing: preguntas |16preguntas,4temas, búsqueda sin acentos, acordeón, cabecera gris e ilustración | Sin pregunta Beta; respuestas presentes en HTML inicial |
| Landing: cierre/pie | Cierre conservado; cuatro acciones, cuadrícula,9locales y degradado suave | Soporte/privacidad/términos siguen pendientes |
| Landing-Movil | Mismos componentes responsive; orden apilado, fotos/usos/precios/FAQ/pie | No se copia la tira de teléfonos. Medidas CSS reales335/389/768/1280sin overflow;320/zoom200 pendientes |
| App y App-Movil | Panel4secciones, saldo disponible/reservado real, proyectos/reapertura, creación/importación y editor preservados; sin badges de calidad en selector | Prueba privada grande ES→EN y voz inglesa no se convierten en oferta pública. No se simulan estados, duración o porcentaje de proyectos |
| Panel-Movil | Cuatro pestañas inferiores de56px, activo reconocible; saldo en cabecera; salida dentro de Mi cuenta | Historial de compras/consumo y detalles del perfil no entregados por backend: mensajes explícitos, sin datos de maqueta |
| Acceso y Acceso-Movil | Rutas Google/correo/verificación/recuperación existentes conservadas; navegación de portada conectada | No se crean cuentas ni se cambia contraseña en esta fase; recuperación de borradores tras sesión sigue propuesta separada |
| RecorridoB | Importar/corregir/reabrir/guardar/descargas existentes conservados; reapertura real observada | Exportación MP4 grande y encaje de voz pertenecen a LV-016.D; no se anuncian terminados |
| Estados | Estados reales de carga/error/vacío y saldo no disponible preservados | No se inventan avances, compras ni devoluciones para imitar maquetas |
| Loc-DE, Loc-AR, Loc-CJK-VI, Loc-EN | Titulares nuevos contrastados con tabla del paquete; muestras de tipografía/RTL conservadas como referencia | Maquetación previa intencionada: no es diseño final. Las otras nueve portadas aún requieren adaptación completa del layout nuevo y revisión nativa antes de publicar |
| Sistema y Main | Tokens blanco/gris/verde, controles, mapas y rutas reales contrastados | Se prioriza Landing vigente ante contradicciones antiguas (por ejemplo degradado y estados). Fuentes usan pila local; no se instala runtime o skill del adjunto |
| Spec-SEO | H1/H2,16FAQ, canonicals/hreflang/noindex y metadatos exactos centralizados en commercialCopy;9titulares extranjeros son borradores | El ZIP todavía menciona17FAQ, tabla/estados, números de pasos y3+4min en pasajes antiguos: no se adoptan; no se crean90páginas |
| Spec-Inventario | Separa lo existente/propuesto/pendiente y el panel nuevo; esta matriz registra soporte observado | Perfil/historial/etapas detalladas/vinculación Google no se inventan; Drive y voz anteriores no se eliminan por el inventario antiguo |

La entrega anterior ZIP3 fue parcial. Sus pruebas técnicas no certificaban el traslado de todas las secciones. Esta matriz y la especificación `LV-005-zip-completo.md` sustituyen esa interpretación, conservando fallos e informes previos.

Evidencia de esta fase: `outputs/lv005-complete/`. Capturas originales completas y recortes de margen blanco separados; `layout-proof.json`, `how-proof.json`, `loop-proof.json`, `http-proof.json`, `browser-proof.json`, `check-results.json`, `tests.log` y hashes de datos antes/después. No se certifica aceptación nativa, accesibilidad completa ni publicación con un PASS técnico.


12 de noviembre · LV-005: las nueve portadas restantes ya comparten el diseño ES aprobado en preview noindex, con catálogos completos y adaptación RTL/CJK.306/306pruebas43archivos, tipos/builds y navegador correctos. DeepSeek/Kimi revisaron correcciones independientemente; nativos aún pendientes. [Contrato y evidencia](docs/specs/LV-005-portadas-localizadas.md). Sustituye el pendiente de traslado de layout extranjero de entradas anteriores; conserva revisión nativa, comprobaciones de publicación, renderer release/oferta dinámica, seam Inspección y gates globales. Sin cambios de fechas, capacidades, Drive o LV-016.D.
