# Bitácora de LinguistVision

Entradas fechadas de cambios, decisiones y entregas. Usa el ID de tarea para enlazar especificación, pruebas, cronograma e incidentes. Conserva el historial y añade una entrada si una decisión se sustituye.

## 2026-11-07 · LV-000 · Base de gestión

- Se establece la gestión por especificación, backlog, hitos e incidentes. La [especificación de lanzamiento](docs/specs/LV-001-plataforma-multilingue.md) adopta 30 idiomas como requisito.
- La revisión de arquitectura con DeepSeek y Kimi, incluidos intentos y cargos, está en el [documento de arquitectura](docs/MULTILINGUAL-ARCHITECTURE.md).
- La candidata de Windows superó las comprobaciones locales. La [validación funcional](docs/VALIDATION-2026-11-07.md) sigue pendiente desde Gemini hasta SRT.
- El calendario es relativo a la disponibilidad de insumos. Aún no hay fechas comprometidas.

## 2026-11-07 · LV-000 · Integración del plan maestro

- Se añadió el [plan maestro](MASTERPLAN.md) y se enlazó desde el README y AGENTS.md. Resume objetivo, alcance, dependencias y evidencia para publicar. El backlog conserva los detalles y el cronograma conserva sus ventanas orientativas.
- Se comprobó que el clip sintético está disponible y que falta el archivo de configuración de Gemini. [LV-002](backlog.md#lv-002) sigue bloqueada tras el HTTP 503 local documentado. [LV-001](backlog.md#lv-001) puede avanzar en paralelo.

## 2026-11-07 · LV-000 · Revisión de preparación

- El plan maestro permite iniciar LV-001 y preparar LV-002 en paralelo. El archivo de configuración de Gemini sigue ausente. Antes de implementar cada fase, conviene detallar la matriz de cobertura y los umbrales de calidad en LV-004, los estados de trabajo y créditos en LV-003 y las comprobaciones operativas de la candidata web en LV-007. Las decisiones comerciales siguen en LV-001.
- El servidor local de T3 aceptó la prueba en LinguistVision. El proveedor volvió a bloquear la generación por el límite de uso compartido de ChatGPT. No se reportó coste ni se lanzó una consulta adicional a OpenRouter. [Incidente LV-E02](errorlogs.md).

## 2026-11-07 · LV-000 · Segunda revisión integral

- DeepSeek y Kimi revisaron en paralelo el plan maestro, LV-001, la arquitectura, el backlog y el cronograma. Se usó OpenRouter de LinguistVision por el bloqueo documentado de T3. Ambos condicionaron la construcción del alcance completo y la publicación a evidencia pendiente. DeepSeek admitió trabajo preparatorio. Kimi recomendó esperar el cierre de LV-001 y LV-002. Codex mantuvo en paralelo la preparación del contrato técnico común y el cierre comercial según sus dependencias.
- Se precisó la aceptación en [LV-001](docs/specs/LV-001-plataforma-multilingue.md) y se sincronizaron [cronograma](gantt.md) y [plan maestro](MASTERPLAN.md). Los 30 idiomas y los pares anunciados se verifican por separado. Se adoptaron controles de muestras, rastreo, créditos, retención y medición de costes. La fórmula de 870 pares sigue siendo condicional. Los umbrales detallados corresponden a LV-004.
- Costes verificados en OpenRouter. DeepSeek V4.1 Flash, Cohere, `gen-1794076686-kDY7Ke974PzuSCPOgmXg`: US$0.0017097102. Kimi K2.6, CoreWeave, `gen-1794076686-wKoYOi72snqkZnqMPwU3`: US$0.0091052676. Total: **US$0.0108149778**.

## 2026-11-07 · LV-001 · Propuesta de idiomas, pares y formatos

- DeepSeek y Kimi evaluaron las tres decisiones en paralelo. Codex contrastó el alcance con datos públicos y documentó [la propuesta, los criterios de piloto y los cargos](docs/specs/LV-001-propuesta-comercial.md). El alcance comercial sigue pendiente de decisión. No cambian las dependencias ni las ventanas del cronograma.

## 2026-11-07 · LV-001 y LV-004 · Piloto y alta de idiomas

- El usuario aprobó el piloto privado inglés ↔ español condicionado a que los demás idiomas se incorporen por paquete. La [prueba de aceptación de LV-004](docs/specs/LV-004-paquetes-de-idioma.md) exige demostrarlo con un tercer idioma y verificar la capacidad antes de publicarla. El lanzamiento mantiene 30 idiomas.
- Los dos selectores de la app local leen el mismo catálogo de subtítulos. Se preservaron las diez opciones y los nombres que consume Gemini. En Node 24.13.0 pasaron los tipos, 28 pruebas y la compilación. Falta la implementación web y su verificación de extremo a extremo.
- LV-002 sigue bloqueada. El clip existe y falta el archivo de configuración de Gemini. No hubo nuevas consultas externas.

## 2026-11-07 · LV-002 · Prueba con Gemini

- La candidata leyó la clave local y Chrome inició el flujo inglés → español con el clip sintético. Gemini Files rechazó la carga por saldo prepagado agotado. La prueba de SRT sigue bloqueada por [LV-E04](errorlogs.md). [Evidencia y siguiente paso](docs/VALIDATION-2026-11-07.md#intento-con-la-clave-del-proyecto).

## 2026-11-07 · LV-008 · Flujo de revisión del piloto

- DeepSeek y Kimi revisaron en paralelo las observaciones de CapCut. Se incorporaron la vista sincronizada, búsqueda con salto, corrección, posición independiente del texto y descarga SRT o MP4 al plan del piloto. [Criterios de aceptación, hallazgos y cargos](docs/specs/LV-008-revision-y-exportacion-del-piloto.md).
- El trabajo quedó en el backlog y cronograma. Puede prepararse con segmentos sintéticos. El cierre con subtítulos reales depende de LV-002. El cambio fue documental.

## 2026-11-07 · LV-008 · Implementación y prueba sintética

- La app local admite importación y revisión sin clave de Gemini. Se incorporaron búsqueda con salto, corrección sobre el video y posición independiente del subtítulo. La vista previa y el MP4 comparten el dibujo. Se verificaron las dos descargas con clips horizontal y vertical.
- La grabación directa de MP4 falló en Chrome. La conversión desde WebM con FFmpeg servido por la app pasó la prueba de dimensiones, audio y comparación de fotogramas. [Evidencia de LV-008](docs/specs/LV-008-revision-y-exportacion-del-piloto.md#evidencia-local-con-subtítulos-sintéticos).
- Quedan la prueba con la transcripción real de LV-002 y la reproducción en un teléfono físico. La prueba sintética no generó consultas a Gemini ni a revisores externos.

## 2026-11-07 · LV-002 y LV-008 · Prueba real tras la recarga

- Se cerró LV-002 tras verificar la carga y transcripción en Gemini y el SRT descargado. Se cerró el incidente LV-E04. [Prueba tras la recarga](docs/VALIDATION-2026-11-07.md#validación-tras-la-recarga).
- La prueba de escritorio de LV-008 pasó con esa transcripción, incluido el SRT revisado y el MP4 con audio y subtítulos en la posición esperada. Queda la reproducción en un teléfono físico. [Evidencia de LV-008](docs/specs/LV-008-revision-y-exportacion-del-piloto.md#evidencia-con-transcripción-real).

## 2026-11-07 · LV-008 · Cierre de la prueba móvil

- El usuario reprodujo el MP4 en su teléfono y confirmó que escuchó el audio y que los subtítulos se leyeron correctamente. Se cerró LV-008 en el backlog. [Confirmación de la prueba](docs/specs/LV-008-revision-y-exportacion-del-piloto.md#confirmación-en-teléfono).

## 2026-11-07 · LV-003 · Contrato técnico

- Quedó definido y revisado el [contrato técnico de trabajos y créditos](docs/specs/LV-003-nucleo-comercial.md), incluidos fallos, reintentos y pruebas. T3 terminó sin respuesta. DeepSeek y Kimi revisaron en paralelo por OpenRouter. Costo confirmado: US$0.004240764.
- Se registró en [AGENTS.md](AGENTS.md) la entrega por actividad y la espera de «avanza». Siguiente actividad: implementar el circuito de trabajos y saldo con un adaptador simulado en un entorno de prueba.

## 2026-11-07 · LV-003, LV-004, LV-005 y LV-006 · Ejecución continua

- Se corrigió el protocolo de AGENTS.md. La autorización de avanzar sigue vigente entre actividades. Las decisiones no técnicas se consultan al usuario mientras se ejecutan los trabajos independientes.
- PostgreSQL 17 verificó el circuito de trabajos y créditos, incluidos avisos de Checkout firmados con datos de prueba. Un PDF real de texto produjo CSV en el mismo núcleo que el adaptador simulado de subtítulos. [Pruebas y límites](docs/specs/LV-003-nucleo-comercial.md#implementación-de-prueba).
- Se probó la incorporación de una tercera página, en árabe, mediante configuración. Se mantuvo la lista candidata de idiomas como propuesta hasta confirmación comercial. [Contrato de paquetes](docs/specs/LV-004-paquetes-de-idioma.md).
- Una instalación limpia en la carpeta activa encontró un archivo bloqueado por Windows. Se repusieron las dependencias faltantes sin reemplazar el ejecutable en uso. La candidata aislada pasó la instalación limpia, tipos, 39 pruebas y compilación. La prueba de arranque anterior a la incorporación del catálogo devolvió HTTP 200 en 3001 sin clave de Gemini. No se realizaron consultas nuevas a modelos, cobros reales ni despliegues públicos.
- El usuario aprobó la lista candidata de 30 idiomas como base comercial. Se incorporó al catálogo y se verificó que el generador conserva identidades y locales distintos sin forzar equivalencias de búsqueda. [Lista aprobada](docs/specs/LV-001-propuesta-comercial.md#lista-base-aprobada-de-30-idiomas).

## 2026-11-07 · LV-003 y LV-006 · Piloto web privado

- La web privada local conectó invitación, carga, créditos, cola, historial y descargas. Las pruebas HTTP verificaron aislamiento entre cuentas, tamaño, devolución ante fallo, firmas y avisos duplicados.
- En Chrome, una compra simulada de 5 créditos financió un PDF → CSV y una transcripción real Gemini → SRT. Se abrieron ambos resultados y se confirmó saldo 3 y descargas tras recargar. Se cerró LV-006. El Checkout de Stripe externo queda pendiente de una cuenta de prueba de LinguistVision.
- T3 volvió a quedar limitado. DeepSeek y Kimi revisaron en paralelo por OpenRouter. Total de consultas confirmado: US$0.0024881868. [Evidencia, configuración y cargos](docs/specs/LV-003-piloto-web-privado.md).
- La candidata aislada pasó instalación limpia, tipos, 40 pruebas y compilación. Arrancó solo en 3001 y rechazó el acceso a una cuenta sin sesión. Se verificaron los enlaces de la documentación y se detuvieron el piloto y PostgreSQL de prueba.

## 2026-11-07 · LV-003 · Cambio a PayPal

- El usuario eligió PayPal por micropagos. Se sustituyó Stripe por Orders v2 Sandbox y se retiró el SDK de Stripe. El nuevo esquema local conserva por separado el historial del prototipo anterior.
- El simulador local y PostgreSQL verificaron aprobación, captura, reconciliación de respuesta perdida, idempotencia y rechazo por importe, vendedor u orden incorrectos. Chrome confirmó cinco créditos, una descarga privada y saldo cuatro. La tarifa de micropagos requiere habilitación comercial aparte.
- T3 volvió a agotar el límite. DeepSeek y Kimi revisaron vía OpenRouter por US$0.0016881470793 en total. [Guía de prueba, tarifas y cargos](docs/specs/LV-003-piloto-web-privado.md).

## 2026-11-07 · LV-003 · Autenticación con PayPal Sandbox

- Node cargó las tres variables locales. PayPal Sandbox rechazó dos solicitudes de token con HTTP 401 (`invalid_client`). La compra de prueba queda pendiente de corregir el par de credenciales de la app. [LV-E08](errorlogs.md) · [Procedimiento](docs/specs/LV-003-piloto-web-privado.md#paypal-sandbox-externo).
- El reintento autenticó la app con HTTP 200. El piloto creó la orden de US$4,95 de prueba y cotejó el vendedor. Pendiente la aprobación con la cuenta compradora de Sandbox. [Evidencia](docs/specs/LV-003-piloto-web-privado.md#paypal-sandbox-externo).
- El usuario aprobó la orden en PayPal Sandbox. La API local retomó la orden en sesión autenticada y verificó una captura completada. La confirmación repetida conservó cinco créditos. El CSV de un PDF sintético coincidió con el esperado, la descarga anónima devolvió HTTP 401 y quedaron cuatro créditos. Queda verificar el retorno automático en el mismo navegador autenticado. [Evidencia](docs/specs/LV-003-piloto-web-privado.md#paypal-sandbox-externo).

## 2026-11-07 · LV-003 · Retorno automático de PayPal Sandbox

- Se inició otra compra de prueba desde el piloto autenticado en Chrome con saldo cero. La misma pestaña regresó tras la aprobación. La página solicitó captura con HTTP 202, limpió los parámetros de retorno y mostró «Saldo actualizado» con cinco créditos. [Evidencia](docs/specs/LV-003-piloto-web-privado.md#paypal-sandbox-externo).

## 2026-11-07 · LV-003, LV-004, LV-005, LV-007 y LV-008 · Editor y candidata

- El editor web abrió fuentes privadas, corrigió y movió un subtítulo y exportó SRT y MP4 en Chrome con saldo simulado y Gemini real. Un fallo devolvió la reserva. Se verificó el audio AAC y la frase incrustada. [Evidencia y coordinación](docs/specs/LV-003-piloto-web-privado.md#editor-web-del-piloto).
- El piloto acepta origen HTTPS canónico para un proxy local, incluye cuotas y borra artefactos sin borrar los movimientos de créditos. Pendiente red privada y teléfono real. [Controles y prueba remota](docs/specs/LV-003-acceso-privado.md).
- El tercer paquete privado procesó árabe → español. El rastreo local cubrió 30 rutas con bloqueo de indexación, tres paquetes de contenido y 27 borradores. [Cobertura](docs/specs/LV-004-paquetes-de-idioma.md).
- Se registraron las primeras dos mediciones de tokens y un MP4. PayPal publica la tarifa de micropagos, pendiente de confirmación para la cuenta. [Mediciones](docs/specs/LV-007-candidata-comercial.md).
- T3 agotó el límite. DeepSeek y Kimi revisaron en paralelo por OpenRouter por **US$0.0017367966**. [Intentos y cargos](docs/specs/LV-003-piloto-web-privado.md#coordinación-y-costos).
- Node 24.13.0. La candidata aislada pasó instalación limpia, tipos, 49 pruebas con PostgreSQL y compilación. La auditoría de producción informó cero vulnerabilidades. La auditoría completa señaló seis avisos de dependencias de desarrollo. El servidor real respondió HTTP 200 para el piloto y su editor en 3001, y un MP4 de 31 s con duración declarada de 1 s se rechazó antes de Gemini. La compra nueva quedó pendiente de aprobación.

## 2026-11-07 · LV-003 · Preparación del piloto desde el teléfono

- Tailscale 1.104.5 quedó instalado en Windows. La PC sigue pendiente de autenticación y el teléfono aún no aparece en la red. Se preparó el clip sintético y se comprobó el piloto detrás de un proxy local, con cookie `Secure` y rechazo de Host, Origin y sesión incorrectos. [Procedimiento y evidencia](docs/specs/LV-003-acceso-privado.md#preparación-de-la-primera-sesión).
- Windows y el Pixel se conectaron a Tailscale. Se habilitó Serve HTTPS para la sesión de prueba, con filtro de las dos direcciones del Pixel. HTTPS rechazó a la PC y a una solicitud con encabezado de origen falsificado. Se entregó la invitación temporal al propietario. [Prueba de conexión](docs/specs/LV-003-acceso-privado.md#conexión-del-pixel).
- El Pixel creó órdenes de Sandbox por 5G, pero el flujo de PayPal se detuvo antes de la aprobación. Se comprobaron siete órdenes y cero capturas. Una cuenta separada recibió cinco créditos del simulador para continuar la prueba de archivos desde el Pixel. [LV-E10](errorlogs.md).
- El Pixel cargó el clip, corrigió la segunda frase y reprodujo el MP4 descargado con «dos ruedas». Se verificaron H.264, AAC con señal y saldo de siete disponibles tras tres trabajos. Queda el SRT editado del teléfono. [Evidencia móvil](docs/specs/LV-003-acceso-privado.md#conexión-del-pixel).
- La captura de Descargas del Pixel mostró `linguistvision.srt` de 136 bytes. Queda cotejar su contenido. [Evidencia móvil](docs/specs/LV-003-acceso-privado.md#conexión-del-pixel).

## 2026-11-07 · LV-004 · Primer corte de tres idiomas

- T3 volvió a alcanzar el límite. DeepSeek y Kimi revisaron en paralelo por OpenRouter y se contrastaron los hallazgos con Chrome y Gemini. Coste confirmado **US$0.0045801657**. [Revisión y evidencia](docs/specs/LV-004-paquetes-de-idioma.md#revisión-del-primer-corte).
- La interfaz del piloto carga paquetes independientes para inglés, español y árabe. Chrome conservó sesión, dirección de traducción y borrador al alternar los tres. Gemini produjo SRT en los tres idiomas y la candidata exportó y cotejó SRT y MP4 en árabe. Pasaron 49 pruebas, tipos y compilación. La candidata se probó en loopback 3002 para conservar el piloto móvil en 3001.
- La candidata se activó para el Pixel en 3001 con los mismos siete créditos simulados y un clip árabe privado. Se verificaron los tres módulos, el editor, el clip y el rechazo HTTPS de un origen falsificado. Pendiente el recorrido en el teléfono. [Prueba privada](docs/specs/LV-004-paquetes-de-idioma.md#prueba-privada-en-el-pixel).
- El Pixel completó árabe → español y árabe → árabe. La captura confirmó subtítulos en árabe sobre el video. El saldo quedó en cinco disponibles y cero reservados. Quedan el cambio de interfaz con edición abierta y las exportaciones árabes desde el teléfono. [Prueba privada](docs/specs/LV-004-paquetes-de-idioma.md#prueba-privada-en-el-pixel).
- Las capturas del Pixel confirmaron el cambio de la interfaz de español a árabe con el editor abierto y la conservación de la frase editada. Queda cotejar las exportaciones árabes. [Prueba privada](docs/specs/LV-004-paquetes-de-idioma.md#prueba-privada-en-el-pixel).

## 2026-11-07 · LV-E12 y LV-E10 · Sincronía y pago móvil

- Se midieron los desfases del MP4 móvil y se sustituyó la captura en tiempo real del piloto por render según el archivo original. Chrome reprodujo la duración de 6,445 s, el audio sin desplazamiento medible y los intervalos de subtítulos a menos de un fotograma. [Mediciones](docs/specs/LV-008-revision-y-exportacion-del-piloto.md#sincronía-de-la-exportación-del-piloto).
- T3 volvió a alcanzar el límite en `mcp:27298754-c34b-4d59-aa0b-4bd4a72af353`. OpenRouter confirmó US$0.00068985081 para DeepSeek V4.1 Flash, Wafer, `gen-1794114670-eEs8ZWAUEiFY3bzc5LAC` y US$0.00691579548 para Kimi K2.6, Inceptron, `gen-1794114670-f6A5B1GHrXZAFf9jWEO7`. Total **US$0.00760564629**. Las recomendaciones sobre tiempos y aprobación se contrastaron con mediciones de fotogramas y audio y con documentación oficial de PayPal.
- El modo web opcional de PayPal Sandbox abrió una pestaña de aprobación en Chromium con Android emulado. Se comprobó la separación de la pantalla de archivos y la política del checkout. Pendiente la aprobación y acreditación en el Pixel. [Candidata de pago](docs/specs/LV-003-acceso-privado.md#candidata-de-pago-en-el-navegador).
- La candidata conjunta pasó instalación limpia, tipos, 50 pruebas con PostgreSQL y compilación. En el Pixel quedó activo el exportador corregido con saldo simulado para repetir la exportación del mismo trabajo. El modo web de PayPal quedó listo en la candidata de prueba.
- El archivo nuevo del Pixel confirmó LV-E12. Duración idéntica a la fuente, audio sin desplazamiento medible y texto incrustado con un error máximo de 17 ms. Se activó la pantalla web de PayPal Sandbox para el Pixel en una cuenta de prueba con saldo cero. [Mediciones](docs/specs/LV-008-revision-y-exportacion-del-piloto.md#sincronía-de-la-exportación-del-piloto).

## 2026-11-08 · LV-E10 · Checkout integrado

- El Pixel volvió de la ventana de PayPal sin aprobar. La orden seguía pendiente y el saldo en cero. Se habilitó la presentación integrada explícita y se corrigió el mensaje de cierre. Chromium emulado cargó el formulario y la candidata pasó tipos, 50 pruebas y compilación. Queda la aprobación en el Pixel. [Registro de pago móvil](docs/specs/LV-003-acceso-privado.md#candidata-de-pago-en-el-navegador).
- La presentación integrada también se cerró en el Pixel. La última orden siguió pendiente, sin solicitud de captura. Se guardó fuera del repositorio un borrador con la referencia de Sandbox para soporte técnico. [LV-E10](errorlogs.md).
- Se abrió el portal oficial de soporte técnico. PayPal solicitó iniciar sesión para acceder al canal de casos. El envío queda pendiente de la autenticación del titular.

## 2026-11-08 · LV-009 a LV-014 · Plan completo del editor

- El propietario fijó el orden. Completar inglés, español y árabe, cerrar la app privada y luego incorporar los otros 27 por paquete. La publicación pública mantiene los 30 idiomas.
- Se agregaron seis tareas para el editor, con inventario CapCut, dependencias, responsables y condiciones de cierre. El maestro, el backlog, el cronograma y las especificaciones reflejan el mismo orden. La próxima implementación es LV-009, proyectos, borrador persistente e importación SRT en la web.
- El reintento de T3 completó la revisión. DeepSeek y Kimi se consultaron por OpenRouter debido a que T3 carecía de proveedores habilitados para esos dos modelos. Coste confirmado US$0.002020896009, con el primer intento de Kimi sin cargo confirmado. [Revisión y cargos](docs/specs/LV-009-plan-del-editor.md#revisión-del-plan).

## 2026-11-08 · LV-009 · Proyecto SRT persistente

- El piloto web importa un MP4 y un SRT existente, guarda correcciones por revisión y permite recuperar el proyecto al iniciar sesión de nuevo. Se añadieron reemplazo con confirmación, deshacer y borrado. Los archivos caducan a las 24 horas.
- La candidata superó instalación limpia, tipos, 51 pruebas con PostgreSQL y compilación. Chrome guardó, reabrió y descargó el SRT corregido sin consumir créditos ni invocar Gemini. Pendiente repetir la prueba en el Pixel. [Evidencia](docs/specs/LV-009-plan-del-editor.md#validación-de-lv-009).
- La implementación se verificó en Codex con las revisiones previas del plan. No se hicieron nuevas consultas externas ni hubo cargos de modelos en esta actividad.

## 2026-11-08 · LV-009 · Revisión del código

- T3 confirmó que no podía asignar DeepSeek ni Kimi. Ambos revisaron el código anterior a las correcciones por OpenRouter. Se confirmó un total de **US$0.094821876**, que incluye un intento de Kimi sin respuesta. Dos intentos iniciales quedaron sin cargo verificable. [Revisiones, identificadores y cargos](docs/specs/LV-009-plan-del-editor.md#revisión-del-código-de-lv-009).
- Codex reprodujo y corrigió el cupo tras la caducidad, la copia simultánea al borrado, la validación del MP4 truncado y el guardado doble. Pasaron 51 pruebas con PostgreSQL, tipos, compilación y el recorrido en Chrome con conflicto de revisión. Queda la prueba física en el Pixel.

## 2026-11-08 · T3 · Conexión de DeepSeek y Kimi

- Se instaló OpenCode 1.19.5 en `%LOCALAPPDATA%\LinguistVision\t3-review` y se conectó a T3 mediante la instancia `linguistvision-openrouter`, habilitada solo en el proyecto LinguistVision. La configuración referencia la clave existente por su archivo. El modelo coordinador conserva su configuración.
- Dos pruebas sintéticas en paralelo desde T3 completaron con `DEEP_READY` y `KIMI_READY`. Los hilos fueron `mcp:bfc6f8c8-f8f7-48bd-9252-d331aebfb280` y `mcp:cc4232cd-f670-4926-8dba-4975d7559f37`. La configuración final desactiva las copias automáticas del espacio de trabajo y deja la revisión sin herramientas. El índice de la copia de la primera prueba quedó con su fecha original después de la segunda.
- El consumo de la clave de LinguistVision subió **US$0.028924115** entre las mediciones que abarcaron las cuatro consultas sintéticas. OpenRouter no confirmó el desglose por consulta. La primera prueba dejó una copia local en el perfil aislado. La revisión automática de la herramienta bloqueó la eliminación recursiva de esa carpeta.

## 2026-11-08 · LV-010 · Dos pistas y edición de tiempos

- DeepSeek y Kimi revisaron el diseño en paralelo desde T3. Codex implementó pistas editables, una revisión atómica, composición temporal de la vista previa y el MP4, y cancelación y reintento. Coste agregado de OpenRouter **US$0.017075558**. [Diseño y evidencia](docs/specs/LV-009-plan-del-editor.md#validación-de-lv-010).
- Pasaron tipos, 54 pruebas con PostgreSQL, migración sobre LV-009, compilación y el recorrido en Chrome móvil emulado. Un trabajo nuevo de Gemini produjo ambos SRT en una llamada y el editor reabrió la traducción editada con el original intacto. Pendiente el Pixel físico.

## 2026-11-08 · LV-011 · Estilo global y presets

- DeepSeek y Kimi revisaron en paralelo por T3. Codex implementó el estilo por revisión y los presets reutilizables por cuenta. El consumo confirmado de OpenRouter fue **US$0.007810221** en conjunto. [Revisión y comprobaciones](docs/specs/LV-009-plan-del-editor.md#validación-de-lv-011).
- Pasaron tipos, 55 pruebas con PostgreSQL, migración y compilación. Chrome confirmó la persistencia tras reabrir y la correspondencia con el MP4 horizontal y vertical. Se actualizó el plan maestro, el cronograma y el backlog. Queda la prueba física en el Pixel.

## 2026-11-08 · T3 · Kimi K3.1 Pro

- La instancia de LinguistVision ofrece `moonshotai/kimi-k3.1-pro` como único modelo Kimi. Se actualizó la lista de modelos de T3, la lista permitida de OpenCode y la regla del respaldo directo. El catálogo local mostró Kimi K3.1 Pro y DeepSeek.
- Una consulta sintética desde T3 devolvió `KIMI_31_READY` con el modelo solicitado en el hilo `mcp:4c830901-44f9-4122-bccb-4aaa0d0ad13f`. El consumo de la clave OpenRouter aumentó **US$0.067805100** durante la prueba.

## 2026-11-08 · LV-009 a LV-011 · Preparación de la prueba en el Pixel

- Se activó la candidata de LV-011 en un acceso Tailscale Serve separado en el puerto HTTPS 8443, con proxy de loopback que acepta solo las direcciones del Pixel. La prueba usa cuenta aislada con saldo simulado y tres archivos sintéticos. La página privada entrega los archivos y la invitación de la sesión.
- La comprobación local verificó HTTP 403 desde otro dispositivo, HTTP 401 para la API sin sesión, la cookie segura, la importación de ambas pistas y la reapertura de una corrección. Queda ejecutar y cotejar el recorrido en el Pixel físico. [Criterios](docs/specs/LV-009-plan-del-editor.md#validación-de-lv-011).
- El Pixel mostró vacío el selector de archivos recientes al elegir un SRT. Se actualizó la candidata con los campos SRT sin filtro y se conservó la invitación y la cuenta de prueba. Pasaron 55 pruebas, tipos y compilación. Falta confirmar la selección desde Descargas en el Pixel. [LV-E16](errorlogs.md).
- En el Pixel apareció el MP4 en Descargas y siguieron sin aparecer los SRT. Se añadió a la página privada un botón para importar las tres muestras por la ruta normal del servidor y abrir el editor con sesión de prueba. Se verificaron ambas pistas, el rechazo sin origen válido y la redirección privada. El selector manual sigue pendiente.
- Tras el siguiente intento desde el teléfono, la cuenta seguía sin proyectos. Se precargó `prueba-video.mp4` en la cuenta privada y se confirmó que el servidor entrega el video y las dos pistas. Queda abrirlo desde el Pixel. La carga desde el teléfono sigue sin verificar.
- Las capturas del Pixel mostraron el proyecto abierto, las dos pistas en la vista previa y la corrección a «dos ruedas» en el editor. La pantalla aún indicaba cambios sin guardar y la base seguía en revisión 1. Pendientes el guardado, la reapertura y el cotejo de las descargas.
- El Pixel guardó la revisión 2. La base confirmó «dos ruedas» y el inicio de la traducción en 2,50 s, con el original intacto en 2,10 s. El proyecto conservó Alto contraste, con tamaño 28 y fondo al 92 %. Falta confirmar la reapertura en el teléfono, el preset personalizado y las descargas.
- Dos capturas del reproductor de Descargas del Pixel confirmaron el MP4 exportado. Se ven ambos pares de subtítulos en inglés y español con Alto contraste, incluida la corrección a «dos ruedas». Quedan por acreditar en el Pixel la reapertura tras recargar, el guardado de un preset personalizado, los dos SRT y la selección manual de archivos.
- El servidor confirmó que el Pixel guardó el preset personalizado `Pixel` con los mismos valores que Alto contraste. Se corrigió el selector que ocultaba el nombre activo. Pasaron 56 pruebas, tipos, compilación y reapertura con selección visible en Chrome. Se actualizó la misma candidata privada con el proyecto y el preset conservados. [LV-E17](errorlogs.md).
- El usuario confirmó que el selector corregido mostró `Pixel` en el teléfono. La revisión 3 confirmó `custom:Pixel`, sus valores de estilo, «dos ruedas» a 2,50 s y el original intacto a 2,10 s.

## 2026-11-08 · LV-012 y LV-013 · Propuesta de alcance

- DeepSeek y Kimi K3.1 Pro revisaron en paralelo por T3. Se documentó el primer corte de LRC/ASS y controles estáticos, el resaltado manual como segundo incremento y las funciones avanzadas propuestas para después. El propietario decide qué entra. Coste agregado confirmado **US$0.311076457**. [Propuesta y criterios](docs/specs/LV-009-plan-del-editor.md#propuesta-de-alcance-para-lv-012-y-lv-013).
- La cuenta del Pixel conserva la revisión 3, el preset `Pixel` y ambas pistas con sus tiempos esperados. Sigue pendiente la comprobación de los archivos SRT en el teléfono y la selección manual en Android.

## 2026-11-08 · LV-012 y LV-013 · Alcance aprobado y candidata local

- El propietario aprobó LRC/ASS y tipografía y transformación estáticas como primer corte, y el resaltado manual como segundo incremento. Codex implementó ambos, con una selección contigua por segmento y pista.
- Pasaron tipos, 61 pruebas, compilación y migración sobre un proyecto previo. Chrome verificó reapertura, reutilización de preset, SRT sin cambios visuales y comparación de los MP4 horizontal y vertical. Se corrigieron los controles de opacidad con identificadores repetidos y el selector de presets al guardar una variante. [Evidencia](docs/specs/LV-009-plan-del-editor.md#candidata-local-de-lv-012-y-lv-013).
- El backlog, cronograma y plan maestro registran la candidata local. La verificación en el Pixel físico continúa abierta. Coste externo nuevo **US$0.00**.

## 2026-11-08 · LV-012 y LV-013 · Candidata preparada para el Pixel

- Se inició la candidata en un puerto privado separado de Tailscale, con cuenta de prueba aislada y tres archivos sintéticos para selección manual. Windows verificó el bloqueo fuera de la lista del Pixel, las descargas y el acceso con sesión propia. Falta completar el recorrido físico. [Prueba en el Pixel](docs/specs/LV-009-plan-del-editor.md#prueba-en-el-pixel-físico).

## 2026-11-08 · LV-012 · Importación y resaltado verificados en el Pixel

- El Pixel importó el MP4, el LRC y el ASS con sufijo `.txt`. Las capturas confirman la selección táctil, la reapertura y el MP4 bilingüe con «amigos» resaltado. La revisión 2 del proyecto conserva el resaltado en el segmento traducido.
- Quedan el cotejo del SRT descargado en el Pixel y los controles estáticos de LV-013 en el teléfono. [Evidencia móvil](docs/specs/LV-009-plan-del-editor.md#prueba-en-el-pixel-físico).

## 2026-11-08 · LV-012 y LV-013 · Cotejo en PC

- A petición del usuario se cotejaron los SRT de ambas pistas y se repitió el recorrido de controles estáticos en Chrome de Windows. Coincidieron los textos y tiempos. El preset y los MP4 conservaron el estilo. La verificación táctil se registra por separado. [Evidencia](docs/specs/LV-009-plan-del-editor.md#cotejo-en-pc).

## 2026-11-08 · LV-013 · Vista previa táctil en el Pixel

- Las capturas muestran cursiva, subrayado y cambio de posición en las dos pistas. La base conserva la revisión 2 con el resaltado y sin estilo personalizado. Quedan persistencia y MP4 nuevo en el teléfono. [Evidencia móvil](docs/specs/LV-009-plan-del-editor.md#prueba-en-el-pixel-físico).

## 2026-11-08 · LV-014 · Primera verificación integrada

- Pasaron los tipos y 62 pruebas con PostgreSQL. Chrome cambió entre inglés, español y árabe con el mismo proyecto. Conservó la vista previa y el SRT, verificó la dirección árabe a 360 px y comparó las dos orientaciones del MP4.
- El backlog y el cronograma registran LV-014 en curso. La especificación separa las comprobaciones de interfaz de la calidad con voz, el recorrido físico, la reversión y la aprobación de PayPal Sandbox. Coste externo nuevo **US$0.00**. [Evidencia y pendientes](docs/specs/LV-009-plan-del-editor.md#verificación-de-lv-014).

## 2026-11-08 · LV-014 · Tres muestras con voz

- La misma candidata procesó inglés, español y árabe con Gemini real. Se cotejaron las cinco frases y sus tiempos en los SRT descargados y se abrieron como proyectos desde los trabajos terminados. La mayor diferencia estimada frente a la voz fue de 0,441 s. [Cotejo](docs/specs/LV-009-plan-del-editor.md#muestras-con-voz).
- El consumo medido equivale a **US$0,00487275 estimados**. La facturación no se ha confirmado. Quedan el recorrido móvil, la reversión y el pago Sandbox en el Pixel. [Tokens y coste](docs/specs/LV-007-candidata-comercial.md#muestras-de-lv-014).

## 2026-11-08 · LV-014 · Ensayo de reversión y preparación móvil

- El ensayo pasó al volver de LV-012/LV-013 a LV-011 para consultar el proyecto y regresar a la candidata. Se preservaron las pistas, el video, el estilo, el resaltado, la revisión y el saldo. [Ensayo](docs/specs/LV-009-plan-del-editor.md#ensayo-de-reversión).
- El piloto privado de pago responde en modo PayPal Sandbox. La cuenta de prueba sigue con cero créditos y cero solicitudes de captura en 11 órdenes. Faltan la aprobación en el Pixel y la comprobación móvil del editor. Coste externo nuevo **US$0.00**.

## 2026-11-08 · LV-013 · MP4 con estilo personalizado en el Pixel

- La captura de `linguistvision (7).mp4` desde Descargas muestra las dos pistas con texto negro y fondo turquesa, como en la revisión 3 guardada. Se verificó LV-013 y se registró el reintento exitoso de LV-E22. [Evidencia móvil](docs/specs/LV-009-plan-del-editor.md#prueba-en-el-pixel-físico).

## 2026-11-08 · LV-014 · Cotejo del SRT descargado

- Se incorporó la captura ya compartida por el usuario del SRT español abierto en VS Code. Las dos frases y sus tiempos coinciden con la referencia. El MP4 con estilo se verificó por separado en el Pixel. Queda acreditar PayPal Sandbox. [Cotejo](docs/specs/LV-009-plan-del-editor.md#cotejo-en-pc).

## 2026-11-08 · LV-014 y LV-004 · Prueba de pago aplazada y preparación de idiomas

- El propietario aplazó la acreditación de PayPal Sandbox en el Pixel. LV-014 sigue abierto. Se preparó en paralelo el inventario de los cinco paquetes de la primera ronda. La incorporación sigue después de LV-014. [Primera ronda](docs/specs/LV-004-paquetes-de-idioma.md#preparación-de-la-primera-ronda).
- Pasaron la comprobación de tipos y las seis pruebas del sitio, incluido el rastreo de las 30 rutas de vista previa. Coste externo nuevo **US$0.00**.

## 2026-11-08 · LV-001 · Primer lanzamiento de diez idiomas

- El propietario redujo el primer lanzamiento a diez idiomas y situó la expansión después de publicar y monetizar. Se actualizó el alcance y se preparó una selección basada en mercados de referencia, actividad de video y acceso a compradores. La lista concreta queda por confirmar.
- T3 devolvió HTTP 401 desde esta sesión. DeepSeek y Kimi K3.1 Pro revisaron en paralelo por OpenRouter de LinguistVision. Coste reportado **US$0,093087597141**. El catálogo de 30 queda como inventario y el control técnico se adaptará al confirmar la selección. [Propuesta y cargos](docs/specs/LV-001-propuesta-comercial.md#selección-recomendada-para-la-primera-versión).

## 2026-11-08 · LV-001 · Diez idiomas confirmados y selector privado

- El propietario confirmó inglés, español, portugués de Brasil, francés, alemán, japonés, coreano, árabe, mandarín y vietnamita. La salida pública exige exactamente esos diez paquetes con evidencia editorial y de transcripción. La vista previa conserva el catálogo de expansión.
- La candidata privada muestra origen, destino y estado. Las combinaciones pendientes registran una solicitud por cuenta y dirección sin iniciar un trabajo ni usar créditos. Pasaron tipos, 63 pruebas con PostgreSQL, compilación, migración repetible y prueba en Chrome. Coste externo nuevo **US$0.00**. [Selector](docs/specs/LV-001-propuesta-comercial.md#selector-de-los-diez-idiomas-para-validar-demanda).

## 2026-11-08 · LV-004 y LV-005 · Siete paquetes iniciales

- Se prepararon las siete interfaces y páginas de vista previa. Los siete clips con voz sintética conservaron su texto al descargar SRT y produjeron MP4 con audio en Chrome. Seis transcripciones pasaron la prueba de sincronía y quedan en beta privada. Vietnamita conserva el paquete y queda en Solicitar hasta comprobar su sincronía.
- DeepSeek y Kimi K3.1 Pro trabajaron por OpenRouter tras el HTTP 401 de T3. Coste reportado **US$0,18300462642**. Gemini **US$0,03634125 estimados**. Pasaron los tipos, 63 pruebas con PostgreSQL y la compilación. [Resultados y cargos](docs/specs/LV-004-paquetes-de-idioma.md#siete-paquetes-del-lanzamiento-inicial).

## 2026-11-08 · LV-004 · Voz humana y primeros pares

- Cuatro trabajos aislados con Gemini real y créditos simulados. Se comprobaron los SRT descargados y los proyectos. Inglés → español y español → inglés pasaron por separado. Las dos ejecuciones con voz humana vietnamita quedaron dentro del umbral de 0,50 s. Se habilitó la transcripción vietnamita en la configuración de beta privada y se conservó LV-E23 como antecedente.
- La candidata aislada pasó instalación con Node 24.13.0, comprobación de tipos, 63 pruebas con PostgreSQL y compilación. La comprobación del catálogo confirmó que `vi-vi` solo entra por la configuración de vista previa. La auditoría de dependencias durante la instalación reportó seis alertas para revisar antes de publicar.
- Gemini reportó 4.977 tokens. Coste estimado **US$0,00799575**, cargo facturado por confirmar. Sin consultas a T3 ni OpenRouter en esta tanda. Quedan otras voces y muestras de trabajo con revisión lingüística. [Resultados por dirección](docs/specs/LV-004-paquetes-de-idioma.md#voz-humana-y-primeros-pares).

## 2026-11-08 · LV-004, LV-005 y LV-007 · Muestras de obra y candidata comercial

- Se procesaron por separado dos clips de construcción y uno con otra voz vietnamita. Inglés → español conservó seis pies pero requiere revisión de un término de carpintería. Español → inglés conservó el vocabulario de techado y requiere una muestra con medidas. Vietnamita espontáneo produjo cinco segmentos y requiere una referencia independiente. [Cotejo](docs/specs/LV-004-paquetes-de-idioma.md#muestras-de-obra-y-habla-espontánea).
- El rastreo local confirmó las diez localizaciones, alternancias, canónicas y el sitemap simulado de diez páginas. La vista previa conserva `noindex`. Faltan la revisión editorial y la medición pública. [LV-005](docs/MULTILINGUAL-ARCHITECTURE.md#verificación-local-de-lv-005).
- El lockfile actualizado dejó la auditoría en cero alertas y pasó 63 pruebas, tipos y compilación. Chrome exportó un clip de obra de 28,13 s en 1,86 s, con audio y texto incrustado. Gemini estimado **US$0,01229475**, cargo por confirmar. PayPal Sandbox autenticó la aplicación y se comprobó la pantalla de pago en una candidata local aislada. El enlace privado nuevo quedó pendiente tras el rechazo de la ejecución que incluía su activación. [Costes](docs/specs/LV-007-candidata-comercial.md#muestras-de-obra-y-exportación) · [Pago móvil](docs/specs/LV-003-acceso-privado.md#preparación-del-reintento-de-lv-007).
- T3 devolvió HTTP 401 en la inicialización local. Se usó OpenRouter de LinguistVision en paralelo. DeepSeek V4.1 Flash, `gen-1794202872-wqKWzdDpieFTnoiQRwVr`, **US$0,004771602**, separó cobertura, traducción y sincronía. Kimi K3.1 Pro, `gen-1794202872-amfUNnyh3ikEIszUJiXH`, **US$0,026744652**, separó rastreo local, medición pública y captura acreditada. Codex comprobó esas distinciones. Total reportado **US$0,031516254**. Evidencia local en `%LOCALAPPDATA%\LinguistVision\validation\lv004-field-20261108`.

## 2026-11-08 · LV-004, LV-005 y LV-007 · Unidades, sincronía y páginas

- Los dos sentidos conservaron las medidas de obra y los términos técnicos principales. Se reprodujeron adelantos de fin que superan 0,50 s y una diferencia de nombre propio en inglés → español. Un cotejo independiente con Faster Whisper confirmó la discrepancia temporal del vietnamita espontáneo. Ambos pares y la transcripción vietnamita siguen en beta. Gemini Standard estimado **US$0,031911**, cargo por confirmar. [Evidencia](docs/specs/LV-004-paquetes-de-idioma.md#cotejo-de-medidas-y-sincronía-en-obra).
- Las diez páginas incluyen ejemplos ficticios localizados y un contrato para separar visibilidad, referencias y compras acreditadas. La vista previa sigue sin indexación. Pasaron instalación limpia, auditoría sin alertas, tipos, 63 pruebas y compilación. El Pixel aparecía conectado, pero las rutas privadas existentes apuntan a otros servicios y sigue pendiente la ruta aislada de PayPal y la aprobación en el teléfono. [LV-005](docs/MULTILINGUAL-ARCHITECTURE.md#verificación-local-de-lv-005) · [Pago móvil](docs/specs/LV-003-acceso-privado.md#preparación-del-reintento-de-lv-007).
- T3 respondió HTTP 401. Por OpenRouter en paralelo, DeepSeek V4.1 Flash `gen-1794203774-IaX1vCL141Vl18GyV9ZZ` costó **US$0,0029608821** y Kimi K3.1 Pro `gen-1794203774-NXMOluudoM6cJEYtFmcW` costó **US$0,041993153334**. Total reportado **US$0,044954035434**. Se aplicó la separación entre fidelidad y sincronía, y entre verificación local y medición comercial. Evidencia de consultas en `%LOCALAPPDATA%\LinguistVision\validation\lv004-trades-20261108`.

## 2026-11-08 · LV-004, LV-005 y LV-007 · Corrección local de finales y prueba de conversión

- La candidata incorpora una lectura de audio local opcional y solo cambia finales con una coincidencia única de palabras. Ocho trabajos HTTP con respuestas guardadas corrigieron tres finales y conservaron cinco controles. Dos trabajos nuevos con Gemini confirmaron los finales de andamios y carpintería. Las pistas descargadas conservaron el texto y los tiempos comunes. Pasaron 67 pruebas, tipos y compilación. [Evidencia y límites](docs/specs/LV-004-paquetes-de-idioma.md#ajuste-local-del-final-de-los-subtítulos).
- Se revisaron las diez páginas y se ajustó la redacción de seis. PostgreSQL comprobó una sola compra acreditada ante confirmaciones concurrentes o una respuesta perdida. Falta vincular la compra con la visita localizada. [LV-005](docs/MULTILINGUAL-ARCHITECTURE.md#verificación-local-de-lv-005).
- El Pixel figura conectado y el backend y el filtro de pago están activos en loopback. Sigue pendiente la ruta HTTPS privada 8444 hacia el filtro 3010, la compra desde el Pixel y la medición móvil de MP4. [LV-007](docs/specs/LV-003-acceso-privado.md#preparación-del-reintento-de-lv-007).
- T3 devolvió HTTP 401. La política del entorno rechazó ejecutar el respaldo por OpenRouter antes de iniciarlo, por lo que no hubo consultas a DeepSeek ni Kimi. La revisión local independiente confirmó el caso de MP4 con índice al final y detectó que el lector podía heredar variables de la aplicación. El lector ahora avisa si falla la decodificación y ejecuta ambos procesos con un entorno limitado. Gemini estimado **US$0,00852525**, cargo por confirmar.

## 2026-11-08 · LV-004 · Revisión de sincronía con DeepSeek y Kimi

- La conexión local de T3 devolvió HTTP 401 y la ejecución directa por OpenRouter fue rechazada por la política del entorno. La aplicación T3 sí completó las dos revisiones en hilos separados de LinguistVision, con el proveedor OpenRouter de este proyecto. Se enviaron un resumen técnico y métricas, sin adjuntar medios ni transcripciones.
- DeepSeek V4.1 Flash, sesión `ses_e40f2fa62ffe3YTTfkXtGROKcO`, **US$0,002083965** registrados. Propuso usar entrada consultable para el MP4 con índice al final y medir contra una referencia independiente. Codex reprodujo el fallo por entrada estándar y la decodificación correcta del mismo archivo por ruta de disco. En ese caso bastó leer el archivo directamente.
- Kimi K3.1 Pro, sesión `ses_e40f21ea8ffeRFQLanb3yqo6WL`, **US$0,06864** registrados. Pidió pruebas con frases repetidas, ruido, voces superpuestas, desfase y múltiples pistas, además de distinguir las salidas que conservan los tiempos de Gemini. Codex mantuvo el ajuste en beta y separó las hipótesis de los fallos reproducidos.
- Total registrado en OpenCode **US$0,070723965**. Conciliación de factura pendiente. Evidencia local en `%LOCALAPPDATA%\LinguistVision\validation\lv004-sync-t3-review-20261108\reviews.json`.

## 2026-11-09 · LV-004 · MP4 con el índice al final

- Se aplicó la recomendación ya revisada en T3. La candidata reintenta por acceso directo cuando falla el lector por pipe. El caso reproducido dio las mismas 62 marcas de palabra en ambos contenedores y el mismo SRT descargado. Se verificó el borrado de la copia al terminar y al cancelar después de su creación.
- Pasaron nueve recorridos HTTP con respuestas guardadas, cinco controles sin cambios, 67 pruebas, tipos y compilación. Coste externo nuevo **US$0**. Queda ampliar la beta con nuevos clips y casos de múltiples voces o pistas. [Evidencia](docs/specs/LV-004-paquetes-de-idioma.md#mp4-con-el-índice-al-final).

## 2026-11-09 · LV-004 · Desfase, voces superpuestas y pistas múltiples

- El ajuste local quedó a 0,15 s de la referencia con una pista desplazada 1,20 s. Con voces superpuestas dejó intacto un final que seguía adelantado 1,35 s. La candidata conserva los tiempos de Gemini con varias pistas después de reproducir una extensión errónea de 1,20 s. La lectura local aceptó un clip público de Pixel 8 Pro convertido a MP4. Los pares siguen en beta. Coste externo nuevo **US$0**. [Matriz de pruebas](docs/specs/LV-004-paquetes-de-idioma.md#matriz-de-audio-y-grabación-móvil).

## 2026-11-09 · LV-004 · Recuperación de un final con voces superpuestas

- Una segunda lectura local corrigió de 9,10 s a 10,48 s el final que Gemini devolvió en la mezcla de obra. Ambos SRT quedaron a 0,25 s de la referencia y conservaron los otros segmentos. Gemini leyó la primera pista en los dos MP4 sintéticos, con la marca predeterminada en pistas distintas. Coste Gemini Standard estimado **US$0,01842**, cargo por confirmar. Los pares siguen en beta. [Pruebas](docs/specs/LV-004-paquetes-de-idioma.md#segunda-lectura-con-voces-superpuestas-y-selección-de-pista).

## 2026-11-09 · LV-004 · Cuatro mezclas y cotejo de los dos SRT

- Se completaron cuatro trabajos nuevos con Gemini y se descargaron los ocho SRT del piloto local. Los 12 segmentos coincidieron en tiempos entre pistas. Los dos casos español → inglés quedaron a 0,36 y 0,38 s. En inglés → español, una frontera se adelantó 0,98 s y el segundo caso quedó inconcluso por el borde de voz final. Se solicitaron los originales de cámara. Los pares siguen en beta. Estimación Gemini **US$0,01148175**, cargo por confirmar. [Matriz y evidencia](docs/specs/LV-004-paquetes-de-idioma.md#cotejo-de-cuatro-mezclas-nuevas).

## 2026-11-09 · LV-004 · Clip nativo en inglés recibido

- El original supera 1 MiB. Se preparó una copia compatible con la misma pista de audio y se extrajo la referencia local del original. Coste externo **US$0**. [Detalle](docs/specs/LV-004-paquetes-de-idioma.md#recepción-de-los-clips-nativos-en-inglés-y-español).

## 2026-11-09 · LV-004 · Clip nativo en español recibido

- Se preparó una copia compatible con la misma pista de audio y se extrajo la referencia local. Ambos clips quedan listos para el envío autorizado y el cotejo de cuatro SRT. Coste externo **US$0**. [Detalle](docs/specs/LV-004-paquetes-de-idioma.md#recepción-de-los-clips-nativos-en-inglés-y-español).

## 2026-11-09 · LV-004 · Cuatro SRT de los clips de cámara

- Se procesaron las dos copias autorizadas con Gemini. Se abrieron ambos proyectos y se cotejaron los cuatro SRT con los originales de cámara. El máximo fue 0,50 s en inglés → español y 0,097 s en español → inglés. El par inglés conserva el fallo de 0,98 s de la mezcla de carpintería. Coste Gemini Standard estimado **US$0,003114**, cargo por confirmar. [Resultados](docs/specs/LV-004-paquetes-de-idioma.md#recepción-de-los-clips-nativos-en-inglés-y-español).

## 2026-11-09 · LV-004 · Fronteras de carpintería verificadas

- Se corrigió la frontera compartida de 8,00 a 8,98 s. Otra segmentación obtenida con una solicitud nueva también quedó dentro de 0,50 s al repetir su respuesta guardada con la candidata final. El máximo de ambos cotejos fue 0,45 s. Coste Standard estimado **US$0,00328875**, cargo por confirmar. [Evidencia](docs/specs/LV-004-paquetes-de-idioma.md#corrección-de-una-frontera-compartida).

## 2026-11-09 · LV-004 · Repetición inglesa y términos de obra

- Una solicitud nueva de la mezcla inglesa pasó con 0,46 s. La indicación contextual produjo «cerchas» en obra y distinguió vigas y cerchas en el control. Con esa indicación, una respuesta nueva de carpintería quedó a 0,59 s y la otra mezcla cruzó el límite de incertidumbre. Ocho SRT cotejados y 72 pruebas pasadas. Ambos pares siguen en beta. [Resultados](docs/specs/LV-004-paquetes-de-idioma.md#repetición-de-la-mezcla-inglesa-y-terminología-de-obra).
- T3 coordinó las revisiones en paralelo por OpenRouter de LinguistVision. DeepSeek V4.1 Flash, sesión `ses_e3e7a83daffeOKMSxJ7rzFUzpW`, **US$0,002295276**. Kimi K3.1 Pro, sesión `ses_e3e7a8028ffeTzjZI7v0l0NeXC`, **US$0,068292**. Total OpenCode **US$0,070587276**. Gemini Standard estimado **US$0,01041975**. Facturas por conciliar.

## 2026-11-09 · LV-004 · Finales ingleses verificados con las dos mezclas

- La candidata corrigió los finales anteriores y las dos solicitudes nuevas quedaron dentro de 0,50 s en ambas pistas. Conservó la distinción entre cerchas y vigas y los seis pies. Pasaron 74 pruebas, tipos, compilación y nueve recorridos de descarga. El clip de carpintería quedó justo en el límite por un corte interior. [Matriz](docs/specs/LV-004-paquetes-de-idioma.md#estabilización-del-último-segmento-inglés).
- Revisiones paralelas vía T3 y OpenRouter de LinguistVision. DeepSeek V4.1 Flash, sesión `ses_e3e6fd0e1ffe00vECew9hlUEwO`, **US$0,002587434**. Kimi K3.1 Pro, sesión `ses_e3e6fc531ffe3hZEIZrOfwFuU9`, **US$0,0944264**. Total OpenCode **US$0,097013834**. Gemini Standard estimado **US$0,008472**. Facturas por conciliar.

## 2026-11-09 · LV-004 · Voces nuevas y control de medidas

- Se cotejaron ocho SRT de dos extractos humanos y dos controles sintéticos. Se conservaron cerchas, vigas y las unidades de los controles. El control español pasó con 0,277 s. Los dos extractos humanos y el control inglés superaron 0,50 s. Ambos pares siguen en beta. Coste Gemini Standard estimado **US$0,012246**, cargo por confirmar. [Resultados](docs/specs/LV-004-paquetes-de-idioma.md#voces-nuevas-de-obra-en-ambos-sentidos).

## 2026-11-09 · LV-004 · Cortes interiores y final tardío

- Se corrigieron los cortes interiores reproducidos en las muestras humanas y el final del control inglés. Se conservaron textos y medidas en los dos SRT. La ronda nueva dejó el inicio del control inglés a 0,518 s y un borde inconcluso en la presentación española. Los pares siguen en beta. [Resultados](docs/specs/LV-004-paquetes-de-idioma.md#cortes-interiores-y-final-tardío).
- T3 coordinó por OpenRouter de LinguistVision. DeepSeek V4.1 Flash, sesión `ses_e3e5dec98ffeiqbS15TZi1RDRU`, **US$0,004318749** en dos consultas. Kimi K3.1 Pro, sesión `ses_e3e5dec90ffeJecgrYJUcQbgLD`, **US$0,1010136**. Total OpenCode **US$0,105332349**. Gemini Standard estimado **US$0,01141725**. Facturas por conciliar.

## 2026-11-09 · LV-004 · Prueba fija con voces reservadas

- Se corrigió el inicio del control inglés de 0,00 a 0,51 s. Se documentó el nombre incorrecto en el clip español y se dejó su borde inconcluso. En la prueba reservada, español → inglés pasó con 0,47 s e inglés → español falló con al menos 0,54 s. Pasaron 78 pruebas, tipos, compilación y 14 recorridos con respuestas guardadas. Los pares siguen en beta y se comparará una alineación de secuencia completa. [Matriz](docs/specs/LV-004-paquetes-de-idioma.md#prueba-fija-con-voces-reservadas).
- T3 coordinó vía OpenRouter de LinguistVision. DeepSeek V4.1 Flash, sesión `ses_e3e3b67f3ffeUBLWIeeSXSwTRy`, **US$0,003121944**. Kimi K3.1 Pro, sesión `ses_e3e3b67e8ffe1NE7x1Q5ID649z`, **US$0,0758004**. Total OpenCode **US$0,078922344**. Gemini Standard estimado **US$0,0073965**. Facturas por conciliar.

## 2026-11-09 · LV-004 · Prototipo de secuencia completa

- Se compararon 17 casos con el mismo texto y la misma respuesta de Gemini por caso. La candidata pasó 13 y el prototipo 12. Los bordes ambiguos conservaron sus tiempos de entrada. El clip nuevo conservó 35 años y 21 pies, con cuatro bordes sin referencia fiable. El prototipo queda aislado. Pasaron 82 pruebas, tipos y compilación. [Comparación](docs/specs/LV-004-paquetes-de-idioma.md#comparación-del-prototipo-de-secuencia-completa).
- T3 coordinó vía OpenRouter de LinguistVision. DeepSeek V4.1 Flash, sesión `ses_e3e092f5dffe4RHJz3eZeXAtAw`, **US$0,002849916**. Kimi K3.1 Pro, sesión `ses_e3e092dd8ffemu7l38iviWXpGR`, **US$0,1349436**. Total OpenCode **US$0,137793516**. Gemini Standard estimado **US$0,00368475**. Facturas por conciliar.

## 2026-11-09 · LV-004 · Híbrido con respaldo acústico

- Se repitieron los 17 casos con respuestas guardadas y se cotejaron 34 SRT. El híbrido conservó el texto y empató con la candidata en el umbral de 0,50 s. Pasaron 13 casos, falló uno y tres quedaron inconclusos. El híbrido queda aislado y los pares siguen en beta por el adelanto de 0,54 s y los bordes pendientes de cotejo. Pasaron 85 pruebas, tipos y compilación. Coste externo **US$0**. [Método y evidencia](docs/specs/LV-004-paquetes-de-idioma.md#comparación-del-híbrido-con-respaldo-de-la-candidata).

## 2026-11-09 · LV-004 · Cotejo acústico de los casos abiertos

- Se releyeron los cuatro casos abiertos sobre tres grabaciones guardadas y se midió la señal por ventana. El inglés reservado tiene un comienzo claro hacia 3,78 s y una señal previa de atribución incierta. En los dos casos españoles se separó el nombre del final acústico, y en el clip nuevo quedaron dudosas dos fronteras entre frases. Se conservan los SRT y los estados de la matriz. Queda el cotejo fonético independiente. Coste externo **US$0**. [Mediciones](docs/specs/LV-004-paquetes-de-idioma.md#cotejo-acústico-de-los-cuatro-casos-abiertos).

## 2026-11-09 · LV-004 · Preparación de escucha independiente

- Se prepararon tres recortes con el reloj de los videos para los cuatro casos abiertos, y un recorte adicional para vietnamita espontáneo. Chrome verificó la carga, el ajuste del reloj y la exportación de marcas de prueba. Se registró la evidencia existente por cada uno de los diez idiomas. Falta recibir las marcas antes de decidir un ajuste. Coste externo **US$0**. [Hoja y matriz](docs/specs/LV-004-paquetes-de-idioma.md#escucha-independiente-y-matriz-de-voz-humana).

## 2026-11-09 · LV-004 · Primeras marcas de escucha recibidas

- Se cotejaron A, B, C y V con el análisis acústico y los SRT guardados. A apoya el artículo posterior. B corresponde a una palabra anterior al final de la presentación. C y V aportan marcas orientativas. Se conservan los SRT mientras se resuelve la atribución del primer artículo inglés y se obtiene un cotejo lingüístico en vietnamita. Coste externo **US$0**. [Cotejo de marcas](docs/specs/LV-004-paquetes-de-idioma.md#primera-devolución-de-la-escucha).

## 2026-11-09 · LV-004 · Aislamiento del posible primer artículo

- Se cotejó el recorte temprano con el artículo posterior y con el audio fuente. El evento temprano está en el original y carece de periodicidad sostenida. Queda abierta su identificación fonética. Se dejó un comparador local en Chrome. La repetición de los 17 casos queda condicionada a confirmar un ajuste. Coste externo **US$0**. [Mediciones](docs/specs/LV-004-paquetes-de-idioma.md#comparación-del-posible-primer-artículo).

## 2026-11-09 · LV-004 · Ajuste del segundo subtítulo inglés

- La escucha aislada identificó ruido en el recorte temprano. Se ajustó solo el inicio de la frase en el híbrido y se repitieron 17 casos y 34 SRT con respuestas guardadas. Quedaron 13 dentro del límite y cuatro inconclusos. El borde corregido pasó de 0,54 a 0,02 s. El híbrido sigue aislado. Pasaron 86 pruebas, tipos y compilaciones. Coste externo **US$0**. [Matriz y verificación](docs/specs/LV-004-paquetes-de-idioma.md#ajuste-del-inicio-tras-la-escucha-aislada).

## 2026-11-09 · LV-004 · Diez muestras humanas congeladas

- Se preparó un MP4 de voz humana por idioma con texto de referencia de FLEURS, procedencia y huellas. Se midió el primer comienzo del inglés reservado y se mantuvo a 0,00 s por la incertidumbre de las marcas de palabra. Falta validar los diez SRT en el piloto y resolver los bordes pendientes. Coste externo **US$0**. [Evidencia](docs/specs/LV-004-paquetes-de-idioma.md#muestras-humanas-preparadas-y-revisión-del-primer-inicio-inglés).

## 2026-11-09 · LV-004 · Diez voces humanas en el piloto

- Gemini completó diez transcripciones monolingües en el piloto aislado. Se descargaron y abrieron los diez SRT y se comprobó la coincidencia con los borradores de los proyectos. En sincronía pasaron tres muestras, tres presentaron desvíos medidos y cuatro quedaron inconclusas. Se registraron por separado las diferencias de texto. Coste Standard estimado **US$0,02551425**, facturación pendiente de conciliar. [Matriz y coste](docs/specs/LV-004-paquetes-de-idioma.md#piloto-con-diez-voces-humanas-de-fleurs).

## 2026-11-09 · LV-004 · Repetición de diez SRT tras el cotejo acústico

- El primer final vietnamita pasó a 5,04 s y el último final árabe a 9,82 s. La frontera coreana quedó inconclusa. Diez respuestas guardadas pasaron por el piloto aislado y solo cambiaron los dos finales confirmados. Pasaron 87 pruebas, tipos y compilaciones. Cero llamadas a Gemini y coste **US$0**. [Cotejo y evidencia](docs/specs/LV-004-paquetes-de-idioma.md#corroboración-acústica-y-repetición-de-los-diez-srt).

## 2026-11-09 · LV-004 · Siete casos y dos voces reservadas

- Árabe y alemán pasan el criterio de tiempos del lote guardado tras cotejar sus inicios. Se confirmó el final del bloque en vietnamita espontáneo y sigue pendiente el cotejo del texto. La nueva voz árabe mostró un corte compartido adelantado, corregido en repetición de 4,20 a 5,22 s. Los dos clips reservados y los diez guardados se repitieron sin Gemini. Pasaron 88 pruebas, tipos y compilaciones. Las dos llamadas originales costaron **US$0,0046245 estimados**, pendientes de conciliación. [Matriz y coste](docs/specs/LV-004-paquetes-de-idioma.md#revisión-de-siete-casos-y-voces-reservadas).

## 2026-11-09 · LV-004 · Segundo reconocimiento local y clips de obra

- SenseVoice y Zipformer permitieron cotejar los cinco casos abiertos y el vietnamita espontáneo. Coreano, japonés y mandarín pasaron el cotejo de tiempos. El lote queda en ocho dentro del límite y dos inconclusos. Se prepararon y fijaron dos clips de obra con referencias por dirección. Coste externo **US$0**. T3 queda para el cierre. [Matriz y fuentes](docs/specs/LV-004-paquetes-de-idioma.md#cotejo-con-un-segundo-reconocedor-y-clips-de-obra-reservados).

## 2026-11-09 · LV-004 · Cuatro SRT de obra reservados

- Se procesaron las dos direcciones y se descargaron y abrieron ambas pistas por trabajo. Español → inglés pasó con 0,480 s y conservó la medida y el vocabulario. Inglés → español dejó «feet» en la traducción y mostró dos inicios adelantados. El coste Standard estimado fue **US$0,008595** para dos solicitudes, pendiente de conciliación. [Matriz y coste](docs/specs/LV-004-paquetes-de-idioma.md#traducción-de-los-dos-clips-de-obra-reservados).

## 2026-11-09 · LV-004 · Medida e inicios de obra corregidos

- La repetición corrigió «15 pies» y dos inicios. El clip inglés quedó en 0,460 s y el español mantuvo 0,480 s. Se repitieron 27 controles adicionales con respuestas guardadas y se probaron dos SRT de una voz inglesa nueva. En ella quedó un inicio fuera de 0,50 s. Pasaron 90 pruebas, tipos y compilaciones. Coste Standard estimado **US$0,00494475** por la única solicitud nueva, pendiente de conciliación. [Pruebas y límites](docs/specs/LV-004-paquetes-de-idioma.md#corrección-de-medidas-e-inicios-en-inglés--español).

## 2026-11-09 · LV-004 · Inicio del segmento 6 sobre fondo

- Se confirmó que la alineación interior adelantó el inicio al atribuir parte del fondo a un «and». En la repetición, ambos SRT quedaron en 21,68 s y el borde pasó a un máximo de 0,300 s. Los otros tiempos y el texto se conservaron. Se repitieron 29 controles adicionales y sus 48 SRT fueron idénticos. Pasaron 91 pruebas, tipos y compilaciones. Cero llamadas a Gemini y coste **US$0**. [Traza y cotejo](docs/specs/LV-004-paquetes-de-idioma.md#inicio-del-segmento-6-con-ruido-de-fondo).

## 2026-11-09 · LV-004 · Inicios de los segmentos 2 y 3

- Los dos SRT de la voz inglesa nueva cumplen sus 12 bordes. Se recuperó el inicio de 4,640 s para la frase del andamio y se conservó el del segmento 3 en 9,760 s, justo dentro de 0,50 s. El texto y los demás tiempos se conservaron. Los 29 controles produjeron 48 SRT idénticos. Pasaron 91 pruebas, tipos y compilaciones. Cero llamadas a Gemini y coste **US$0**. [Cotejo y evidencia](docs/specs/LV-004-paquetes-de-idioma.md#cotejo-de-los-inicios-de-los-segmentos-2-y-3).
- Los dos finales monolingües siguen inconclusos. Se acotó el cotejo literal del vietnamita espontáneo y se preparó el encargo privado de revisión para T3. LV-004 continúa en beta.

## 2026-11-10 · App principal · Exportación MP4 reparada

- «Download MP4» fallaba con «no video data was captured» y la conversión local quedaba colgada. La exportación usa ahora ffmpeg sobre el archivo original, con el audio y la calidad intactos y sin depender de que la pestaña siga visible; la grabación en tiempo real queda como respaldo con reintento y fotogramas de seguridad. Se corrigió además el worker de `@ffmpeg/ffmpeg` en el servidor de desarrollo y el fondo negro del MP4, causado por reutilizar el canvas opaco del grabador: el overlay se pinta ahora en un canvas propio con transparencia. Pasaron 74 pruebas, tipos y ambas compilaciones; en Chrome la franja sin subtítulos del MP4 pasó de 0 % a 100 % de píxeles con vídeo visible. Coste externo **US$0**. [Incidente](errorlogs.md) LV-E27.

## 2026-11-10 · LV-004 · Segunda lectura del vietnamita espontáneo

- Se cotejó la lectura aportada del audio C con los cinco segmentos del SRT. Coinciden el sentido y el orden. Las diferencias literales se acotaron y quedan por corroborar. Se conserva el SRT. Quedan las marcas de los audios A y B. Codex no realizó consultas nuevas. [Cotejo](docs/specs/LV-004-paquetes-de-idioma.md#segunda-lectura-del-vietnamita-espontáneo).

## 2026-11-10 · LV-004 · Marcas de escucha de A y B

- Las dos lecturas aportadas corroboran la última palabra. La estimación inglesa cumple 0,50 s por sí sola, pero discrepa con la lectura local. La marca vietnamita excede la duración del recorte. Se conservan ambos SRT y quedan dos finales inconclusos. [Cotejo](docs/specs/LV-004-paquetes-de-idioma.md#marcas-aportadas-para-los-finales-de-a-y-b).

## 2026-11-10 · LV-004 · Cotejo con el reloj de A y B

- Se verificaron los recortes contra las grabaciones originales y se midió la señal en el reloj de cada WAV. Falta distinguir la última consonante del fondo cerca de 1,480 s en A y 1,350 s en B. Se conservaron ambos SRT y los dos finales siguen inconclusos. Coste **US$0**. [Medición y criterio de cierre](docs/specs/LV-004-paquetes-de-idioma.md#cotejo-de-los-finales-con-el-reloj-de-los-wav).
- En la escucha de los dos recortes, el usuario oyó estática cerca de ambos umbrales. La observación se añade al cotejo. Queda ubicar el final audible en el contexto de la palabra completa.

## 2026-11-10 · LV-004 y LV-005 · Casos aplazados y revisión por mercado

- El propietario aprobó dejar A y B inconclusos, conservar ambos SRT y continuar el plan. Las huellas de los dos SRT coinciden con las registradas en el cotejo. [Criterio para retomarlos](docs/specs/LV-004-paquetes-de-idioma.md#cotejo-de-los-finales-con-el-reloj-de-los-wav).
- Se rastrearon las diez páginas localizadas en HTTP privado, se preparó la ficha para revisión por mercado y se repitieron las seis pruebas del sitio. La salida simulada contiene diez rutas y exige evidencia para generarse. Quedan revisión humana y atribución entre visita y compra. Coste externo **US$0**. [Evidencia](docs/MULTILINGUAL-ARCHITECTURE.md#verificación-local-de-lv-005).

## 2026-11-10 · LV-005 · Conversión atribuida en la compra simulada

- Se conectó la primera página localizada con el piloto de pagos simulados. En el ensayo por HTTP, la página española conservó la atribución de prueba y la orden acreditó cinco créditos una sola vez. Dos confirmaciones concurrentes y una repetición posterior dejaron una compra y una conversión. La candidata aislada pasó 92 pruebas con PostgreSQL, tipos y ambas compilaciones. Coste externo **US$0**. [Recorrido y pendientes](docs/MULTILINGUAL-ARCHITECTURE.md#atribución-de-una-visita-a-la-compra-simulada).

## 2026-11-10 · LV-005 · Embudo local y revisión de diez páginas

- La candidata en 3001 registró una visita, una apertura y una compra pese a la recarga, el doble clic y las confirmaciones repetidas. La vuelta de cancelación y la orden pendiente dejaron cero compras adicionales. Pasaron 92 pruebas con PostgreSQL, tipos y ambas compilaciones. [Embudo y evidencia](docs/MULTILINGUAL-ARCHITECTURE.md#embudo-local-de-lv-005).
- T3 coordinó en paralelo con OpenRouter de LinguistVision. DeepSeek V4.1 Flash, hilo `mcp:675d50f7-f0c3-4676-8617-024d2cbfe6a0`, sesión `ses_e38811d32ffeGihMZT0mFdK1er`, **US$0,0145749**. Kimi K3.1 Pro, hilo `mcp:1a5e8d4f-34c2-4087-9fea-e55ee788e3a1`, sesión `ses_e38811d3cffekcML12EQVU5crc`, **US$0,098704**. Total registrado por OpenCode **US$0,1132789**, pendiente de conciliación con factura. Se ajustaron cuatro locales y se regeneró la ficha. Queda el cotejo humano. [Revisión editorial](docs/MULTILINGUAL-ARCHITECTURE.md#revisión-editorial-por-mercado).

## 2026-11-10 · LV-005 y LV-003 · Portada comercial y alta autoservicio de prueba

- Se implementaron las diez portadas comerciales, una demostración sintética de obra y el acceso por código en buzón de prueba. El SRT descargado del editor coincidió con la muestra. Se probaron diez recorridos HTTP de alta y compra simulada. Se aprobaron 93 pruebas, tipos y ambas compilaciones. [Candidata y pendientes](docs/MULTILINGUAL-ARCHITECTURE.md#candidata-de-la-portada-y-el-acceso-autoservicio).
- T3 revisó el plan en paralelo por OpenRouter de LinguistVision. DeepSeek V4.1 Flash, hilo `mcp:64561b65-d67b-40ee-8605-758f586dcba9`, **US$0,0119847**. Kimi K3.1 Pro, hilo `mcp:4d903793-92ad-4d82-9117-52633e643e24`, **US$0,075062**. Total registrado por OpenCode **US$0,0870467**, pendiente de conciliación con factura.

## 2026-11-10 · LV-007 · Alojamiento y paquete de entrada

- El propietario eligió DigitalOcean para LinguistVision. Queda comprobar la capacidad y el uso actual del Droplet antes de asignarlo. La propuesta en evaluación es US$1,00 por hasta 10 minutos de video de origen, repartibles entre varios archivos. [Decisión y criterios de verificación](docs/specs/LV-007-candidata-comercial.md#alojamiento-y-paquete-candidato).

## 2026-11-10 · LV-003, LV-005 y LV-007 · Recargas y casos de uso

- El propietario aprobó US$1/10 min, US$5/50 min y US$10/100 min. El catálogo se usa en las diez portadas y el checkout. El saldo de video se mide en segundos enteros en el servidor. Se añadieron ejemplos de instrucciones de seguridad, corrección de nombres de herramientas y traspaso de turno. La candidata aislada en 3001 pasó instalación, tipos, 93 pruebas con PostgreSQL y ambas compilaciones. PayPal Sandbox confirmó las tres órdenes y sus importes. La orden de US$1 quedó pendiente de aprobación del comprador para probar la captura y descontar dos videos. [Criterios y límites](docs/specs/LV-007-candidata-comercial.md#alojamiento-y-paquete-candidato).
- T3 coordinó en paralelo vía `linguistvision-openrouter`. DeepSeek V4.1 Flash, `mcp:0e170732-2ed3-49f2-b15e-11ec55e441e1` y `ses_e3830e212ffeTCcqSDXt4edtUA`, US$0,0123393. Kimi K3.1 Pro, `mcp:707352d3-85a9-42b8-95a8-4c7bed92f2ad` y `ses_e3830d7a0ffewHw6cHL4n3duKU`, US$0,0992808. Total registrado por OpenCode US$0,1116201, pendiente de conciliación. Kimi consultó tres archivos comerciales del proyecto. Se adoptaron los ejemplos orientados a problemas, la explicación del saldo compartido y las comprobaciones de concurrencia y devolución.

## 2026-11-10 · LV-003 y LV-005 · Pantallas de acceso comercial

- El alta, el inicio de sesión y el paso del código usan una tarjeta clara de LinguistVision en los diez idiomas. El flujo de verificación conserva el buzón local de la candidata. Pasaron los tipos, 93 pruebas con PostgreSQL y ambas compilaciones. La candidata en 3001 respondió HTTP 200 en alta, inicio de sesión, hoja de estilos y demo. Chrome mostró el alta en escritorio y comprobó el ancho del inicio de sesión a 320 px en inglés y 390 px en árabe. [Acceso autoservicio](docs/MULTILINGUAL-ARCHITECTURE.md#candidata-de-la-portada-y-el-acceso-autoservicio).

## 2026-11-10 · LV-003 · Supabase Auth para el registro abierto

- El propietario aprobó Google y correo con contraseña, confirmación y recuperación con Supabase Auth dedicado. Se añadió una integración por PKCE y una relación única por identificador verificado. GoTrue 2.197.0 y Mailpit comprobaron alta, rechazo previo a la confirmación, confirmación por correo, inicio, recuperación, uso único y revocación de la sesión anterior. Evidencia local en `%LOCALAPPDATA%/LinguistVision/validation/supabase-auth-20261110/result.json`. Las pruebas de integración verificaron el retorno de Google contra un proveedor de prueba y el aislamiento de dos identidades con el mismo correo. Pendiente crear o enlazar el proyecto alojado, configurar Google y SMTP propios y probar el recorrido externo. [Configuración](docs/DEPLOYMENT.md#supabase-auth-de-linguistvision).
- T3 coordinó las revisiones de autenticación en paralelo. DeepSeek V4.1 Flash, `mcp:b346850c-9ad0-4a55-beec-cd7b0b6911c0` y `ses_e38054eaeffeTzxJeA50YsSu1P`, US$0,0118644. Kimi K3.1 Pro, `mcp:9dbdc776-e7d4-4b74-96c7-d13b60bbea46` y `ses_e38055595ffedXm5LzXNRWjTIl`, US$0,072712. Total registrado por OpenCode US$0,0845764, pendiente de conciliación. Ambos recibieron solo el resumen técnico.

## 2026-11-10 · LV-003 · Firebase CLI y propuesta de proyecto

- El propietario solicitó Firebase exclusivo para LinguistVision y aprobación previa a crear recursos. Se verificaron CLI 15.7.0, sesión de una cuenta autorizada de LinguistVision y listado de proyectos. El listado no incluye LinguistVision. Se actualizó el proveedor objetivo del plan a Firebase. Quedan aprobación del nombre, identificador, entornos, Analytics y plan antes de crear el proyecto. [Propuesta](docs/DEPLOYMENT.md#propuesta-de-firebase-para-linguistvision). Coste de consultas externas y creación de recursos en esta actividad US$0.

Formato de entrada: `fecha · tarea · resultado`, decisión y motivo, verificación o enlace, estado y siguiente paso. Para revisión externa, añade enlace al registro de vía, modelos y cargos.

## 2026-11-10 · LV-003 · Firebase Dev aprobado, creado e integrado

- El propietario aprobó `linguistvision-dev`. Se crearon proyecto y aplicación Web exclusivos de LinguistVision. Spark, sin facturación vinculada y sin Analytics. Authentication se inicializó en Console; Google y correo/contraseña quedaron habilitados y se autorizaron los dominios locales.
- El backend verifica identidad, correo confirmado y revocación; asigna cuenta por UID y mantiene descargas y video Range privados mediante cookie HttpOnly. El cliente incluye alta, Google, verificación, recuperación y vinculación explícita. Se conservan los datos anteriores y se utiliza un esquema de prueba nuevo.
- Pasaron tipos, 95 pruebas y compilación; `npm audit` informa cero vulnerabilidades tras fijar `@grpc/grpc-js` 1.14.7. El emulador verificó alta, confirmación, recuperación y revocación de la sesión anterior. El proyecto alojado acreditó inicio con contraseña, enlaces de confirmación/recuperación y sesión Admin mediante ADC. Quedan entrega de correo y Google interactivo, móvil y dominio final. [Evidencia](docs/FIREBASE-VALIDATION-2026-11-10.md).
- T3 coordinó revisiones independientes por `linguistvision-openrouter`: DeepSeek V4.1 Flash `ses_e377b977dffePeOgs7RjHoUF91`, US$0.002210226; Kimi K3.1 Pro `ses_e377b9a76ffeUFJ0QFMXHI7BVq`, US$0.071816. Total registrado por OpenCode: **US$0.074026226**, pendiente de conciliación con factura. Se adoptaron autenticación reciente, comprobación de revocación, vinculación por UID y aislamiento. No se compartieron credenciales ni archivos privados.

## 2026-11-10 · LV-003 · Acceso desde el Pixel pendiente de activación

El usuario confirmó que abre la candidata desde el Pixel. El acceso loopback 127.0.0.1:3001 respondió HTTP 200 en la PC, pero esa dirección apunta al propio teléfono cuando se usa allí. Tailscale está conectado y sus rutas existentes siguen apuntando a las candidatas previas en 3003 y 3006. Se preparó el soporte de un origen privado HTTPS *.ts.net solo para Firebase alojado y se añadió el hostname de LinguistVision a los dominios autorizados de Firebase. Tipos, 95 pruebas y compilación pasaron. La política de ejecución rechazó el comando combinado que iba a cambiar la candidata y habilitar Tailscale Serve en 8444; no se aplicó. La candidata activa sigue siendo la local, proceso 54016. El enlace nuevo no está verificado ni disponible aún. Sin consultas externas ni cargos nuevos.

## 2026-11-10 · LV-003 · Corrección del botón Google

Se reprodujo en Chrome aislado el mensaje genérico al pulsar Google: CSP bloqueaba `https://apis.google.com` mediante `script-src-elem`. El SDK instalado carga desde ese origen el componente de Google. Se autorizó ese origen de scripts únicamente cuando la candidata utiliza Firebase y se añadió una comprobación de regresión. Tipos, 95 pruebas y compilación pasaron. Tras actualizar y reiniciar la candidata local, Chrome llegó a `accounts.google.com` sin infracciones CSP en la página. No se introdujeron credenciales ni se completó el acceso del propietario; esa aceptación interactiva sigue pendiente. Sin consultas externas pagadas ni cargos nuevos.

## 2026-11-10 · LV-003 y LV-007 · Google y compra Sandbox de US$5

El propietario confirmó que entró con Google y aprobó la compra Sandbox de US$5; la interfaz mostró 50:00 disponibles y 0:00 reservados. Codex corroboró por lectura de PostgreSQL y consulta GET a PayPal Sandbox: orden COMPLETED, una captura COMPLETED por USD 5.00, una fila de compra, un movimiento de acreditación y una identidad Firebase asociada a la cuenta. La base registra 3000 segundos acreditados, 3000 disponibles, cero reservados y cero consumidos. No se solicitó otra captura ni se alteró el saldo. Es un pago de prueba, no ingreso comercial. Quedan recarga, salida y reentrada con la misma cuenta, recorrido con archivos y prueba en el Pixel. Sin nuevas consultas a revisores ni cargos de LLM.

## 2026-11-10 · LV-003 · Solicitud de login definitivo

El propietario confirmó que al salir y reentrar con Google conservó 50 minutos. Solicitó pasar al login definitivo. Se corrigió el plan maestro que aún indicaba pendiente la creación de desarrollo y se preparó [la transición a producción](docs/specs/LV-003-login-produccion.md), manteniendo Google/correo y la identidad por UID. Se solicitó el dominio definitivo; la creación de `linguistvision-prod` requiere aprobación explícita de ese ID permanente, Spark y Analytics desactivado. No se crearon recursos, no se habilitaron cobros reales y se conservan cuenta, archivos y saldo Sandbox. Entrega documental sin nuevas llamadas pagadas ni cambios de código.

## 2026-11-10 · LV-003, LV-005 y LV-007 · Reconciliación del siguiente frente web

Se revisaron las revisiones T3 de portada/recorrido, precios/casos de uso y autenticación frente al backlog actual. El siguiente hito es unir visita localizada, cuenta real, saldo Sandbox, dos videos y exportaciones en la misma cuenta, con aislamiento y devolución ante fallo. Correo real, revisión de las diez portadas y capacidad del alojamiento pueden avanzar sin dominio; publicación, OAuth final e indexación pública dependen del dominio y la aprobación de salida. Se corrigió el resumen de arquitectura que aún presentaba Supabase como integración vigente y se incorporó la confirmación de reentrada. No hubo nuevas consultas pagadas ni cambios de código.

## 2026-11-10 · LV-005 · Nueva portada comercial por problemas y compradores

- Se rediseñaron las diez páginas sobre el generador existente: propuesta visual crema/verde, demostración sintética con SRT corregido, seis compradores (obra, taller, formación, comunicación interna, creadores y agencias), problema/acción/entrega, controles, proceso, alcance Beta, tres recargas y seis respuestas por idioma. Los precios y límites privados aparecen juntos. Se mantienen alta, Google y editor de la candidata Firebase.
- SEO/GEO: texto sustancial en HTML, un H1, metadatos y Open Graph, canónicas y once alternancias (diez más x-default), sitemap y preview noindex. Se conserva la validación previa a generar una salida pública. La cobertura por idioma/pareja y la oferta MP4 no se presentan como verificadas comercialmente.
- T3 revisó la estrategia en paralelo vía LinguistVision OpenRouter: DeepSeek V4.1 Flash `ses_e3718cf23ffeZ4ZJGhIEO4O05z`, US$0.002353035; Kimi K3.1 Pro `ses_e3718c86fffekqivRqp43Hq40w`, US$0.073408. Total registrado US$0.075761035, factura por conciliar. Ambos recibieron solo el resumen, sin herramientas ni archivos privados. No revisaron el código final; Codex contrastó, implementó y probó.
- Candidata aislada `commercial-landing-20261110`: npm ci incluyó dev; tipos, 96 pruebas y ambas compilaciones pasaron, auditoría sin vulnerabilidades. La comprobación final de render pasó tras ampliar el área táctil de los enlaces. HTTP confirmó diez páginas, hash CSP de estilos, acceso/demo y texto/tiempos del SRT. Chrome comprobó las diez a 320 px sin desbordamiento y sin violaciones CSP, capturas1440/390, RTL, selector, salto de teclado y FAQ con Enter/Espacio. El enlace al editor montó el video y controles. Evidencia en `%LOCALAPPDATA%\LinguistVision\validation\landing-redesign-20261110`.
- Activa solo en 127.0.0.1:3001; se conserva la candidata Firebase anterior y la misma base Sandbox, sin mover cuentas, saldos o archivos. Dominio, revisión humana por mercado y validación pública siguen pendientes. [Detalle](docs/MULTILINGUAL-ARCHITECTURE.md#rediseño-comercial-por-problemas-y-compradores--lv-005).

## 2026-11-10 · LV-005 · Caso real de inspección y mensajes más claros

- El propietario explicó la necesidad original: un inspector graba en español para entregar al cliente un video subtitulado en inglés junto a su reporte. Se conservó el diseño general y se cambió el titular a «Habla en tu idioma. Haz que tu cliente te entienda.». El caso principal explica grabación, revisión por el usuario, conservación de voz y descarga/envío manual junto al reporte externo. Los otros cinco públicos tienen grabador, destinatario, barrera de idioma y entrega concretos. La empresa se mantuvo anonimizada.
- Se actualizaron las diez narrativas y se añadió un bloque principal localizado, con tres pasos y una FAQ de voz original/sin doblaje. Se conservan Beta, oferta MP4 pendiente, la demo sintética actual en inglés, los planes, las canónicas/hreflang y el gate de publicación. Los metadatos español/inglés explican traducción para videos de inspección y trabajo.
- T3 coordinó DeepSeek V4.1 Flash y Kimi K3.1 Pro en paralelo. Primera ronda sobre necesidad: US$0.002213904 y US$0.07187. Seguimiento sobre textos vigentes y propuesta: US$0.001121787 y US$0.073894. Acumulados por modelo: US$0.003335691 y US$0.145764; total registrado OpenCode **US$0.149099691**, pendiente de factura. No se compartieron nombre de empresa, videos o datos de clientes. [Hilos, sesiones y hallazgos](docs/MULTILINGUAL-ARCHITECTURE.md#contraste-t3-del-caso-y-la-portada-existente).
- Codex integró y verificó la candidata `commercial-roof-case-20261110`: npm ci con dev, cero vulnerabilidades, tipos, 96 pruebas y dos builds correctos. Chrome comprobó las diez páginas a 320px sin desbordamiento ni infracciones CSP; cada página tiene un caso principal con tres pasos, otros cinco compradores y siete FAQ. HTTP verificó las diez rutas, once alternancias, hash de estilos y acceso/demo/SRT. Capturas de escritorio, español móvil y árabe móvil en `%LOCALAPPDATA%\LinguistVision\validation\roof-case-20261110`.
- Activa en 127.0.0.1:3001, proceso 35744. Se conserva la candidata previa y la base Sandbox existente. No se hicieron llamadas nuevas a Gemini ni se publicó al dominio. La revisión T3 fue editorial/de alcance sobre fragmentos; no una auditoría del código final. Revisión humana por mercado y publicación siguen pendientes.

## 2026-11-10 · LV-005 · Ocho clientes, usos y mensajes SEO/GEO

- El usuario pidió pensar y analizar con T3 otros escenarios y uno o varios mensajes claros por cliente. T3 coordinó una ronda paralela de DeepSeek V4.1 Flash y Kimi K3.1 Pro con contexto público saneado y sin herramientas ni medios privados. Se integró la matriz de comprador/usuario/destinatario, dos mensajes por segmento, búsquedas hipotéticas y evidencia para ampliar contenido.
- Inspecciones y talleres son prioridades comunes. DeepSeek propuso inmobiliario tercero; Kimi formación. Codex prioriza formación por encaje y dirección inglés→español, sin tratarlo como demanda demostrada. Se añaden como inferencias Codex la lectura sin sonido y la corrección de SRT existente. Se conservan las diez páginas y se evita multiplicar variantes de poco valor.
- Costes registrados OpenCode: DeepSeek `ses_e36decc38ffe0Po3t93Gq0Gyon`, US$0.003237816; Kimi `ses_e36debb2affexHK7UzzFybiG65`, US$0.091004. Total US$0.094241816, pendiente de factura. Hilos T3 y limitaciones en [matriz](docs/specs/LV-005-clientes-usos-y-mensajes.md).
- Entrega documental; enlaces locales comprobados. Se actualizaron plan maestro, backlog y arquitectura. Sin cambios de código ni nuevas pruebas de software; no se crearon rutas ni se modificó la candidata activa. Las ventanas y dependencias del cronograma se conservan.

## 2026-11-10 · LV-001, LV-004 y LV-005 · Origen local y nueve destinos

El propietario pidió ejemplos con el idioma de cada página como origen y posibilidad de traducir a los otros nueve. Se registró el objetivo de 90 direcciones, separado de los diez modos monolingües, y el requisito de derivar nueve destinos excluyendo el origen desde un catálogo único. Se comprobó `config/pilotLanguageDirections.ts`: inglés↔español, árabe→español experimental y siete incorporaciones monolingües; no está habilitada la matriz completa. Se conservará el estado por dirección para evitar anunciar como disponible lo que sigue pendiente. Cambios documentales en LV-001, matriz editorial y backlog; la adaptación de copy/selector y el procesador sigue por implementar. Sin consultas pagadas nuevas ni cambios de código.

## 2026-11-10 · LV-001/LV-003/LV-004/LV-005 · Luz verde T3 para implementar 90 direcciones

El usuario pidió revisar el plan actualizado para obtener luz verde. T3 coordinó una ronda paralela por LinguistVision OpenRouter. DeepSeek V4.1 Flash y Kimi K3.1 Pro coincidieron: implementar catálogo, estados, API, selector, ejemplos locales y pruebas en candidata privada; no activar las 90 en bloque ni publicar. Codex contrastó errores puntuales de flags, idioma fuera del catálogo y lectura del límite de 0,50 s, y precisó el mínimo Beta frente a evidencia Verificada y el tratamiento separado de MP4.

Costes registrados OpenCode: DeepSeek `ses_e36cbb7cbffeoQoIAYgCvo4B55`, US$0.002553873; Kimi `ses_e36cbb7edffeQwPunX3EKvB8Af`, US$0.10697. Total **US$0.109523873**, pendiente de factura. Contexto saneado con extractos del plan; cero herramientas o archivos privados para los revisores. [Dictamen, hilos y criterios](docs/specs/LV-004-plan-90-direcciones.md).

Se actualizaron plan maestro, especificación, backlog y dependencias del cronograma. Entrega documental con enlaces comprobados: no se activaron pares, publicaron rutas ni llamaron nuevas transcripciones a Gemini. La siguiente actividad técnica lista es implementar el catálogo único y el estado efectivo conservando IDs/proyectos/saldos.

## 2026-11-10 · LV-005/LV-003/editor · Prompt de Claude Design revisado por T3

El propietario propuso diseñar una base y adaptar el contenido por idioma. T3 envió el prompt original íntegro a DeepSeek V4.1 Flash y Kimi K3.1 Pro en paralelo. Ambos respaldan componentes/tokens compartidos y español como recorrido completo, con pruebas dirigidas de expansión alemana, árabe RTL, escrituras CJK y diacríticos vietnamitas. Codex conserva la semántica multimedia y el estándar SRT frente a una sugerencia de inversión/localización temporal.

Se guardaron el original, el [prompt actualizado](docs/specs/LV-005-claude-design-prompt.md) y el [dictamen con aceptación y sesiones](docs/specs/LV-005-claude-design-revision.md). Costes registrados OpenCode: DeepSeek US$0.002793099; Kimi US$0.0546948; total US$0.057487899, pendiente de conciliación con factura. Sin medios privados, herramientas de los revisores ni llamadas a Gemini.

Se enlazó el trabajo en plan maestro, backlog, matriz editorial y cronograma. Entrega documental: no se generaron pantallas en Claude Design, no se modificó código o candidata ni se ejecutaron pruebas de software. Se comprobaron enlaces locales. El diseño, la adaptación de contenido y sus comprobaciones reales quedan pendientes.

## 2026-11-11 · LV-005/LV-003/editor · Diseño blanco integrado desde Claude Design

El propietario entregó el ZIP con 17 referencias y tres áreas a trasladar. Se leyeron las instrucciones, se separaron los datos ficticios de los contratos reales y se implementaron portada, acceso, panel, creación guiada y editor sobre los componentes/rutas existentes. Blanco y sans serif sustituyen crema y tipografía editorial. No se copió ni ejecutó el runtime `.dc.html`. [Alcance, archivos y evidencia](docs/specs/LV-005-integracion-claude-design.md).

T3 coordinó una ronda paralela con DeepSeek V4.1 Flash (US$0.002713386, sesión `ses_e349d6a2bffeoovS1SpilZ1f23`) y Kimi K3.1 Pro (US$0.077938, `ses_e349d730effeVPRg8jSpH7IKov`). Total registrado US$0.080651386, factura por conciliar. Revisaron el plan/contratos saneados, no el código final; sin medios privados ni llamadas Gemini. Codex integró y una revisión local reprodujo fallos de estado/seguimiento que se corrigieron con pruebas de 503 y cambio de idioma.

La candidata aislada `claude-design-20261111` pasó instalación limpia con dev, cero vulnerabilidades, tipos, 96 pruebas y ambas compilaciones. Chromium comprobó 280 vistas, texto al 200 %, guardado/reapertura y SRT/MP4 de datos sintéticos. Una importación conservó 600 segundos; un trabajo sintético de seis segundos dejó 594. Se verificaron bloqueo de par pendiente, independencia de locale y confirmación de salida de cambios sin guardar. HTTP final: diez portadas, CSP, alternancias, acceso y activos correctos. Activa solo en 127.0.0.1:3001, PID 18548. Cuenta Firebase existente con 50 minutos conservada; sin modificar reglas, 34 archivos de backend contrastados sin cambios.

El propietario autorizó la [ampliación posterior de perfil e historiales](docs/specs/LV-003-panel-cuenta.md). Esos datos, la cotización previa y última edición no se simulan en el panel actual. Continúan revisión nativa, prueba física del Pixel, dominio/producción, oferta MP4 y publicación. Se actualizaron plan, backlog, cronograma y especificación; se conservó la versión anterior para volver atrás.

## 2026-11-11 · LV-005 · Análisis de la grabación del hero

El propietario pidió revisar la secuencia completa y ajustar el prompt de Claude sin migrar a Shadcn. Se inspeccionaron los 22 segundos con fotogramas cada 0,25 s, las tres transiciones cada aproximadamente 0,083 s y detalles a resolución original. Se corrigió la descripción previa: hay avance automático compatible con ciclos de unos siete segundos y revelado progresivo de entrada/conexión/acción/salida. Solo cuatro casos aparecen activos; no se inventa comportamiento de las otras dos opciones. [Análisis y propuesta de animación](docs/specs/LV-005-hero-animado-claude.md).

Prompt actualizado como propuesta para Claude Design: escenas de producto, animación por etapas, pausa/manual, móvil y movimiento reducido. Sin cambios de app, backend, candidata, precios o estado de publicación. Sin consultas pagadas nuevas; el video privado no se compartió con revisores.

## 2026-11-11 · LV-005 · Segunda portada comercial de Claude Design

- Se comparó el ZIP2 con la primera entrega y se integraron sus cambios comerciales sin Shadcn ni runtime de diseño: hero de cuatro casos con secuencia/pausa, tres pasos animados, tres recargas aprobadas, 17 FAQ buscables y pie ampliado. Las diez rutas, reglas de oferta y las áreas de cuenta/editor se conservan. El prototipo no activa idiomas ni servicios adicionales.
- T3 coordinó DeepSeek V4.1 Flash y Kimi K3.1 Pro en paralelo sobre el plan/contexto mínimo. Codex auditó el código y probó la integración. Costes OpenCode: US$0.002686236 y US$0.105470000; total US$0.108156236, pendiente de conciliación con factura. Sin llamadas Gemini ni pagos reales.
- Se corrigieron pausa del video externo, contador localizado, foco/controles sin JavaScript, desbordamiento a 320 px/texto al 200 % y paneles ocultos visibles con movimiento reducido. Pasaron 96 pruebas, tipos, ambas compilaciones, 80 vistas comerciales y 280 vistas de regresión, además de guardar/reabrir/SRT/MP4 sintéticos.
- Candidata `commercial-v2-20261111` activa sólo en 127.0.0.1:3001; la anterior permanece para revertir. [Evidencia, revisiones, costes y pendientes](docs/specs/LV-005-diseno-v2.md). No publicado. Continúan revisión nativa/Pixel, ampliación posterior de cuenta y gates comerciales.

## 2026-11-11 · LV-005 · Corrección de fidelidad al ZIP2

El propietario rechazó la reinterpretación de la portada. Se trasladó la versión española completa desde Landing: cabecera/hero, caso Situación–Qué hace–Resultado, Cómo funciona con sus tres tarjetas, usos, idiomas, precios, 17 FAQ y pie, manteniendo texto/SVG/medidas y tipografía Inter local. Sin runtime DC ni cambios de cobro/backend. Se conectaron destinos reales; soporte/legal inexistentes quedan deshabilitados sin alterar su texto. Las otras nueve traducciones siguen como borradores.

T3 revisó el resultado en paralelo con DeepSeek y Kimi K3.1 Pro, sólo texto/código/mediciones: US$0.004679637 + US$0.199152 = US$0.203831637 de uso registrado, pendiente de conciliación con factura. Codex corrigió el título señalado y descartó los avisos no confirmados sobre main y redondeo de minutos. No hubo consultas Gemini ni cobros reales.

Las tres capturas españolas completas de referencia e implementación (390/1120/1440px, estáticas con movimiento reducido) tienen cero píxeles distintos; 68 medidas coinciden. Pasaron paridad literal, 50 vistas comerciales, 96 pruebas/tipos/compilaciones y 280 vistas de regresión con guardar/reabrir/SRT/MP4. Candidata aislada `claude-zip2-exact-20261111` activa sólo en 127.0.0.1:3001; anterior conservada. [Evidencia, alcance del dictamen y condiciones pendientes](docs/specs/LV-005-diseno-v2.md). No se extiende esa comprobación a todos los estados ni a otros idiomas; la maqueta no sustituye datos de disponibilidad ni valida la oferta pública.

## 2026-11-11 · LV-005 · Tarjetas de Cómo funciona en selección manual

Se reprodujeron los tres fallos informados: las seis combinaciones de paso/ancho (390 y1280px) pausaban la animación con opacidad cero o clip del texto completo. El ensayo anterior con movimiento reducido no cubría ese estado. Se corrigió sólo la regla CSS de selección manual para mostrar las tres tarjetas completas, sin rediseñar ni cambiar textos/cobros. La prueba específica compara con las tarjetas extraídas del ZIP original y pasó seis casos y el ciclo automático de tres pasos. Se conservan capturas por tarjeta y el registro de diferencias; no se declara igualdad absoluta de píxeles.

Tipos,96pruebas, instalación y ambas compilaciones correctos. Nueva candidata `claude-how-cards-20261111` activa sólo en127.0.0.1:3001; hashCSP servido verificado y anterior conservada. T3/DeepSeek/Kimi revisaron y aprobaron el parche acotado; coste nuevo registrado US$0.001122804 + US$0.083064 = US$0.084186804, conciliación pendiente. Sin Gemini ni pagos reales. [Evidencia y alcance](docs/specs/LV-005-diseno-v2.md).

## 2026-11-11 · LV-005 · Página completa y animaciones contra ZIP2

Corregidas diferencias confirmadas de reinicio/selección/pausa de animaciones, intervalo tras retrasos, espacios de anclas y búsqueda FAQ por envío/singular/estado vacío. Candidata claude-active-audit-20261111:96 pruebas, tipos, instalación y ambas compilaciones correctos;20 comparaciones geométricas y70 pares de fotogramas, ciclo real y estados sin fallos. La referencia nueva parte del original, supera el alcance de la antigua captura estática adaptada y reemplaza el parche de fotograma manual final. [Evidencia y límites](docs/specs/LV-005-diseno-v2.md#auditoría-completa-con-animaciones-activas--2026-11-11).

T3: DeepSeek0.021634098 + Kimi independiente0.333346800 + Kimi delegado adicional0.096654000 = US$0.451634898, uso registrado, conciliación pendiente. La delegación adicional evidencia permisos de herramientas no aislados como se esperaba; diagnóstico registrado sin modificar T3 global. Revisiones de código/texto, no certificación visual. Sin Gemini, pagos reales ni publicación. LV-005 sigue en curso por catálogo/legal/localización/gates públicos.

Activación final comprobada: claude-active-audit-20261111, PID65256, sólo127.0.0.1:3001; portada, acceso, fuente e imagen200, noindex y hash CSP correctos. Evidencia active-http.json en la carpeta de esta auditoría. Anterior conservada.

## 2026-11-11 · LV-007 · Tamaño, almacenamiento, nube personal y voz AI

Analizados los cuatro frentes con DeepSeek y KimiK3.1Pro en paralelo por respaldoOpenRouter autorizado. T3V2 no tiene aislamiento efectivo validado; no se relanzó porT3 ni se modificó instalación global. Dos intentos completos sin herramientas ni delegación: DeepSeekUS$0.01506035025 y KimiUS$0.191454912, totalUS$0.20651526225 devuelto porOpenRouter; factura pendiente. IDs y respuestas externas enlazadas en la especificación. Sin archivos privados, Gemini/TTS, pagos reales ni nueva facturación.

[Estudio y propuesta](docs/specs/LV-007-archivos-destinos-voz.md): no prometer500MB/10min antes de carga/reanudación, cuotas/borrado y render medidosPC/Pixel; Driveprimero y Dropbox condicionado al artefacto accesible; narraciónTTSopcional, separada de doblaje/lipsync y del precio actual. Costes porcarácter son estimaciones, no margen neto. Conservados todosloscambioslocales y estado de candidata. Actualizados enlaces deMasterplan/backlog/Gantt; no cambia lanzamiento ni paquetes. Entrega documental sin cambios de código: no se requieren nuevas pruebas de compilación; enlaces locales comprobados.

## 2026-11-11 · LV-003/LV-007 · Archivos privados grandes y guardado en Drive

Implementadas carga reanudable, almacenamiento externo a PostgreSQL, proyectos por referencia, lectura Range y limpieza de 24 horas. Medidos 100/250/500 MB con MP4 sintéticos de 1/5/10 minutos y relleno; hashes, aislamiento, caducidad y eliminación física correctos. Es medición de disco local, no cámara real, red pública ni render de 500 MB. La exportación MP4 grande queda bloqueada hasta validar recursos; los clips del perfil anterior mantienen exportación y alineación acústica.

Añadidos botones SRT/MP4 en Drive con permiso explícito drive.file, UID comprobado, carga por bloques y confirmación de archivo remoto. Transporte y recorrido de interfaz probados con simulación; el consentimiento y apertura reales siguen pendientes del propietario. Drive API habilitada sólo en linguistvision-dev; se confirmó facturación deshabilitada. Sin recursos de Spaces ni llamadas reales a Gemini/TTS.

DeepSeek y Kimi K3.1 Pro revisaron una instantánea por OpenRouter exclusivo de LinguistVision, pues T3 sigue pendiente de aislamiento. Coste nuevo confirmado: US$0.0491382045 + US$0.258457716 = US$0.3075959205; factura por conciliar. Codex reprodujo y corrigió carreras de cancelación/vencimiento, conexiones anidadas, retención de Blob y reintentos vencidos, con regresiones. No se atribuye a los modelos una revisión del código posterior. [Detalles, pruebas, configuración y pendientes](docs/specs/LV-007-archivos-destinos-voz.md#entrega-local--archivos-grandes-y-drive--2026-11-11). Sin publicación ni cambios de precios; los cambios locales existentes se conservaron.

Cierre de candidata: large-files-drive-guard-20261111 activa sólo en127.0.0.1:3001, PID65028. Instalación, tipos,155pruebas y ambas compilaciones correctos. Navegador final:280vistas,0excepciones, SRT/MP4 pequeños, botonesDrive simulados y bloqueoMP4grande correctos (run-Gjd4or). HTTP200/401/noindex/Firebasepropio comprobados. Consentimiento y archivo real enDrive pendientes de la respuesta del propietario. Candidatas anteriores conservadas.

## 2026-11-11 · Repositorio e instalación en otra PC

El propietario autorizó actualizar GitHub y documentar la instalación. Se confirmó origin Robcaze1980/video_transcript, rama main, sin divergencia respecto de afe2d4caefd53b8576b066c0f20129095fbcc172. Se conserva el trabajo local y se prepara su publicación como código; no se publica la web ni se cambia la candidata que está corriendo.

README actualizado y [guía de otra PC](docs/INSTALACION-WINDOWS.md) con Node24, dependencias de desarrollo, PostgreSQL dedicado, FFmpeg, acceso simulado o Firebase/ADC, Gemini, Drive y PayPal Sandbox. Diferencia los servidores3000/3001 y explica cómo trasladar PostgreSQL y medios privados para conservar saldo/proyectos. Añadida plantilla pública de Firebase sin valores reales. Se excluyen adjuntos remotos, configuración, backups y datos locales. Un correo personal de la bitácora se sustituyó por una referencia a la cuenta autorizada antes de preparar el repositorio público. Esta actividad no necesita consultas externas de modelos ni genera nuevos cargos de revisión.

Verificación de entrega: se exportó el árbol preparado por Git a una carpeta limpia, sin adjuntos ni configuración de esta PC. npm ci instaló348 paquetes con0 vulnerabilidades; tipos,155 pruebas sin omisiones y ambas compilaciones correctos. Arranque adicional en la copia de pruebas con puerto efímero y PostgreSQL nuevo: rol sin privilegios de administrador, configuración externa, portada200, registro303, saldo inicial0, carga privada, importación, Range y eliminación física correctos. No se interrumpió el servidor existente de3001 ni se hicieron llamadas a Gemini o pagos externos. Los datos temporales de base/rol se eliminaron. Evidencia externa: validation/github-install-20261111/tests.json e installation-smoke.json. El README no afirma haber instalado en otro hardware físico.

El control de publicación comparó los valores privados configurados y patrones de credenciales contra el contenido preparado:0 coincidencias. Adjuntos, backups, configuración y medios de clientes excluidos; sólo se incluyen los recursos sintéticos/de diseño usados por la aplicación. La evidencia privada sigue fuera deGit. Consulta externa de modelos para esta actividad:US$0.
