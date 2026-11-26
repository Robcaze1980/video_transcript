> **Aviso 25 nov 2026:** este recibo es un borrador histórico; la pieza 2 no está certificada en la versión integrada. Consulta HANDOFF.md y la revisión local vigente.

# Recibo · Paso 1.4b, pieza 2 · Desbloqueo auditado, lado Video

**Fecha:** 25 nov 2026 · **Estado:** certificado en local por Codex, **con límites declarados (tarea 1.4c)** · **Desplegado:** no (G0: nada se despliega hasta que la voz esté lista).
**Escribió:** T3 (`deepseek/deepseek-v4.1-flash`, hilo `c98cbabf`, el encargo y cuatro correcciones). **Revisaron:** GLM Flash Latest y DeepSeek V4.1 Flash, cuatro parejas (abajo). **Certifica:** Codex, con sus propias mediciones: los informes de T3 no se usaron como prueba.
Diseño: [bloqueos y cierres v2](../../specs/LV-019-B-bloqueos-y-cierres-diseno.md), §3.3. Encargos: [pieza 2](brief-2-video.txt), [continuación](brief-2b-continuar.txt), [corrección 1](brief-2c-correccion.txt), [2](brief-2d-correccion.txt), [3](brief-2e-correccion.txt) y [4](brief-2f-correccion.txt).

## Qué quedó hecho

La pieza 1 dejó a la Cuenta capaz de reabrirse. Esta pieza hace lo mismo del lado Video, con auditoría y sin abrir nada que siga sin revisar:

- **La guarda de Video lleva generación** (`epoch` y `createdAtMs`) con un único escritor, `writeBlockedGuard`, que la devuelve; `guardEpoch`/`guardPreview` calculan antes de escribir exactamente la misma generación. El id del hold es el mismo valor que el id del incidente en la Cuenta, `accountHoldId(tipo, incidente, epoch, createdAtMs)`, así que cada ocurrencia nueva de un bloqueo tiene un id nuevo (la Cuenta no acepta reutilizar un incidente ya revisado). Una guarda ajena o con `blocked` no booleano sigue registrando una incidencia no verificada, sin hold y sin tocar la guarda.
- **`unblockBillingAccount`** ([billingUnblock.ts](../../../server/commercial/billingUnblock.ts)), en cuatro fases con registros inmutables `billingUnblockAudit`: (0+1) en **una** transacción comprueba la alerta `guard` abierta del estado `blocked:<epoch>:<createdAtMs>:<incidente>`, la guarda, que el incidente sea el que ella nombra y que no haya filas rivales de la cuenta, y crea `unblock_requested`; (2) pregunta primero a la Cuenta, y un rechazo suyo no escribe nada en Video; (3) en **una** transacción relee la misma generación y la alerta, avanza solo las filas auditadas (hold, incidencias, salida, intención y, para intenciones, su guarda de admisión) y borra la guarda solo si la Cuenta ya no está bloqueada y Video no tiene fila rival.
- **Resultado parcial, completable.** Si la Cuenta responde `blocked:true`, la guarda de Video sobrevive y la **misma** petición repetida vuelve a preguntar; cuando la Cuenta queda libre y no hay rivales, una transacción borra la guarda, dispone la alerta y crea `video_released`. Una tercera llamada es repetición pura (cero escrituras, cero llamadas). Otro operador u otra carga es `conflict`. Una petición vieja sobre un bloqueo nuevo es `conflict`, nunca éxito aparente.
- **Ids de auditoría por ocurrencia** (`unblockAuditId(incidente, acción, epoch, createdAtMs)`): una intención que vuelve a divergir tras su desbloqueo se puede desbloquear otra vez.
- **Incidente de intención completo:** además de la intención, la incidencia y el hold, el desbloqueo devuelve la guarda de admisión de la intención a su forma exacta de 4 campos (sin eso la intención quedaba atascada aunque la cuenta ya estuviera abierta).
- **Filas rivales leídas dentro de la transacción** (`tx.get(consulta)`) en las tres transacciones. **Hold de segundo incidente:** una sola función, `pendingHoldRow`, conserva `epoch` y `createdAtMs` de la guarda (antes se pisaban con la hora actual y el segundo hold nunca llegaba a la Cuenta).
- **No hay ruta HTTP ni autenticación de operador:** `authorizedBy` llega ya autenticado (paso 3.5).

## Evidencia (medida por Codex sobre el código final)

| Verificación | Resultado |
|---|---|
| `tsc --noEmit` | limpio |
| Suite de desbloqueo de Video ([billingUnblock.emulator.mjs](../../../server/commercial/billingUnblock.emulator.mjs), Cuenta real en emulador) | **42/42** |
| `firestoreAi.emulator.mjs` · `firestoreBlocksA` · `firestoreA3Exit` | 173 (169 aprobadas, 4 omitidas de voz cerrada, 0 fallidas) · 27/27 · 27/27 |
| Regresión protegida de Cuenta (`run-7c83450a-5d54-43a8-aea1-e26a3afe198a`) | **PASS** |
| **Regresión financiera completa** (`run-02c3868b-444c-4bb5-8ebf-9148f9d26fdf`) | **PASS: 458 pruebas, 453 aprobadas, 5 pausadas de voz, 0 fallidas** (antes 403: suman las suites de desbloqueo de Video y de Cuenta, que entran ahora en la regresión oficial, y tres pruebas nuevas de `firestoreAi`) |
| `npm test` | {{NPM}} |
| Mutaciones propias ([arnés](mutaciones/mutate_video_unblock.py), [clasificación](mutaciones/CLASIFICACION-pieza-2.md), seis rondas) | **116 mutantes distintos: 100 detectados, 16 equivalentes con su razón, 0 sin explicar** |

Corridas **interrumpidas** que se conservan sin ocultar: dos ejecuciones de la regresión financiera (`run-b625f1b2…` y `run-45e7a7bf…`) que paré yo porque cambié un archivo vigilado o un defecto nuevo las invalidaba; y la primera tanda de mutaciones, que murió con la sesión (sin pérdida: restauré los archivos y verifiqué el hash).

## Revisión independiente y adjudicación

Cuatro parejas (GLM y DeepSeek, solo lectura, con el diff exacto en el encargo). Salidas completas en esta carpeta; el modelo efectivamente servido del alias de GLM y el costo por revisión **no fueron observables**.

| Pareja | Resultado | Qué adoptó Codex |
|---|---|---|
| 1 ([GLM](review-1-4b-p2-glm.txt), [DeepSeek](review-1-4b-p2-deepseek.txt)); sin bloque final, **INCONCLUYENTE** formal | FALLA / FALLA | Un hold que cambia de estado entre la lectura auditada y la liberación atascaba el desbloqueo; lecturas transaccionales. Rechazado: guarda ajena en la vía outbox (`verifiedOutboxOwner` ya la excluye), `createdAtMs` sin `epoch` (el reporte la marca corrupta, no genera la alerta). Varios incidentes del mismo tipo → 1.4c. |
| 2 ([GLM](review-1-4b-p2-final-glm.txt), sin bloque; [DeepSeek](review-1-4b-p2-final-deepseek.txt)) | FALLA / FALLA | **Ids de auditoría por ocurrencia** y **guarda de admisión de la intención** (ambos confirmados con prueba roja). Rechazado: `epoch` crudo en `sameGeneration` (inalcanzable), `recordExternalBillingReview` con guarda ajena (lanzaba `invariant` antes de este cambio). |
| 3 ([GLM](review-1-4b-p2-final2-glm.txt), con bloque pero con borradores de razonamiento mezclados; [DeepSeek](review-1-4b-p2-final2-deepseek.txt)) | PASS / FALLA | **Marca de generación del hold pisada con la hora actual** (ALTA, confirmada con dos pruebas rojas). Rechazado: colisión de ids en el mismo milisegundo (requiere repetir la marca de creación de la misma intención tras un ciclo completo). La BAJA de GLM sobre `advanced` vacío era falsa: la repetición ya devuelve lo avanzado; quedó fijado con una aserción. |
| 4 ([DeepSeek](review-1-4b-p2-final3-deepseek.txt); GLM: [intento fallido](review-1-4b-p2-final3-glm.txt) por `max_output_tokens`, 0 bytes, y [reintento](review-1-4b-p2-final3b-glm.txt)) | PASS / PASS | Sin hallazgos ALTA ni MEDIA. Adoptada la BAJA de cobertura: prueba estructural de las 12 lecturas por consulta dentro de la transacción (+ mutante detectado). No adoptada: repetir en la ruta de estado directo la aserción de generación (sin falla alcanzable). |

## Defectos de producción que encontraron mis pruebas y las revisiones (todos corregidos con prueba roja previa)

1. Repetir tras un desbloqueo parcial se rompía (`planned is not iterable`). 2. Una guarda de otra cuenta perdía la evidencia. 3. Una fila de hold con generación parcial detenía el listado de todas. 4. Repetir la petición vieja tras `video_released` aparentaba éxito sobre un bloqueo nuevo. 5. Un hold que cambiaba de estado entre fases atascaba el desbloqueo. 6. Los ids de auditoría de una intención no eran por ocurrencia. 7. El desbloqueo de una intención no reabría su admisión. 8. La fila del hold de un segundo incidente pisaba la marca de la guarda. 9. (Endurecimiento) lecturas de filas fuera de la transacción.

## Límites declarados (no se cierran aquí; tarea **1.4c**, que bloquea el cierre del paso 1.7)

- **Varios incidentes del mismo tipo sobre una misma guarda:** el desbloqueo solo nombra el más reciente y los anteriores quedan como filas rivales; la cuenta permanece bloqueada (falla cerrado, el recibo lo dice) y no hay salida. Pide guardar en la guarda la lista de incidentes de su generación.
- **Un incidente ya revisado que vuelve a divergir mientras la misma guarda sigue viva** (misma generación, sin hold nuevo), y la **alerta de una guarda con incidentes de los dos tipos** (nombra el más viejo).
- **Filas rivales sin ruta de resolución** (un hold corrupto, una incidencia no verificada): mantienen la guarda de Video y no hay herramienta que las resuelva.
- **Holds legados** (sin generación): código inalcanzable hasta que exista una migración; las bases reales están vacías.
- **Carrera lectura→escritura:** el emulador no permite inyectar una escritura entre una lectura y su commit; el contrato se fija de forma estructural y la serialización dura la da Firestore.
- **La edad de un hold de segundo incidente** se cuenta desde la creación de la guarda (más vieja, conservador).
- **Fuera de alcance de esta pieza:** ruta HTTP y autenticación del operador (3.5) y la salida de reservas atrapadas bajo bloqueo (pieza 3).

## Costo

Medido por diferencia de `total_usage` de OpenRouter, no por modelo: entre las 14:40 del 25 nov y este cierre fueron ≈US$0,97 (tres parejas de revisiones, un intento fallido y dos correcciones de T3). Entre las 16:18 del 24 nov y las 14:40 del 25 aparecieron ≈US$2,25 que **no** corresponden a esta pieza (hilos de metodología de otra sesión y posible uso del otro proyecto que comparte la clave); no se pueden aislar. Saldo al cierre ≈US$8,1 tras la recarga de US$10.
