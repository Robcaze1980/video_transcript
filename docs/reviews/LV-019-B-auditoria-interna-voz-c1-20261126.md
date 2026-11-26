# LV-019.B · Auditoría interna de la reserva local de voz C1 · 26 de noviembre de 2026

**Resultado final del corte experimental: PASS.** Se conservan cuatro auditorías con hallazgos, una evaluación de diseño y la auditoría de la corrección. Cada bloque final reproduce el emitido en su ronda. Los resultados de emulador que una ronda cita corresponden únicamente a esa versión.

**Procedencia.** Repositorio `Robcaze1980/video_transcript`, base `255aa5e`, cambios de C1 sin commit en `C:/Users/rob62/Documents/Codex/2026-11-11/vistavo-voice-c1-20261125`. Las rutas y líneas de los informes apuntan a ese árbol y pueden haberse desplazado en revisiones posteriores. Revisor interno de solo lectura: Codex. Modelo servido, tokens y costo: no medido. Las ejecuciones de emulador fueron realizadas por el equipo implementador. El revisor examinó código, manifiestos, registros y resultados guardados. Esta revisión interna deja pendientes las revisiones financieras de GLM y DeepSeek y las puertas del plan.

## Instantáneas y evidencia

| Ronda | Estado de la revisión interna | Pruebas aprobadas / limpiezas | SHA-256 del manifiesto de ejecución |
|---|---|---|---|
| 1 · Corte inicial | FALLA | Inspección estática | No se registró manifiesto |
| 2 · Colisión con saldo simulado | FALLA | 39 / 39 | `afa6bb4478804c0559078b5509ddf7e2fd37307c2d5cb585d19220baf6433196` |
| 3 · Colisión con texto externo | FALLA | 40 / 40 | `b43b558e5997e6fd86b7fd67f58bfb78a6ad4286e9a7d16b51de72e44e083ce4` |
| 4 · Evaluación de la corrección propuesta | FALLA de la misma candidata | Sin nueva ejecución | Misma instantánea que la ronda 3 |
| 5 · Reclamo recreado | FALLA | 44 / 44 | `bf6bcf6c16ac17ae4a6cc89353c85eec762d90de349a8f2829ea268dd5936f28` |
| 6 · Reclamo vinculado a su primer registro | PASS local | 44 / 44 | `bb91ad122a0ae659eedf94d0e1af83194be7fe6e0aab08fa52b07dffb19ca0d8` |

Al archivar, los 39 archivos del manifiesto final `manifest-1981edb6-6046-4295-895d-fc1b7be37266.json` coincidían con la candidata. El resultado de la ejecución correspondiente registró salida 0 y limpieza verificada. [Manifiesto final](C:/Users/rob62/Documents/Codex/2026-11-11/vistavo-voice-c1-20261125/outputs/lv019-b-review-manifests/manifest-1981edb6-6046-4295-895d-fc1b7be37266.json) · [Registro final](C:/Users/rob62/Documents/Codex/2026-11-11/vistavo-voice-c1-20261125/outputs/lv019-b-review-runs/run-c24e9890-1731-4a9b-a266-d2d854fde862/fixture.stdout.tap)

## 1. Corte inicial

**FALLA para cerrar C1.** El corte acredita por inspección una reserva experimental en el emulador. La voz sigue cerrada a clientes. El trabajo usa la revisión actual, relee la identidad y el vínculo después de la respuesta de Cuenta y calcula los segundos sobre la duración original. La prueba de 2,0004 segundos espera una reserva de 3 segundos.

| Prioridad | Hallazgo | Evidencia |
|---|---|---|
| P1 | Un llamador interno de la reserva genérica todavía puede adoptar una intención de voz preparada sin presentar el intento v2 y su ACK. Esa rama acepta la marca plana del proyecto y puede crear trabajo, copia del proyecto y salida para despacho. La entrada pública actual mantiene la voz cerrada. | `server/commercial/firestoreBackend.ts`, líneas 1642, 1672, 1742 y 1763–1775 |
| P1 | La prueba positiva obtiene la traducción de una captura del saldo simulado de Video. Luego reserva voz directamente en `AccountStore` emulado. Falta el recorrido con texto capturado por Cuenta, revisión guardada y segunda reserva para el mismo titular. | `server/commercial/firestoreReviewedTranslation.emulator.mjs`, líneas 220, 1048 y 1062 |
| P2 | El trabajo de voz guarda `snapshot: null`, pero copia el objeto `asset.storage` entero. El validador acepta campos adicionales. Además, una clave de solicitud con texto o una URL pasa la validación y queda guardada en intención, trabajo y clasificación contable. El test actual busca una sola frase en el trabajo. | `server/commercial/privateObjectPlan.ts`, línea 18. `server/commercial/firestoreBackend.ts`, líneas 116, 1085 y 1755–1762. `server/commercial/firestoreReviewedTranslation.emulator.mjs`, línea 1095 |
| P2 | El lanzador estándar espera 28 pruebas y su entorno hijo omite la opción de C1. Los nueve casos añadidos necesitan esa opción. Un resultado de 28 aprobadas deja los nueve sin verificar. | `scripts/runReviewedTranslationEmulator.mjs`, líneas 21, 125 y 174. `server/commercial/firestoreReviewedTranslation.emulator.mjs`, líneas 22 y 1046 |

La prueba escrita cubre cuenta ajena, saldo insuficiente, revisión obsoleta, cambio y restauración de revisión, revocación de UID, confirmación perdida y concurrencia. El corte conserva incertidumbre y protege contra un segundo intento. La recuperación sin visitas queda para C3. La ruta de texto conserva en el código examinado el identificador determinista y el formato v1. Su compatibilidad ejecutable queda pendiente de regresión.

```text
=== RESUMEN FINAL ===
RESULTADO: FALLA
EVIDENCIA: Revisión estática del árbol `vistavo-voice-c1-20261125`, base `255aa5e`, seis archivos modificados y `videoReservationId.ts` sin seguimiento.
NEGATIVOS: Falta comprobar rechazo de la reserva genérica sin ACK, privacidad con campos extra o clave con URL, y resultado de los nueve casos mediante un lanzador reproducible.
BLOQUEOS: Dependencias financieras 1.1–1.4, contraste GLM/DeepSeek y regresión completa. Auditoría de solo lectura, sin ejecución de suites, emuladores, red ni servicios. Uso y costo no medidos.
=== FIN RESUMEN ===
```

## 2. Colisión con saldo simulado

**FALLA en el aislamiento de la clave de reserva.** Después de perder el ACK de Cuenta, la ruta genérica con saldo simulado todavía puede ocupar la misma clave, crear otro trabajo y dejar una salida de despacho. Esto puede impedir la recuperación del trabajo original. No observé un segundo cargo en Cuenta ni exposición pública. El control actual cubre la ruta genérica que recibe `externalBilling`. [Control de reserva](C:/Users/rob62/Documents/Codex/2026-11-11/vistavo-voice-c1-20261125/server/commercial/firestoreBackend.ts:1675) · [Prueba existente](C:/Users/rob62/Documents/Codex/2026-11-11/vistavo-voice-c1-20261125/server/commercial/firestoreReviewedTranslation.emulator.mjs:1240)

Para impedir esa colisión, la transacción genérica puede leer la marca de voz y la intención correspondientes al UUID en minúsculas, junto con la solicitud que ya consulta. La presencia de la marca o del campo de intención C1 debe impedir ocupar la clave, incluso cuando ese campo vale `null`. La comprobación debe preceder a las escrituras y al retorno por solicitud previa. La ausencia de ACK es normal durante una reserva pendiente. [Creación atómica de marca e intención](C:/Users/rob62/Documents/Codex/2026-11-11/vistavo-voice-c1-20261125/server/commercial/firestoreBackend.ts:1083)

```text
=== RESUMEN FINAL ===
RESULTADO: FALLA
EVIDENCIA: Contrasté los 39 archivos del manifiesto con el árbol actual. Todos coinciden. El registro muestra 39 pruebas aprobadas y 39 limpiezas verificadas, incluidos los casos de privacidad de claves y metadatos, captura de tres segundos de texto seguida de reserva independiente de tres segundos de voz, concurrencia y repetición. [Registro del emulador](C:/Users/rob62/Documents/Codex/2026-11-11/vistavo-voice-c1-20261125/outputs/lv019-b-review-runs/run-b4ffecbf-3f3c-408f-912b-02518dd4f038/fixture.stdout.tap)
NEGATIVOS: Falta el caso de clave ya ocupada por C1 cuando el llamador genérico usa saldo simulado, incluida otra operación con la misma clave. La comprobación debe conservar el uso normal de otra clave y del texto anterior.
BLOQUEOS: El hallazgo residual impide aceptar el aislamiento. Revisé código y evidencia guardada. No ejecuté servicios ni emuladores. Las revisiones financieras, la regresión integral y las puertas de producción quedan fuera de esta comprobación.
=== FIN RESUMEN ===
```

## 3. Colisión con texto externo

**La guarda de saldo simulado pasa la revisión.** Si C1 ya posee la clave, la reserva genérica comprueba la marca y la intención dentro de su transacción, antes de escribir o devolver un trabajo previo. Cualquier documento superviviente impide ocupar la clave. Las solicitudes genéricas anteriores conservan la distinción entre mayúsculas y minúsculas cuando C1 no ha ocupado el UUID. [Guarda transaccional](C:/Users/rob62/Documents/Codex/2026-11-11/vistavo-voice-c1-20261125/server/commercial/firestoreBackend.ts:1699)

**Queda un fallo financiero en la ruta interna de texto con Cuenta externa.** Si C1 ya ocupa un UUID en minúsculas, una solicitud posterior de texto con ese UUID en mayúsculas puede crear una intención distinta y llegar a reservar saldo antes de que la guarda del trabajo rechace la colisión. El control debe aplicarse también antes de contactar a Cuenta. La entrada pública mantiene este camino deshabilitado. [Preparación de la intención](C:/Users/rob62/Documents/Codex/2026-11-11/vistavo-voice-c1-20261125/server/commercial/firestoreBackend.ts:1033) · [Reserva en Cuenta](C:/Users/rob62/Documents/Codex/2026-11-11/vistavo-voice-c1-20261125/server/commercial/firestoreAi.ts:122) · [Entrada pública](C:/Users/rob62/Documents/Codex/2026-11-11/vistavo-voice-c1-20261125/server/commercial/firestoreAi.ts:154)

```text
=== RESUMEN FINAL ===
RESULTADO: FALLA
EVIDENCIA: La ejecución registró 40 aprobadas, cero fallos u omisiones y 40 limpiezas. Los 39 archivos del manifiesto coinciden con el árbol actual. Los casos 33–36 verifican el rechazo de colisiones simuladas después de ACK, pérdida de respuesta, uso de mayúsculas, pérdida de uno de los dos documentos y confirmación de trabajo. [Registro del emulador](C:/Users/rob62/Documents/Codex/2026-11-11/vistavo-voice-c1-20261125/outputs/lv019-b-review-runs/run-9f6bdeb8-4e8f-45b5-bf7e-587c9b0da532/fixture.stdout.tap)
NEGATIVOS: Falta el control «C1 primero, texto con Cuenta después, mismo UUID en mayúsculas» que demuestre cero llamadas nuevas a Cuenta, cero movimientos y saldo intacto.
BLOQUEOS: La colisión externa se identificó por lectura del código. No repetí pruebas ni ejecuté servicios. La voz real continúa pendiente de sus revisiones y puertas de integración.
=== FIN RESUMEN ===
```

## 4. Evaluación de la solución propuesta para los dos órdenes

**Para impedir la colisión en ambos órdenes, texto y voz deben disputar la misma clave antes de solicitar saldo.** Con el esquema actual y consultas acotadas, hace falta un registro durable por cuenta y UUID normalizado a minúsculas. Puede ser un documento de coordinación o un índice equivalente. No necesita guardar ni mover saldo.

1. **Al crear la intención**, texto y voz leen el mismo registro dentro de la transacción de Video. El primero fija el modo. El otro recibe un conflicto antes de contactar a Cuenta. Si se incluye el saldo simulado en la garantía, ese camino debe participar en el mismo protocolo.
2. **El texto conserva sus claves históricas.** El UUID normalizado arbitra entre texto y voz. El texto sigue calculando sus reservas, búsquedas y reintentos con la clave literal anterior. Así, dos variantes de mayúsculas que históricamente eran distintas para texto conservan ese tratamiento.
3. **Un resultado incierto conserva el registro.** La preparación del envío y la confirmación del trabajo deben comprobar que el modo sigue correspondiendo. El registro por sí solo nunca autoriza un nuevo envío a Cuenta, una captura ni una liberación.
4. **Para cuentas existentes, la ausencia del registro nuevo no demuestra disponibilidad.** Los identificadores anteriores derivan de la clave literal. El ensayo puede comenzar con una raíz sintética verificada como vacía. Antes de abrir la voz sobre datos anteriores, hace falta reconstruir y contrastar el índice con las intenciones y trabajos existentes, sin alterar sus reservas. Los casos con historia incompleta quedan pendientes de conciliación.

```text
=== RESUMEN FINAL ===
RESULTADO: FALLA
EVIDENCIA: La candidata actual comprueba la clave canónica al confirmar el trabajo, después del punto en que el texto externo ya puede haber reservado saldo. [Creación de la intención](C:/Users/rob62/Documents/Codex/2026-11-11/vistavo-voice-c1-20261125/server/commercial/firestoreBackend.ts:1033) · [Solicitud a Cuenta](C:/Users/rob62/Documents/Codex/2026-11-11/vistavo-voice-c1-20261125/server/commercial/firestoreAi.ts:122)
NEGATIVOS: La corrección debe cubrir ambos órdenes de llegada, concurrencia, variantes de mayúsculas y pérdida de respuesta de cada modo. En cada caso, el perdedor debe dejar cero solicitudes y movimientos nuevos en Cuenta. El texto histórico debe conservar sus resultados de repetición.
BLOQUEOS: La propuesta aún requiere implementación y pruebas. Esta revisión fue de solo lectura, sin cambios ni llamadas a servicios.
=== FIN RESUMEN ===
```

## 5. Borrado y recreación del reclamo

**FALLA en la recuperación de un reclamo alterado.** La reserva normal ya arbitra correctamente entre voz y texto en ambos órdenes, incluso con solicitudes concurrentes y distintas mayúsculas. El defecto restante requiere que un escritor privilegiado borre y recree el documento de reclamo. La ruta pública de voz sigue cerrada.

Un reclamo recreado también tiene fechas de creación y actualización iguales. Si contiene el modo opuesto y un token válido, la comprobación lo acepta sin consultar la historia de la clave canónica. Cuando la solicitud entrante usa otra combinación de mayúsculas, puede carecer de intención propia que la vincule con la original. Por inspección, en ese caso el segundo servicio podría llegar a reservar saldo. [Validación del reclamo](C:/Users/rob62/Documents/Codex/2026-11-11/vistavo-voice-c1-20261125/server/commercial/firestoreBackend.ts:704) · [Comprobación de los documentos vinculados](C:/Users/rob62/Documents/Codex/2026-11-11/vistavo-voice-c1-20261125/server/commercial/firestoreBackend.ts:722)

```text
=== RESUMEN FINAL ===
RESULTADO: FALLA
EVIDENCIA: La batería terminó con 44 aprobadas, cero fallos, cero omisiones y 44 limpiezas. Los 39 archivos del manifiesto coinciden con el árbol revisado. Se comprobaron ambos órdenes, concurrencia, privacidad, variantes históricas de texto, ACK perdido, reclamo ausente y modificación del token. [Registro del emulador](C:/Users/rob62/Documents/Codex/2026-11-11/vistavo-voice-c1-20261125/outputs/lv019-b-review-runs/run-4b3f2467-03f0-4dfd-b30f-3ba86828b2dd/fixture.stdout.tap)
NEGATIVOS: Falta borrar y recrear el reclamo con modo opuesto conservando intactas las evidencias originales. El segundo servicio debe dejar cero llamadas y movimientos adicionales, incluso si se reutiliza el token original. Una corrección acotada puede contrastar la fecha de creación del reclamo con la de la primera intención o solicitud creada en la misma transacción.
BLOQUEOS: El defecto se identificó por inspección. No ejecuté pruebas ni modifiqué datos. El candidato sigue restringido a raíces sintéticas nuevas. La migración de cuentas históricas y las revisiones financieras siguen pendientes.
=== FIN RESUMEN ===
```

## 6. Corrección del primer registro y comprobación de cierre local

**PASS para la corrección local de C1.** El hallazgo de la revisión anterior quedó resuelto. El primer servicio crea el reclamo y su primer registro de intención o solicitud en la misma transacción. Antes de reservar saldo y de confirmar el trabajo, el servidor coteja su fecha de creación, identificador, modo y token. Borrar y recrear solo el reclamo impide una segunda reserva, incluso reutilizando el token original. [Validación del vínculo](C:/Users/rob62/Documents/Codex/2026-11-11/vistavo-voice-c1-20261125/server/commercial/firestoreBackend.ts:714)

```text
=== RESUMEN FINAL ===
RESULTADO: PASS
EVIDENCIA: La ejecución asociada al manifiesto `1981edb6-6046-4295-895d-fc1b7be37266` terminó con 44 pruebas aprobadas, cero fallos, cero omisiones y 44 limpiezas verificadas. Los 39 archivos del manifiesto coinciden con el árbol actual. [Resultado de la ejecución](C:/Users/rob62/Documents/Codex/2026-11-11/vistavo-voice-c1-20261125/outputs/lv019-b-review-runs/run-c24e9890-1731-4a9b-a266-d2d854fde862/result.json)
NEGATIVOS: Pasaron los casos de voz primero, texto primero, concurrencia, reclamo ausente o recreado con token nuevo u original, modo del registro original alterado y marca de voz superviviente ante una pareja de registros falsificada. El texto v1 conserva las solicitudes que distinguía por mayúsculas. [Controles del emulador](C:/Users/rob62/Documents/Codex/2026-11-11/vistavo-voice-c1-20261125/server/commercial/firestoreReviewedTranslation.emulator.mjs:1313)
BLOQUEOS: El resultado cubre raíces sintéticas nuevas. La migración de datos históricos, la regresión financiera integral y las revisiones GLM/DeepSeek conservan sus propios criterios de aceptación. Una reescritura privilegiada de toda la evidencia queda fuera del ensayo. La voz pública sigue cerrada.
=== FIN RESUMEN ===
```
