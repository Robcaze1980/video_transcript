# LV-007.STAB / LV-017.LOCAL · Estabilidad y cliente privado cloud

13nov2026. Autorización vigente: avanzar sobre diagnóstico500, despacho acotado y conexión de interfaz seleccionados por Rob. Repositorio video_transcript, main c435068 con cambios anteriores conservados. No Cloud SQL, otros productos, publicación funcional ni cambios de presupuesto/comercial. T3 DeepSeek propone y Kimi audita; Gemini Batch revisa candidata final.

## Estado de verificación ·14nov2026

Cierre técnico privado aceptado mediante [nueva revisión independiente tras pérdida de evidencia](../reviews/LV-007-gemini-final-2026-11-14.md) y [aceptación sellada](../../outputs/vistavo-stabilization/gemini-recovery-final-acceptance.json). Se mantienen los criterios y límites de este contrato: el PASS nuevo no restaura la cadena histórica original, que sigue INCONCLUYENTE, ni cierra LV-E55 o gates comerciales. Pruebas nativas y limpieza acreditadas; detalles y seguimientos en [backlog](../../backlog.md). Sin ampliación comercial o publicación.

## 1 · Diagnóstico LV-E55

El500 original104s no conservó excepción SDK: permanece INCONCLUYENTE. Instrumentar etapas e intentos de transacciones relevantes con ID de correlación y tiempos, código numérico/estado categórico, sin mensajes/stack/cuerpos/credenciales/texto. Diferenciar accountForUid, consulta/cotización, reserva durable y despacho. Un timeout posterior al commit no autoriza otra requestKey ni repetir proveedor.

Ensayo nativo aislado en raíz de diagnóstico no observada por Scheduler, sin outbox activo/dispatch/proveedor ni datos de clientes. Repetir claves deterministas, concurrencia entre dos clientes y cuenta caliente/control con evidencia de etapas/intentos. Ningún FAIL anterior se vuelve verde. Sólo atribuir causa si se reproduce con traza; si no, conservar incidente abierto y documentar diagnóstico/mitigaciones probados.

## 2 · Acotar LV-E56

HTTP POST AI confirma reserva/outbox y responde202 sin recorrer pendientes de otras cuentas. DELETE confirma cancelación/UNKNOWN sin esperar purgas. Eliminar nudgeAi global de rutas de usuario: no fire-and-forget después de responder. Scheduler interno existente cada5min recupera y despacha trabajo durable; UI muestra espera de cola. Sin nuevas colas/identidades/IAM ni invocadores públicos.

Mantenimiento debe limitar tamaños de lote, aislar errores por elemento y no perder pendientes por fallo de un vecino. Llamadas externas con cancelación y timeout, ninguna llamada pagada dentro de HTTP ni de callbacks Firestore. Diferenciar límites de cantidad/tiempo de red de transacciones SDK no cancelables: no prometer deadline absoluto del SDK sin evidencia. No cambiar UNKNOWN/captura/conciliación.

Aceptación: enqueue/replay/cancel responde aun si el dispatcher está bloqueado; no inspecciona ni despacha Jobs ajenos; clave repetida conserva Job/reserva únicos; mantenimiento posterior entrega el mismo Job y un fallo no impide otros elementos; límites y acuse ambiguo conservan recuperación durable.

Progreso entre páginas: un lote completo de filas defectuosas tampoco puede ocultar vecinos sanos posteriores. Cursores internos duraderos con orden existente, avance mediante compare-and-set y vuelta acotada al principio permiten recorrerlos sin cambiar vencimientos de archivo, leases de proveedor, cuotas o dinero. Outboxes AI propios ineligibles se posponen sin cerrar estados ambiguos ni lanzar infraestructura. Pruebas con páginas completas de veneno y30outboxes obsoletos deben demostrar progreso en pasadas posteriores.

El progreso probado exige campos de orden válidos (timestamps numéricos finitos con formato esperado). Corrupción del propio campo de orden o del checkpoint requiere reparación explícita del operador y se informa como fallo; no se inventa vencimiento/lease ni se promete recuperación automática de cualquier corrupción administrativa. IDs internos noUUID no deben filtrarse por informes públicos ni impedir adelantar el cursor; nunca autorizan ejecutar al proveedor.

## 3 · Interfaz privada local conectada al estado cloud

API Run sigue INTERNAL_ONLY: un proxy desde PC sin VPC no la alcanza sólo por IAM. Crear candidato loopback separado127.0.0.1:3002, conservando piloto3001 y Hosting. Reutilizar misma lógica firestoreHttp/FirestoreBackend/FirestoreFiles/FirestoreAi/GcsObjects contra vistavo-prod; procesamiento real en Jobs cloud existentes. Esto prueba cliente+adaptadores/estado cloud compartidos, no acceso HTTP externo al servicio Run interno. Puerto3002 es preparación paralela sin promoción a3000 ni sustitución del piloto3001.

Entrypoint local explícito, ADC aislado existente fuera de repo y Firebase Admin verificación de ID token. No relajar guards managed de runtime cloud, no cambiar ADC global, no SAJSON. API sólo loopback, Host/Origin exactos y token Firebase verificado; sin proxy arbitrario y sin CORS permisivo. Config cliente Firebase pública desde archivo externo apropiado; ninguna credencial de servidor al navegador. Cuentas requieren aiPilot/simulationOnly por operador; no autoacreditar ni alterar cuentas/saldos reales.

Pantalla Vistavo con diseño actual: acceso Firebase Google/correo, saldo etiquetado unidades ficticias; seleccionar clip corto español (piloto≤30s), SHA y carga por chunks, validación/cola/estado, ES/ENtxt/srt privados, revisión/guardado de inglés con revisión optimista, Kore/Charon, escuchar/descargar WAV y borrar. Separar del editor SRT avanzado anterior: draft cloud es texto inglés plano, no serializar estilos ni dos pistas dentro de él.

Cliente mantiene requestKey estable por cuenta/input/operación/revisión antes de POST. Tras500/pérdida de respuesta ofrece comprobar misma solicitud, no generar otra. UNKNOWN no ofrece repetir IA. Tokens sólo en Authorization; no URLs/localStorage/logs. Fetch autenticado→Blob para resultados acotados; ObjectURLs revocadas y polling abortado al cambiar cuenta/cerrar sesión. FileObjectURL para previsualización inicial. Persistir sólo IDs de navegación por cuenta, no texto/tokens; reapertura completa de biblioteca/video remoto y editor avanzado queda fuera de este incremento.

## Evidencia y cierre

Hallazgo real de cierre LV-E57: una ejecución femenina terminó exit1 después de confirmar Job/recibo y registrar succeeded; sus resultados válidos no se regeneran. Mantener la ejecución FALLA original. El worker debe detener nuevas renovaciones y esperar la promesa de heartbeat en curso antes de devolver control al cierre del cliente Firestore. Probar carrera retenida/rechazo sin alterar captura, intentos, UNKNOWN ni abortos. Tras corregir sólo ciclo de vida, aceptar una verificación nativa del mismo Job ya terminal con cero llamadas pagadas adicionales, además de regresión controlada de heartbeat: distinguir salida not_claimed/cierre limpio de una nueva generación. No declarar que las tres ejecuciones originales fueron exitosas ni atribuir este cierre a LV-E55.

Política del candidato local: además del control visual, el servidor rechaza cotizar/reservar fuentes mayores de30s y narraciones mayores de600 caracteres o3 fragmentos. Esta política se aplica al entrypoint local no confiable; no cambia el contrato de600s del backend interno ni acredita calidad de videos largos. Rechazar antes de reserva/proveedor; una solicitud ya registrada conserva su replay original.

Pruebas emulador y HTTP/cliente, negativos de cuentas/revisión/timeout/abort/logout/idempotencia y despacho; tipos/suite/builds/instalación. Prueba de navegador y ensayo sintético controlado contra Firestore/GCS/Jobs reales, sin clientes ni pago real, con limpieza de usuarios/archivos/planes/temporales. No repetir proveedores a ciegas ni scripts previos de seed/proof. T3 informes completos y Gemini Batch real, gastos observados separados, HANDOFF/plan/backlog/gantt/bitácora/errorlogs actualizados. Mantener E55 abierto si no se acredita causa. Publicación online, calidad humana/nativa, renderMP4, videos largos, monederos/pagos/restore y Drive conservan gates propios.
