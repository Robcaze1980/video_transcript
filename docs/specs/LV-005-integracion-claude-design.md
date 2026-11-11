# LV-005 / LV-003 / editor · Integración del diseño recibido

Fecha: 2026-11-11. Integrada localmente; ampliaciones y prueba física pendientes. Fuente: ZIP `linguistvision-diseno.zip` aportado por el propietario, con INSTRUCCIONES y 17 referencias `.dc.html`. Solo Landing, Acceso y App se trasladan a la interfaz existente; las otras pantallas describen variantes, estados y aceptación. No se ejecuta ni copia el runtime de la herramienta.

Actualización de cierre: integración verificada en candidata local; prueba física del nuevo diseño y funciones que requieren ampliación del servidor pendientes. SHA256 del ZIP: `935a170b97d19df064aa51d0ab3edd87b1ae6346318bfe524bb9988e1513d726`.

Dirección vigente: blanco #FFFFFF, superficie #F7F8FA, texto #111827/#4B5563, verde de acción #0F6B45, sans serif y componentes compartidos, controles 44/48px. Sustituye la dirección visual crema/editorial anterior. Mantener rutas existentes, SEO/GEO, diez locales, identidad, permisos, procesamiento y reglas del servidor. Sin publicación ni cambios de backend.

## Contraste previo de datos

- `/pilot/api/account`: saldo disponible/reservado/consumido/acreditado, paquetes, servicios y flags; no perfil ni lista de compras.
- `/pilot/api/projects`: ID, nombre y caducidad; no fecha de edición ni estados detallados por proyecto.
- `/pilot/api/jobs`: últimos trabajos con servicio, estado, precio y disponibilidad; no historial contable por video.
- La duración enviada se lee en el navegador y el servidor vuelve a medirla al procesar. No existe una cotización previa de consumo emitida por el servidor.

Se implementan panel, navegación y listas sobre datos reales. Perfil detallado, historial de compras/consumo y cotización previa se señalan como no disponibles; se consultó al propietario sobre ampliar posteriormente el backend, sin bloquear las áreas independientes. No mostrar tablas vacías como si acreditaran cero compras, ni inventar correo, fechas o importes. El prototipo 28seg→1min no sustituye la regla vigente de segundos redondeados hacia arriba.

El propietario autorizó la ampliación **posterior** del backend. [Siguiente incremento del panel](LV-003-panel-cuenta.md). La integración actual conserva el contrato: 34 archivos TypeScript de servicios/rutas comprobados contra la candidata previa sin cambios, excluyendo el renderer de acceso. No se crearon endpoints, cambiaron reglas de cobro o activaron pares.

## Comprobación prevista

Portada→acceso→panel; navegación y saldo real; importación→editor→guardar→panel→reabrir→SRT/MP4 sintéticos, sin retranscripción; aislamiento y contratos existentes mediante regresión. Escritorio, 320/390/768px, zoom 200%, RTL y teclado. No se considera comprobado hasta registrar resultados abajo.

## Implementación y resultado

- Portada: blanco, sans serif y verde de acción, producto visible y rotulado ilustrativo, ejemplo principal, pasos, usos, idiomas, tabla de precios y FAQ en HTML. Diez locales con ejemplo en su propio idioma; los ocho ejemplos sin dirección habilitada se identifican como previstos, no como demos reales. El objetivo de otros nueve destinos no se presenta como cobertura ya disponible. Conservadas rutas, canónicas, once alternancias y noindex.
- Acceso: pantalla clara y mostrar/ocultar contraseña en diez locales. Conservados hooks y flujos de Firebase; recuperación/verificación y Google usan las operaciones existentes. No se repitió un login humano ni recepción de correo real en esta entrega.
- Área privada: Inicio, Mis proyectos, Saldo y compras, Mi cuenta; saldo disponible/reservado, compra existente, listas/caducidad reales y acciones de proyecto. Navegación lateral en PC e inferior en teléfono; editor separado, guardado visible, importación, búsqueda, tiempos con botones ±0,1 s y momento actual, estilos secundarios y ayudas de descarga. La creación guía archivo → idiomas → revisión; no simula una cotización del servidor ni etapas internas que no informa.
- Conexión: errores no vuelven a presentar datos antiguos al cambiar de idioma; el seguimiento de un trabajo continúa aunque falle la consulta de saldo. Bloqueada una segunda creación mientras la primera carga se confirma; cancelación de carga visible. Las ediciones de un resultado sin proyecto también avisan antes de salir.
- No implementados por falta de datos: perfil detallado, historial contable, fecha de última edición y cotización previa. No se generaron nombres de descarga con idiomas que el proyecto no guarda. Legales/soporte finales y revisión nativa siguen pendientes.

## Evidencia de la candidata

Release: `%LOCALAPPDATA%\LinguistVision\releases\claude-design-20261111`. Activa solo en `127.0.0.1:3001`, PID 18548 al cierre. Se conserva `commercial-roof-case-20261110` para volver atrás; misma base Firebase dev/PayPal Sandbox y cuenta con 3000 segundos disponibles confirmada por consulta de solo lectura. No se modificó Tailscale, producción o dominio público.

Instalación limpia con dev, Node 24.13.0, cero vulnerabilidades npm, tipos, **96 pruebas/17 archivos** y ambas compilaciones correctos. El aviso de tamaño de bundle existente continúa; no es un fallo de compilación.

`scripts/qaClaudeDesign.ts` ejecuta navegador y servidor real con cuenta, esquema PostgreSQL y adaptador sintéticos aislados, sin Gemini ni PayPal externo. Evidencia: `%LOCALAPPDATA%\LinguistVision\validation\claude-design-20261111\run-WI8Bwq\acceptance.json` y capturas del mismo directorio.

- 280 vistas: 40 portadas y 240 vistas privadas (10 locales, 320/390/768/1280 px). Sin desbordamiento horizontal, excepciones de JavaScript o violaciones CSP. Otras 40 combinaciones privadas con texto al 200%, sin desbordamiento. El acceso se comprobó además en 160 combinaciones por locale/página/ancho y texto 200%.
- Importación de video y dos SRT → corrección → guardado → panel → reapertura → descarga SRT y MP4, con saldo 600 segundos sin cambios. SRT abierto con texto corregido y marcas `00:00:00,500 --> 00:00:04,000`. MP4 H.264/AAC 960×540, seis segundos; inspección de un fotograma confirma ambas pistas y corrección visible.
- Trabajo sintético completo desde el asistente: saldo 600→594 segundos, sin redondear a un minuto. Cambiar interfaz conserva el par; destino pendiente bloqueado. Fallos 503 de saldo/historial y cambio de idioma no restauran datos antiguos; polling continúa; confirmación de salida conserva la edición cuando se cancela.
- HTTP sobre candidata Firebase activa: diez páginas 200, hash de estilos conforme a CSP, once alternancias, noindex; acceso, registro, CSS, módulo de contraseña y SRT de demo responden 200. Contraste sobre blanco: verde 6,54:1, texto 17,74:1, secundario 7,56:1, borde de campo 3,18:1.

Límites de evidencia: la prueba automatizada móvil es Chromium con viewport/escala, no un Pixel físico ni una prueba con lector de pantalla. El comportamiento del teclado real, Google móvil y descarga del Pixel se confirman después. Textos nuevos de otros idiomas son borradores sin revisión nativa.

## Revisión T3 y coste

Una ronda en paralelo vía `linguistvision-openrouter`, sobre instrucciones/inventario y contratos saneados. DeepSeek propuso integración mínima y pruebas; Kimi auditó datos, estados y seguridad. No revisaron el código final. Codex integró y contrastó; una revisión local adicional reprodujo los fallos de conexión y pérdida de cambios que luego se corrigieron y probaron.

| Modelo | Hilo T3 | Sesión OpenCode | Coste registrado USD |
|---|---|---|---:|
| DeepSeek V4.1 Flash | mcp:fbb58bf1-f408-4221-aeaa-4b1d9cf8c83f | ses_e349d6a2bffeoovS1SpilZ1f23 | 0.002713386 |
| Kimi K3.1 Pro | mcp:f1b59646-253e-497a-b836-5fb5ccfe1eac | ses_e349d730effeVPRg8jSpH7IKov | 0.077938000 |
| Total | | | 0.080651386 |

Registro OpenCode pendiente de conciliación con factura. Sin ID de generación persistido, medios privados o nuevas llamadas Gemini. No se infiere calidad de 90 direcciones, demanda comercial ni aprobación de publicación a partir de esta revisión.
