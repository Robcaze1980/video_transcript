# LV-019.B · Revisión de texto y descargas en móvil

**Fecha:** 17 de noviembre de 2026. **Estado:** hallazgo de lectura; propuesta pendiente de revisión T3 y de implementación. La lectura corresponde al árbol de trabajo local, con cambios sin confirmar sobre `8b8e3e4`. No acredita el comportamiento ni la configuración desplegados.

La [especificación](../specs/LV-019-B-video-text.md#L57) exige que las correcciones confirmadas aparezcan en TXT/SRT y que la voz utilice la traducción guardada. La candidata local todavía no cumple la primera parte para el texto inglés corregido.

## Comportamiento observado

| Elemento | Comportamiento en el código local |
| --- | --- |
| Edición | La candidata carga el TXT inglés original y lo permite editar en un único campo de texto. Guardar crea una nueva revisión del borrador plano; el campo no conserva los tiempos ni la correspondencia con los segmentos. [Interfaz](../../server/commercial/web/cloudCandidate.tsx#L116) · [Guardado](../../server/commercial/firestoreBackend.ts#L294). |
| TXT y SRT | Los botones de resultado descargan los archivos originales del trabajo, aun después de guardar otra revisión. El estado puede indicar `stale`, pero el resultado anterior sigue disponible. La interfaz advierte que las descargas conservan el resultado generado. [Interfaz](../../server/commercial/web/cloudCandidate.tsx#L127) · [Resultado](../../server/commercial/firestoreAi.ts#L244). |
| Voz | Un trabajo nuevo utiliza el borrador guardado que se capturó para la revisión solicitada; editar después no cambia el trabajo ni el WAV anterior. El código comprueba revisión y hash del borrador, pero esos campos por sí solos no demuestran que el texto proceda de una traducción exitosa. [Reserva y snapshot](../../server/commercial/firestoreBackend.ts#L751) · [Worker](../../server/commercial/cloudAiWorker.ts#L38). El WAV no se incorpora automáticamente al video. |

La traducción genera también `cues.json` con identificadores, tiempos y textos español/inglés; el resultado se trata como archivo privado del trabajo. [Worker](../../server/commercial/cloudAiWorker.ts#L44) · [Modelo de segmentos](../../server/commercial/pipelineTextCodec.ts#L23).

## Piezas reutilizables y sus límites

Existe un editor piloto que permite seleccionar frases por tiempo y corregirlas, con video sincronizado; también tiene controles para cambiar tiempos, dividir y unir. [Editor](../../server/commercial/web/pilotEditor.tsx#L289) · [Selección y corrección](../../server/commercial/web/pilotEditor.tsx#L325). Su persistencia está conectada al circuito piloto de PostgreSQL, no a los proyectos Firestore de la candidata. [Aplicación del resultado piloto](../../server/commercial/pipelineTextService.ts#L114). Sus descargas se crean desde el estado local y pueden incluir cambios aún no guardados. [Botones del piloto](../../server/commercial/web/pilotEditor.tsx#L404).

El codec ya produce TXT y SRT a partir de segmentos con tiempos. [Serialización](../../server/commercial/pipelineTextCodec.ts#L166). `encodeTextResult` presupone segmentos validados; no debe recibir datos arbitrarios del navegador. El parser genérico de SRT crea identificadores nuevos y omite bloques que no interpreta, por lo que no garantiza conservar la correspondencia con `cues.json`. [Codec](../../server/commercial/pipelineTextCodec.ts#L340) · [Parser](../../utils/helpers.ts#L44). Además, las reglas de texto del editor y del codec difieren respecto de saltos de línea; deben acordarse y validarse antes de reutilizarlos. [Editor](../../server/commercial/web/pilotEditor.tsx#L36) · [Codec](../../server/commercial/pipelineTextCodec.ts#L60).

## Propuesta para revisión T3

1. Adaptar los controles de edición por segmentos a la candidata, sin conectar directamente su persistencia PostgreSQL. Para una primera versión acotada, conservar identificadores, orden, tiempos y español del resultado y permitir corregir el texto inglés; definir después los cambios de tiempos o segmentación.
2. Guardar privadamente una revisión estructurada vinculada al propietario, video, resultado de traducción y revisión esperada. Validar en servidor origen, identificadores, textos, tamaños y correspondencia; proteger la revisión con control de concurrencia. El guardado actual reemplaza el documento completo, por lo que debe adaptarse si se agregan campos estructurados. [Guardado actual](../../server/commercial/firestoreBackend.ts#L294).
3. Generar TXT, SRT y el texto de entrada de la próxima voz desde esa misma revisión canónica confirmada. Conservar los resultados anteriores como originales identificados por revisión, sin sobrescribirlos. Diferenciar en pantalla cambios sin guardar, revisión confirmada y resultado original; recuperar la revisión desde otra sesión. Editar o descargar no debe iniciar una solicitud de voz ni un cobro.

Esto requiere cambios en interfaz, API y backend. No se puede reconstruir con seguridad la distribución de un borrador libre entre tiempos a partir del texto plano. La propuesta no autoriza por sí misma cambios de contrato, publicación o despliegue.

## Autorización y revocación

La lectura actual del proyecto comprueba propietario, eliminación y vencimiento dentro de una transacción, pero no comprueba allí las banderas `aiPilot` y `simulationOnly`. El servidor de la candidata local comprueba ambas previamente mediante un autorizador separado. [Lectura](../../server/commercial/firestoreBackend.ts#L308) · [Autorizador local](../../server/commercial/cloudCandidateLocal.ts#L25). El constructor de `cloudFilesRuntime` revisado no proporciona ese autorizador; esto es una observación del código, no una afirmación sobre una configuración desplegada. [Constructor](../../server/commercial/cloudFilesRuntime.ts#L80).

La lectura de resultados AI comprueba el acceso de piloto y vincula resultado, propietario y video en una transacción. [Autorización de resultados](../../server/commercial/firestoreAi.ts#L252). Antes de añadir exportaciones revisadas hay que definir qué revocación les aplica y probarla en la misma transacción de autorización, además de verificar borrado y vencimiento. La lectura de objetos de Storage y la transacción de Firestore no son una única operación atómica: el diseño debe fijar generación y hash y volver a comprobar el estado pertinente. Los bytes autorizados o descargados antes de retirar el acceso no se pueden recuperar. No se ha demostrado una vía explotable ni acceso de otra cuenta a través de este hallazgo.

## Pruebas existentes y pendientes

No se ejecutaron pruebas para esta revisión. Las pruebas existentes relevantes son:

- [Resultado anterior e inmutable, aislamiento y descargas privadas](../../server/commercial/firestoreAi.emulator.mjs#L1209): comprueba que, tras guardar otra revisión, se conserva el TXT original con la revisión anterior.
- [Voz de worker con proveedor simulado](../../server/commercial/firestoreAi.emulator.mjs#L1300): comprueba el recorrido al WAV y su publicación privada; no comprueba que una edición segmentada aparezca en todos los resultados.
- [Codec de texto](../../server/commercial/pipelineTextCodec.test.ts#L3), [previsualización de pistas](../../server/commercial/web/pilotTracks.test.ts#L5) y [aplicación e IDs del piloto PostgreSQL](../../server/commercial/pipelineTextService.integration.test.ts#L31): cubren piezas individuales, no la candidata Firestore de extremo a extremo.
- [Revocación de resultados AI](../../server/commercial/firestoreAiAccess.emulator.mjs#L54): cubre banderas y carreras de autorización para esa ruta, no para una exportación revisada futura.

Para cerrar la brecha: probar con varios segmentos sintéticos y cambios en nombres y medidas que, tras guardar y reabrir, TXT y SRT tengan el texto y tiempos correctos, y el snapshot de una voz nueva tenga el mismo texto. Verificar que los originales y las voces previas no cambien; cubrir rechazo por otra cuenta, revocación, expiración o borrado concurrente, conflicto de revisión, ACK perdido, IDs alterados y entradas inválidas. Añadir pruebas móviles y de teclado y comprobar que editar o descargar no invoque proveedores ni genere cargos. La revisión T3 debe evaluar el contrato y estas garantías antes de implementar o declarar el criterio cumplido.
