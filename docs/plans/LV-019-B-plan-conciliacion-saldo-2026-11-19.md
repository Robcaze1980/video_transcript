# LV-019.B · Plan de conciliación de saldo (BORRADOR · no ejecutado)

**Estado:** propuesta del 19 nov 2026 para revisión del dueño y de T3. No se ha escrito código ni se ha tocado saldo. La voz sigue cerrada y fuera de alcance. Base: [política de incertidumbre](../specs/LV-019-B-politica-incertidumbre-cuenta.md), [recuperación de testigos](../specs/LV-019-B-recuperacion-testigos.md), [autoridad de reserva v2](../specs/LV-019-B-autoridad-reserva-v2.md), [HANDOFF](../../HANDOFF.md) y [errorlogs](../../errorlogs.md).

## Qué debe garantizar (criterios de aceptación observables)
1. **Nunca dos liberaciones ni dos capturas** para la misma reserva, con reintentos, respuestas perdidas o procesos concurrentes: un solo movimiento en el libro, comprobable.
2. **Nunca saldo reservado para siempre:** toda reserva termina liberada, capturada o en un estado de revisión con alerta durable y dueño del caso; ninguna queda solo en `reserve_pending`.
3. **Cuenta es la autoridad.** Una cuenta solo se bloquea o se corrige si su titular original está verificado (identidad + época); si no, el incidente se conserva sin atribuir y no se mueve saldo.
4. **Decisión de Rob (18 nov):** alerta sin pausa general; el video en curso termina si está autorizado; después se impiden videos nuevos de la cuenta afectada y verificada; nada se repite automáticamente ante una llamada incierta.
5. Cada corrección de saldo es auditable y protegida contra duplicados.

## Brechas abiertas que el plan cierra (según HANDOFF)
- Doble ACK deja incidencia conservadora y puede bloquear al dueño; falta conciliación y recuperación tras caída.
- Estados sintéticos inconsistentes permiten admitir un segundo trabajo (J2) con la cuenta en revisión; falta barrera autoritativa en Cuenta.
- Marca por intención y barreras: revisión T3 INCONCLUYENTE; faltan barrido/scheduler autenticado, datos legados/corruptos, historias eliminadas conjuntamente y llamadas en vuelo.
- Reserva externa de texto: 7/13 en emulador; la ruta HTTP externa sigue cerrada.
- Migración de fechas de intenciones: propuesta con T3 INCONCLUYENTE (cursor/CAS, escritores legacy, ABA).
- Restricción específica para trabajos nuevos de la cuenta afectada: sin diseño (el hold actual también bloquea capturas y liberaciones).
- Cloud: falta el índice `billingHoldOutbox` y el readback completo de IAM (fuera de este plan hasta que haya autorización).

## Fases (cada una termina con pruebas focales; la regresión completa solo al cierre de la fase)
| Fase | Entregable | Gate de salida |
|---|---|---|
| 0 | **Inventario y máquina de estados** (solo documentos): tabla de estados de intención/reserva/guard, quién puede mover cada uno, precondición y efecto en saldo de cada transición, estado terminal permitido y **marca de idempotencia por reserva**; lista de incidentes tipo y su resolución | Cada transición documentada con precondición y efecto en saldo; revisión T3; sin código |
| 1 | **Barrera autoritativa en Cuenta** para reservar/admitir (lee guard y hold en su propia transacción) **y registro del titular original** (cuenta, identidad y época) creado en la transacción de reserva, requisito previo de cualquier bloqueo | Pruebas que reproducen J1/J2 y ahora rechazan J2; prueba concurrente sin doble asiento; ninguna decisión sin leer guard+hold en la misma transacción; regresión de Cuenta (38/38 previa) sin cambios |
| 2 | **Conciliador idempotente** de intenciones `reserve_pending`/`release_pending` (una pasada, con clave por reserva, backoff y tope con alerta durable) | Cada reserva llega a un estado final o a revisión con alerta; pruebas: doble ACK, ACK perdido antes/después, caída entre pasos, dos conciliadores concurrentes → un solo movimiento |
| 2b | **Observabilidad y auditoría:** consulta/reporte de reservas huérfanas o con ACK ambiguo, alerta entregable al operador y registro auditable de cada resolución (la ruta de reembolso es decisión comercial del dueño, no se implementa) | Prueba: una reserva huérfana sembrada aparece en el reporte, genera una alerta y se concilia una sola vez |
| 3 | **Restricción de videos nuevos** para la cuenta afectada verificada (usa el titular original de la fase 1), sin tocar capturas ni liberaciones | Pruebas: video en curso termina; nuevo se rechaza; cuenta B no se afecta; titular no verificado → solo alerta |
| 4 | **Datos legados/corruptos y migración de fechas** con barrera de activación y verificación de titular | Pruebas de legado, ABA, cursor/CAS; cero reservas huérfanas tras migrar; **se repite la batería de doble ACK**; T3 sin INCONCLUYENTE por esas causas |
| 5 | **Scheduler autenticado** (diseño; despliegue fuera de alcance) | Contrato revisado; sin cambios cloud |

Reglas de siempre: cada fase = especificación → revisión T3 confirmada por el dueño → pruebas antes que código → focales → commit aparte con rutas explícitas; regresión completa (hoy 222 pasan / 5 pausadas / 0 fallan) solo al final de la fase; nada a GitHub, nada de cloud; la voz no se toca y sus 5 pruebas siguen pausadas.

## Riesgos y límites
- Todo se prueba con Firestore/Cuenta emulados y datos sintéticos: no acredita IAM, proveedor, cobro real ni recuperación entre dispositivos.
- Un timeout, 404 o silencio no prueba ausencia de efecto: ante la duda se conserva la reserva (UNKNOWN) y se escala.
- No se acredita ni devuelve dinero a una cuenta supuesta.
- La fase 1 y 2 tocan código de saldo: requieren aprobación expresa del dueño antes de la primera línea de código.

## Resultado de la revisión T3 (19 nov 2026)
DeepSeek y GLM respondieron PASS sobre el resumen agregado (recibos y notas en [`docs/evidence/lv019-b-t3-conciliacion-plan-20261119/`](../evidence/lv019-b-t3-conciliacion-plan-20261119/RECIBO.md)). Cambios adoptados en este plan: marca de idempotencia y precondiciones en la fase 0; registro del titular original como requisito de la fase 1; nueva fase 2b de observabilidad y auditoría; repetir la batería de doble ACK tras la fase 4; criterios observables ampliados. No se adoptan números (TTL, topes, tiempos): se medirán en la fase 2 y se decidirán con evidencia. Sigue siendo un borrador sin código.
