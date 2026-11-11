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
- **R8.** La portada comercial se dirige a empresas con videos de instrucciones, capacitación y comunicación interna. El ejemplo principal es de obra. El registro comercial es abierto con Google o correo y contraseña en un proyecto Firebase Authentication propio de LinguistVision. El acceso por contraseña exige correo verificado y admite recuperación. El servidor valida el ID token y relaciona el UID con la cuenta de PostgreSQL que controla saldo y archivos. La oferta visible exige precio, créditos, límites, capacidades y enlaces legales aprobados. [Candidata comercial local](../MULTILINGUAL-ARCHITECTURE.md#candidata-de-la-portada-y-el-acceso-autoservicio).

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
