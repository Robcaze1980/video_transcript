# LV-007 · Adaptación aprobada a Firestore y ejecución bajo demanda

Rob aprobó el 13 de noviembre de 2026 adaptar el backend a Firestore, con T3 y revisión Gemini. Cloud SQL queda expresamente excluido. Esta decisión sustituye la elección pendiente y las fases futuras SQL de los documentos anteriores; no autoriza eliminar recursos existentes ni publicar funciones sin sus gates.

Firebase Authentication conserva la identidad. El servidor verifica el ID token y usa su UID, nunca un accountId suministrado por el cliente. Firestore guarda cuentas, saldo, recibos únicos, proyectos versionados, reservas, trabajos y outbox. Cloud Storage privado conserva bytes; Firestore no almacena videos. Cloud Run ejecuta API y workers bajo demanda; no se porta el polling de 250 ms del piloto.

## Fases encadenadas

1. Repositorio Firestore operativo: UID estable, saldo entero, capturas verificadas una vez, proyectos con revisión optimista, reservas y outbox atómicos. Mantener PostgreSQL como piloto/referencia, sin migración silenciosa.
2. Despacho durable y worker: entrega al menos una vez, claim con fencing, incertidumbre UNKNOWN sin reejecutar proveedor, reconciliación interna y recuperación tras acuse perdido. Ninguna llamada externa dentro de un callback transaccional.
3. GCS: carga/commit/checksum/generación, autorización por cuenta, cuota y tombstones, descargas con TTL, purga idempotente. No simular filesystem POSIX sobre objetos.
4. API Firebase y pipeline: entrypoint cloud separado, contratos de editor y TXT/SRT/voz; autenticación, cancelación y publicación de artefactos consistentes con saldo. Activar únicamente servicios/capacidades demostradas.
5. Candidata privada: pruebas con dos cuentas, reinicios, concurrencia, duplicados, caducidad, cancelación, incertidumbre y restauración; tipos, suite y ambas compilaciones. Revisión independiente T3 y Gemini batch sobre fuentes y evidencia exactas.

## Invariantes y aceptación

- available + reserved + consumed = credited; enteros seguros no negativos. Un trabajo tiene un único movimiento terminal: captura o liberación.
- El servidor calcula el precio y verifica captura/importe/moneda/comercio; un endpoint cliente nunca puede acreditar saldo ni declarar un resultado remoto verificado.
- UID y recibos tienen claves deterministas; requestKey repetido exige el mismo payload. IDs de intentos se generan antes de callbacks repetibles.
- Proyecto: propietario obligatorio, contenido acotado, expectedRevision en cada modificación; conflicto conserva la versión almacenada.
- Reserva y evento de despacho se confirman juntos. Un evento sin acuse puede repetirse; el worker reclama el trabajo una vez. Timeout tras invocar proveedor conserva reserva y evidencia UNKNOWN.
- UNKNOWN bloquea todos los hermanos del mismo input hasta reconciliar. Bytes caducados no producen una entrega cobrable; limpieza física y retención son pruebas separadas.
- Reglas cliente inicialmente deniegan acceso directo; Admin exige autorización explícita de API e IAM mínimo. Un PASS de modelos sin herramientas no demuestra login, reglas, despliegue ni proveedor real.

La aprobación de esta adaptación no cierra Drive, calidad humana, pagos live, publicación ni recuperación cloud. No se presenta el ensayo ledger anterior como backend integrado. Costos por uso se medirán; no se promete gratuidad ni un total mensual fijo.

## Política de ejecución y alcance de la primera integración

El nuevo núcleo distingue `not_started` de `invoking`. Un lease abandonado antes de autorizar la llamada se puede reencolar con un intento nuevo; el anterior queda invalidado. Después de autorizar la llamada, cualquier incertidumbre conserva reserva, intento y hash en UNKNOWN. Una cancelación anterior a la invocación puede liberar; posterior a ella conserva la incertidumbre.

UNKNOWN bloquea reserva, claim, heartbeat que autorice trabajo adicional y finalización automática de hermanos que ya estaban running. Los resultados verificados se reconcilian internamente por trabajo, como en el núcleo PostgreSQL: la resolución de uno no habilita nuevas ejecuciones mientras quede otro UNKNOWN. No se exige desechar una evidencia definitiva de un trabajo porque exista otro ambiguo; esto no autoriza repetir proveedores ni publicar resultados desde el cliente.

La API de esta primera integración es una candidata local bajo `/api/cloud`, separada del piloto y todavía sin conectar a la SPA pública. Verifica Firebase mediante un verificador inyectable; las pruebas HTTP usan identidades sintéticas, no acreditan Google login real. El entrypoint hospedado exige identidad administrada y rechaza archivos de credenciales en variables y emuladores heredados. Procesamiento HTTP queda 503 hasta integrar cotización ligada al snapshot, GCS, proveedor y artefactos. Las funciones de ledger que acreditan o reconcilian son internas, sin rutas cliente.

Outbox conserva redelivery hasta el claim, no sólo hasta la aceptación del transporte. Un dispatcher de una sola ejecución también recupera leases; su despliegue IAM/Scheduler sigue siendo un gate. El transporte Cloud Run Jobs tiene destino fijo de proyecto/región e identidades de trabajo, sin video ni transcripción en las variables de ejecución. Configurar `maxRetries: 0` al desplegar; el recuperador de dominio decide la recuperación segura.

Restauración: suspender dispatcher/worker antes y después de restaurar. No reanudar automáticamente trabajos no terminales recuperados desde una copia antigua: el proveedor externo no retrocede con Firestore. La futura prueba de restore debe demostrar ese aislamiento y reconciliar las operaciones externas antes de habilitar despacho.

Pruebas reproducibles: Firebase CLI 15.19.1, Java 24 y emulador oficial 1.21.0; `npm run emulator:firestore` y, en otra terminal con `FIRESTORE_EMULATOR_HOST=127.0.0.1:8185`, `npm run test:firestore`. La suite falla si no está el emulador dedicado; no omite casos y no usa credenciales cloud. `npm test` mantiene por separado la regresión PostgreSQL.

Fuentes de contrato: [transacciones Firestore](https://firebase.google.com/docs/firestore/manage-data/transactions), [ejecución de Cloud Run Jobs](https://docs.cloud.google.com/run/docs/execute/jobs) y [creación de bases Firestore](https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases/create). Ninguna de estas fuentes sustituye una prueba real de permisos, ejecución o facturación.

## Incidente de transporte detectado después de la primera revisión Gemini

Una nueva corrida completa gRPC obtuvo 39/40: la carrera cancelación/finalización volvió a devolver código3, `Transaction is invalid or closed`. El orden cuenta primero no resolvió de forma concluyente el incidente. Se conserva el PASS estático anterior con sus hashes y logs40; no se aplica retroactivamente a esta corrida ni a cambios posteriores.

El [reporte upstream9693](https://github.com/googleapis/google-cloud-node/issues/9693) describe pérdida de un ABORTED de lectura mediante reintentos de transporte sobre una transacción cerrada. Es una hipótesis compatible, no prueba de la secuencia RPC inicial local ni de comportamiento en producción. No se adopta su parche privado ni se amplía retry de INVALID_ARGUMENT. Tampoco se habilita globalmente `gaxServerStreamingRetries`: el reporte recoge un negativo de documentos duplicados en consultas parciales.

Se evalúa `preferRest`, opción pública del [Admin SDK](https://firebase.google.com/docs/reference/admin/node/firebase-admin.firestore.firestoresettings), manteniendo Firestore y sus transacciones. La API no usa listeners; no añadir `onSnapshot` al cliente servidor porque podría cambiar todo el cliente a gRPC. Antes de adoptar: suite completa, estrés de carreras y negativos de consulta/error de transporte; T3 independiente y nueva revisión Gemini sobre la versión y evidencia exactas. No desplegar con este gate sin resolver.

La matriz posterior está ejecutada: **52/52**, cero omisiones, con REST por defecto y `initializeFirestore(app,{preferRest:true})` en la factoría hospedada; 100 carreras con dos clientes SDK independientes, rollback real más ABORTED inyectado, preservación de códigos3/7, interrupción de consulta/batch, HTTP503 transitorio, errores de consultas de recuperación y acuses perdidos después de commits reales. Un control gRPC limitado a20 reprodujo código3 en la carrera2; no se continuó hasta obtener verde. La regresión general añade siete guardas de entorno: **332/45**, tipos y dos builds. Se solicita una segunda revisión Gemini; el primer PASS sigue ligado exclusivamente a su snapshot anterior.

La pérdida de un acuse de commit también puede devolver código3 bajo REST. La mitigación no equivale a eliminar ese código: las pruebas demuestran recibo/reserva únicos tras replay y lectura del estado durable al finalizar, sin ampliar sus reintentos ni volver a invocar el proveedor. Las consultas interrumpidas pueden fallar explícitamente; nunca se aceptan resultados exitosos incompletos o duplicados. La inferencia admisible se limita a esta matriz local, no a producción ni a resolver el issue upstream.

Antes de pagos reales: separar namespaces/ledgers Sandbox y live, ligar entorno al runtime y verificar captura/catálogo en servidor. No hay ninguna ruta cliente de acreditación ahora. Antes de publicar: demostrar identidad administrada e IAM mínimos en Cloud Run; rechazar variables de credenciales no demuestra por sí solo el origen real de ADC. Esos gates siguen abiertos.
