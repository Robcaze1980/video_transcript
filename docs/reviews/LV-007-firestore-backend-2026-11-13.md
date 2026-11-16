# LV-007 · Núcleo Firestore y ejecución bajo demanda: avance local verificado

Rob aprobó la adaptación a Firestore con T3/Gemini y excluyó Cloud SQL. Esta entrega implementa el primer núcleo real de aplicación, separado del experimento ledger y del piloto PostgreSQL. No es todavía el backend completo ni está conectado a la web pública.

## Qué cambió

- Cuenta estable por UID verificado de Firebase; saldo entero, recibos únicos, reservas y un movimiento terminal por trabajo.
- Proyectos con propietario, revisión optimista y snapshot guardado con la reserva. Una edición posterior no altera el trabajo en curso.
- Outbox creado atómicamente con reserva/trabajo; dispatcher de una ejecución y transporte Cloud Run Jobs con destino fijo. No se porta el polling residente del piloto.
- Worker con fencing, heartbeat y permiso durable not_started→invoking. Crash anterior a la invocación puede recuperarse; después de autorizar proveedor, incertidumbre conserva reserva, intento y hash en UNKNOWN. Los hermanos no ejecutan ni capturan automáticamente mientras haya UNKNOWN.
- API candidata /api/cloud independiente: token con revocación y correo verificado, propietario derivado del UID, cuerpos acotados, DTO sin fencing ni rutas cliente de crédito/reconciliación. Procesamiento permanece503 hasta integrar GCS, cotización y proveedores.
- Reglas cliente deny-all, índices declarados y pruebas reproducibles versionadas. Runtime candidato usa la opción pública initializeFirestore(app,{preferRest:true}); rechaza proyectos ajenos, emuladores heredados y variables de archivos de credenciales. Identidad administrada real e IAM siguen por demostrar en cloud.

## Verificación ejecutada por Codex

| Evidencia | Resultado | Límite |
|---|---|---|
| Suite emulador oficial | 52/52, cero omisiones:41núcleo+11transporte | No equivale a pruebas de nube/proveedor/pagos reales |
| Carrera de finalización/cancelación | 100 casos prefijados, dos clientes SDK independientes | Un terminal por trabajo, invariantes conservadas |
| Fallos de transporte inyectados | ABORTED con rollback real; códigos3/7; consultas parciales y503 | Respuestas completas/únicas o error explícito, sin ocultar permisos o solicitudes inválidas |
| Commits reales con respuesta perdida | Crédito/reserva únicos; begin/finish sin segunda invocación | Se conserva el diagnóstico código3, también posible bajo REST |
| Regresión general | 332/45:325anteriores+7guardas de runtime; cero omisiones | Separada de los52casos de emulador |
| Instalación/tipos/builds | npm ci348, audit0conocidas; tipos y dos compilaciones correctos | No acredita despliegue funcional |

Resultados, comandos/scripts, logs y hashes: outputs/vistavo-firestore-backend/{acceptance.json,gemini-rest-snapshot.json,tests-rest-final.log,full-check-rest/check-results.json}. Node24.13.0, SDKFirestore9.4.1, Java24, CLI15.19.1 y emulador1.21.0. Suite reproducible: npm run emulator:firestore y, con FIRESTORE_EMULATOR_HOST=127.0.0.1:8185, npm run test:firestore.

## Incidente encontrado y contraste T3/Gemini

Las revisiones se hicieron sin herramientas externas. Codex implementó y ejecutó los controles; los modelos revisaron fuentes y evidencia. Se preservan dictámenes y generaciones, sin verdes retroactivos:

| Ronda | DeepSeek | Kimi | Gemini |
|---|---|---|---|
| Diseño | INCONCLUYENTE | FALLA | — |
| Candidata intermedia, log29/fuente32 | INCONCLUYENTE | FALLA | — |
| Núcleo corregido40 | — | — | PASS local sobre su snapshot |
| Reapertura por transporte | INCONCLUYENTE | FALLA | — |
| Matriz REST final52 | — | — | PASS local sobre fuentes/logs exactos |

Se adoptaron sus correcciones de fases, fencing, cuarentena de hermanos running, estado real tras reembolso/acuse perdido, snapshots tipados, replay antes de cotizar, DTO y semántica de cancelación. Sus gates GCS/proveedor/IAM/restore siguen abiertos.

Una corrida gRPC posterior al primer PASS volvió a fallar39/40 con Transaction is invalid or closed. El orden cuenta primero no resolvió concluyentemente el incidente. El control gRPC, limitado a20, reprodujo código3 en la carrera2 y se detuvo. El [issue upstream9693](https://github.com/googleapis/google-cloud-node/issues/9693) es una hipótesis compatible; no se capturó la secuencia RPC inicial local ni se demuestra causalidad o comportamiento en producción.

Se adoptó preferRest como mitigación para esta matriz, sin parche SDK, sin retry genérico de código3 ni gaxServerStreamingRetries global. REST tampoco elimina los acuses ambiguos: el faultserver comprobó commits aplicados y respuestas cortadas; crédito/reserva reportaron código3 y el replay conservó un único efecto. Worker consulta el estado durable también tras finishfalse/catch. No se repitió hasta verde el control negativo.

Primer batch histórico: batch-1794608027-BT54FRyNB7pQdbj4IGXb. Final: batch-1794610269-epEVVKC3qJCXRJpVKDcQ, Google/google/gemini-4-hydrogen-20261112. [Informe final completo](LV-007-gemini-firestore-rest-2026-11-13.md). El contador accepted mide aceptación del transporte, no acuses persistidos. La mención externa de UUIDv4 no implica validar bits de versión: el código valida formato UUID y genera sus IDs con randomUUID.

## Estado remoto, coste y siguiente paso

Sonda de sólo lectura: SQL list200/0, APIFirestore DISABLED, listado de bases403; ese403 no demuestra ausencia. Esta fase no creó recursos, grants, claves o bases cloud; B1.base anterior permanece. No modificó Hosting, DNS, Auth, ADC global, Techos ni ROBATO. Piloto3001 sigueHTTP200; sin commit/push. La elección SQL y sus roles/secretos futuros quedaron retirados del plan, conservando historial y VPC/PSA existentes.

Ocho respuestas medidas de T3/Gemini: **337008 tokens; US$0.92317678049** de usage.cost. Cuatro solicitudes candidate sin respuesta/generación/usage observable se registran como no medido, no cero. Sin topes locales; factura, Google y Codex no medidos. Fases anteriores excluidas; accounting.json y SESSION_COSTS.md conservan detalle.

Siguiente fase autorizada: GCS privado con generación/hash/cupo/tombstone, sin borrar metadata financiera necesaria para UNKNOWN; Firestore cloud, reglas/índices e IAM mínimos; dispatcher/worker privados y recuperación programada; cotización ligada a snapshot/generación y una operación real de texto con artefacto verificable. Después traducción y voces. Antes de cobrar: separar Sandbox/live y verificar capturas en servidor. Antes de publicar: loginPC/Pixel, restore sin replay, maxRetries0, calidad humana, Drive y gates comerciales. No se necesita otra aprobación rutinaria de arquitectura para continuar la ruta ya aprobada.
