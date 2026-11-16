# LV-007 · Comparación de base de datos para uso pequeño · 13nov2026

## Motivo y frontera

Rob cuestiona el alquiler de Cloud SQL frente al bajo gasto diario de Techos.app. Es una revisión de decisión de arquitectura y costo, no una orden de migrar a Firestore ni de borrar recursos. Cloud SQL, su base, usuarios, secreto y grants todavía no fueron creados. La preparación SQL se limita a lecturas. B1.base existe y tiene27controles PASS; buckets/registro/identidades pueden reutilizarse con cualquiera de las dos opciones. VPC/PSA aún no hospedan SQL; no se eliminan sin indicación específica.

Según la información de Techos aportada por Rob, usa Firestore para metadatos, Functions/Cloud Run para cómputo y Storage/R2 para archivos. No se consultó su factura ni se modificó su repositorio: inferir menor costo por arquitectura de uso no demuestra la causa de cada cargo real.

## Opciones concretas

| Aspecto | Mantener PostgreSQL en Cloud SQL | Adaptar persistencia a Firestore |
|---|---|---|
| Base de datos en reposo | Instancia propuesta ALWAYS,0.035USD/h,25.55USD/730h sólo cómputo; más disco/backups | Cobra operaciones/datos/transferencia; puede quedar dentro de cuotas gratuitas para poco uso, no promesa de factura0 |
| Reutilización | Conserva transacciones SQL, restricciones, locks, esquema y mayor parte de persistencia ya probada | Reescribe persistencia de saldo, compras, UID, proyectos, cuotas, jobs/texto/voz y sus pruebas |
| Protección de dinero | Transacciones/índices únicos/CHECK actuales; gates de nube todavía pendientes | Transacciones Firestore y documentos de idempotencia de IDs estables; ningún proveedor o archivo como side effect dentro del callback, que puede repetirse |
| Videos y MP4 | GCS privado y workers de cómputo aparte | GCS privado y workers de cómputo aparte; nunca videos grandes dentro de documentos |
| Login | Firebase Auth existente | Mismo Firebase Auth existente; no exige rehacer Google login por cambiar persistencia |
| Concurrencia/retención | Revalidar leases/fencing/UNKNOWN, cuerdas de borrado y restore en cloud | Rediseñar reclamo atómico, fencing/UNKNOWN y outbox durable; TTL nativo no cumple borrado exacto al vencer |
| Operación | Mantener SQL y backups; ensayo shared-core sin SLA, producción requiere tamaño apropiado | Índices/reglas/IAM/backups y contención; cuotas gratuitas no cubren todo ni eliminan cargos de cómputo/video/IA |

## Candidato Firestore si Rob lo elige

1. Mantener Firebase Auth/Hosting y buckets privados ya existentes. Registrar una decisión nueva en plan y backlog antes de portar persistencia; conservar PostgreSQL local como referencia y rollback, sin doble escritura improvisada.
2. Prototipo local/emulador de ledger: compra duplicada, reserva concurrente, captura/liberación única, requestKey igual con payload distinto, UNKNOWN sin retry y aislamiento de cuentas. Reintentar callback de transacción no repite proveedor. Probar contra los mismos criterios, no contar los325tests PostgreSQL como cobertura Firestore.
3. Sólo si ese gate pasa, portar proyectos y metadatos, después cola/leases/texto/voz/retención. Agregar generación/tombstones GCS; expiración se verifica antes de autorizar y por worker de limpieza, no se delega todo a TTL.
4. Candidata privada con Firebase real, reinicio, recuperación, medición de lecturas/escrituras/índices/cómputo/IA y restore. Conservar pruebas humanas PC/Pixel, Google, pagos, voz/render, Drive y publicación.

Ningún cambio a Firestore se declara trivial, inmediato, de costo total0 ni equivalente a cambiar una variable de conexión. No se estiman días sin prototipo. La elección depende de aceptar mayor adaptación inicial a cambio de evitar una instancia SQL fija; sigue reservada a Rob.

## Fuentes oficiales verificadas13nov

- Cloud SQL https://cloud.google.com/sql/pricing : g1-small0.035USD/h; el producto factura cómputo/almacenamiento/otros componentes.
- Firestore Standard https://firebase.google.com/docs/firestore/pricing : cobro por operaciones, índices, datos y transferencia; una base con cuota gratuita por proyecto,50klecturas/20kescrituras/20kborrados diarios y1GiB según la documentación Core Standard consultada. TTL/PITR/backups/restore no tienen esa gratuidad. No mezclar cifras de write-units de otras ediciones.
- Transacciones https://firebase.google.com/docs/firestore/manage-data/transactions : callback puede repetirse por conflicto y lecturas preceden escrituras.
- TTL https://firebase.google.com/docs/firestore/ttl : eliminación no instantánea; generalmente dentro de24h después de vencer y no elimina automáticamente subcolecciones.

Este documento compara el componente base de datos. Cloud Run/Functions, almacenamiento/operaciones/transferencia, IA/transcripción/traducción/voz y monitoreo siguen siendo cargos aparte en ambas rutas. Falta medida de consumo real de Vistavo y de respaldo/restore; no inventar costo mensual total.


## Informe nuevo de Techos y ensayo local

Rob aportó el informe de solo lectura de Techos13nov:Firestore confirmado, Functions/Run sin mínimos positivos observados, Scheduler y almacenamiento/secretos/artefactos con cargos posibles aun sin usuarios. No se obtuvo factura; API SQLdeshabilitada impidió inventario completo de SQL enTechos. Es evidencia aportada por su otroLLM, no inspección independiente de Codex ni autorización para modificar ese proyecto. En Vistavo SQLAPIestá habilitada y el listado200completo está vacío: no confundir ambos proyectos.

Inventario AST seleccionado:212 llamadas query en7clases; no es todo el repositorio ni estimación de horas. Pruebas actualesPostgreSQL325/44archivos,0omitidos, T3/GeminiPASSlocal. PrototipoFirestore aislado:primera batería18PASS; Kimi detectó sibling ya encolado que podía arrancar durante UNKNOWN. Se reprodujo con la prueba nueva, se añadió guarda en claim después de TTL y la batería completa pasó19/19sinomisiones. Resultado provisional de código local, aún pendiente cierreGemini; no es backend migrado.

El piloto actual pregunta por trabajo cada250ms:4veces/segundo o345600ciclos/día/instancia, no lecturas facturadas. Su nube requiere activación por eventos/outbox/dispatch y limpieza propia en ambas rutas; no copiar ese sondeo aFirestore.

Recomendación actual de Codex para la prioridad expresada porRob: valorar adaptaciónFirestore porfases para evitar la instanciaSQLfija, conservando PGlocal como referencia. Decisión remota/cutover sigue en Rob. El ensayo permite evaluar consistencia inicial, no demuestra ahorro total ni capacidad/costo productivos. LoginFirebase/Hosting permanecen y el video iráenGCS con workersFFmpeg bajo demanda.
