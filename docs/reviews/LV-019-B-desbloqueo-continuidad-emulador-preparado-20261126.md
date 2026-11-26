# LV-019.B · Foco de continuidad de desbloqueo para Firestore Emulator

El arnés prepara la ejecución de `708c414`. Parte de los 16 casos de `538c2c4` y conserva su guardia de red, sus raíces sintéticas y la verificación de limpieza. Cada caso crea su propio par de raíces. La raíz de Video recibe el marcador sintético de corte antes de que se cree la guardia, salvo en el negativo donde el marcador debe estar ausente. El marcador del ensayo no acredita un corte de escritores real.

## Adaptación de las 16 pruebas anteriores

| Casos | Aserción del foco anterior | Aserción de este foco |
| --- | --- | --- |
| 1 y 6, fuente dañada y advertencia con enumeración inválida | Cero contactos con Cuenta, sin mutación de Video | Se conservan. El caso 1 sigue probando una segunda cuenta independiente. |
| 2, daño en la guardia al entregar el ACK directo | Primer POST y recuperación posterior por el recibo confirmado | La primera secuencia pasa a consulta `pending` seguida del POST. La guardia dañada mantiene el bloqueo; una guardia reparada permite cerrar por el recibo existente, con cero POST adicionales. |
| 3, daño durante una consulta `pending` al reanudar | Fallo de la primera entrega y una consulta de reanudación, sin POST entregado | Se observan dos consultas, incluida la consulta fresca previa a la primera entrega. Sigue habiendo cero POST entregados y ningún efecto en Cuenta. |
| 4 y 5, cierre parcial | El daño anterior a la consulta impide contactar Cuenta; el daño al recibir `confirmed` preserva la revisión | Las condiciones se conservan. La fase inicial tiene una consulta adicional. El cierre parcial con historial válido se sigue recuperando por recibo. |
| 7–9, respuesta `confirmed` recuperada con solicitud alterada, restaurada o intacta | La alteración aborta el cierre y la solicitud intacta permite recuperarlo | Mismas condiciones y mismo recibo. Se añade la consulta inicial a los recuentos. |
| 10–12, ACK directo fresco con solicitud alterada, restaurada o intacta | El ACK directo solo cierra con solicitud intacta | Continúan las tres aserciones. Se añade la consulta inicial y se comprueban el digest y los metadatos que vinculan las tres creaciones originales. |
| 13–15, ACK directo del POST posterior a `pending` | La reanudación hacía un POST condicional y después validaba el ACK | Esos tres casos se sustituyen por tres negativos de reenvío, con solicitud alterada, restaurada e intacta. El primer coordinador obtiene un despacho y simula fallo antes del transporte. La nueva consulta `pending` jamás alcanza el puerto mutante. Compara las huellas de ambas raíces y confirma cero decisiones de Cuenta. |
| 16, ACK perdido con solicitud intacta | La reanudación por recibo concluye con un solo POST total | Sigue cerrando por `confirmed`. Se añade la consulta inicial y se verifica que un replay concluido queda local. |

El progreso se comprueba por separado del rechazo de `pending`. Los casos intactos y los parciales prueban cierre mediante `confirmed` y preservan el recibo de Cuenta.

## Once casos añadidos

- Seis combinan borrado o recreación idéntica con pérdida de la solicitud, el testigo o la constancia de despacho. Antes del daño se verifica una creación conjunta de las tres filas. La recreación conserva el contenido y cambia el `createTime` del documento. Cuenta ya confirmó. Video conserva guardia, alerta abierta e incidencia sin revisión, sin invocar otra mutación.
- Una pérdida de las tres filas tras `confirmed` permite una consulta y conserva la revisión. La respuesta remota no permite reconstruir la autorización local.
- Dos carreras retienen el POST original mientras una lectura real de Cuenta todavía devuelve `pending`. Con historial intacto, un segundo coordinador se detiene y luego puede recuperar el recibo confirmado. Con solicitud y testigo perdidos, el despacho sobreviviente impide el reenvío. Tras el POST original, Video mantiene la revisión.
- Ausencia de corte y rechazo 409 de Cuenta acreditan las dos barreras de disponibilidad. La ausencia permite lectura sin crear autorización. El 409 conserva el despacho inicial y un `pending` posterior no autoriza otro envío.

Los casos nuevos y los seis adaptados de ACK directo crean una reserva real mediante AccountStore antes del bloqueo. Inspeccionan su cuenta, reserva y asiento. En caminos confirmados, el único cambio permitido en el inventario de Cuenta corresponde a guardia, incidencia y un recibo. Las rutas cerradas conservan todas las firmas pertinentes y el estado de revisión requerido. El inventario de raíces dedicado comienza vacío y debe volver al mismo estado. El arnés valida dos marcadores por caso y comprueba la eliminación de cada descendiente conocido.

## Evidencia preservada y ejecución pendiente

La ejecución anterior de `538c2c4` en `run-df1becb0-0388-4854-8354-77597de90c31` dio **16/16** y limpieza completa. Ese resultado pertenece al contrato anterior. Sus huellas de TAP y resultado son `121fb1b6ccdc19ebc2e5cf1c817617c1fa6d354e7e3f6f815ce2bcc287900a59` y `e90afc569eb63850c9c79427b471c41c30df07433063956c43966265b53ff16d`. En la base del ACK directo se conservan los seis negativos, **34/40**. La auditoría de continuidad y su repetición conservan **44/46** con dos fallos. [Informe de continuidad](LV-019-B-desbloqueo-continuidad-solicitud-20261126.md)

La comprobación estática verificó sintaxis, 27 nombres únicos y correspondencia exacta entre la fixture y el lanzador. También confirmó que las únicas tres denominaciones históricas retiradas son los tres POST condicionales tras `pending`. Se hicieron cero llamadas al emulador al preparar este foco.

Con el emulador dedicado disponible en `127.0.0.1:8185` para `demo-vistavo-ledger`, ejecutar desde este worktree el lanzador de pruebas `scripts/runAlertContractFocusEmulator.mjs --run <manifiesto>` con el Node 24.22.3 exacto que identifica el manifiesto. La corrida debe registrar **27** casos, **27** limpiezas, cero omisiones y ninguna desviación de las huellas. El preload de Node y la comparación de archivos son controles del arnés. Carecen del alcance de un cortafuegos de sistema operativo.

Quedan abiertos los metadatos reales del emulador, la migración de consumidores y la certificación del corte. Las pérdidas durante el POST presuponen que sobreviva al menos una constancia local. El foco cubre pérdida total tras `confirmed`. La desaparición coordinada de todas las constancias con un POST todavía en vuelo queda fuera de la garantía documentada. Las dos raíces sintéticas y la retención normal tampoco dan una transacción entre bases.
