# LV-019.B · Cola de testigos: experimento aislado

Experimento sintético en Firestore Emulator, separado del backend y desactivado al abrir cada cliente. No llama Cuenta ni proveedores, no usa dinero y no ejecuta un scheduler. No acepta como cliente una instancia Firestore proporcionada por el llamador. Solo admite el proyecto `demo-vistavo-ledger`, `127.0.0.1:8185` y una raíz aleatoria marcada como sintética.

El archivo [witnessRecoveryQueueFixture.mjs](../../server/commercial/witnessRecoveryQueueFixture.mjs) y sus [pruebas](../../server/commercial/witnessRecoveryQueueFixture.emulator.mjs) se conservan en el repositorio para poder repetir el experimento desde otra PC. La ejecución independiente de Codex pasó **16/16**, sin omisiones, con Node 24 y Firestore Emulator; salida en `outputs/lv-witness-queue-local-20261118-012245-c76e2bbb/test-run-06-repository.tap`. La fuente revisada tiene SHA-256 `63124cb64fb97e22ffc04a7175302fd549badded1c01d00c6fdeeb5776e18b31`.

Las pruebas abarcan creación conjunta simulada del testigo y tarea, repetición sin reinicio, hash de intención/acción igual al esquema real, corrupción, dos clientes en un proceso, vencimiento de turno y rechazo de respuesta obsoleta, límites numéricos e incidencias sintéticas para `unverified`, `captured` y 404 repetido. Cinco intentos es exclusivamente un umbral del experimento. La incidencia se escribe en el emulador en la misma transacción que el cambio de tarea; no se verificó persistencia del emulador al reiniciar.

GLM Flash mediante T3 revisó estáticamente el prototipo y dio PASS limitado, sin ejecutar pruebas; [informe inicial](LV-019-B-cola-testigos-fixture-GLM-flash-T3-2026-11-17.txt) y [rectificación](LV-019-B-cola-testigos-fixture-GLM-flash-seguimiento-T3-2026-11-17.txt). El primer informe afirmó que una consulta numérica incluía `null`; Codex lo contrastó con dos documentos sintéticos en el emulador y la consulta solo devolvió el documento numérico. El revisor retiró esa afirmación. La observación del emulador no acredita el comportamiento de producción. El selector también puede detenerse ante una fila corrupta que sí alcanza; los documentos sin el campo consultado pueden permanecer invisibles.

**Aún falta:** crear la tarea en el método real, completar el contrato de estados, conectar la recuperación puntual, reintentar `reserved` y errores de transporte, conservar y conciliar confirmaciones tardías auténticas, barrer testigos antiguos, cursor, barreras, reinicio, más de 100 filas, equidad, reloj/skew, índices y scheduler autenticado. El resultado sintético no prueba identidad, saldo real, aislamiento cloud ni capacidad de producción.

## Repetición en Windows

Con Node 24 y el Firestore Emulator propio de Vistavo ya disponible en `127.0.0.1:8185`, desde la raíz del repositorio:

```powershell
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8185'
$env:LV_WITNESS_QUEUE_EMULATOR_ONLY = '1'
$env:NODE_ENV = 'test'
node --no-network-family-autoselection --test server/commercial/witnessRecoveryQueueFixture.emulator.mjs
```

Las pruebas crean y eliminan únicamente sus raíces aleatorias marcadas. No arrancan ni detienen el emulador y fallan cerradas si detectan credenciales de aplicación o marcadores de ejecución cloud.
