# LV-019.B · Compatibilidad entre el testigo C1 y el origen v3 de Cuenta

Corte local del 26 de noviembre de 2026, basado en `a5c98e7c17b46421da19410b7c88f92d88b9e199`. El [diagnóstico independiente](LV-019-B-c2-origen-cuenta-auditoria-C1-20261126.md) conserva su **FALLA** original. La reproducción sobre el base dio tres controles aprobados y dejó rojo el caso nominal. Cuenta devolvía `invalid` antes de abrir una transacción. La corrección queda aislada para auditoría.

## Contrato aplicado

- [Video](../../server/commercial/firestoreBackend.ts#L993) deriva la intención como SHA-256 de la serialización JSON de `[accountId, requestKey]`. El [constructor del testigo C1](../../server/commercial/reserveAttemptEvidence.ts#L184) vuelve a calcular intención y reserva y exige que su intento de **reserva** sea el UUID de esa reserva. El [validador común v3 de Cuenta](../../server/account/backend.ts#L28) acepta el digest de 64 caracteres hexadecimales en minúsculas y exige `reserveAttemptId === reservationId` con la reserva en forma UUIDv4. La comprobación aplica tanto a reserva como a admisión.
- El [contrato de voz](../specs/LV-019-B-voz-desde-revision.md#reserva-carreras-y-llamadas) y el [diseño de titular y generación](LV-019-B-c2-admision-titular-generacion-20261126.md) enumeran el `attemptId` del proveedor en la tupla de la llamada. Cuenta sigue validándolo como su propio UUID y fijándolo con el trabajo y la primera admisión. El contrato no exige desigualdad de valores respecto de la reserva. Las pruebas verifican valores distintos e iguales y que un replay con otro intento se rechaza en ambos casos.
- La transacción sigue cotejando el ámbito, la identidad y titular vigentes, el vínculo y su generación, el permiso y la tupla exacta, y el par de origen e índice. Las pruebas de autoridad mantienen los controles de hold, replays e historial, y comprueban el rechazo de la reserva v2 por v3 y de mutaciones legacy sobre una reserva v3 íntegra. Las filas sintéticas v3 con el formato previo quedan fuera de la forma aceptada. Cualquier migración futura exige inventario y una decisión separada.

## Evidencia

Con Node 24.22.3, las **98/98** unitarias focales de diez archivos pasaron y `tsc --noEmit` devolvió 0. La [fixture de frontera](../../server/account/voiceOriginIndependent.test.ts#L176) entrega a Cuenta la tupla emitida por el constructor real de C1 con un permiso preparado en el doble. Comprueba una reserva y un único asiento para A, B íntegra y replay sin escrituras desde otra instancia. Verifica rechazo de UUID en lugar del digest, digest truncado, mayúsculas, salto de línea, otra intención, IDs de reserva discordantes incluso si el permiso los repite, y digest donde se espera el intento del proveedor. La admisión y sus replays conservan saldo y asiento en ambos controles de intento del proveedor.

La primera corrida tras el cambio de validador conservó cuatro fallos de precondición de las fixtures anteriores. Se actualizaron las tuplas de esos casos para alcanzar las comprobaciones transaccionales originales. La corrida final incluye esa cobertura y los negativos de forma por separado.

```powershell
$paths = @(Get-ChildItem -Name server/account/*.test.ts | ForEach-Object { "server/account/$_" })
$paths += @('server/commercial/voiceAdmissionOwnershipBoundary.test.ts','server/commercial/accountBillingClient.test.ts','server/commercial/reviewedVoiceFragment.localFixture.test.ts')
node node_modules/vitest/vitest.mjs run @paths --maxWorkers=1 --reporter=verbose
node node_modules/typescript/bin/tsc --noEmit
```

Logs locales ignorados por Git bajo `outputs/lv019-b-c2-c1-id-20261126/`.

| Archivo | SHA-256 |
| --- | --- |
| `before.log` | `a82147c596fcd74d16859629c7c3eeba46713eaeeeacf2e4ea6bc3a43da7465b` |
| `focal-initial.log` | `51e70eaead29edf9bc1a76c458e17b56131dc0ce98771e30dc730e4ec31d99fb` |
| `focal-final.log` | `190ed52f5833ba57e9495eb332d81c6ad423f6564f653bfb593994509be4c943` |
| `types-verified.log` | `f95e36aca63e3ad1a919542625fc9ff13077d972e04e21b73bdc46269066fc30` |

## Frontera pendiente

Cuenta verifica forma y coincidencia con el permiso durable. La derivación del digest y del UUID, la procedencia de la revisión, el vínculo con UID y la procedencia del trabajo y de su intento requieren un emisor autenticado que compruebe la historia de Video. El doble instala vínculo y permiso como precondiciones. La transacción de Cuenta no prueba que la historia de Video continúe vigente al admitir o entregar un fragmento. Faltan el traspaso durable de la referencia de origen al trabajo, la verificación antes de despachar, la conciliación de respuestas inciertas, la validación de versiones/reintentos en Firestore y la revisión independiente. Los métodos siguen limitados a pruebas y carecen de rutas. El puente legacy conserva su diagnóstico previo de reasignación, fuera de esta corrida. No se usaron emulador, proveedor ni nube.

=== RESUMEN FINAL ===
RESULTADO: PASS
EVIDENCIA: Caso nominal C1 de rojo a verde, 98/98 unitarias focales y tipos con salida 0 en este corte local.
NEGATIVOS: Intención en forma inválida o distinta, IDs de reserva discordantes, intento de proveedor inválido o cambiado, vínculo y titular, hold, replay y mutaciones legacy sobre una reserva v3.
BLOQUEOS: Pendientes la auditoría independiente, el emisor autenticado, el traspaso durable entre bases y las pruebas en emulador. La preparación aislada no certifica el flujo integrado. Costo y tokens no medidos.
=== FIN RESUMEN ===
