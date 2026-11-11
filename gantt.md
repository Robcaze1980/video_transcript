# Cronograma de LinguistVision

Orden de ejecución y dependencias. Las semanas son ventanas orientativas de planificación desde que estén disponibles los insumos de cada bloque. No representan fechas ni duraciones comprometidas. Reestimar tras la prueba real, el cierre de alcance y las primeras mediciones.

| Tarea | Bloque | Inicio relativo | Depende de | Evidencia de cierre |
|---|---|---|---|---|
| LV-001 | Alcance de lanzamiento | Semana 1 | Decisión del usuario | Lista de diez, pares prometidos, formatos y límites |
| LV-002 | Prueba local Gemini → SRT | Semana 1, en paralelo | Clave y saldo disponible del proyecto Gemini | Clip real procesado y SRT descargado y cotejado |
| LV-003 | Núcleo comercial y adaptadores | Semanas 2–3 para la base. Pago móvil y preparación de Firebase en paralelo al editor. | LV-001 para cerrar reglas comerciales y Google real en desarrollo verificado; dominio y proyecto final aprobados para el alta de producción | Alta, confirmación, Google, recuperación y aislamiento de cuenta. Acreditación de PayPal Sandbox en el teléfono. |
| LV-006 | Prueba de reutilización con PDF | Tras disponer del núcleo local de LV-003 | Circuito local de trabajos y saldo | Verificado en la web local con PDF → CSV y video → SRT |
| LV-008 | Revisión y exportación del piloto | Preparación en paralelo con LV-002 | La prueba con subtítulos reales depende de LV-002 | Corrección sobre el video y salidas SRT y MP4 cotejadas |
| LV-009 | Proyectos, borrador e importación SRT web | Candidata local verificada | LV-008 y núcleo local de LV-003 | Importación, guardado y reapertura verificados en Chrome. Prueba física del Pixel pendiente. |
| LV-010 | Pistas bilingües, tiempos y estados de trabajo | Candidata local verificada, en paralelo con LV-011 | LV-009 | Edición y MP4 bilingüe verificados en el Pixel. Pendiente cotejar ambos SRT descargados. |
| LV-011 | Estilos globales y presets | Verificada | LV-009 | Reapertura comprobada en Chrome. MP4 con Alto contraste y preset personalizado guardado en el Pixel. |
| LV-012 y LV-013 | Importación LRC/ASS, resaltado manual y estilos estáticos | Importación, reapertura, resaltado y MP4 con estilo personalizado comprobados en el Pixel. Descarga SRT cotejada en VS Code. | LV-009 a LV-011. El pago móvil puede avanzar en paralelo. | Evidencia del editor registrada. |
| LV-014 | App privada completa en inglés, español y árabe | Editor, tres muestras con voz y ensayo de reversión comprobados. | LV-009 a LV-013 según alcance, LV-003 para pago y operación | Acreditar PayPal Sandbox en el Pixel. Prueba aplazada por el propietario. |
| LV-004 | Completar los diez idiomas por paquete | Ajuste local de finales y lectura de MP4 con índice al final comprobados. Sigue la validación con clips nuevos. | Contrato de idioma estable y selección comercial de LV-001 | Diez idiomas y pares anunciados con evidencia por capacidad. |
| LV-005 | Web pública SEO y GEO en diez idiomas | Portada y alta de prueba verificadas en localhost. | LV-003 para acceso comercial, LV-004 para capacidades y LV-007 para oferta y cobro | Revisión humana por mercado y comprobación pública de las diez rutas y la medición. |
| LV-007 | Candidata comercial | Medición de obra en PC y tres recargas aprobadas. Evaluar el Droplet de DigitalOcean en paralelo. Cierre tras LV-003, LV-004, LV-005 y LV-014. | Costes, calidad, pagos y alcance aprobados | Recorrido completo con saldo repartido, prueba de capacidad y restauración, límites y decisión de publicación. |

El [backlog](backlog.md) guarda el estado de cada tarea. Al cambiar alcance o dependencias, ajusta el orden aquí y explica el motivo en la [bitácora](bitacora.md). La fecha de lanzamiento se estima después de medir la carga de validación lingüística.

Claude Design: propuesta de base compartida → contraste de recorridos y escrituras → integración privada → pruebas. La propuesta puede avanzar en paralelo al catálogo y al contenido localizado; no bloquea su preparación ni cambia las ventanas orientativas. [Prompt y revisión](docs/specs/LV-005-claude-design-revision.md).

11 de noviembre: integración privada de las tres áreas y pruebas automatizadas completadas. Siguiente incremento LV-003: contrato de perfil/historiales → backend autorizado → panel con datos → aislamiento/concurrencia y recorrido. Revisión de contenido/Pixel puede avanzar en paralelo. Se conservan ventanas orientativas y aprobación pública pendiente. [Evidencia](docs/specs/LV-005-integracion-claude-design.md).

Actualización LV-005 (10 de noviembre): rediseño de las diez portadas implementado y verificado localmente con casos por comprador, demo, planes y FAQ. La revisión editorial humana puede avanzar en paralelo al cierre de cuentas y consumo. Dominio y publicación siguen condicionando la verificación pública; se conservan las ventanas orientativas anteriores.

LV-005: el caso de inspección español→inglés y los cinco usos secundarios quedaron integrados y verificados en diez locales. Se conservan fechas orientativas y dependencias; siguen revisión humana y publicación con dominio.

Revisión T3 de 90 direcciones: catálogo/estado efectivo → API/selector → validación y activación por dirección. La redacción localizada y preparación de muestras pueden avanzar en paralelo. La publicación conserva sus gates y ventanas orientativas. [Plan](docs/specs/LV-004-plan-90-direcciones.md).

11 de noviembre · LV-005: [diseño comercial V2](docs/specs/LV-005-diseno-v2.md) integrado y probado localmente. Secuencia conservada: revisión editorial y prueba física → gates LV-003/LV-004/LV-007 → aprobación del dominio/publicación. La ampliación de perfil e historiales sigue en paralelo como siguiente incremento de LV-003. No cambian las ventanas orientativas.

11 de noviembre · Estudio solicitado de [archivos grandes/destinos/voz](docs/specs/LV-007-archivos-destinos-voz.md), sin nueva fecha comprometida. Dependencia propuesta: carga y almacenamiento privado medidos→Drive→Dropbox según disponibilidad del artefacto. Evaluación TTS y revisión de textos en paralelo; precio/alcance de voz después de coste y calidad. Conserva ventanas y gates de lanzamiento existentes; la voz no se convierte en requisito de lanzamiento sin decisión comercial.

11 de noviembre · incremento autorizado: carga privada/reanudación/cuotas/borrado yDrive implementados/verificados localmente. [Evidencia](docs/specs/LV-007-archivos-destinos-voz.md#entrega-local--archivos-grandes-y-drive--2026-11-11). Ahora consentimientoGoogle→persistenciaSRT/MP4 PC/Pixel; enparalelo medición cámara/render ypreparaciónDigitalOcean. Sinfecha pública nueva, no se eleva promesa500MB ni se incluye voz. Conserva ventanasanteriores.
