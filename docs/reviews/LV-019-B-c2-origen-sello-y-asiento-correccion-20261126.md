# Cuenta v3 · Protección del sello y del asiento de reserva
**Candidata local para auditoría independiente.** Se parte de a616a5dd15995935396ca335b60a1e9938fd2ee9, que conserva los dos rojos y los inventarios anteriores. El primer cambio evita que el sello tome una reserva operativa desaparecida por un ID nunca utilizado. El segundo exige el asiento original al repetir una reserva v3 y al admitir o leer un recibo v3. La candidata mantiene la pieza v3 en modo de prueba.

## Escritura y lectura de Cuenta

* Al emitir una reserva v3, la misma transacción crea un documento permanente en `videoVoiceReservationSlots/{sha256(JSON.stringify([accountId,reservationId]))}`. Contiene el titular de Cuenta, reserva, ámbito, intención, referencia de origen y generación de reserva. También añade reserva, referencia de origen y generación al asiento de reserva determinista. El origen por intención, su índice, la reserva, la actualización de disponible/reservado y el asiento siguen compartiendo este commit. El asiento y el documento por reserva se crean con precondición de inexistencia. La API del extracto de saldo continúa proyectando únicamente los campos públicos previos. [Emisión](../../server/account/backend.ts#L450) · [Proyección](../../server/account/backend.ts#L207).
* Con la fila operativa ausente, el sello lee el índice por titular/reserva y el asiento. La existencia de cualquiera de los dos impide crear una lápida o ratificar una previa. La resolución tampoco devuelve `sealed` frente a esa historia contradictoria. Una reserva nueva comprueba los dos documentos antes de crear registros, incluido un posible intento v2 posterior a la pérdida. Cuando no hay fila ni lápida, una consulta de resolución sigue devolviendo `not_found` (estado sin resolver). Para una reserva intacta el sello legacy sigue siendo una lectura de su estado económico. [Guardia](../../server/account/backend.ts#L330) · [Sello](../../server/account/backend.ts#L361).
* Antes de devolver un replay v3 o decidir una admisión, Cuenta coteja titular, reserva, origen y generación en índice y asiento. El índice debe apuntar al ámbito e intención actuales. En el asiento deben coincidir clase `video_reserve`, segundos y fecha económica de la reserva. Además de las comprobaciones previas de origen, vínculo y generación, los metadatos de creación y última escritura de esos dos documentos inmutables deben corresponder a la emisión. La escritura create-only por el emisor autorizado, la existencia de los demás registros y su tupla son parte de la prueba. Una igualdad de timestamps por sí sola no autentica al escritor. Si la historia diverge, se conserva un recibo existente sin presentarlo como un replay autorizado y sin emitir nuevas admisiones ni reparar el asiento con los datos del llamador. [Verificación](../../server/account/backend.ts#L397).

## Lecturas, compatibilidad y retención

Se añaden dos lecturas puntuales por reserva nueva v2/v3, sello sin fila operativa, resolución que devolvería una lápida y comprobación ordinaria de respaldo v3 en reserva repetida o admisión. La emisión v3 añade una escritura por reserva. No se hacen barridos ni consultas por colección; no se requiere un índice compuesto. Las lecturas y escrituras pueden repetirse si Firestore reintenta la transacción. El operador debe prever acceso a los dos documentos y retención equivalente al origen y al asiento. El coste real de despliegue no se midió.

V2 conserva su formato de asiento, su reserva, replay, sello de una reserva existente y sello idempotente de un ID genuinamente libre. Una fila perdida con un asiento existente ya se trata como historia incompleta. Para la versión v3 experimental anterior, faltan el índice y los campos nuevos del asiento. No se reconstruyen durante el uso. Un replay o una admisión de esa versión queda en conflicto para conciliación. El asiento determinista superviviente evita el sello aun si la versión anterior carecía del índice. Antes de cualquier activación o conversión de datos históricos, inventariar esos documentos, acreditar la emisión original y definir un procedimiento autorizado de migración o cierre con recibos durables. La candidata no implementa tal migración. Una actualización en sitio que estampase valores nuevos en una historia antigua no produciría el commit de emisión que exige esta verificación.

La ausencia simultánea de la reserva, el índice por reserva y su asiento priva al sello legacy de sus dos comprobantes por esa clave. Su firma no contiene el ámbito e intención de Video para recuperar el origen por intención. La pérdida conjunta, una reescritura administrativa total o un escritor legacy antiguo que omita las nuevas comprobaciones quedan fuera de esta protección. Se requieren retención y sustitución de escritores. Un documento insertado sin autoridad solo puede causar un rechazo conservador en la comprobación de ocupación. Acreditar saldo requiere la tupla completa y el permiso de Cuenta. El emisor autenticado de ámbito, titular e intención y el traspaso durable entre bases siguen pendientes. El modelo no prueba IAM desplegado, metadatos o contención reales de Firestore, ni entrega a un proveedor.

## Pruebas

- **Base**. Los dos controles de seguridad se repitieron antes de editar y ambos fallaron. H1 observó una lápida; DS3 observó una nueva admisión con recibo, cerca y actualización de la reserva. Se mantienen esos mismos controles. Las dos pruebas del diagnóstico que describían el comportamiento antiguo se actualizaron para verificar la respuesta corregida y el inventario completo. La rama a616a5d y su evidencia permanecen intactas.
- **Candidata**. **44/44** en el archivo de autoridad, **133/133** en diez suites relacionadas y `tsc --noEmit` con salida cero. El conjunto combinado incluye las 44 focales. H1 rechaza con cero escrituras, incluidos sello y resolución de una lápida contradictoria mientras sobreviva solo el índice o solo el asiento. DS3 rechaza tanto la primera admisión como un ordinal nuevo y un replay histórico cuando desaparece o cambia el asiento. Los casos de dueño, cantidad, clase, origen, tiempo, restauración y recreación conservan el inventario de ambas cuentas. Se mantienen los controles de ordinales y sus recibos. La carrera entre sello legacy y reserva v3, la pérdida del asiento antes del commit de admisión y la aparición de evidencia mientras se prepara un sello se probaron en el doble. [Controles financieros](../../server/account/voiceOriginAuthority.test.ts#L337) · [Carreras](../../server/account/voiceOriginAuthority.test.ts#L518).
- **Puente legacy**. En ejecución aparte de sus dos controles de reasignación, 1 pasó y 1 siguió rojo, con 37 fuera del filtro. Si cambia el titular antes de la admisión y B ya tiene una reserva compatible, el puente v2 todavía registra tres escrituras de admisión en B. Este cambio de Cuenta no conecta el puente con el origen v3. No se ha probado un cargo adicional, un reenvío físico ni un cierre integrado de Video.
- Node 24.22.3, datos ficticios y procesos locales. El siguiente gate requiere auditoría independiente de este commit, revisión dual de la candidata resultante y pruebas de emulador/regresión financiera en el orden del coordinador.

Los hashes de la tabla son SHA-256 de los archivos locales de Windows, sin normalizar. Los logs se conservan en `outputs/h1-ds3-fix/`.

| Archivo | SHA-256 |
| --- | --- |
| red.log | fa6ee182526db5e040ed0be7b876f87a9200b8dda6a140caf0eee9751ba469e0 |
| first.log | b707faea42653e9b99a68180af09e559bd00417be67d5d530bae6a32d109e2aa |
| focal-races.log | 094ac1eb9c6ea7beaf056e65ee1e02549627e6426b329f8ea5477625044b64ed |
| final.log | ae86fff9a703d8a8ad396a50a97cc87ec598de51fb29291f8883c35ec2af6207 |
| types-final.log | e05222033cd2c7b46b6fad5ec87b44b62f844dbb6f004476498f71d0e3c9875b |
| legacy-bridge.log | 07b10e1c8b6e50fba1a914accf1b7ca70c70d4ba890645819b0e15b93301c03f |
| backend.ts | 799c2937276344ceb9083423572769b3531a6add6b4050fab9c9381a439f0e83 |
| voiceOriginAuthority.test.ts | 5a69075c721b8bee03e70523a4a74da53c783dbe96755ed68bc48e2c77b500da |

Para repetir, ejecutar con las dependencias locales de la candidata:

~~~powershell
$paths=@(Get-ChildItem -Name server/account/*.test.ts | ForEach-Object {"server/account/$_"})
$paths+=@('server/commercial/voiceAdmissionOwnershipBoundary.test.ts','server/commercial/accountBillingClient.test.ts','server/commercial/reviewedVoiceFragment.localFixture.test.ts')
node node_modules/vitest/vitest.mjs run @paths --maxWorkers=1 --reporter=verbose
node node_modules/typescript/bin/tsc --noEmit
~~~

=== RESUMEN FINAL ===
RESULTADO: PASS
EVIDENCIA: H1 y DS3 de rojo a verde en Cuenta, 44/44 focales, 133/133 combinadas y tipos con salida cero.
NEGATIVOS: Pérdida de reserva, lápida contradictoria, asiento o índice ausentes, alterados o recreados, carreras y ordinales; no se altera saldo ante esos rechazos.
BLOQUEOS: Revisión independiente de esta corrección; falta el emisor y traspaso, la migración/retención, el retiro de escritores legacy, emulador y regresión integrada. El puente v2 sigue con un negativo rojo. Costo no medido.
=== FIN RESUMEN ===
