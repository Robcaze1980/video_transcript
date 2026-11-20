# LV-019.B · Conciliación de saldo · Propuesta para llevar el barrido y el endpoint de operador a la nube (BORRADOR PARA DECISIÓN DEL DUEÑO)

**Estado:** propuesta del 19 nov 2026, **solo documento**: sin cambios de nube, sin código nuevo, sin mover saldo. Nada de lo que sigue autoriza ejecutar algo: cada cambio de nube necesita tu aprobación expresa y por separado. La voz sigue cerrada. Continúa el [diseño de fase 2](LV-019-B-conciliacion-fase2-barrido-diseno.md) (pieza A y preguntas abiertas) y el [diseño del endpoint de operador](LV-019-B-conciliacion-endpoint-d-diseno.md).

## 1. Dónde estamos (evidencia)
| Cosa | Estado | Fuente |
|---|---|---|
| Reporte de pendientes, alertas durables, resolución auditada, barrido y endpoint de operador | Implementados y probados **solo en local con emuladores**; ningún servicio en la nube los importa (una prueba lo exige) | `server/commercial/billingPending*.ts`, `billingOperator*.ts`; [recibos T3](../evidence/lv019-b-t3-conectar-local-20261119/RECIBO.md) |
| Servicio de mantenimiento `vistavo-files-maintenance` (HTTP privado, mínimo 0 instancias) | Existe en el diseño de despliegue; su ruta `POST /internal/maintenance` hoy drena archivos y empuja despachos de IA. **No ejecuta el modo `billing` ni el barrido nuevo.** | `server/commercial/cloudFilesRuntime.ts` (modo `maintenance`) |
| Planificador de esa ruta (`*/5 * * * *`, con identidad de servicio y token OIDC) | Se creó **inerte y PAUSADO** al desplegar; el cron periódico quedó «pendiente de habilitar tras la aceptación privada». **Su estado vivo no se ha verificado desde esta sesión.** | `deploy/google-cloud/files.plan.json:220–226`, `files-deploy.mjs:119–138`, [LV-007](LV-007-gcs-cloud.md) |
| Modo `billing` (drena bloqueos y salidas de saldo; **mueve saldo**) | Existe como ejecución puntual; falla con error si queda algo fallido. Nada lo ejecuta periódicamente; falta «un scheduler autenticado y equitativo verificado». | `cloudFilesRuntime.ts:58–61`, [DEPLOYMENT](../DEPLOYMENT.md) |
| Índice `billingHoldOutbox (state, nextAttemptAt)` | Propuesto, **no aplicado ni comprobado** en la nube | `deploy/google-cloud/billing-hold.indexes.json` |
| API de Video | Interna, sin invocadores públicos, sin Hosting conectado | `files.plan.json` (notas), DEPLOYMENT |
| Costos de Google | **No medidos** | DEPLOYMENT (LV-007.AI) |

## 2. Propuesta por fases (cada una con su puerta; ninguna mueve saldo salvo P4, que queda fuera)
**P0 · Comprobaciones de solo lectura (opcional, necesita tu OK).** Leer en `vistavo-prod`, sin cambiar nada: estado y horario del planificador, servicios y trabajos desplegados, índices READY, y cuántos planificadores hay en la cuenta de facturación (para el costo del §3). Es **acceso a producción** aunque sea de lectura: usaría tu ADC local aislado (el que ya existe fuera del repositorio) y solo si lo apruebas; **no está concedido**. Resultado: un documento de estado. Sin esto, todo lo demás parte de supuestos.

**P1 · Ejecutar el barrido (solo lectura de filas + alertas durables).** Es la pieza A del diseño. **Todo lo que sigue es una propuesta: cada cambio de nube necesita tu aprobación expresa y ninguna opción está preaprobada ni se encadena sola con la siguiente.** Opciones:
| | Qué es | A favor | En contra |
|---|---|---|---|
| **1A** | Ruta nueva `POST /internal/pending-sweep` en el servicio de mantenimiento existente, con su propio planificador (misma identidad privada y token OIDC; sin invocadores públicos) | Reutiliza servicio e identidad; sin trabajo nuevo de Cloud Run | Cambia la imagen de un servicio que también atiende archivos e IA; requiere despliegue |
| **1B** | Trabajo de Cloud Run nuevo en modo `pending-sweep` más un planificador que lo lance (mismo patrón que `billing`) | Aislamiento total de los otros procesos | Más recursos y permisos nuevos; el plan de mantenimiento evitó lanzar Jobs desde el cron |
| **1C** | Nada nuevo en la nube: el barrido se ejecuta a mano desde tu equipo con credenciales tuyas, con un ejecutor nuevo y guardas distintas de las del emulador. Primero **solo lectura** (el reporte de pendientes y el inventario de `nextAttemptAt`, sin escribir nada); las alertas (escritura en dos colecciones nuevas) solo después de una aprobación aparte y de una comprobación previa (consulta nativa de índices y diferencias antes y después) | Cero infraestructura nueva; mide cuántas filas pendientes hay de verdad y cuántas lecturas hace cada pasada | Depende de que alguien lo ejecute: **si nadie lo ejecuta no hay barrido ni alertas**; no mide el costo de Cloud Run ni de Monitoring (eso solo lo da la facturación) |
Mi recomendación técnica, **que no es una secuencia preaprobada**: si autorizas P0, empezar por **1C solo de lectura** para ver cuántas filas pendientes hay de verdad; decidir después, por separado, si se escriben alertas y si se pasa a **1A**. Propongo no programar nunca la opción `audit` del propio barrido (escanea colecciones enteras; **no es el modo `billing`**, que mueve saldo y queda excluido en P4): solo manual, salvo que decidas otra cosa.

**P2 · Que la alerta llegue a una persona.** Hoy una alerta es un registro consultable; sin destinatario nadie la ve.
- **2A:** solo el registro (estado actual).
- **2B:** una métrica basada en registros y una política de Cloud Monitoring que te envíe un correo cuando el barrido registre un fallo o un `needs_review` (el resumen del barrido contiene solo recuentos, sin datos de filas). Recursos nuevos de Monitoring; **por verificar en la documentación de Monitoring** antes de decidir (la consulta de esta sesión no pudo leerla).
- **2C:** envío directo de correo desde el servicio con un proveedor externo (secreto, costo, nueva superficie). No recomendado ahora.

**P3 · Quién resuelve y cómo (operador).** Solo después de que existan alertas reales.
- **3A:** herramienta local solo para ti, con tu identidad, sin superficie nueva (requiere diseñar cómo se autentica el autor; hoy el diseño exige un token de Firebase verificado).
- **3B:** montar el endpoint HTTP existente en un servicio **interno** y llegar a él por un túnel autenticado, con token de Firebase y tu UID en la lista (secreto en Secret Manager). Sin Hosting y sin invocadores públicos. Límite: el limitador es **por proceso**; con varias instancias haría falta uno compartido.
- **3C:** exponerlo por Hosting: **fuera de alcance**, depende de la publicación pública.

**P4 · Programar el modo `billing` (el que sí mueve saldo).** **Fuera de esta propuesta.** Depende de sus propios gates (escritores antiguos drenados, reservas heredadas, planificador equitativo verificado, índice real) y es una decisión aparte.

## 3. Costos (con lo que sí está verificado y lo que no)
- **Cloud Scheduler:** es una tarifa publicada, no un costo medido de tu proyecto. Según la [página oficial](https://cloud.google.com/scheduler/pricing) (leída a través de un buscador el 19 nov; **confirmar en la documentación antes de decidir**): 3 trabajos gratis por cuenta de facturación; 0,10 USD por trabajo cada 31 días, prorrateado; **un trabajo pausado también cuenta**. Cuántos hay ya en tu cuenta **no está verificado** (el de mantenimiento existe en el diseño, aunque esté pausado).
- **Firestore:** por ejecución del barrido hay 10 consultas por estado (contadas en el código: `PENDING_SOURCES` suma 3+1+2+3+1) más 1 de alertas abiertas, **≈11 lecturas como mínimo aunque no haya nada pendiente** (Firestore cuenta al menos una lectura por consulta; esto último es la regla documentada, no se ha medido aquí). A una cadencia de 5 minutos (1A/1B) serían unas 3.200 lecturas al día en reposo; un barrido manual (1C) las hace solo cuando se ejecuta. Cada alerta nueva o actualizada suma lectura y escritura. **Precios y cuota gratuita vigentes: no verificados** (la [página](https://cloud.google.com/firestore/pricing) no se pudo leer desde aquí).
- **Cloud Run, Monitoring, Secret Manager:** no verificados ([Cloud Run](https://cloud.google.com/run/pricing)). Las ejecuciones serían de pocos segundos con mínimo 0 instancias.
- **No hay medición real de costos de Google en este proyecto.** Las únicas cifras en dólares de este documento son tarifas publicadas con su fuente; un costo en dólares para tu proyecto sería inventado y solo lo dará la facturación tras ejecutar.
- **Cadencia:** el diseño de fase 2 no fija números antes de medir. Cada 5 minutos es la del plan de mantenimiento, no una decisión sobre este barrido; empezar «a mano» es una opción válida.

## 4. Riesgos y cómo se acotan
- **Tocar la imagen del servicio de mantenimiento (1A):** ruta separada y apagada por configuración; aplicador con ensayo en seco por defecto y comprobación posterior (patrón de `files-deploy.mjs`); reversión a la imagen anterior.
- **Escrituras en el Firestore real:** solo las colecciones nuevas `billingPendingAlerts` y `billingPendingAudit`; no tocan filas ni saldos; se comprobaría con diferencias antes y después.
- **Choque con el drenaje existente:** el barrido solo lee filas de facturación y no reclama colas.
- **Índices:** las consultas son por igualdad más orden por id de documento, cubiertas según la documentación por índices automáticos de un campo; **no verificado contra el proyecto real**, se comprobaría con una consulta nativa antes de depender de ello.
- **Alertas sin destinatario:** por eso P2 va antes de apoyarse en ellas.
- **Límite de escrituras por proceso con instancias que se apagan:** aceptable con una instancia efectiva; documentado.
- **Identidad y mínimo privilegio:** el barrido correría con una identidad ya existente: el 13 nov la cuota de 10 cuentas de servicio impidió crear una nueva (`files.plan.json`, notas; cuánto margen queda hoy no está verificado), así que 1B con identidad propia puede no ser posible. Antes de elegir habría que comprobar qué permisos de Firestore tiene realmente esa identidad (según [LV-007](LV-007-gcs-cloud.md), `datastore.user` limitado por condición a la base `(default)`) y qué se gana o se pierde con otra.
- **Retención:** las alertas cerradas se marcan pero no se borran y los registros de auditoría son inmutables por diseño; no hay política de retención ni de borrado, y no se fija ningún plazo sin tu decisión.
- **Limitador del operador:** con mínimo 0 instancias el contador en memoria se reinicia cuando la instancia se apaga, así que **no limita de verdad**; no apoyarse en él para el endpoint de operador en la nube hasta tener uno compartido (por ejemplo, guardado en Firestore).
- **Postura de red del endpoint (3B):** llegar a un servicio interno por túnel exige darte permiso de invocación sobre él; eso cambia la postura actual (sin invocadores) y habría que revisarlo y revertirlo después.
- **Entrega real del correo (2B):** habría que probar de punta a punta que el correo llega (también a la carpeta de spam) y qué pasa si falla el canal; una política sin prueba de entrega no es una alerta.
- **Arranque en frío:** con mínimo 0 instancias la primera petición tarda más; irrelevante para un barrido periódico, relevante para el endpoint de operador.
- **Lo que esta propuesta no cubre:** frontend de operador, Firebase real en el verificador, pruebas con varias instancias.

## 5. Lo que necesito de ti
1. ¿Autorizas **P0** (lecturas en `vistavo-prod`, sin cambios)? Sin esto, el estado real sigue sin verificarse.
2. Cadencia del barrido («a mano al principio» es válido) y, tras medir, el umbral de edad de alerta.
3. Canal de alerta y destinatario (por ejemplo, tu correo).
4. Operador(es): tu UID real; por defecto solo tú.
5. Política de retención de alertas y de registros de auditoría (o «sin borrar por ahora»).
6. Aprobar por separado cada cambio de nube cuando llegue (1A/1B, Monitoring, servicio del operador). Las preguntas anteriores son preguntas: ninguna está respondida.

## 6. Qué no haré sin tu OK
Cambiar nada en `vistavo-prod`, desplegar, habilitar o reanudar un planificador, aplicar índices, montar el endpoint fuera del servidor local, tocar `cloudFilesRuntime.ts` o `cloudApi.ts`, subir a GitHub o mover saldo.

## 7. Gate de salida
Este documento revisado por T3 y sus decisiones respondidas por el dueño. Hasta entonces: solo documentos y trabajo local.
