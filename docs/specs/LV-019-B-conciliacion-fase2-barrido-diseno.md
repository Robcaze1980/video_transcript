# LV-019.B · Conciliación de saldo · Fase 2: diseño del barrido y la alerta (BORRADOR)

**Estado:** diseño del 19 nov 2026, **sin código, sin cambios de nube, sin mover saldo**. Parte de la [máquina de estados (fase 0 aprobada, respuestas de fase 1 en §4.3)](LV-019-B-conciliacion-fase0-maquina-de-estados.md). La voz sigue cerrada. **Revisión T3 hecha (GLM y DeepSeek, PASS sobre un resumen): ver §6.1.** No se fija ningún número (tiempos, topes): se miden primero (§5).

## 1. Qué existe hoy (evidencia)
| Pieza | Estado | Fuente |
|---|---|---|
| Barrido de intenciones, salidas de saldo y bloqueos | Existe como **ejecución puntual**: modo `billing` hace `drainExternalHolds` → `drainExternalBilling` → `drainExternalHolds` y **falla con error** si queda algo fallido o en revisión | `cloudFilesRuntime.ts:58–61` |
| Quién lo ejecuta periódicamente | **Nadie verificado:** el propio código dice «a scheduler is still required» | `firestoreAi.ts:146`, `:163` |
| Reintentos | Espera `min(15 min, 1 s·2^min(n,10))`; **sin tope de intentos**, y nunca pasa solo a `needs_review` por agotamiento | `firestoreBackend.ts:1024`, `:1343`, `:1367` |
| Selección de filas | Límite por tanda (25 por defecto, 100 máx.); el diagnóstico del 18 nov mostró que filas futuras pueden ocultar una debida | bitácora 18 nov (selector de intenciones) |
| Reserva en Cuenta sin salida (llamada admitida, resultado desconocido; cuenta con hold) | Sin vencimiento ni barrido; solo salida manual | fase 1, P1 |
| Alerta entregable al operador | No existe; solo el fallo del trabajo (`Billing settlement needs retry or review`) | `cloudFilesRuntime.ts:61` |

## 2. Diseño propuesto (cuatro piezas, todas sin mover saldo por su cuenta)
**A. Ejecución periódica.** Un disparador que lance el modo `billing` existente. Qué lo dispara (por ejemplo un planificador de la nube) es un cambio de nube y de costo: **requiere aprobación expresa**. Hasta entonces el diseño no depende de él: la pieza B se puede ejecutar a mano.

**B. Reporte de pendientes (solo lectura).** Una consulta que clasifica, por antigüedad desde `createdAtMs`, todo lo no resuelto: intenciones `reserve_pending`/`release_pending`; pares de recuperación terminal `pending`; `billingHoldOutbox` `pending`/`needs_review`; `billingOutbox` `pending`/`retry_wait`/`needs_review`; trabajos `unknown`. Debe recorrer **todas** las filas no terminales (con cursor), no solo las primeras de la tanda, para no repetir el sesgo del selector. No lee ni escribe Cuenta.

**C. Alerta.** Un registro durable y deduplicado por incidente que salta cuando: (1) aparece cualquier `needs_review`, o (2) una fila no terminal supera la antigüedad que fije el dueño tras medir (§5). El canal (correo, panel, otro) y quién la atiende son **decisión del dueño** (pregunta abierta de la fase 0). Una alerta no ejecuta ninguna acción de saldo.

**D. Resolución auditada, una sola vez.** Toda resolución manual (corrección, liberación autorizada) escribe antes un registro de auditoría con evidencia y quién la autorizó. La unicidad de la acción ya la impone Cuenta con la entrada de libro por reserva y acción (`ledgerId([cuenta,reserva,acción])`, `backend.ts:352`): una segunda acción falla. La ruta que **decide** reembolsar es comercial y no se implementa aquí.

## 3. Caso crítico: llamada admitida con resultado desconocido
Cuenta prohíbe liberar tras una admisión (`backend.ts:347`) y bloquea toda captura/liberación con hold (`:345`). Opciones, para decisión del dueño (no técnica: afecta a cuándo se devuelve dinero a un cliente):
1. **Dejar la reserva retenida y alertar** (comportamiento actual + alerta). Seguro, pero el cupo y el saldo quedan atrapados hasta intervención.
2. **Protocolo de reconciliación manual auditado** que, con evidencia del proveedor, capture o libere una sola vez. Nunca automático; nunca repite la llamada al proveedor; nunca acredita una cuenta supuesta.
Recomendación técnica: la 1 como valor por defecto y la 2 solo cuando exista el reporte B y la evidencia que exigirá (se define en la fase 3/4).

## 4. Invariantes que este diseño debe respetar
I2 (incierto no prueba ausencia), I4 (`needs_review` no se resuelve solo ni acredita a una cuenta supuesta) y I5 (toda reserva llega a estado final o a revisión **con alerta**). La alerta C es la parte que hoy falta de I5.

## 5. Qué se mide antes de fijar números (sin proponerlos aquí)
Latencia y tasa de fallos reales de cada `drain`; distribución de antigüedad de filas no terminales en el emulador con carga sembrada; cuántas filas debidas oculta el límite de tanda; tiempo de recuperación tras caída entre dos transacciones. Con esos datos el dueño decide la antigüedad de alerta y el tope de reintentos.

## 6. Pruebas que debe superar la implementación (fases siguientes)
- Una reserva huérfana sembrada aparece en B, dispara una sola alerta (deduplicada) y se concilia **una sola vez** (plan 2b).
- Con más filas futuras que el límite de tanda, B sigue listando la debida.
- Dos barridos concurrentes no producen dos acciones sobre la misma reserva (I1).
- Caída entre cualquier par de transacciones: tras reiniciar, B y el barrido convergen sin duplicar.
- Un `needs_review` nunca sale de ese estado sin registro de auditoría.

## 6.1 Añadidos tras la revisión T3 (19 nov; [recibo](../evidence/lv019-b-t3-fase2-barrido-20261119/RECIBO.md))
- **Orden estable en B:** cursor persistente y reanudable con orden total (clave de desempate), tolerante a barridos solapados; B valida cada estado contra Cuenta/libro al leer.
- **Bloqueada ≠ abandonada:** una reserva bajo incidente no es terminal; B y C la distinguen para no alertar en falso cada vez. Falta decidir (dueño, §7) si D puede resolver bajo bloqueo con una anulación auditada o queda en cola.
- **Acción terminal fallida:** hoy solo reintenta sin tope (`retry_wait`); el diseño exige que el fallo por bloqueo o admisión llegue a `needs_review` y dispare C (la regla de cuándo se fija tras medir).
- **Deduplicación de C** por (reserva, acción/motivo, estado): persistir «visto por primera vez» y re-alertar al **cambiar de estado**; revalidar estado terminal al emitir y al mostrar (carrera C→D).
- **Fallos del barrido:** también generan alerta durable; sin la pieza A hace falta un modo degradado explícito (quién ve el fallo ruidoso).
- **Reconciliación = captura o liberación:** no existe una tercera acción; usa la misma entrada de libro por reserva y acción, así que no puede haber doble cierre.
- **Pruebas añadidas:** fallo inyectado tras la admisión (retener y alertar, nunca automático); doble resolución simultánea; reinicio a mitad de cursor; cambio de estado que re-dispara la alerta; soak concurrente B+C+D+bloqueo con «unión del barrido = libro».
- **Criterio observable de cierre (adoptado):** ninguna reserva no terminal sin alerta activa o disposición auditada; cada fallo (de acción o de barrido) produce exactamente una alerta durable y un registro de auditoría; el umbral de antigüedad sale de la distribución medida por B.

## 6.2 Decisiones técnicas tomadas por Codex (19 nov, delegadas por el dueño)
- **Se implementa primero la pieza B** (solo lectura, no mueve saldo): `server/commercial/billingPendingReport.ts`, con pruebas unitarias (12) y comprobación contra emulador ([recibo T3 y contraste](../evidence/lv019-b-t3-reporte-pendientes-20261119/RECIBO.md)). Límites declarados: el modo rápido no ve filas sin estado usable (el modo `audit` sí, a costo de leer todo); los trabajos no se auditan; los índices en la nube no están verificados; aún no hay alerta (C) ni resolución (D).
- **Valor por defecto del §3:** opción 1 (retener y alertar). No se implementa ninguna liberación automática ni manual.
- **Canal de alerta:** hasta que el dueño elija, la alerta es un registro durable consultable (pieza C), sin envío externo. **Pieza C implementada (19 nov):** `server/commercial/billingPendingAlerts.ts` escribe solo en `billingPendingAlerts`; una alerta por (tipo, fila, estado, motivo) con transacción; sin umbral de edad por defecto; alerta propia para un barrido fallido; cierre solo tras leer la fila en un estado terminal conocido **dentro** de la transacción, o `superseded` si la fila sigue reportada con otro estado cuya alerta ya está abierta (nunca se pierde atención); reapertura con historia. Revisión T3 en 6 rondas, la última PASS de ambos ([recibo](../evidence/lv019-b-t3-alertas-20261119/RECIBO.md)); 22 pruebas + emulador. **Índices de nube (19 nov):** el reporte ya no usa filtros `in`: consulta por **igualdad en `state` + orden por id de documento**, que la documentación oficial de Firestore cubre con el índice automático de un solo campo (sin índice compuesto que desplegar); la consulta de alertas abiertas (`status == open`, orden por id) está en el mismo caso. Sigue **sin verificarse contra el proyecto real** (no se tocó la nube) ni con el emulador, que no exige índices. Límites:  todavía nada la invoca (falta D y el disparador A); los trabajos `unknown` solo se alertan si están malformados o por antigüedad, y nunca se cierran solos.
- **Pieza D implementada (19 nov), solo biblioteca:** `server/commercial/billingPendingAudit.ts` registra una decisión humana sobre una alerta, una sola vez por alerta y acción, con un registro de auditoría inmutable y la actualización de la alerta en la misma transacción. `acknowledge` deja la alerta abierta; `resolve` (exige evidencia) la cierra como `dispositioned`; una repetición idéntica es replay y una distinta es conflicto. **No mueve saldo ni edita filas**: solo observa el estado de la fila para dejar contexto. Precondiciones para cualquier endpoint futuro: autor autenticado en lista permitida y reloj del servidor. Revisión T3 en 3 rondas (la última PASS de ambos; [recibo](../evidence/lv019-b-t3-auditoria-20261119/RECIBO.md)). Un hallazgo propio: la pieza C fallaba si una alerta sustituida reaparecía; corregido.
- **Barrido local B+C implementado (19 nov; decisión de Codex por delegación del dueño):** `server/commercial/billingPendingSweep.ts` + ejecutor `scripts/runBillingPendingSweepLocal.mjs`, que solo acepta un emulador local (loopback, proyecto `demo-*`, sin credenciales). Lee el reporte, levanta alertas y cierra las verificables; **solo resuelve si todo salió bien**: cualquier fallo deja una alerta `sweep_failed`/`sweep_review` y rechaza con un error sin mensajes y con resumen parcial. No llama a los `drain`, no mueve saldo y D (decisión humana) sigue separada. Revisión T3 en 3 rondas (última PASS de ambos; [recibo](../evidence/lv019-b-t3-barrido-local-20261119/RECIBO.md)).
- **Endpoint de operador de D implementado y desactivado (19 nov; decisión equilibrada de Codex por delegación del dueño):** `server/commercial/billingOperatorHttp.ts`, **sin cablear a ningún servidor** y con todo en 404 salvo configuración completa (operadores, secreto, limitador, verificador, reloj; ventana para escribir). Parte B revisada con PASS de ambos; la parte A **sin PASS limpio** (sus FALLA restantes se refutaron con pruebas; ver el recibo). Activarlo en un servicio sigue necesitando la aprobación expresa del dueño, la lista de operadores y la verificación con un verificador de Firebase real.
- **Pieza A (disparador en la nube):** sigue sin hacerse; requiere aprobación expresa del dueño.

## 7. Decisiones que necesito del dueño (no técnicas)
Canal y responsable de la alerta; opción 1 u opción 2 de §3; y si autoriza más adelante el cambio de nube de la pieza A. Hasta entonces: solo documentos.

## 8. Gate de salida de la fase 2 (diseño)
Revisión T3 con criterio observable (cada pieza traza a un invariante y a una prueba de §6), decisiones de §7 tomadas y aprobación del dueño. No se escribe código antes.
