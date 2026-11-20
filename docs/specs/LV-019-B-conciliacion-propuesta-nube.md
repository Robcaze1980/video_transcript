# LV-019.B · Conciliación de saldo · Propuesta para llevar el barrido y el endpoint de operador a la nube (BORRADOR PARA DECISIÓN DEL DUEÑO)

**Estado:** propuesta del 19 nov 2026, **solo documento**: sin cambios de nube, sin código nuevo, sin mover saldo. Nada de lo que sigue autoriza ejecutar algo: cada cambio de nube necesita tu aprobación expresa y por separado. La voz sigue cerrada. Continúa el [diseño de fase 2](LV-019-B-conciliacion-fase2-barrido-diseno.md) (pieza A y preguntas abiertas) y el [diseño del endpoint de operador](LV-019-B-conciliacion-endpoint-d-diseno.md).

## 1. Dónde estamos (evidencia)
| Cosa | Estado | Fuente |
|---|---|---|
| Reporte de pendientes, alertas durables, resolución auditada, barrido y endpoint de operador | Implementados y probados **solo en local con emuladores**; ningún servicio en la nube los importa (una prueba lo exige) | `server/commercial/billingPending*.ts`, `billingOperator*.ts`; [recibos T3](../evidence/lv019-b-t3-conectar-local-20261119/RECIBO.md) |
| Servicio de mantenimiento `vistavo-files-maintenance` (HTTP privado, mínimo 0 instancias) | Existe en el diseño de despliegue; su ruta `POST /internal/maintenance` hoy drena archivos y empuja despachos de IA. **No ejecuta el modo `billing` ni el barrido nuevo.** | `server/commercial/cloudFilesRuntime.ts` (modo `maintenance`) |
| Planificador de esa ruta (`*/5 * * * *`, con identidad de servicio y token OIDC) | Se creó inerte y pausado al desplegar. **Lectura P0 del 19 nov: está HABILITADO y registra un intento cada 5 minutos** (último intento 2026-11-20T04:10Z, sin código de error); es el único planificador del proyecto ([lectura](../reviews/LV-019-B-cloud-readback-2026-11-19.md)). | `deploy/google-cloud/files.plan.json:220–226`, `files-deploy.mjs:119–138`, [LV-007](LV-007-gcs-cloud.md) |
| Modo `billing` (drena bloqueos y salidas de saldo; **mueve saldo**) | Existe como ejecución puntual; falla con error si queda algo fallido. Nada lo ejecuta periódicamente y, según la lectura P0, **ningún trabajo ni servicio está configurado en ese modo** (los trabajos son solo `vistavo-ai-process`, `vistavo-files-cleanup` y `vistavo-files-validate`); falta «un scheduler autenticado y equitativo verificado». | `cloudFilesRuntime.ts:58–61`, [DEPLOYMENT](../DEPLOYMENT.md) |
| Índice `billingHoldOutbox (state, nextAttemptAt)` | Propuesto, **no aplicado ni comprobado** en la nube | `deploy/google-cloud/billing-hold.indexes.json` |
| API de Video | Interna, sin invocadores públicos, sin Hosting conectado | `files.plan.json` (notas), DEPLOYMENT |
| Costos de Google | **No medidos** | DEPLOYMENT (LV-007.AI) |

## 2. Propuesta por fases (cada una con su puerta; ninguna mueve saldo salvo P4, que queda fuera)
**P0 · Comprobaciones de solo lectura. HECHO el 19 nov por autorización expresa del dueño («Sí, autorizo P0»).** Se leyó en `vistavo-prod`, sin cambiar nada: planificador, servicios y trabajos desplegados, cuentas de servicio e índices; **no** se enumeraron los planificadores de otros proyectos de la cuenta de facturación (separación con ROBATO), así que ese conteo sigue desconocido. Resultado: [lectura P0](../reviews/LV-019-B-cloud-readback-2026-11-19.md). Resumen: el planificador de 5 minutos **ya está habilitado y registra intentos**; ningún trabajo ni servicio está configurado en modo `billing`; hay 11 cuentas de servicio (margen de cuota desconocido); falta el índice de bloqueos. Esa autorización cubrió solo esas lecturas; las filas de las colas (1C) se autorizaron después y se leyeron: ver [lectura 1C](../reviews/LV-019-B-lectura-1c-2026-11-19.md).

**P1 · Ejecutar el barrido (solo lectura de filas + alertas durables).** Es la pieza A del diseño. **Todo lo que sigue es una propuesta: cada cambio de nube necesita tu aprobación expresa y ninguna opción está preaprobada ni se encadena sola con la siguiente.** Opciones:
| | Qué es | A favor | En contra |
|---|---|---|---|
| **1A** | Ruta nueva `POST /internal/pending-sweep` en el servicio de mantenimiento existente, lanzada por un planificador (misma identidad privada y token OIDC; sin invocadores públicos). Como ya corre un planificador cada 5 minutos, el barrido podría colgarse de esa misma pasada sin un segundo trabajo de planificador | Reutiliza servicio, identidad y planificador | Ata la cadencia del barrido a esos 5 minutos; cambia la imagen de un servicio que ya atiende archivos e IA en producción privada; requiere despliegue |
| **1B** | Trabajo de Cloud Run nuevo en modo `pending-sweep` más un planificador que lo lance (mismo patrón que `billing`) | Aislamiento total de los otros procesos | Más recursos y permisos nuevos; el plan de mantenimiento evitó lanzar Jobs desde el cron; el margen de cuota de cuentas de servicio es **desconocido** (hay 11 hoy; el 13 nov falló crear una al llegar a 10) y habría que comprobarlo |
| **1C** | Nada nuevo en la nube: el barrido se ejecuta a mano desde tu equipo con credenciales tuyas, con un ejecutor nuevo y guardas distintas de las del emulador. Primero **solo lectura** (el reporte de pendientes y el inventario de `nextAttemptAt`, sin escribir nada); las alertas (escritura en dos colecciones nuevas) solo después de una aprobación aparte y de una comprobación previa (consulta nativa de índices y diferencias antes y después) | Cero infraestructura nueva; mide cuántas filas pendientes hay de verdad y cuántas lecturas hace cada pasada | Depende de que alguien lo ejecute: **si nadie lo ejecuta no hay barrido ni alertas**; no mide el costo de Cloud Run ni de Monitoring (eso solo lo da la facturación) |
Mi recomendación técnica, **que no era una secuencia preaprobada**: empezar por **1C solo de lectura** para ver cuántas filas pendientes hay de verdad (**hecho el 19 nov: hay 0**, ver [lectura 1C](../reviews/LV-019-B-lectura-1c-2026-11-19.md)); decidir después, por separado, si se escriben alertas y si se pasa a **1A** (con las colas vacías, ninguna de las dos tiene urgencia hasta conectar el flujo de saldo del vídeo). Propongo no programar nunca la opción `audit` del propio barrido (escanea colecciones enteras; **no es el modo `billing`**, que mueve saldo y queda excluido en P4): solo manual, salvo que decidas otra cosa.

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
- **Cloud Scheduler:** es una tarifa publicada, no un costo medido de tu proyecto. Según la [página oficial](https://cloud.google.com/scheduler/pricing) (leída a través de un buscador el 19 nov; **confirmar en la documentación antes de decidir**): 3 trabajos gratis por cuenta de facturación; 0,10 USD por trabajo cada 31 días, prorrateado; **un trabajo pausado también cuenta**. En `vistavo-prod` hay **uno** (el de mantenimiento, habilitado); cuántos hay en el resto de la cuenta de facturación **no está verificado** a propósito (no se enumeraron otros proyectos). Con la opción 1A de arriba no haría falta un segundo.
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
1. **P0 (lecturas en `vistavo-prod`, sin cambios): respondida y hecha el 19 nov** («Sí, autorizo P0»; [lectura](../reviews/LV-019-B-cloud-readback-2026-11-19.md)). **1C solo de lectura (reporte e inventario, solo recuentos, sin escribir): respondida y hecha el 19 nov** («Sí, autorizo 1C»; [lectura 1C](../reviews/LV-019-B-lectura-1c-2026-11-19.md): las colas de saldo del vídeo están vacías). Sigue sin autorizarse escribir alertas o registros en el proyecto real.
2. Cadencia del barrido («a mano al principio» es válido) y, tras medir, el umbral de edad de alerta.
3. Canal de alerta y destinatario (por ejemplo, tu correo).
4. Operador(es): tu UID real; por defecto solo tú.
5. Política de retención de alertas y de registros de auditoría (o «sin borrar por ahora»).
6. Aprobar por separado cada cambio de nube cuando llegue (1A/1B, Monitoring, servicio del operador). Salvo la 1 (P0), las preguntas anteriores no están respondidas.

## 6. Qué no haré sin tu OK
Cambiar nada en `vistavo-prod`, desplegar, habilitar o reanudar un planificador, aplicar índices, montar el endpoint fuera del servidor local, tocar `cloudFilesRuntime.ts` o `cloudApi.ts`, subir a GitHub o mover saldo.

## 7. Gate de salida
Este documento revisado por T3 y sus decisiones respondidas por el dueño. Hasta entonces: solo documentos y trabajo local.
