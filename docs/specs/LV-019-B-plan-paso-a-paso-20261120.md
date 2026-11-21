# LV-019.B · Plan paso a paso hasta producción (20 nov 2026)

**Estado: PLAN v3 ACEPTADO CON LÍMITES (20 nov 2026).** T3 ronda 1: 2 FALLA con hallazgos reales; ronda 2 sobre la v2: GLM PASS y DeepSeek FALLA con siete pendientes, adjudicadas e incorporadas en esta versión ([recibo](../evidence/lv019-b-t3-plan-paso-a-paso-20261120/RECIBO.md)). Es el orden de trabajo, no evidencia de que algo funcione. Guía de ejecución: define **los pasos, su criterio de salida y quién actúa**. No sustituye al estado vigente: el estado de cada tarea vive en el [backlog](../../backlog.md), el orden y las dependencias actuales en el [gantt](../../gantt.md) y las decisiones en el [plan integral](LV-019-B-plan-integral-20261120.md); si algo difiere, prevalecen esos. Hecha para el dueño (no técnico): cada paso dice qué se consigue y cómo se sabrá que está bien.

## 0. «Production ready» significa esto, siempre

Un paso **no está terminado** hasta cumplir lo que le toque de esta lista, y se dice con honestidad cuando algo no se pudo comprobar:

1. **Pruebas primero:** se escriben antes y se ven fallar por el motivo correcto; después pasan.
2. **Mutaciones:** se rompe a propósito cada condición del código nuevo y alguna prueba lo detecta.
3. **Regresión financiera completa** en emulador cada vez que se integra algo (hoy 222 aprobadas y 5 pausadas de voz).
4. **Revisión T3 por nivel de riesgo (aprobada por el dueño el 21 nov):** **dos modelos** (GLM y DeepSeek) en el **diseño y el código que mueven saldo** (reservas, capturas, liberaciones, bloqueos, ejecutor, contratos de Cuenta); **un solo revisor** (GLM) en lo mecánico o sin saldo (scripts de lectura, guiones, interfaz, documentación). Cada hallazgo se contrasta contra el código y todas las respuestas se conservan, también las FALLA. Si un cambio «mecánico» resulta escribir saldo, vuelve a revisión doble.
5. **Revisión con `google/gemini-4-hydrogen:batch`** de la migración y el backend integrados antes de abrir nada al público.
6. **Cambio de nube = lectura previa + ensayo en seco + revisión T3 del cambio + verificación + reversión probada.** IAM y secretos los hace el dueño con comandos que preparo.
7. **Nada de secretos** en el repositorio ni en lo que se envía a revisores; documentos al día en el mismo commit.
8. **Observable:** todo lo que pueda dejar dinero o saldo en duda genera una alerta que llega a una persona.
9. **Reversible:** un interruptor de emergencia y una vuelta atrás probados, **en seco y antes de encender**.
10. **Impuesto en el servidor:** quién puede usar una función (cuentas de verificación, voz) lo decide Cuenta y Video, nunca el navegador.

## 1. Mapa de fases

| Fase | Objetivo | Sale cuando | Estado (20 nov) |
|---|---|---|---|
| 1 | Cierre financiero local | Ninguna reserva ni cobro puede quedarse en duda sin alerta y un ejecutor periódico las resuelve; Video y Cuenta coinciden en cada fallo, cancelación y caída | **En curso:** Cuenta hecha; Video es lo siguiente |
| 2 | Voz en inglés y español | La voz cumple las puertas G1–G5 en local, con escucha nativa de los dos idiomas | Pendiente |
| 3 | Nube preparada, sin desplegar | Lecturas, índice, alertas, métricas, operador, límites y restauración ensayada, listos y probados | Pendiente (alguna lectura puede adelantarse) |
| 4 | Producto completo en local | Subir → transcribir → traducir → revisar → descargar (y voz) de punta a punta en emuladores | Pendiente |
| 5 | Puertas y acta de «lista» | G0–G10 cumplidas con evidencia y aprobación escrita del dueño | Pendiente |
| 6 | Primer despliegue restringido | Cuentas de verificación, con y sin saldo, en teléfonos reales | Pendiente (puerta G0) |
| 7 | Apertura gradual y operación | Clientes reales por tandas, con medición y criterios de parada | Pendiente |

Las fases 1 a 3 comparten archivos de saldo y se hacen **una tras otra**; calidad de idiomas, móvil y Drive avanzan en paralelo.

## 2. Fase 1 · Cierre financiero local

| Paso | Qué se hace | Cómo se sabe que está bien | Quién |
|---|---|---|---|
| 1.1 | **Video usa la liquidación parcial** (etapa 2 de C2a): fila de salida con protocolo 3; elegir la acción según el trabajo (éxito → captura; fallo sin llamadas → liberación; fallo o «sin habla» tras admitir → liberación con resolución; cancelación tras entrega → captura parcial); tope de reintentos que acaba en revisión con alerta; `too_early` sin contar | Prueba con Cuenta **real** que primero reproduce el incidente «sin habla tras admitir» y luego lo cierra; filas de ambos protocolos drenan; mutaciones; T3; regresión | Codex |
| 1.2 | **Cancelación del cliente y trabajos en duda (`unknown`)**: sellar el trabajo, calcular lo entregado, cobrar solo eso; plazo máximo para `unknown` con estado visible, límite por cuenta y liberación con marcador; llamador de producción para `reconcile` | Pruebas de cada transición; ningún camino cobra de más ni deja saldo retenido sin fin | Codex |
| 1.3 | **Reserva hecha sin trabajo (A-3)** ([diseño v2](LV-019-B-reserva-sin-trabajo-a3-diseno.md), dividido en **1.3a** salida por plazo del drenaje y **1.3b** ACK durable del solicitante): que converja (crear el trabajo solo con un ACK real repetido, o liberar sin trabajo tras el plazo y con prueba de Cuenta) y conectar la evidencia de ACK | El ensayo de reserva externa pasa de 7/13 a 13/13; puerta para abrir la reserva externa por HTTP | Codex |
| 1.4 | **Bloqueos** ([diseño v2](LV-019-B-bloqueos-y-cierres-diseno.md)): que un fallo transitorio tras un ACK no deje un bloqueo permanente (C-3, E-3: reintentos acotados antes de la cuarentena; el bloqueo permanente solo con una divergencia demostrada); protocolo auditado de desbloqueo; alerta de bloqueo solo en Video (D-4); salida para reservas de una cuenta bloqueada (A-5, E-4) | Pruebas por cada ventana del [mapa de caídas](../reviews/LV-019-B-mapa-caidas-video-cuenta-20261120.md) | Codex |
| 1.5 | **Historias antiguas o corruptas y legado**: fallar cerrado, inventario, y documentar que no hay escritores antiguos que drenar (las bases reales están vacías) | Pruebas de forma futura/ausente; inventario de fechas ya existente | Codex |
| 1.6 | **Ejecución periódica de los drenajes de saldo (modo `billing`):** hoy ningún planificador los ejecuta y la recuperación depende de que pase un worker; diseñar y probar un ejecutor periódico autenticado y equitativo, de una sola ejecución a la vez y con tope de trabajo por pasada, para reservas, salidas y bloqueos | Exclusión mutua con arriendo y valla (token de fencing) además de la idempotencia que ya tiene Cuenta; prueba de **dos ejecutores simultáneos y de uno pausado que despierta tarde** que demuestre un solo movimiento de saldo; pasada interrumpida y equidad entre cuentas; el barrido de alertas (3.4) lo vigila | Codex |
| 1.7 | **Cierre de la fase**: regresión completa, T3 del conjunto y revisión Gemini del backend de saldo | Invariantes I1–I6 con prueba; I5 («todo llega a estado final o a revisión con alerta») ya garantizado | Codex + T3 + Gemini |

## 3. Fase 2 · Voz en inglés y español

| Paso | Qué se hace | Cómo se sabe que está bien | Quién |
|---|---|---|---|
| 2.1 | **Decisiones previas:** variante del español (**decidida: español neutro latinoamericano**; sin regionalismos, voseo ni vocabulario propio de un país), voces de cada idioma, protocolo y rúbrica de escucha nativa, leer la adenda de datos de Google, texto del precio adicional | Registradas en la nota C0a y el plan | Dueño (variante, escucha) + Codex |
| 2.2 | **Reserva de voz (C1):** identidad → marca → intención → reserva de Cuenta en una sola transacción, con los negativos del contrato | Pruebas de emulador; no se cierra sin 1.1–1.4 | Codex |
| 2.3 | **Llamada por fragmento (C2):** cuerpo reconstruido y validado en ambos idiomas (tildes, ñ, ¿ ¡), fragmentos que son una partición exacta de la revisión (para poder calcular lo entregado), una sola llamada en vuelo, jamás reintento automático, `UNKNOWN` si no hay ACK, cobro solo con entrega verificada, sin cobro si fallamos | Pruebas de cada fallo y de cancelación a mitad | Codex |
| 2.4 | **Recuperación de voz (C3):** ACK perdido, caducidad de `UNKNOWN`, artefacto tardío que no se puede descargar ni cobrar | Pruebas; alerta de reservas envejecidas | Codex |
| 2.5 | **Reabrir las 5 pruebas pausadas** (140–143 y 182) adaptadas y añadir las nuevas | Regresión completa sin pausas de voz | Codex |
| 2.6 | **Interfaz de voz:** elegir voz, ver el texto que se narrará y el precio adicional (US$0.10/min), saldo, estado, cancelar, escuchar y descargar | Navegador sintético en tamaño móvil; luego teléfonos reales (fase 6) | Codex |
| 2.7 | **Cumplimiento:** guardado de 90 días con purga por lotes y marcadores **y un informe que lo demuestre** (una regla de ciclo de vida solo como respaldo de los objetos, nunca de los marcadores), borrado a petición, interruptor de emergencia, habilitación por cuenta **impuesta en el servidor** y apagada por defecto (hoy el código exige `aiPilot` y `simulationOnly`), auditoría | Pruebas de borrado y de interruptor; nada de contenido en registros | Codex |
| 2.8 | **Calidad nativa:** escuchar muestras de inglés y de español, rúbrica LV-004, correcciones; la aprobación de un idioma no aprueba el otro | Acta firmada en `docs/reviews/` | Dueño + Codex |
| 2.9 | **Cierre de la fase:** T3 y Gemini del conjunto de voz, regresión completa | Puertas G1–G5 de voz en local | Codex + T3 + Gemini |

## 4. Fase 3 · Nube preparada, sin desplegar

Hasta que la voz esté lista (G0) solo se permiten, con **aviso previo y reversión**, los tres primeros.

| Paso | Qué se hace | Cómo se sabe que está bien | Quién |
|---|---|---|---|
| 3.1 | **Lectura previa (A0):** permisos reales, APIs, cuotas de cuentas de servicio, permisos de la identidad de mantenimiento, ingreso de cada servicio | Informe con T3 antes de leer; declara que las bases vacías no validan la conciliación | Codex |
| 3.2 | **Índice `billingHoldOutbox (state, nextAttemptAt)` (A1)** | Consulta exacta, estado `READY`, no pide otro índice | Codex; dueño si falta permiso |
| 3.3 | **Alerta por correo (A3):** métrica por registros, política, canal, alerta de «sin datos», prueba de punta a punta (con una entrada de registro de prueba que el dueño debe permitir) | Llega un correo real, también a spam | Codex + dueño |
| 3.4 | **Barrido para la nube (A2):** manejador aislado, latido, tiempo propio, solo dos colecciones, prueba de frontera de importaciones | Mutaciones; T3; ensayo en seco; **la alerta de «sin latido» la evalúa Cloud Monitoring, fuera del servicio que vigila** | Codex |
| 3.5 | **Servicio de operador nuevo (A5):** ingreso `all` sin invocadores públicos, identidad IAM + token Firebase + tu UID, limitador compartido | Pruebas de aceptación, rechazo (otro UID, sin token) y revocación | Codex; IAM lo hace el dueño |
| 3.6 | **Límites y costes:** alertas de gasto de Google Cloud, límites de duración, tamaño y coste por trabajo, cupos por cuenta, límite de ráfagas | Documentados y con prueba; ráfaga de un usuario no frena a otro | Codex |
| 3.7 | **Runbooks:** despliegue, reversión, incidente de saldo, apagado de emergencia, copias y restauración | Ensayados en seco | Codex |
| 3.8 | **Métricas y panel mínimos:** tasa de error, trabajos atascados, latencia, divergencia de saldo entre Video y Cuenta y gasto del proveedor; quién atiende cada alerta y cuándo (el dueño por correo; no hay guardia de 24 horas), con umbral y tiempo máximo de respuesta definidos para cada alerta | Panel y umbrales revisados; sirven de criterio de puerta (G10) | Codex + dueño |
| 3.9 | **Datos:** simulacro de restauración de las dos bases y de GCS con datos sintéticos, midiendo cuánto se tarda y cuánto se pierde; versionado de esquema y compatibilidad al revertir (qué pasa con lo que escribió una versión nueva); etiquetas trazables de cada revisión; **la purga prevalece sobre la restauración** (tras restaurar se vuelven a ejecutar la purga y los borrados a petición antes de dar servicio) | Restauración ensayada y documentada (G9); prueba de lectura con la versión anterior | Codex |
| 3.10 | **Abuso y capacidad:** cupos de gasto por cuenta, suspensión manual y automática, concurrencia y ráfagas, cuotas del proveedor y prueba de carga acotada con simuladores; interruptor para apagar **todas** las llamadas al proveedor (separado del de voz), **guardado en una configuración externa que cada llamada consulta** y no en el servicio que podría estar fallando, con orden de apagado explícito y medido: nuevas subidas → voz → proveedor → despliegue | Pruebas de límites y del interruptor; moderación de contenido: valor por defecto propuesto **sin moderación automática**, política de uso aceptable y suspensión manual ante un reporte; el dueño decide el alcance antes de G8 | Codex + dueño |

## 5. Fase 4 · Producto completo en local

| Paso | Qué se hace | Cómo se sabe que está bien |
|---|---|---|
| 4.1 | **Gateway:** verifica el token de Firebase, llama al servicio privado con OIDC por la red privada, solo rutas permitidas, nunca un proxy abierto | Negativos de token caducado, audiencia errónea, archivo ajeno y descarga tras revocación |
| 4.2 | **Configuración de Hosting** (`/api/video/**`) y política de seguridad de contenido de la cuenta, preparada y **sin aplicar** | Prueba estática; reversión escrita |
| 4.3 | **Procesamiento real asíncrono:** transcripción → traducción → revisión → TXT/SRT (y voz), con adaptadores reales detrás de interruptores y simuladores en pruebas | Estados, reintentos y `UNKNOWN` idempotentes; límites aplicados antes de llamar al proveedor |
| 4.3b | **Prueba controlada con el proveedor real, desde esta PC y sin desplegar:** una transcripción y un fragmento de voz por idioma (inglés y español), con **contenido sintético propio y nunca de clientes**, para medir coste, latencia, formato, límites y modos de fallo reales; el dueño coloca la clave en el archivo privado de configuración; gasto dentro del tope de US$5 (propuesta: hasta US$1 para esto); aquí empieza la conciliación manual del gasto con el informe de facturación de Google | Mediciones guardadas sin contenido de cliente; el diseño se ajusta a lo medido antes de las puertas |
| 4.4 | **Flujo completo en la cuenta:** subir, elegir idiomas habilitados, cotizar, saldo, estados, revisar, descargar, voz, con aviso de privacidad, términos y consentimiento visibles | Navegador sintético en tamaño móvil |
| 4.5 | **Archivos y móvil:** de 30 s a 2–3 min, MOV, reanudación, suspensión y red interrumpida | Pruebas sintéticas; teléfonos reales después |
| 4.6 | **Integración de punta a punta** en emuladores con regresión completa | 0 fallidas |

## 6. Fase 5 · Puertas y acta de «lista»

Cumplir con evidencia: **G0** (voz lista) · **G1** regresión completa · **G2** recuperación y legado cerrados · **G3** lectura de nube sin sorpresas · **G4** voz: privacidad, retención e interruptor · **G5** T3 y Gemini de la integración · **G7** ninguna extensión del barrido que escriba fuera de sus dos colecciones · **G8** privacidad, términos y consentimiento redactados y revisados **antes de cualquier cuenta real**, aunque sea de verificación (Google como subencargado, transferencia internacional, contenido de terceros) · **G9** restauración ensayada · **G10** métricas, panel e interruptor del proveedor probados. Las cuentas de verificación se imponen en el servidor desde el primer despliegue de Cuenta. Se redacta un **acta** con enlaces a la evidencia y el dueño **aprueba por escrito** el primer despliegue. G6 (con y sin saldo, teléfonos reales) se evalúa en la fase 6.

## 7. Fase 6 · Primer despliegue restringido

Cada paso del 2 al 5 lleva ensayo en seco y reversión; **nada se abre al público**.

1. Aprobación escrita del acta y de la ventana.
2. Orden: **Cuenta primero** (con la habilitación por cuenta ya impuesta en el servidor), los servicios de Video como **revisión nueva sin tráfico**, **el mantenimiento con el barrido, la alerta de frescura y el ejecutor periódico de los drenajes**, el gateway y, por último, Hosting en un **canal de vista previa** antes de publicarlo en el sitio real; humo de archivos e IA antes de promover.
3. **Ensayar en seco la reversión y el apagado** (voz, proveedor y despliegue) antes de encender; después encender solo para **cuentas de verificación**, impuesto en el servidor.
4. Pruebas en línea: cuenta **con saldo** completa texto y voz (inglés y español); cuenta **sin saldo** no crea trabajo ni llama al proveedor; aislamiento entre cuentas; revocación; fallo y cancelación a mitad; `UNKNOWN`; simulacro de alerta y de apagado; simulacro de reversión.
5. **Gasto de proveedor dentro del tope de US$5**, registro del coste real medido (la tarifa de audio se duplica el 1 de enero de 2027) y conciliación con el informe de facturación de Google (a mano al principio), con alerta de presupuesto.
6. Teléfonos físicos (iPhone y Android) con conexión interrumpida.
7. Ventana de observación y revisión T3/Gemini de los resultados.
8. Decisión de apertura: sí, no o corregir.

## 8. Fase 7 · Apertura gradual y operación

Primeros clientes por tandas pequeñas; límites de capacidad publicados según lo medido; criterios de parada (saldo en duda, alerta sin atender, gasto fuera de plan); soporte definido (quién responde y en cuánto tiempo); revisión de precio y margen con la tarifa de 2027. **Compras y PayPal, render largo de MP4, restauración y Drive son pistas propias** con su presupuesto y puertas.

## 9. Pistas paralelas

Calidad de los demás pares de idiomas (LV-004, uno por uno), experiencia móvil, Drive y el diagnóstico causal de LV-E55 siguen su propio ritmo; el fallo intermitente del emulador (`Transaction is invalid or closed`) se registra cada vez y no se oculta repitiendo.

## 10. Qué necesito del dueño y cuándo

| Cuándo | Qué |
|---|---|
| Hecho (20 nov) | Variante del español de la voz: neutro latinoamericano |
| Paso 2.8 | Escuchar y aprobar muestras de inglés y español con la rúbrica |
| Paso 3.3 | Permitir una entrada de registro de prueba en Cloud Logging |
| Paso 3.5 | Conceder el permiso de invocación del operador (comando que preparo) |
| Fase 5 | Aprobar por escrito el primer despliegue |
| Fase 6 | Teléfonos físicos y tiempo para las pruebas |
| Fase 5 (antes de cualquier cuenta real) | Aprobar los textos legales y de privacidad: consentimiento, términos y privacidad |
| Paso 3.10 | Decidir el alcance de la moderación de contenido de los videos |
| Paso 4.3b | Colocar la clave de Gemini en el archivo privado de configuración (nunca en el chat) |

## 11. Qué no se promete

No hay fechas: dependen de lo que revelen las pruebas. Hasta la fase 6 todo se prueba solo en emuladores y con proveedores simulados, y las bases reales están vacías, de modo que las reglas de conciliación nunca se han ejercitado con datos reales. Ningún PASS de un revisor sustituye a la evidencia de las pruebas.
