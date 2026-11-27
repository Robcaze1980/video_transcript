# LV-019.B · Continuidad con bloqueo financiero: diagnóstico

**26 nov 2026 · Diagnóstico local, no implementación ni aceptación.** La rama parte de `aecd5aae8a56c810511dd945d8e4083a8a110047`. No se modificó código de producción. Las dos contrapruebas originales que exigen impedir nuevas admisiones tras una devolución vencida siguen rojas. La alerta no se usó para atribuir un titular. Este experimento estudia el guard **financiero** existente para determinar si puede servir para el requisito de una restricción solo de entrada; no lo puede sustituir.

## Resultados

En un emulador Firestore 1.21.0 dedicado, con dos raíces separadas de Video y Cuenta y dos cuentas ficticias por raíz, pasaron las cuatro caracterizaciones del [TAP](emulator-tests.tap). Cada caso creó y limpió su propia pareja de raíces; la comprobación final registró **4/4** limpiezas. El transporte de Cuenta fue local y llamó a `AccountStore`; no se llamó a un proveedor real.

1. Para un trabajo externo de A ya admitido, la guarda financiera de Video impidió avanzar desde la comprobación local previa al proveedor e impidió obtener la solicitud anterior por `priorExternalRequestForEnqueue`. Una solicitud nueva de A no envió otra reserva. B pudo crear y avanzar su trabajo. Una reserva independiente de A se liberó directamente en Cuenta una vez, mientras el evento de hold de Video todavía no se había aplicado. Esta liberación directa no es la reparación integrada de la fila en revisión.
2. Para otro trabajo de A, Cuenta ya había admitido una llamada y el ensayo creó un recibo de proveedor **sintético**. Tras aplicar el guard financiero de Video, `completeNoSpeech` terminó el trabajo en Video una sola vez y dejó una devolución pendiente. El drenador de Video **no envió esa devolución**, aunque aún no había hold en Cuenta. Un trabajo de B se canceló y su devolución sí se asentó una vez. Por tanto, evitar el hold remoto no basta para que el drenador liquide bajo el guard financiero actual.
3. Como contraprueba, una observación sintética contradictoria sobre **la misma reserva** produjo `capture_before_success`, mantuvo el guard y la revisión y no envió una devolución de A. B se liquidó. La prueba preserva el caso en que una reserva incierta no debe liberarse por conveniencia.
4. Un hold de Cuenta impidió la devolución de A. La lectura y la operación de B continuaron. El desbloqueo auditado **directo en AccountStore**, con incidente y generación de guard sintéticos, permitió después dos liberaciones concurrentes de la misma reserva: una asentó y la otra devolvió el recibo; hubo un único movimiento y saldos correctos. Esta prueba no demuestra que el desbloqueo coordinado de Video y Cuenta esté resuelto.

El [diagnóstico en memoria completo](memory-diagnostic.tap) conserva **10 controles aprobados y dos rojos**, sin omisiones. Los rojos son las mismas dos expectativas de veto aún sin implementar. De los nuevos controles, uno termina una operación **simulada** ya invocando; no demuestra finalización exitosa de un video externo real. Los otros separan liquidaciones directas en Cuenta de la aplicación posterior de un hold. El doble de Firestore en memoria no demuestra exclusión transaccional ni concurrencia.

## Por qué no se cambió el guard financiero

`validExternalBillingOutbox` deniega la salida cuando existe el guard financiero ([código](../../../server/commercial/firestoreAi.ts#L417)); los pasos externos de procesamiento también lo consultan ([código](../../../server/commercial/firestoreBackend.ts#L1049)). El guard conserva la época y los últimos identificadores, no una demostración canónica de que **todos** los incidentes activos permiten disponer de una reserva distinta. En Cuenta, un hold bloquea disposiciones nuevas y puede confirmarse mientras otra operación está en tránsito. El vínculo local de trabajo/solicitud/intención y la instantánea de catorce documentos son necesarios, pero no acreditan por sí solos la titularidad histórica y su vigencia entre las dos bases, ni autorizan ignorar un hold o una divergencia.

No es seguro quitar el chequeo existente para que la caracterización 2 produzca una devolución: también se debilitaría la protección de la caracterización 3. La política vigente reserva una operación específica para resolver una reserva bajo hold, con permisos y comprobación de todos los holds aplicables; esa operación y el cierre de generación frente a escritores tardíos siguen sin implementarse. [Contrato](../../specs/LV-019-B-admision-video-devolucion-vencida.md).

## Pieza mínima y autoridad faltante

El cambio funcional mínimo propuesto es una **guarda distinta, solo para nuevas admisiones**, conservando separadamente el guard financiero. Las transacciones que preparan la intención y el intento, y la que crea solicitud/trabajo, deben leer el mismo guard de entrada; una lectura o repetición exacta de un trabajo ya verificado debe distinguirse de una admisión nueva, respetando la autorización y el contrato de la ruta. Esa guarda no debe impedir pasos ni liquidaciones ya autorizados. Si un POST de reserva ya estaba autorizado cuando aparece, su ACK debe conservarse y conciliarse sin repetir una solicitud incierta. Los holds financieros independientes y sus reglas actuales permanecen en vigor.

El alta de esa guarda todavía carece de autoridad indispensable: una ocurrencia durable que distinga una devolución vencida de una reserva inicial, un recibo de Cuenta que vincule la reserva y la operación autorizada a su titular y generación originales, y un protocolo que ordene la revocación/reasignación con el commit de Video. El dato `accountId` de una alerta es solo una pista; las historias A→B→A y una revocación posterior a una lectura no son distinguibles por las consultas actuales. La igualdad actual de marcas de documentos tampoco demuestra continuidad histórica si todos se recrean coordinadamente: véase la prueba independiente `AISLAMIENTO-SEGUIMIENTO.md` de `codex/vistavo-firestore-metadata-isolation-20261126`.

Sin esas constancias, activar una guarda dirigida podría bloquear a B; usar solo las filas actuales podría además confundir una reserva con una devolución. La incidencia debe seguir sin atribuir y los dos rojos permanecen abiertos. Falta probar con las futuras autoridades las carreras de alta contra envío/admisión, replays, trabajo en curso, devolución, resolución idempotente, identidad A→B→A, legado y caída. También faltan regresión financiera sobre la candidata integrada y revisiones independientes GLM y DeepSeek. No se hizo ninguna de ellas en esta rama.

## Ejecución y límites

- Node 24.22.3, JDK 24 y Firestore Emulator 1.21.0; dependencias instaladas en el worktree con `npm ci --ignore-scripts` (npm usó Node 22 y mostró avisos de motor; las pruebas usaron Node 24). El emulador se inició con `--host 127.0.0.1 --port 8197 --websocket_port 9197 --project_id demo-vistavo-admission` y las reglas locales de solo denegación. Su proceso se detuvo al terminar y se comprobó que los puertos observados quedaron libres. Las instancias existentes de 8185 y 8186 conservaron sus PID en las dos observaciones.
- Los diagnósticos Node usaron un perfil vacío, sin credenciales y con el [guard de red](network-guard.cjs), derivado de `scripts/financialEmulatorNetworkGuard.cjs` cambiando exclusivamente puerto y proyecto. La copia entregada elimina una línea en blanco final de la copia ejecutada; se comparó el texto restante. La copia ejecutada tiene SHA-256 `13676df8953e02297b38953b7cf5715215d3c454efee543f42f78240f1112089`. Su autocomprobación pasó y la fixture verificó el proyecto, host y marcador de cada raíz antes de escribir o limpiar. El guard de Node no es un cortafuegos para Java, `esbuild`, módulos nativos ni otros procesos. El [inventario de escuchas](listeners-before-stop.txt) se tomó después de las pruebas: las cuatro escuchas observadas pertenecían al emulador y eran loopback. No se inspeccionaron los puertos internos antes de iniciar la prueba.
- Las cuatro suites unitarias relacionadas (`billingPendingAlerts`, `billingPendingReport`, `firestoreBlocksA` y `reserveAttemptEvidence`) dieron **91/91** en el ambiente normal del shell; no se ejecutaron bajo el guard anterior. [Salida](unit-tests.log).
- El [log del emulador](emulator.log) conserva ocho avisos de `Transaction lock timeout` durante las ejecuciones acumuladas. Las pruebas y limpiezas terminaron con éxito; no se determinó la causa de esos avisos. Las copias de ambos logs omiten solo líneas vacías al final; los originales conservan sus bytes en `outputs/admission-isolated/` local, que Git ignora. Sus SHA-256 originales son `13f828bc63e8cce54351618509b88c146cee6058dbcf7d13e9fb68d95bb0647a` para el emulador y `d87886081be0373ba6596acd4a441ad72fe77430ed8c46e82c41f06236ee8216` para las pruebas unitarias. Los TAP de las ejecuciones intermedias también quedan en esa carpeta local.
- El código ejercitado es interno; la entrada HTTP externa sigue cerrada. No se probó un teléfono, medio real, IA, IAM, nube, ni entrega real de una llamada de proveedor. No hay cambio de permisos, gasto, despliegue ni datos de clientes.

Para repetir, iniciar por separado un emulador demo con ese proyecto, host y puerto, asegurándose de que los puertos sean propios y estén libres. Ejecutar desde la raíz con Node 24 y ambiente aislado (`NODE_ENV=test`, `FIRESTORE_EMULATOR_HOST=127.0.0.1:8197`, `GOOGLE_CLOUD_PROJECT=GCLOUD_PROJECT=demo-vistavo-admission`, `METADATA_SERVER_DETECTION=none`, `LV_REVIEW_CONTRACT=LV_FINANCIAL_REGRESSION=1`), perfil vacío en `outputs/admission-isolated/profile` y sin credenciales ni `NODE_OPTIONS`:

```powershell
node --no-network-family-autoselection --require ./docs/evidence/lv019-b-entry-continuity-20261126/network-guard.cjs --import tsx --test --test-concurrency=1 --test-reporter=tap server/commercial/overdueEntryContinuity.diagnostic.emulator.mjs
node --no-network-family-autoselection --require ./docs/evidence/lv019-b-entry-continuity-20261126/network-guard.cjs --import tsx --test --test-concurrency=1 --test-reporter=tap server/commercial/overdueReleaseEntry.diagnostic.mjs
```

El segundo comando termina con código 1 mientras los dos requisitos en rojo sigan abiertos. No volver a enviar una operación real basándose en este diagnóstico.

| Copia local de evidencia | SHA-256 |
| --- | --- |
| `emulator-tests.tap` | `ee75a79197ed6e9575e6e5bc2cd43186af26c375b78aa70336c73ac00e4bd197` |
| `memory-diagnostic.tap` | `72a771f7bdab4e8fa2726d3bbe461e6c1a21344b494e7a46e68059616119952e` |
| `emulator.log` | `3bd176ca7466e75cb8d6342a8c3c51eccd7cbc58dfc98e818772d4ee40912004` |
| `network-guard.cjs` | `caf601fbbb23404665be64d1a3292c3957f140893804f45e061dafd1c5e1dd28` |
| `unit-tests.log` | `98dbdb394b45503442c6b1e5668665ab59fdeccee97a1abe57e56ab5847298f4` |

Costo y tokens: **no medido**. Sin T3 ni consultas a proveedores.
