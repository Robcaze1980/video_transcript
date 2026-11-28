# LV-016 · Integrar video español, texto, subtítulos y voz inglesa en la web

Estado: A y B (texto ES/EN y TXT/SRT) completados técnicamente; C–F y calidad LV-004 pendientes. Fecha: 2026-11-12.
Base: main c435068 con cambios locales preservados. Sustituye la preparación centrada en pedir un archivo: primero unir las piezas en la aplicación. No hace falta un video del propietario para diseñar ni comenzar con fixtures sintéticos.
Responsables: Codex integra y verifica; DeepSeek propone cambios mínimos; Kimi audita independientemente mediante el respaldo autorizado OpenRouter mientras T3 no tenga aislamiento resuelto.
Dependencias: LV-003 cuenta/cola, LV-007 archivos privados, LV-004 calidad ES→EN, LV-008/009 editor y LV-015 voz. Drive permanece pendiente y separado.

## Resultado para el usuario

Desde la PC: subir video español de 2–3 minutos → revisar transcripción española y traducción inglesa → descargar TXT/SRT → elegir voz inglesa femenina o masculina → escuchar vista previa → crear y descargar MP4 con voz y subtítulos ingleses. Guardar y reabrir conserva revisión, estado y resultados. La interfaz indica qué está listo, qué está procesando y qué debe corregirse.

Primera entrega: una voz estándar por video, sin clonación ni sincronización labial. Al elegir narración inglesa, silenciar la pista española en el MP4 derivado; conservar intacto el original. Separar música/ambiente requiere otra fase. El objetivo de dos voces por cada uno de diez idiomas permanece, pero esta integración valida primero español→inglés.

## Piezas disponibles y huecos

- Carga privada reanudable y proyectos/editado persistente existentes. Ensayo de carga hasta 500 MB/600 s; no equivale a límites comerciales ni compatibilidad universal.
- Adaptador Gemini ES→EN existente, desactivado en candidata. Conectarlo de forma privada y comprobar salidas, sin activar indiscriminadamente capacidades anunciadas.
- Exportación actual de pilotEditor.tsx ejecuta renderTimedSubtitlesMp4 en navegador y conserva límite 1 MiB/30 s. Para 2–3 minutos se necesita trabajo de render en servidor; no basta quitar la condición del botón.
- prototypeVoiceover.mjs demuestra generación externa, no servicio web. Kore/Charon sólo probadas y aprobadas en español. Validar inglés antes de habilitar ambas opciones.
- CommercialJobs y sus pruebas aportan patrones de propiedad, reserva/captura/liberación e idempotencia. No asumir que ya soportan voz y render.

## Orden de implementación y puertas de cierre

| Paso | Cambio concreto | Cierre verificable |
| --- | --- | --- |
| A. Contratos y estados | Definir trabajos de transcripción/traducción, narración y render; migración aditiva, API y manifiesto de artefactos. Fijar versión de texto, tiempos, voz, modelo y estilo por resultado. | Contratos y pruebas de transiciones; una edición marca voz/MP4 previos como desactualizados sin mezclarlos con la versión nueva. |
| B. Texto y subtítulos | Conectar carga existente al procesador ES→EN; editor guarda ambas pistas y permite descargar TXT/SRT sin esperar a voz. | Fixture español de 2 y 3 minutos produce texto inglés editable, tiempos válidos y reapertura consistente; errores no borran original ni resultados válidos anteriores. |
| C. Servicio de voz | Extraer adaptador del prototipo con credencial sólo servidor; validar Kore/Charon en inglés, generar por segmentos temporales y almacenar audios privados/versionados. | Ambas opciones inglesas evaluadas con nombres, medidas y términos; vista previa y regeneración de segmentos modificados; no repetir segmentos válidos accidentalmente. |
| D. MP4 en servidor | Cola/worker FFmpeg con archivos en disco, concurrencia inicial de un render, cancelación y descarga autenticada. Incrustar subtítulos ingleses y unir narración al video. | MP4 de 2–3 minutos decodifica completo, conserva imagen/orientación y no corta palabras; recursos y compatibilidad medidos. |
| E. Unir la interfaz | Controles de idioma, revisión, voz, vista previa y exportación; progreso por etapa, cancelar, reintentar y reabrir. Estimación visible antes de generar. | Recorrido completo desde navegador sin comandos ni manejo manual de archivos; fallo de voz permite seguir descargando TXT/SRT. |
| F. Candidata y aceptación | Tipos, pruebas pertinentes, ambas compilaciones y recorrido en 3001; evidencias, costos y reversión de candidata. | Ensayo completo con fixtures de 2 y 3 minutos y después un video autorizado del propietario para calidad real. Distinguir aceptación técnica de publicación comercial. |

Camino crítico: A → B → C → D → E → F. Tras A pueden avanzar independientemente la validación de voces inglesas, el worker de render y los componentes de interfaz con adaptadores simulados; su integración depende de contratos estables. No se fijan fechas antes de medir las etapas.

## Reglas técnicas obligatorias

- Cada trabajo pertenece a una cuenta y una revisión inmutable. Clave de idempotencia por etapa/revisión/configuración; doble clic o reintento de red no duplica generación, resultado ni consumo. Reclamo del worker con lease y recuperación tras reinicio; una respuesta tardía no publica una versión cancelada o reemplazada.
- Estados por etapa: pendiente, en cola, ejecutando, completado, fallido y cancelado. Reintentos explícitos y trazables; nunca bucle ilimitado. Una etapa posterior fallida conserva etapas válidas anteriores.
- Fijar antes del ensayo tolerancias de sincronía, huecos y duración con fixtures conocidos. Detectar segmentos solapados y narración demasiado larga; exigir corrección/regeneración cuando no encaje. No cortar palabras ni acelerar toda la pista para esconder desajustes. Medir inicio, medio y final y escucha humana; la aprobación española no aprueba inglés.
- Archivos fuera de raíz pública, sin blobs grandes en PostgreSQL; lectura/Range/descarga/borrado autorizados por cuenta. Aplicar cuotas a originales, audios, MP4 y temporales; reservar espacio antes de render. Subproceso con argumentos estructurados, rutas controladas y sin interpolación shell.
- Mantener política vigente de retención de 24 h y documentar origen del reloj/limpieza de trabajos activos; cancelar, caducar o borrar elimina derivados/temporales de forma verificable. Un resultado incompleto nunca se ofrece como válido. No borrar copias externas del propietario.
- Antes de cada etapa mostrar estimación y alcance; registrar uso real de proveedor, intentos, latencia, tamaño, memoria observable, CPU/render y almacenamiento por separado. Proyecciones españolas no son precios ingleses ni presupuesto total.
- Candidata privada con consumo comercial simulado: no inventar precio de voz, descontar minutos de subtítulos por narración ni alterar saldos reales. Probar reservas/capturas/liberaciones por servicio con datos de prueba, incluyendo fallo y cancelación. Precio, inclusión en paquetes y reglas comerciales de regeneración quedan para Rob antes de habilitación comercial.

## Pruebas de aceptación y controles negativos

1. Caso completo sintético de 2 y 3 minutos, con nombres, números, medidas, silencios, segmentos largos y orientación; TXT/SRT inglés, audio y MP4 de la misma revisión. Registrar hashes, metadatos, tiempos y costos.
2. Dos cuentas: leer, descargar, reproducir, cancelar o borrar artefactos ajenos debe fallar sin efectos. Sin sesión no se accede a archivos.
3. Doble clic, reconexión, reinicio de worker, respuesta tardía, fallo del proveedor, disco insuficiente y cancelación: sin cargos/resultados duplicados ni reservas huérfanas; limpieza comprobada.
4. Editar texto durante generación: resultado anterior no sustituye revisión nueva; regenerar sólo lo necesario con procedencia visible.
5. Decodificación FFmpeg completa, audio sin clipping/truncamiento, subtítulos dentro de duración y evaluación bilingüe/escucha. Establecer umbrales numéricos antes de ejecutar, no acomodarlos al resultado.
6. Reapertura en navegador conserva progreso/resultados; fallo de narración o render no bloquea exportación de texto. Retención y borrado abarcan todos los derivados.

No declarar listo por pasar pruebas unitarias: requiere recorrido real de navegador en 3001 y evidencia de medios. Un video del propietario será necesario para validar sus grabaciones, pero no bloquea la implementación con material sintético. No se envían videos/transcripciones privados a revisores.

## Límites de esta fase y siguiente acción

Este documento autoriza el diseño del plan, no declara implementación ni aceptación. No cambia paquetes, límites comerciales, facturación, producción o publicación. Drive/Pixel, Dropbox, clonación, lipsync y los otros idiomas no bloquean este incremento privado y conservan sus propios gates.

Siguiente actividad: C, voces estándar inglesas sobre texto revisado, apoyándose en [B texto ES/EN verificado](LV-016-B-texto.md) y contratos A. Antes de cada candidata seguir docs/DEPLOYMENT.md. Codex recoge evidencia de ambos revisores, verifica contra código/pruebas y registra discrepancias; Rob conserva decisiones comerciales y publicación.

## Decisiones de diseño para cerrar en A antes de escribir el flujo

- Reutilizar PostgreSQL y el reclamo de trabajos de LV-003; ampliar por tipos/etapas y añadir worker Node, sin introducir otra infraestructura de cola. Diseñar DTOs y rutas bajo el API autenticado existente para crear/consultar/cancelar trabajos y leer artefactos; no crear un acceso paralelo sin propiedad. Migración aditiva y feature flag privada con apagado independiente de voz/render.
- Validar entrada con ffprobe, bytes reales y pistas; rechazar archivos sin audio o formatos no admitidos con mensaje claro. El adaptador actual puede aceptar video: decidir extracción/chunking sólo según sus límites comprobados, sin imponer transcodificación innecesaria. Definir política de audio multicanal, sample rate, rotación y formatos antes de aceptar cada perfil.
- MP4 inicial: H.264 + AAC, subtítulos ingleses quemados y descarga SRT separada; única pista audible inglesa, reemplazando el audio original en el derivado. Resolución/orientación sujetas a perfil validado, sin prometer 1080p/HEVC/HDR universal.
- Vista previa inicial: un fragmento elegido de la revisión vigente, reutilizado si no cambia; mostrar que usa proveedor y registrar su costo. No generar la narración completa con cada cambio de selector.
- Edición española invalida traducción dependiente; edición inglesa invalida segmentos de voz afectados y MP4. Mantener historia y etiquetas de versión; nunca regenerar silenciosamente ni servir derivados desactualizados como actuales.
- En A/B fijar en un documento de pruebas valores de CPS, caracteres/líneas, duración de cues y tolerancias de desfase; en C fijar encaje de narración. Si excede ventana, intentar reformulación aprobada/regeneración explícita o informar desajuste; primer incremento no depende de aceleración automática.
- Antes de solicitudes reales documentar datos enviados y política vigente del proveedor; no prometer retención cero, región o no entrenamiento sin comprobación. Revisores reciben sólo fixtures/contexto técnico. Registrar restricciones de API y tiempos de espera por etapa para detectar trabajo atascado, sin confundirlos con un límite de tiempo de esta sesión.
- Sin topes locales de tokens/gasto acumulado impuestos al propietario. Controlar duplicados, cuotas técnicas de archivos, costos observables y errores de proveedor; cualquier nuevo límite comercial corresponde a Rob. La sugerencia externa de imponer caps monetarios no se adopta contra su instrucción.

## Cierres añadidos tras auditoría independiente del plan

- A: IDs estables de segmento, correspondencia ES→EN y grafo de dependencias; publicación de artefactos mediante staging, validación y reconciliación recuperable BD/disco. Probar caída entre escritura y publicación. Timeout con resultado externo desconocido no se reintenta a ciegas: registrar, consultar/reconciliar si el proveedor lo permite y exigir reintento explícito cuando no pueda determinarse el resultado; no prometer exactamente una llamada externa por idempotencia local.
- B: demostrar separadamente video→reconocimiento español→segmentos con tiempos→traducción inglesa alineada. Comprobar silencio, idioma incorrecto, archivo corrupto y ausencia de voz; persistir ambas pistas. TXT/SRT ingleses son entrega obligatoria; exportación española podrá reutilizar selector existente si queda validada, sin desplazar el objetivo.
- A/E/F: especificar reloj común de caducidad y competencia limpieza/worker; reapertura promete archivos sólo dentro de retención. Probar vencimiento durante ejecución y reapertura caducada con aviso y sin enlaces rotos. Ningún worker vuelve a publicar después de borrar/caducar.
- C/D: rellenar con silencio ventanas más largas que la voz; exceso de narración requiere corrección explícita, nunca truncamiento. Verificar uniones, clics, solapamientos y final. Vista previa y exportación comparten revisión/configuración; voces inglesas no aprobadas permanecen deshabilitadas para render y producción y no se sustituyen silenciosamente. La autorización del paso C permite generarlas, escucharlas y descargarlas en el ensayo privado para su evaluación; eso no constituye aprobación lingüística humana.
- D: un render global en esta candidata de una instancia. FFmpeg con protocolos restringidos, privilegios mínimos, límites técnicos de recursos/salida y terminación del árbol al cancelar o atascarse; registrar estos valores antes del ensayo. Probar cancelación real del proceso y limpieza tras caída, no sólo estado del botón.
- F: comparar hash del original antes/después, matriz mínima de codecs/contenedores/orientación/navegadores, fixture con narración imposible, caducidad, resultado desconocido y fallo de publicación. Cada prueba especifica entrada, esperado, umbral, medición y evidencia. Reversión drena trabajos o conserva worker compatible; probarlo con trabajos en curso.

Revisión del plan: DeepSeek PASS y Kimi PASS documental; informes completos contrastados por Codex. Sus PASS no acreditan código ejecutado ni medio final. Vía: OpenRouter directo autorizado, sin herramientas, no T3 global (aislamiento pendiente). Evidencia privada: LOCALAPPDATA/LinguistVision/t3-review/integration-plan-20261112/. Costo devuelto usage.cost: DeepSeek US$0.0073842417 / 13267 tokens; Kimi US$0.17231742 / 19681 tokens. Total US$0.1797016617 / 32948 tokens; factura no comprobada. Se incorporan observaciones como puertas de cierre; no se adopta cap monetario contra la instrucción vigente.

## LV-016.A · Alcance de implementación del 12 de noviembre

Contrato interno y persistencia primero: tipos/validación runtime, snapshot inmutable capturado desde proyecto existente por servidor, etapas/estados y procedencia, idempotencia, caducidad heredada y manifiesto de metadatos. Migración aditiva y repositorio propio sin cambiar saldos ni la cola comercial actual. Las rutas HTTP se especifican como contrato; su activación e interfaz pertenecen a E, y los workers/proveedores/bytes reales a B–D. No declarar procesamiento o publicación atómica de archivos reales por probar sólo metadata en A.

Cierre A: persistir/reabrir snapshot y trabajos; detectar revisión desactualizada después de editar; rechazar acceso cruzado, configuración/requestKey incompatible, publicación tardía/cancelada/caducada y éxito sin artefactos válidos. Validar migración dos veces sobre esquema de prueba y conservación del editor existente. Tipos, pruebas PostgreSQL sin omisiones y ambas compilaciones. Contrato documentado de rutas futuras, límites de confianza y pendientes explícitos para etapas siguientes.


## Cierre A · 2026-11-12
Contratos runtime y DTO, snapshots inmutables con ambas pistas/estilo/highlights y hash versionado; repositorio PostgreSQL de trabajos/manifiestos, dependencias, token/lease, idempotencia y caducidad; migración aditiva registrada en arranque. Invalidación conservadora por revisión/hash y publicación transaccional de metadatos. No ejecuta proveedores, HTTP nuevo, archivos físicos o saldos. Segmentos estables y vista previa se cierran en B/C antes de habilitarlos.

DeepSeek/Kimi PASS final tras FALLA inicial y cuatro regresiones reproducidas/corregidas.193 pruebas sin omisiones, tipos y ambas compilaciones; piloto3001 reiniciado con4tablas nuevas vacías y huellas de cuenta/proyectos intactas. Evidencia y límites en [contrato A](LV-016-A-contratos.md). Próximo B; Drive separado.


## Cierre técnico B · 2026-11-12
[Video→texto bilingüe y TXT/SRT](LV-016-B-texto.md) integrado en candidata privada3001. Carga sin SRT, procesamiento por ventanas30s, revisión y aplicación CAS, correcciones/reapertura R4 y descargas probadas;232pruebas, tipos/builds y DeepSeek/KimiPASS técnico final. No acredita calidad humana universal/habla continua entre ventanas; LV-004 pendiente. Voces/MP4 largo/recorrido completo/publicación aún pendientes; Drive separado.
