# Revisión estática independiente · observación por edad LV-019.B

Fecha: 26 noviembre 2026. Revisor: Codex, en modo de solo lectura sobre la
candidata del ejecutor. No ejecuté pruebas, inicié emuladores, accedí a nube,
ni modifiqué archivos de la candidata. Costo de esta revisión: **no medido**.

## Alcance y huellas

Worktree revisado: `C:/Users/rob62/Documents/Codex/2026-11-11/vistavo-account-admission-20261126`.
La base es `e21889c58e31ca2d3695e1ce107ad5f5017a9cea`; la candidata examinada
contiene cambios sin commit. La revisión no cubre C2 ni su auditoría interrumpida.

- `server/commercial/firestoreBackend.ts`: SHA-256 `9a41abcdcc56d9d566a5285f152b6435da748103cc4179db750bdf0b1a241750`.
- `server/commercial/firestoreAgeObservation.test.ts`: `849190a26bc94a833677d076bbf0b7c4b8d6daeb6335c1b5667800b1b3a1f75e`.
- `server/commercial/firestoreAgeEscalation.test.ts`: `3fc1b90d32bcd60378f1b501e1c8e49c71099d32429ef73777e0174e9d4ddbf2`.
- `server/commercial/overdueEntryContinuity.diagnostic.emulator.mjs`: `e7a7e7b3f2c4cf612baaa358671d119a93721e00fcea923fd5e592b004026aa3`.
- `server/commercial/overdueReleaseEntry.diagnostic.mjs`: `369d3b821c43ddd9c71f66195fc59e811a2730b999a5e9e4b32fb0178fc27081`.
- `docs/specs/LV-019-B-observacion-edad-intenciones.md`: `890e94bf8bde1f49c7d7f9069e32f0389720f293ae08a4bac7d1e390799d3f90`.
- `docs/evidence/lv019-b-age-observation-20261126/run-inspected.ps1`: `5f19ffa7f703010f57b2924ac914911d11d7142927220d03978e169f8b4abbcf`.

Se leyeron `AGENTS.md`, el plan maestro, el contrato de admisión, la
especificación de observación, el diff, las pruebas y reglas locales de
Firestore. Se comprobaron llamadas mediante el grafo de código y referencias
literales. El manifiesto preparado más reciente comunicado para esta versión
es `outputs/age-observation-manifests/manifest-682e3de1-aeda-408f-a925-dd3318fc3a8d.json`,
SHA-256 `970a64cd8110a595e56399d625cfaa51bebc50b75e757c0d0f6abdc3642f6131`.
Comprobé directamente que el hash del lanzador en ese manifiesto coincide con
el archivo; **no** recalculé sus árboles completos ni ejecuté su verificador.
Los manifiestos `19196b0c…` y `1236d9ca…` quedaron obsoletos tras ediciones.

## Resultado del código

En `firestoreBackend.ts:2447-2475`, el ID se genera una vez por candidato,
fuera del callback reintentable. El callback relee la fila y exige el mismo
estado no terminal y una edad válida; crea la observación y actualiza la fila
en la misma transacción. La búsqueda examinada de `ageObservationId` y
`billingIntentAgeObservations` encontró escritura y pruebas, no un consumidor
que use ese dato para autorizar un bloqueo, devolución o envío. No se detectó
un defecto concreto dentro del alcance de **observar**, sujeto a las pruebas
pendientes. La política de edad y los datos de entrada siguen siendo los del
proceso que llama; no se ha auditado su despliegue.

**Contradicción documental pendiente:** la especificación, en la revisión
`890e94bf…`, dice que un fallo de escritura deja la fila pendiente. Sin
embargo, el caso preparado `overdueEntryContinuity.diagnostic.emulator.mjs:239-263`
espera `failed=1` después de descartar la respuesta de un commit ya aplicado,
con fila `needs_review` y observación creada. No es válido inferir ausencia de
commit a partir del contador de errores; debe distinguirse el rechazo
definitivo del resultado incierto y conciliar la fila antes de repetir. Se
comunicó al ejecutor y a coordinación; aún no se ha verificado su corrección.

## Tres observaciones y respuesta en la candidata

1. **Carrera y respuesta perdida.** La primera prueba lanzaba dos barridos con
   `Promise.all` sin forzar que vieran el mismo candidato, y un nombre sugería
   ACK perdido aunque solo había repetición posterior a éxito. Se comunicó al
   ejecutor. En el archivo actual, `overdueEntryContinuity.diagnostic.emulator.mjs:186-264`
   prepara una barrera tras ambos escaneos y antes de las transacciones; añade
   un aborto `ABORTED` inyectado para observar el mismo ID en callbacks y una
   respuesta descartada tras el commit con lectura antes de repetir. Son
   diseños de prueba leídos, **no resultados verificados**. La pérdida se
   inyecta fuera de `runTransaction`; no demuestra todas las rutas de retry
   internas del SDK ante un ACK perdido.
2. **Fallo atómico al confirmar.** La primera inyección lanzaba dentro de
   `tx.create` antes de encolar el `tx.update`, por lo que no ejercitaba un
   rechazo de commit con ambos pendientes. El caso actual `:266-288` prepara
   ambas escrituras y fuerza una colisión contra un centinela existente;
   comprueba error, fila intacta y ausencia de nueva observación. Aún no lo
   ejecuté ni observé su resultado.
3. **Aislamiento y cierre del lanzador.** Advertí que un timeout de 60 s podía
   ser insuficiente y que matar solo el PID padre podía dejar hijos. También
   señalé la ambigüedad de identificar un proceso hijo después de que el
   padre haya terminado y su PID pueda reutilizarse. El lanzador actual usa
   180 s, detiene el árbol mediante el handle de un proceso propio vivo, y si
   aparece un posible descendiente tras salir Node lo conserva y marca la
   corrida incompleta (`run-inspected.ps1:77-101,125-133`). Registra y compara
   listeners compartidos antes/después. No ejecuté la fixture ni verifiqué
   esas propiedades en una corrida real.

## Límites y gates

- El registro omite `accountId` e identidad, pero su `intentId` permite
  correlación; no es anonimización. No se implementan TTL, borrado de huérfanos
  ni una política aprobada de acceso o retención. La especificación los deja
  pendientes; la nueva escritura y costo de almacenamiento no están medidos.
- `observedAtMs` es el reloj suministrado y no se registra `maxAgeMs`; el dato
  no demuestra por sí solo que se cumplió una política concreta de edad.
  Tampoco prueba reserva legítima, titular actual, generación u orden entre
  Cuenta y Video. Una referencia conservada tras reapertura/recreación no
  autoriza usar un registro viejo. Los casos heredados ya revisados sin
  observación no se reconstruyen. La ocurrencia canónica, inventario y
  migración siguen pendientes.
- `deploy/google-cloud/firestore.rules` niega acceso directo de cliente en el
  archivo local; no se comprobaron reglas, IAM, despliegue ni aislamiento real
  en Google Cloud. No se ejecutó la suite financiera ni se recibieron las
  revisiones externas requeridas.

## Antecedente de la batería financiera 5d949a0

En `C:/Users/rob62/Documents/Codex/2026-11-11/vistavo-alert-confirmed-audit-20261126/outputs/lv019-b-financial-runs/run-aa00f5d2-5b15-47c6-90c2-175f4677c8f3/`,
el resultado registra 521 casos: **516 aprobados, cinco omisiones de voz y
cero fallos**, no 516/516. Duración TAP: 2.265.259 ms. Manifiesto SHA-256
`a81a0491b5da63ab1254ed58ba33ad21da5994a63f7b11ef5b82b2155a714972`, TAP
`c5ebc907b045e789b309054526640e856e60732e622ee27327830854ed62315e` y resultado
`c0fe69501e5b782412eadd436d6336b2227df60a37d7fa6667d4f2638595d559`. Sus 73
archivos congelados aún coincidían con ese worktree al hacer esta lectura.

El runner `scripts/runFinancialRegressionEmulator.mjs` requiere Node 24 y un
Firestore Emulator propio ya en `127.0.0.1:8185`, proyecto
`demo-vistavo-ledger`. Sus dos pasos son `node ... --prepare` y luego
`node ... --run <manifiesto>` con el mismo ejecutable. **No ejecutar en el
8185 actual**, ocupado por un proceso ajeno. Cambiar solo la variable de
entorno a otro puerto falla: el guard, las fixtures y una condición de prueba
del propio backend también lo fijan. Una VM/PC con loopback aislado permite el
mismo puerto; adaptar condiciones para otro puerto cambia los bytes probados y
debe documentarse. La pasada es serial y el guard Node no es firewall del SO.

Distinción de limpieza en el TAP y fuentes de esa revisión:

1. **Fixtures mismas:** se registran totales 56/56 desbloqueo Video, 20/20
   edad, 30/30 bloques, 9/9 sección drenaje, 11/11 control drenaje, 22/22
   UNKNOWN y 24/24 C2a; hay 14 eventos `synthetic-result-cleanup`. A3 y ACK
   comprueban descendientes y contadores en `firestoreA3Exit.emulator.mjs:37-45`
   y `textAccountReserveAckWindow.emulator.mjs:30-38`. Las tres fixtures
   principales usan `financialFixtureSafety.mjs:29-45`. La de Cuenta
   `server/account/unblockAudited.emulator.mjs:13-15` espera un borrado de
   cada raíz UUID, sin lectura posterior ni contador propio.
2. **Inventario externo:** `scripts/inspectFinancialSyntheticRoots.mjs:19`
   comparó únicamente `vistavo_backend_test`, `vistavo_ai_backend_test` y
   `vistavo_ai_integration_test`, vacías antes y después. `cleanups:true`
   refleja esa comparación, no un inventario universal.
3. **Sin comprobar externamente:** inventario previo/posterior de las demás
   colecciones, incluida `vistavo_account_test`, y de otros emuladores. La
   evidencia de limpieza interna descrita arriba sí existe y se conserva; no
   debe sustituirse por una afirmación de inventario completo.

=== RESUMEN FINAL ===
RESULTADO: FALLA
EVIDENCIA: La especificación afirma que todo fallo deja la fila pendiente, pero el caso de ACK descartado prevé failed=1 después del commit; diff y pruebas preparados revisados estáticamente; evidencia previa 516/521 inspeccionada y limpieza desglosada.
NEGATIVOS: No se encontró consumidor de la observación como autoridad; no se usa cuenta ni identidad en el documento nuevo; las pruebas de carrera, ACK y colisión están preparadas pero no ejecutadas por este revisor.
BLOQUEOS: Corregir la contradicción documental y verificar el corte resultante; faltan ejecución de pruebas, batería financiera apropiada, revisiones independientes, definición de acceso/retención y pruebas de identidad y continuidad antes de habilitar. Costo no medido.
=== FIN RESUMEN ===
