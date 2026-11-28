Revisión estática del paquete adjunto. No ejecuté herramientas; no modifico archivos. Cito `server/...` con líneas.

**Defectos materiales**

- **Ventana pedida: incidente nuevo entre la relectura de Cuenta y el commit de Video.** La revalidación vive en `server/commercial/billingUnblock.ts:672-682` (una segunda lectura del recibo de Account), pero la decisión de liberar se toma en la transacción de Video `705-762`, que solo relee Video (`accountRows`/`unresolvedRows`, `741`) y **nunca vuelve a leer Account**. Un incidente que aterrice después de `676` y antes de `705` no se ve: se borra el guard (`755-756`) y se escribe `video_released`/`unblocked` con Cuenta aún bloqueada. El propio código lo admite (`673-675`). No asumo atomicidad entre bases: no hay transacción compartida.

- **Control negativo ausente para esa ventana.** El test `successor stale Account clear` (`billingUnblock.emulator.mjs:2613-2647`) inyecta el incidente **dentro de la primera** llamada a receipt (`receiptCalls===1`, `2632-2635`) y comprueba que la **segunda** lectura lo atrapa (`2639`). Nunca coloca un incidente **después** de la segunda lectura, así que solo demuestra que la revalidación corrige un snapshot viejo, no que la ventana posterior esté cerrada. No hay aserción de que la liberación se rechace con un incidente posterior a `676`.

- **La vía sin seam no tiene revalidación alguna.** `672` exige `seam && acceptedAttemptId`; en el flujo no-seam `acceptedAttemptId` queda `null` (`535`, `569`) y el unblock se hace en `614`. Por tanto la vía `deps.accountBilling.unblock` decide la liberación con una única lectura de Account y sin relectura previa al commit: es la misma ventana, más ancha. Es una asimetría con el comentario `672-675`, que sugiere una revalidación siempre previa.

- **La admisión de proveedor solo consulta el guard de Video.** `server/account/backend.ts:496-497,520` lee `billingHold(guard,…)` y rechaza si `blocked`; no consulta Account. La restricción por proveedor sí se conserva (mismo prefijo de `callKey` y `model`, fence y recibo del primer call revalidados, `507-515`), pero no preserva un bloqueo que Video perdió por la ventana anterior. Nota: la comparación entre proveedores ignora `requestSha256`, así que se admiten varias llamadas por proveedor+modelo; confirmar que es lo deseado.

- **El emulador no puede probar no-atomicidad entre bases.** `fencedDeps` atesta `attestLocalEmulatorPair(c.db, c.db)` (`emulator.mjs:338`): "Video" y "Cuenta" son dos raíces del **mismo** Firestore. Un test no puede reproducir una carrera real entre dos Firestore distintos, y la atestación de par (`attestLocalEmulatorPair`, `201-215`) se satisface trivialmente con la misma base. Por eso `successorOf` (`219`) acepta el seam sin garantía de par real.

- **Autorización externa.** `authorizedBy` solo se valida por patrón (`411`, `52`); la lista blanca/principal autenticado es precondición documentada (`14-16`), no verificada aquí, y el módulo no está cableado a ruta. No puedo comprobar permisos.

- **Corte de escritores no certificado.** `guardBornAfterWriterCut` (`180-185`, usado en `589/599/640`) confía en el documento `verified-writer-cut-v1`; el módulo no prueba que los escritores se cortaran.

- **Superficie test-only.** `runFencedUnblock` y sus wrappers exigen `NODE_ENV==='test'` (`346`); la atestación exige el emulador (`202-204`). La lógica successor/reconcile/confirm se ejercita **solo** bajo test con seam sintético; la vía de producción es el `deps.accountBilling.unblock` legacy.

**Qué demuestra el emulador (y qué no)**

- Demuestra: dedup de claim (parallel, `2238-2266`), no reenvío tras ACK perdido (`2300-2328`), aislamiento de cuenta ajena con saldo/ledger/reserva intactos (`2184-2235`), y que una relectura atrapa un snapshot viejo (`2613-2647`).
- No demuestra: endpoint Account real, IAM, endpoint fenced, corte de escritores, atomicidad entre servicios, ni la ventana posterior a la relectura.

**Fallas sin explicar (no aceptar aún)**

- 17/22 con 3 `conflict` "durante la revisión de otro incidente", 1 identidad ficticia no encontrada y 1 "clase no definida" (posible definición/import faltante en una ruta de test). No vi los otros 18 tests.

**No comprobado:** los 18 tests restantes; la especificación/diseño (semántica de proveedor); la batería financiera completa con esta versión; costo/uso (no observable).

=== RESUMEN FINAL ===
RESULTADO: FALLA
EVIDENCIA: `billingUnblock.ts:672-682` revalida Account con una segunda lectura, pero la transacción de liberación `705-762` solo relee Video (`741`) y borra el guard (`755`) sin releer Account: un incidente entre `676` y `705` no se detecta. `emulator.mjs:2613-2647` inyecta el incidente solo en la primera lectura (`2632-2635`), sin control negativo para la ventana posterior. La vía no-seam no revalida nunca (`672` exige `seam`; `535/569/614`). La admisión (`backend.ts:520`) consulta solo el guard de Video. El emulador usa un único Firestore para ambas raíces (`emulator.mjs:338`), por lo que no reproduce no-atomicidad entre bases.
NEGATIVOS: no pude verificar endpoint Account real, IAM, endpoint fenced, corte de escritores, atomicidad entre servicios, los otros 18 tests ni el diseño; costo no medido (sin herramientas).
BLOQUEOS: foco ampliado 17/22 con 5 fallas sin causa raíz (3 conflict, 1 identidad ficticia, 1 clase no definida); sin batería financiera completa con esta versión; garantías de producción sin acreditar.
=== FIN RESUMEN ===
