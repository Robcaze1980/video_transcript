# LV-019.B · Migración de fechas de intenciones

**Estado: propuesta no implementada ni aceptada.** *(Actualización del 19 nov: existe un inventario de solo lectura, `server/commercial/billingScheduleInventory.ts`, que cuenta cuántas filas seleccionables de `billingIntents`, `billingOutbox` y `billingHoldOutbox` están vencidas, futuras, sin `nextAttemptAt` o con valor inválido, y el máximo de futuras por estado; probado en emulador, sin ejecutar contra datos reales. No repara nada ni sustituye este diseño: sirve para saber si hace falta migrar.)* Este documento describe un incremento local, apagado y pendiente de revisión T3. No habilita el selector nuevo, el drenador, una ruta pública, procesamiento, cobros ni una migración en Google Cloud. No se han hecho cambios en saldos o datos en la nube para elaborar esta propuesta.

## Problema y alcance

El selector actual de `billingIntents` consulta hasta 100 documentos por estado y filtra `nextAttemptAt` después de la consulta. Una intención vencida puede quedar oculta detrás de 100 futuras cuyos IDs aparezcan antes. El [diagnóstico sintético](../../outputs/lv019-b-intent-selection-runs/run-5f52c712-9972-4136-88ca-d73fd3e23c3f/result.json) confirmó ese comportamiento en emulador; no demuestra un incidente en producción.

Una consulta futura ordenada por fecha no debe activarse mientras existan documentos activos con `nextAttemptAt` ausente o incorrecto: Firestore excluye los documentos sin el campo usado para ordenar. La [revisión DeepSeek](../reviews/LV-019-B-selector-equidad-DeepSeek-T3-2026-11-18.txt) identificó este riesgo y terminó **INCONCLUYENTE**; no constituye aprobación del diseño. El [contrato general](LV-019-B-video-text.md) mantiene abiertos los requisitos de conciliación, escritores, barridos e índices.

La primera pieza propuesta trabaja **solo con el esquema real de `billingIntents`**. No cambia `billingOutbox`, `billingHoldOutbox`, la selección de trabajos, el programador ni los protocolos financieros. Su preparación no resuelve la justicia entre clases ni demuestra que el despachador esté listo. Las demás colecciones necesitan inventario y tratamiento propios antes de una activación integral.

El experimento existente `server/commercial/billingNextAttemptMigration.ts` está limitado a emulador y contiene una heurística que asigna fechas a algunas filas sin historia suficiente. Se conserva como antecedente, no como regla aceptada para datos reales. `billingFairQueue.ts` también es un experimento aislado; ninguno de los dos acredita el nuevo migrador o una consulta de producción.

## Pieza propuesta y límite de ejecución

- `server/commercial/billingIntentScheduleMigration.ts`: futuro algoritmo para el esquema de intención y sus transacciones, con entrada desactivada por defecto. En esta etapa solo podrá abrir un cliente propio hacia el proyecto demo, host loopback y raíz sintética verificados; no aceptará un cliente o una raíz arbitrarios. Sin habilitación explícita de la fixture, el modo apagado no lee ni escribe.
- `server/commercial/billingIntentScheduleMigration.test.ts` y `server/commercial/billingIntentScheduleMigration.emulator.mjs`: futuras pruebas de clasificación y transacciones, con datos sintéticos y limpieza verificable. Son nombres propuestos, todavía no archivos implementados.
- Sin ruta HTTP, CLI operativa, scheduler, cambio en lectores ni bandera que por sí sola conecte la nube o active el selector. Un adaptador para el entorno real y su autorización requerirían una fase y revisión separadas.

El objetivo es preparar un algoritmo aplicable al esquema real y probarlo de forma aislada. Ejecutarlo en emulador no migrará datos reales ni verificará IAM, índices desplegados o comportamiento de Google Cloud. El incremento no hace llamadas a Cuenta ni proveedores y no modifica saldo, trabajos, movimientos, estados financieros o reservas.

## Contrato de clasificación

1. Recorrer todos los documentos por ID, sin filtrar por `state` ni por existencia o valor de `nextAttemptAt`. Así también se ven estados desconocidos y fechas ausentes.
2. En los estados actualmente seleccionables, `reserve_pending` y `release_pending`, conservar una fecha ya presente si su tipo, rango y metadatos de programación son coherentes. Un campo presente inválido —por ejemplo `null`, cadena, fracción, negativo o entero fuera de rango— es incidencia, no una fecha ausente que pueda normalizarse.
3. Mantener sin cambios los documentos que no están activos para este selector y cuyo estado y esquema sean reconocidos, incluidos `job_created`, `insufficient`, `closed` y `needs_review`. Esa clasificación no afirma que todos sean terminales de negocio: cualquier reapertura sigue su propio contrato y debe conservar una fecha válida.
4. Para una fecha ausente, si no hay procedencia e historia verificables que justifiquen una fecha exacta, registrar `UNKNOWN` y bloquear el avance de aceptación. Ni `now`, cero, un retraso arbitrario, `attempts` por sí solo ni un lease vencido prueban qué ocurrió antes. No hay todavía una regla histórica acreditada que permita rellenar automáticamente esas ausencias en el entorno real. Una futura regla debe especificar su evidencia, alcance y compatibilidad y pasar revisión; la pieza puede terminar con cero reparaciones.
5. Las tuplas de lease parciales o corruptas y la actividad remota incierta quedan en revisión. Un lease completo debe validarse según el protocolo correspondiente; su vencimiento no cancela un POST anterior ni convierte una fecha en autorización para enviar otro. Si falta la fecha de una fila con lease, no reconstruirla sin una regla y evidencia aprobadas.
6. Los estados o esquemas desconocidos también bloquean; no modificar la fila financiera para inventar `needs_review`. La incidencia del migrador no bloquea una cuenta de cliente sin atribución verificada. Los diagnósticos evitan texto, claves, tokens y saldos; sus metadatos de correlación necesitan acceso y retención controlados.

## Paginación, concurrencia y recuperación

El barrido usa `orderBy` por ID y un cursor exclusivo `startAfter`, con páginas acotadas y un checkpoint durable que incluye objetivo, fase, generación, cursor, secuencia y contadores. El tamaño de página se valida y limita. Un barrido de verificación empieza desde el inicio con una generación nueva; no comparte el cursor del barrido anterior.

Para cada fila seleccionada, una transacción relee checkpoint, barrera compartida y fila. Comprueba posición, generación, existencia, `createTime`, `updateTime` y esquema respecto de la lectura de página. Si alguna edición normal conservó la identidad del documento pero cambió su versión, el resultado es `stale`: no se escribe ni adelanta el cursor, y la fila se relee. Si existe una regla de reparación respaldada por evidencia suficiente, la transacción solo escribe `nextAttemptAt` si continúa ausente y la misma fila sigue siendo elegible; confirma ese cambio y el avance del checkpoint juntos. Ningún checkpoint adelanta una página antes de procesar sus filas.

Dos ejecutores pueden observar la misma página: solo el que valida la posición vigente puede avanzar cada fila. Si una fila seleccionada desapareció o fue reemplazada, el ejecutor registra de forma idempotente una incidencia y una barrera común, también cuando otro ya avanzó el cursor, terminó el barrido o abrió una generación posterior. No debe reescribir esa nueva posición. Un `createTime` diferente detecta un reemplazo observado; su igualdad por sí sola no demuestra que nunca se sustituyó el documento. Si Firestore impide persistir la incidencia, se propaga el fallo sin adelantar el cursor; no se declara un bloqueo durable que no quedó guardado.

El reporte final relee transaccionalmente checkpoint y barrera y representa ese instante. Otra ejecución podría observar y guardar una incidencia después: un reporte pasado no se revoca por sí solo. La barrera propuesta impide aceptar una futura activación bajo este contrato; **no detiene el lector o drenador actuales**, que no la consultan. No se infiere que dos lecturas con un documento ausente excluyan un ciclo crear→borrar entre ellas.

## Pruebas negativas y controles pendientes

La implementación futura debe conservar resultados y limpieza por ejecución, sin datos de clientes ni proveedores reales. Como mínimo:

- Modo apagado sin I/O; rechazo de cliente, host, proyecto o raíz ajenos; guard de red y limpieza restringida a la raíz sintética.
- Más de 100 documentos, con vencidos y futuros intercalados por ID; campo ausente frente a `null` y otros tipos/rangos inválidos; estados desconocidos y documentos no activos intactos.
- Ausencia e historia remota dudosa permanecen `UNKNOWN`, incluso si pasó mucho tiempo o un lease venció. Ninguna fecha por sí sola autoriza un POST; no hay cambios en saldo, trabajo, proveedor o Cuenta.
- Dos ejecutores, interrupción y reanudación, fallo de página y fallo de escritura de incidencia; sin saltos ni retrocesos indebidos del checkpoint.
- Un escritor concurrente cambia fecha, backoff o estado: la transacción no lo pisa. Borrado y recreación de un ID tras lectura, avance, finalización o cambio de generación deben conservar la barrera; una actualización normal debe producir `stale` y poder releerse.
- Inserción o degradación detrás del cursor: un segundo barrido desde el inicio debe detectarla. La prueba debe distinguir un reporte correcto en su instante de una incidencia posterior y no tratar la igualdad de versiones como prueba de historia completa.

## Secuencia e índices antes de una futura activación

1. Revisar este diseño con T3, contrastar sus observaciones y concretar cualquier regla de fecha basada en evidencia. La ausencia incierta sigue bloqueada mientras esa evidencia no exista.
2. Implementar y verificar la pieza apagada con esquema real y Firestore Emulator; conservar las incidencias, rojos y límites. Sin cambiar selector ni rutas.
3. Inventariar escritores y lectores de las colecciones afectadas, desplegar y verificar por separado los escritores compatibles, retirar los antiguos y resolver registros legacy. El protocolo de autorización, conciliación, leases y operaciones en vuelo de Cuenta necesita su propia evidencia; completar fechas no lo sustituye.
4. Antes del cambio de lector, drenar ejecutores de migración, hacer un segundo barrido completo por ID bajo una generación nueva y releer checkpoint y barrera, con evidencia de que los escritores antiguos no vuelven a introducir campos ausentes. Investigar barreras o incidencias; no presentar una pasada de emulador como prueba del estado en la nube.
5. Para una consulta futura por estado y vencimiento, diseñar y verificar en el Firestore destino el índice y orden adecuados, previsiblemente `(state, nextAttemptAt, __name__)`, con `__name__` como desempate estable de cursor. La necesidad, dirección y estado real del índice se deben confirmar con la consulta definitiva; este documento no crea índices ni asegura que existan. El barrido por ID se evalúa por separado.
6. Solo tras esas condiciones, una revisión independiente y una decisión de activación podrán evaluar el nuevo lector y el scheduler. Se necesitan además pruebas de equidad por clase, reclamos concurrentes, ACK perdido e idempotencia en Cuenta, y medición de carga y costo. Un checkpoint compartido puede generar contención; no se afirma equidad global, escalabilidad ni preparación de producción sin esos ensayos.
