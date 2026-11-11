# Plan maestro de LinguistVision

LinguistVision será el primer servicio web B2B de una plataforma que cobra por resultado mediante créditos. El cliente carga un video y recibe subtítulos que puede descargar. Las mismas cuentas, créditos, trabajos y descargas servirán para futuros productos de archivos, como la extracción de datos de PDF.

## Primer lanzamiento

El alojamiento será en DigitalOcean. Las recargas aprobadas son US$1 por 10 minutos, US$5 por 50 y US$10 por 100, repartibles entre varios videos. [LV-007](docs/specs/LV-007-candidata-comercial.md#alojamiento-y-paquete-candidato) verifica el servidor y la operación de la oferta.

El registro comercial será abierto con Google o correo y contraseña, con confirmación y recuperación mediante Firebase Authentication propio de LinguistVision. [LV-003](backlog.md#lv-003) verifica la identidad y el aislamiento de cada cuenta. El proyecto de desarrollo `linguistvision-dev` ya está creado y Google fue validado con una cuenta real. El acceso definitivo depende del dominio y del proyecto de producción aprobado; [preparación](docs/specs/LV-003-login-produccion.md).

El primer lanzamiento comercial incluye **10 idiomas**, un recorrido web localizado, transcripción y traducción para la cobertura anunciada, descarga de SRT y páginas públicas preparadas para SEO y búsqueda con IA. La interfaz, el idioma hablado y el idioma de salida se tratan por separado. El detalle está en la [especificación LV-001](docs/specs/LV-001-plataforma-multilingue.md).

Los [diez idiomas iniciales](docs/specs/LV-001-propuesta-comercial.md#selección-aprobada-para-la-primera-versión) están aprobados. El catálogo de 30 sirve como inventario de expansión. El objetivo aprobado es que cada idioma se pueda dirigir a los otros nueve: 90 traducciones dirigidas, con disponibilidad y calidad verificadas por separado. El [plan de las 90 direcciones](docs/specs/LV-004-plan-90-direcciones.md) tiene luz verde de implementación privada tras la revisión T3. El usuario confirma variantes, oferta MP4, límites finales y publicación; los tres precios ya están aprobados.

**Orden aprobado.** Completar y verificar la app privada con inglés, español y árabe. Preparar el alcance de diez idiomas por paquete. Retomar la expansión tras publicar y comenzar a monetizar.

El [plan completo del editor](docs/specs/LV-009-plan-del-editor.md) reúne las funciones de CapCut revisadas, el alcance aprobado para la primera versión y la evidencia de cada entrega.

## Orden de ejecución

1. **Base ya probada.** [LV-002](backlog.md#lv-002) verificó Gemini → SRT, [LV-006](backlog.md#lv-006) la reutilización con PDF y [LV-008](backlog.md#lv-008) la edición y exportación. La sincronía del MP4 pasó en el Pixel. El núcleo y los pagos de [LV-003](backlog.md#lv-003) siguen en curso. PayPal Sandbox acreditó en escritorio y falló antes de la aprobación en Android.
2. **Completar el editor en tres idiomas.** Ya pasaron las pruebas locales de [proyectos e importación SRT](backlog.md#lv-009), [pistas y tiempos](backlog.md#lv-010) y [estilos y presets](backlog.md#lv-011). El Pixel importó [LRC y ASS y exportó el resaltado guardado](backlog.md#lv-012). En PC se cotejaron los dos SRT y se verificaron los [controles tipográficos y de posición](backlog.md#lv-013). El pago móvil avanza en paralelo. [LV-014](backlog.md#lv-014) cierra el recorrido en escritorio y teléfono.
3. **Completar el alcance de diez.** Después de LV-014, [LV-004](backlog.md#lv-004) reutiliza el flujo común. Cada idioma aporta mensajes, configuración, muestras y validación. [LV-005](backlog.md#lv-005) verifica en paralelo el contenido y el rastreo de sus rutas.
4. **Publicar y medir.** [LV-007](backlog.md#lv-007) consolida calidad, costes, pagos y operación. El propietario decide la publicación con la evidencia de los diez idiomas.
5. **Ampliar tras monetizar.** Priorizar los siguientes paquetes con compras, uso repetido y demanda observada por idioma.

La [matriz de clientes, usos y mensajes](docs/specs/LV-005-clientes-usos-y-mensajes.md) orienta el contenido comercial y su validación SEO/GEO sin modificar la cobertura aprobada.

Claude Design aportó la propuesta de las tres áreas sobre una base visual reutilizable. El [prompt inicial revisado por T3](docs/specs/LV-005-claude-design-prompt.md) y su [dictamen](docs/specs/LV-005-claude-design-revision.md) conservan el historial; la integración y dirección visual vigentes se registran a continuación.

Actualización 11 de noviembre: el propietario entregó el diseño blanco/sans serif que reemplaza la dirección crema anterior. [Tres áreas integradas y verificadas localmente](docs/specs/LV-005-integracion-claude-design.md), con panel del cliente y backend conservado. Autorizada la [ampliación posterior de perfil e historiales](docs/specs/LV-003-panel-cuenta.md). La revisión física móvil y los gates comerciales siguen abiertos.

La [segunda portada de Claude Design](docs/specs/LV-005-diseno-v2.md) añade ejemplos por etapas, pasos animados, recargas y preguntas buscables. Conserva las tres áreas y los gates comerciales; no habilita nuevas direcciones ni publicación.

Consulta las ventanas orientativas en el [cronograma](gantt.md). El [backlog](backlog.md) mantiene estados y responsables, y las [especificaciones](docs/specs/LV-001-plataforma-multilingue.md) detallan la aceptación.

## Evidencia para publicar

- **Calidad.** Gemini procesa el clip de prueba y se abre el SRT descargado para cotejar texto y tiempos. La candidata comercial supera las pruebas de los diez recorridos y valida cada capacidad anunciada con muestras de referencia. Si se incluye MP4, se comprueba también su reproducción.
- **Costes y operación.** Se mide coste por trabajo exitoso, idioma o par y minuto, incluidos reintentos y almacenamiento. Los resultados sustentan el precio y los límites que apruebe el usuario. En modo de prueba se comprueba el pago, la reserva y consumo únicos, la liberación de créditos ante fallo final y el acceso privado a los archivos.
- **Publicación.** La candidata en Node.js 24 LTS supera las comprobaciones técnicas y el recorrido completo. Las diez rutas públicas pasan la revisión de rastreo, canónicas, `hreflang` y sitemap, y queda lista la medición de indexación, referencias de asistentes y conversiones. Con esa evidencia, el usuario decide si se publica.

## Estudio de ampliaciones · 11 de noviembre

[Archivos grandes, almacenamiento temporal, Drive/Dropbox y voz sintética](docs/specs/LV-007-archivos-destinos-voz.md): análisis solicitado, no alcance comercial aprobado. Preparar carga/cuotas/borrado y medir1/5/10min antes de ampliar límites; estudiar narración en paralelo, con calidad/precio independientes de subtítulos. No cambiar paquetes, activar facturación ni publicar estas funciones por este estudio.

Incremento autorizado de archivos yDrive: [implementado en candidata local](docs/specs/LV-007-archivos-destinos-voz.md#entrega-local--archivos-grandes-y-drive--2026-11-11), con pruebas de volumen/borrado yAPI propiaGoogle habilitada sinfacturación. Guardado real enDrive requiere consentimiento/apertura delpropietario; límites comerciales definitivos, exportación larga ySpaces siguen por validar. No se incluye voz enlosplanes por estaentrega.
