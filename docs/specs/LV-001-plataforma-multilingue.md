# LV-001 · Plataforma comercial multilingüe

**Estado.** Primer lanzamiento y lista de diez idiomas aprobados. Cobertura comercial objetivo: cada uno de los diez idiomas hacia los otros nueve. Quedan habilitación/validación por dirección, variantes y oferta.

LinguistVision será el primer servicio web de pago por resultado sobre una plataforma reutilizable para otros servicios de archivos. La expansión se evalúa tras publicar y comenzar a monetizar. [Diseño y revisión externa](../MULTILINGUAL-ARCHITECTURE.md).

## Requisitos y aceptación

- **R1.** El recorrido público y el área de uso cubren los diez idiomas de la primera versión. El locale de interfaz, el idioma de origen y el de salida se guardan por separado. Evidencia con inventario versionado y pruebas de los diez recorridos.
- **R2.** Validar transcripción en los diez idiomas y traducción en los pares anunciados. LV-004 definirá muestras sintéticas o autorizadas, rúbrica y umbrales antes de evaluar la cobertura. La evidencia incluye una matriz por capacidad, SRT con texto y tiempos válidos y revisión bilingüe de muestras representativas y casos de mayor riesgo. La app Windows sirve para validar el primer procesador.
- **R3.** Cada versión pública dispone de URL propia y metadatos coherentes. El rastreo automatizado comprueba las diez rutas, respuestas HTTP, canónicas, sitemap y enlaces entre versiones. Verificar alternancias recíprocas, autorreferencias y `x-default` para las versiones con un código de búsqueda compatible. Las demás conservan su URL, canónica y presencia en sitemap. La medición separa indexación, referencias observables desde asistentes, auditorías de citas y conversiones.
- **R4.** Los créditos se reservan una vez y se consumen al publicar un resultado válido. Un fallo final libera la reserva. LV-003 documentará estados, transiciones y condiciones de cobro y reintento. La evidencia incluye pruebas de pago con PayPal, confirmaciones duplicadas, aislamiento entre cuentas y borrado conforme a la retención acordada, incluida la de los proveedores.
- **R5.** La base admite un segundo producto. Evidencia: trabajo de PDF de prueba con el mismo circuito de cuenta, créditos, carga, cola y descarga.
- **R6.** Usar Node.js 24 LTS en desarrollo, CI y despliegue. LV-007 verifica la candidata y reúne coste por resultado exitoso y por minuto del video de origen, con reintentos y almacenamiento. Si se ofrece MP4, medir el coste incremental de renderizado y almacenamiento. Usar esa evidencia para aprobar precio y límites comerciales antes de publicar.
- **R7.** Completar primero la app privada en inglés, español y árabe según [LV-014](../../backlog.md#lv-014). Completar el conjunto de diez mediante [paquetes de idioma](LV-004-paquetes-de-idioma.md) que reutilizan interfaz, rutas, procesamiento y exportación. Cada capacidad conserva su verificación de calidad.
- **R8.** La portada comercial se dirige a empresas con videos de instrucciones, capacitación y comunicación interna. El ejemplo principal es de obra. El registro comercial es abierto con Google o correo y contraseña en un proyecto Firebase Authentication propio de LinguistVision. El acceso por contraseña exige correo verificado y admite recuperación. El servidor valida el ID token y relaciona el UID con la cuenta que controla saldo y archivos: Firestore en el backend cloud aprobado; PostgreSQL se conserva como piloto local. No crear Cloud SQL. La oferta visible exige precio, créditos, límites, capacidades y enlaces legales aprobados. [Candidata comercial local](../MULTILINGUAL-ARCHITECTURE.md#candidata-de-la-portada-y-el-acceso-autoservicio).

### Ejemplos por idioma y destinos aprobados

El propietario pidió que cada versión comercial use su propio idioma como origen del ejemplo y presente la posibilidad de traducir a los otros nueve idiomas de la selección. Esto define 90 direcciones de traducción como objetivo de la primera versión, sin contar los diez modos de transcripción en el mismo idioma. No acredita por sí solo habilitación, calidad o validación de esas direcciones.

Cada página debe obtener origen y los nueve destinos desde el catálogo de diez, excluyendo el propio origen. Ejemplos: español→inglés, francés→inglés, inglés→español, japonés→inglés. Los nombres se localizan en el idioma de la página. El idioma de interfaz de la app sigue siendo independiente del audio y del subtítulo: el ejemplo no obliga a que todos sus usuarios graben en ese idioma.

Antes de anunciar un destino como utilizable, comprobar que esté habilitado y aceptado por el procesador. Distinguir Beta habilitada, pendiente de habilitación y calidad verificada. El catálogo actual del piloto contiene traducciones inglés↔español y una ruta experimental árabe→español; las otras siete incorporaciones son monolingües. Por tanto, todavía no se puede presentar la matriz completa como disponible. LV-003 conecta el catálogo/selector y LV-004 conserva evidencia por dirección; LV-005 adapta ejemplos, lista de destinos y estado visible.

## Piloto aprobado

Presentación vigente desde el 11 de noviembre: diseño blanco/sans serif de Claude Design para portada, acceso y panel/editor. [Integración y límites](LV-005-integracion-claude-design.md). El panel utiliza datos reales actuales; [perfil e historiales](LV-003-panel-cuenta.md) se completan en un incremento posterior autorizado, sin alterar precios ni cobertura.

Piloto privado inglés ↔ español con talleres y contratistas de la Bahía. SRT como entrega base y MP4 incrustado como complemento a evaluar. La aprobación está condicionada a demostrar la incorporación por paquete en LV-004.

El piloto incluye [LV-008, revisión sobre el video y descarga](LV-008-revision-y-exportacion-del-piloto.md): vista sincronizada, búsqueda con salto al segmento, corrección de texto, posición del subtítulo independiente del clip y exportación SRT o MP4.

El [plan completo del editor](LV-009-plan-del-editor.md) registra las funciones adicionales, su orden y las decisiones de alcance que se cierran antes de ampliar los idiomas.

## Decisiones pendientes

El propietario eligió DigitalOcean y aprobó tres recargas: US$1 por 10 minutos, US$5 por 50 y US$10 por 100. El saldo de video de origen se reparte entre varios archivos. La selección del Droplet y la validación de la oferta se detallan en [LV-007](LV-007-candidata-comercial.md#alojamiento-y-paquete-candidato).

La [propuesta comercial](LV-001-propuesta-comercial.md) reúne la selección candidata de diez idiomas, el inventario de expansión, los primeros pares dirigidos y la oferta SRT/MP4 que se evaluará en el piloto.

La cobertura objetivo de 90 direcciones está aprobada. Confirmar variantes, la entrega SRT con o sin MP4 y los límites comerciales. Validar los tres precios aprobados con costes medidos antes de publicar. La activación y las promesas visibles dependen de evidencia por dirección según el [plan revisado por T3](LV-004-plan-90-direcciones.md). Registrar el motivo, impacto, responsable y criterio actualizado al resolver cada decisión.

Seguimiento: [backlog](../../backlog.md) · [cronograma](../../gantt.md) · [incidentes](../../errorlogs.md).


## Estado incremental LV-016.C · 2026-11-12
El ensayo privado incorpora [narración inglesa Kore/Charon](LV-016-C-voz.md) desde texto guardado, sin clonación ni cobro de saldo. Ambas voces se generan, reproducen y descargan como WAV con cuenta/revisión/TTL. Técnica verificada; calidad humana inglesa pendiente. No acredita otros idiomas, mezcla con video ni MP4 largo; permanecen D/F y LV-004.


12 de noviembre · Estado de diseño local: [traslado completo de la portada ES y panel](LV-005-zip-completo.md), con [matriz de pantallas y límites](LV-005-matriz-zip.md). Catálogo futuro de diez idiomas no habilita pares nuevos. No modifica precios, cuenta, saldo, voz privada, Drive ni gates de publicación.


12 de noviembre · LV-005: las nueve portadas restantes ya comparten el diseño ES aprobado en preview noindex, con catálogos completos y adaptación RTL/CJK.306/306pruebas43archivos, tipos/builds y navegador correctos. DeepSeek/Kimi revisaron correcciones independientemente; nativos aún pendientes. [Contrato y evidencia](docs/specs/LV-005-portadas-localizadas.md). Sustituye el pendiente de traslado de layout extranjero de entradas anteriores; conserva revisión nativa, comprobaciones de publicación, renderer release/oferta dinámica, seam Inspección y gates globales. Sin cambios de fechas, capacidades, Drive o LV-016.D.


2026-11-12 · LV-007/Vistavo: Rob aprueba ruta Google Cloud y presupuesto; selecciona Billing for Robertson. Sustituye DigitalOcean y rechaza página temporal. Proyecto dedicado vistavo-prod creado ACTIVE y Firebase añadido correctamente. Vinculación billing falla HTTP400 QuotaFailure Cloud billing quota exceeded, permiso de asociación comprobado; primer intento y un reintento preservados. Fase A incompleta, sin Cloud SQL/Run/Storage de pago creados ni cambios DNS ni exposición local. Preparación y cálculo en docs/specs/LV-007-vistavo-google-cloud.md y deploy/google-cloud/. Linux Node24.13.0/FFmpeg5.1.9 bajo usuario1000, sin red/fsreadonly/tmpfs256MiB/1GiBRAM/2CPU: patrón+seno180s,4500frames,H264/AAC y archivo inválido rechazado. No prueba ASR/traducción/voz/rendercloud. Datos/candidata3001 conservados. Siguiente: resolver cuota de la cuenta elegida, reanudar sólo billing del proyecto existente; después B almacenamiento durable/SQL y C entrypoint/activación cloud, manteniendo gates D/E. Revisiones y costes se completan en el cierre de esta fase.



12 de noviembre · Marca Vistavo aplicada localmente a diez portadas y panel; Firebaseprod configurado tras aprobación explícita (Google/correo, Vistavo Web, dominios autorizados), separado de dev.306/306pruebas43archivos, tipos/builds0 y DeepSeek/KimiPASS técnico acotado. [Informe](docs/FIREBASE-VISTAVO-2026-11-12.md). No desplegar ni habilitar billing según última instrucción; pruebas humanas/prodcloud y gates globales pendientes. Sin nueva fecha pública.
