# LV-019.B C2 · Origen transaccional de Cuenta en pruebas

La candidata añade la emisión y el cotejo de un origen de voz dentro de AccountStore. Los dos métodos nuevos requieren modo de prueba, carecen de consumidores en las rutas y rechazan una operación sin las pruebas durables de procedencia. El puente C2, el proveedor y la liquidación del protocolo nuevo siguen cerrados. Esta pieza parte del [diagnóstico del contrato anterior](LV-019-B-c2-autoridad-durable-bloqueo-20261126.md) y del [diseño de titular y generación](LV-019-B-c2-admision-titular-generacion-20261126.md).

## Contrato de la pieza

- La futura identidad de servicio aporta el ámbito de Video por separado. La solicitud propone los IDs de Video, identidad Firebase, intención, intento de reserva, reserva y segundos. El método exige propiedades de datos propias y forma exacta. Un campo de dueño en el cuerpo se rechaza. El ámbito local se contrasta con los registros existentes. La autenticación de servicio sigue pendiente.
- Cuenta exige un vínculo activo previamente verificado en `videoVoiceBindings` y un permiso en `videoVoiceIntentGrants` para esa intención y ese ámbito. La prueba del vínculo incluye el titular de Cuenta, el ID de Video separado, una generación y la versión de la identidad de Cuenta. El permiso fija la versión del vínculo y la tupla reservable exacta. Queda pendiente el escritor que autentica y emite esos dos registros. Las unidades los instalan de forma explícita como precondición del arnés.
- La transacción de reserva comparte con el protocolo anterior la comprobación de cuota, saldo y hold, la deducción de disponible, el incremento de segundos reservados y el asiento `video_reserve`. En ese mismo commit crea una fila v3 de reserva, con generación nueva, y una pareja inmutable de origen e índice en `videoVoiceReservationOrigins` y `videoVoiceOriginClaims`. La clave de ambos se deriva del ámbito y de la intención. La referencia opaca que devuelve Cuenta es aleatoria. La pareja permite detectar la pérdida de un documento aunque la reserva actual del UID hubiera cambiado. Una repetición exacta desde una instancia nueva recupera la misma referencia sin reservar ni registrar un segundo asiento.
- La admisión v3 toma el dueño del origen emitido y compara en la misma transacción el vínculo vigente, la identidad de Cuenta, el permiso y la creación original de la cuenta y la reserva. Verifica también el hold, el tombstone, la cerca de primera llamada y el recibo del ordinal. El ordinal y su recibo se escriben juntos, sin mover saldo. Si desaparece el recibo de un ordinal ya indexado, se rechaza sin recrearlo. Un replay exacto autorizado devuelve `receiptOnly`. Un hash distinto o un trabajo distinto producen conflicto. Un hold bloquea nuevas admisiones y permite consultar el recibo exacto bajo el mismo vínculo vigente.
- Las entradas legacy siguen usando la forma v2 anterior. Si encuentran una fila v3, sus mutaciones de reserva, admisión y liquidación la rechazan. Una reserva v2 existente carece de origen y el método v3 no la adopta. El puente aún puede llegar a la admisión legacy, que conserva el negativo al cambiar de titular. Conectar las versiones requiere un corte explícito de escritores y de rutas.

## Pruebas

Con Node 24.22.3, **88/88** pasaron en nueve suites focales, incluidas las **15** nuevas. La comprobación de tipos y la sintaxis de ambos archivos también pasaron. En una segunda selección que incluyó el puente en memoria, **126/127** pasaron. El negativo de integración existente falló cuando el puente legacy encontró una reserva B compatible después de un cambio de titular. El arnés detectó tres escrituras en B, correspondientes a reserva, cerca y recibo. La versión anterior de C2 no entregó bytes ni movió saldo en ese caso. La transacción nueva conserva el mismo control bajo ambos órdenes, con cero escrituras en B y un solo recibo de A cuando su admisión se confirma primero.

Las unidades ejercitan la reserva y el ledger reales de AccountStore sobre un doble transaccional. Comparan la colección completa antes y después de los rechazos, con reserva compatible en B, origen de otro ámbito o intención, pérdida independiente del origen o de su índice, reserva borrada y recreada con el mismo contenido, ABA de identidad y vínculo, hold y cambio concurrente antes del commit. Una doble llamada de reserva converge en un solo origen y asiento. Las admisiones correctas conservan saldo y movimientos. Las pruebas del hold, otros ordinales y recibo ausente comprueban que la conservación de evidencia no concede permiso nuevo.

En PowerShell, con Node 24.22.3 y dependencias locales.

```powershell
$paths = @(Get-ChildItem -Name server/account/*.test.ts | ForEach-Object { "server/account/$_" })
$paths += @('server/commercial/voiceAdmissionOwnershipBoundary.test.ts','server/commercial/accountBillingClient.test.ts','server/commercial/reviewedVoiceFragment.localFixture.test.ts')
node node_modules/vitest/vitest.mjs run @paths --maxWorkers=1
node node_modules/vitest/vitest.mjs run @paths server/commercial/reviewedVoiceFragment.memory.test.ts --maxWorkers=1
node node_modules/typescript/bin/tsc --noEmit
```

El segundo comando conserva el fallo legacy. Logs locales ignorados por Git en `outputs/lv019-b-c2-account-origin-20261126/`.

| Archivo local | SHA-256 |
| --- | --- |
| `vitest-account.log` | `9b1d31b966ec9c44f67148e8b11058ec99f4e34156954493fa91b0dc88429027` |
| `vitest.log` | `f1b9081c1a89224cbb15ff93a5ddfa8b33f3a31d33dd3938b3cf0547488445db` |
| `types.log` | `2095d5302e465922147e220c0389f7a923ea0c1509a23097f04b3c220798aef8` |

## Frontera y dependencias

El doble representa la lectura de versiones y el reintento transaccional. La prueba de recreación usa los metadatos de creación de los tres documentos que emite el mismo código en una transacción. Verificar en Firestore Emulator la igualdad de esos metadatos para las tres creaciones, su estabilidad después de actualizaciones legítimas y los dos órdenes de carreras reales antes de usar esa comparación como evidencia de integración. La prueba presupone el control de los escritores Admin y la conservación de la historia. La retención del origen, índice, reserva y recibos y el inventario de escritores forman parte del protocolo pendiente.

Quedan pendientes el emisor privado de vínculo e intención, sus generaciones y la revocación con recibo durable. Video debe conservar la referencia del ACK original, acreditar el trabajo, el intento y sus bytes ante la nueva admisión y volver a verificar antes de entregar. Los documentos de Video requieren su propia verificación fuera de la transacción de Cuenta. El corte entre versiones debe excluir llamadas legacy para trabajo nuevo y verificar captura, devolución, sellado y conciliación. Las barreras de devolución vencida y D2 siguen dependiendo del orden del traspaso y de las imágenes de transición de Video. Se requieren emulador y revisión independiente dual para cualquier integración posterior. Esta corrida usó únicamente datos sintéticos y procesos locales.

## Inventario

- [backend.ts](../../server/account/backend.ts) contiene los dos métodos cerrados, el cotejo de evidencia y los cambios acotados al acceso de filas v3.
- [voiceOriginAuthority.test.ts](../../server/account/voiceOriginAuthority.test.ts) contiene el arnés local y las contrapruebas. El negativo del puente legacy permanece en su archivo original.
