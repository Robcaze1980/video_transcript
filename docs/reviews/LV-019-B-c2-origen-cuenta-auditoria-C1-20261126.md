# Auditoría independiente de origen de Cuenta y testigo de voz C1

**FALLA de compatibilidad.** En el commit `947de8141bd58db6d47372a78f71d42923ab2d7c`, Cuenta rechaza la solicitud que corresponde al testigo de voz de Video incluso con un vínculo y una autorización sintéticos válidos para el titular actual. El rechazo ocurre antes de la transacción. Ninguna de las dos cuentas ficticias cambia de saldo. Se requiere corregir el contrato local de entrada v3 antes de someter esta candidata a revisión dual.

## Reproducción nominal y controles

El [ensayo independiente](../../server/account/voiceOriginIndependent.test.ts) combina el constructor real `createReviewedVoiceReserveAttempt` con `AccountStore.reserveVideoWithVoiceOrigin`. El contenido de la traducción y los registros de identidad, versiones y autorización son ficticios. Un doble transaccional de Cuenta prepara dos titulares con 30 segundos cada uno y una identidad que apunta a A. Para el testigo producido por C1 se siembran un vínculo activo y una autorización exacta de A, incluida su generación. Se toma el inventario después de esa preparación.

| Caso | Resultado observado |
| --- | --- |
| C1 válido, autorización exacta y reserva nueva para A | **Falla** la expectativa de una reserva creada. `AccountFault('invalid')` en `server/account/backend.ts:37`. |
| Mismo escenario, caracterización del rechazo | Pasa. Cero transacciones de Cuenta y el inventario completo de A y B permanece idéntico. |
| Intento de reserva de voz diferente del ID de esa reserva | Pasa. El constructor real de C1 rechaza la discordancia. |
| Solicitud de la fixture v3 con UUIDv4 diferentes para intento y reserva y una autorización que repite ambos | Pasa como caracterización. Cuenta crea la reserva de A con esos valores y B mantiene sus 30 segundos. |

**Dos campos originan el desacuerdo.** Video deriva `intentId` con SHA-256 de la serialización de la cuenta Video y la clave de solicitud. El constructor verifica el digest y vuelve a calcular el ID determinista de reserva. Para voz exige `reserveAttemptId === reservationId`. El ID de reserva es UUIDv4. En este contrato `reserveAttemptId` corresponde al `attemptId` del testigo de **reserva** de voz, no al `attemptId` posterior del trabajo/proveedor. El camino de texto elige su propio intento. Cuenta exige UUIDv4 para los tres campos y compara la tupla con la autorización almacenada, pero acepta UUIDv4 diferentes para intento de reserva y reserva. La fixture congelada construye los tres UUID de forma independiente. Véanse `server/commercial/firestoreBackend.ts:142,995`, `server/commercial/reserveAttemptEvidence.ts:91–101,184–198`, `server/account/backend.ts:9,15,28–40,375–378` y `server/account/voiceOriginAuthority.test.ts:23–30`.

**Corrección requerida.** Definir en el contrato v3 de voz el digest canónico en minúsculas y la igualdad de los dos UUIDv4 de reserva. Mantener la validación de la autorización durable, el titular, la generación y el ámbito. Usar el testigo C1 para las pruebas positivas de Cuenta. Conservar controles para digest truncado, digest de otra intención, UUIDv4 distintos aunque una autorización sintética los repita y separación del intento del proveedor. Los testigos C1 ya cumplen esas reglas. Una eventual migración de documentos v3 con otro formato exigiría inventario y decisión explícita. Este corte solo demuestra registros sintéticos.

## Titular, origen, hold y perímetro

* En `server/account/backend.ts:360–379` Cuenta toma el titular de su mapeo vigente para crear el origen y del origen para reusar la operación. Contrasta ambos con el vínculo, su versión, la autorización y la generación. El llamado no elige el titular con un campo adicional. El método exige ámbito de forma válida y entorno de pruebas. El principal de servicio autenticado y el emisor que acredita vínculo e intención siguen pendientes. Una fila precargada por la fixture no demuestra autoridad para crearla. Los métodos nuevos carecen de ruta en `server/account/http.ts:33,61–82`; las reglas de clientes de `deploy/google-cloud/account.rules:4` deniegan acceso directo. El control de los escritores Admin queda fuera del doble.
* En `server/account/backend.ts:399–439` la creación de origen, índice, reserva y asiento y la actualización del saldo suceden dentro de la misma transacción de Cuenta. La prueba local modela el conflicto/reintento. En `381–393` la verificación coteja las versiones de la identidad, el vínculo y los documentos emitidos. La igualdad de tiempos de creación de documentos distintos requiere contrastarse con el escritor y probarse en Firestore. No autentica por sí sola al emisor. En `458–510` el origen, titular, estado, hold y evidencia por fragmento condicionan las admisiones y replays. Las pruebas congeladas cubren reasignación, cambio y restauración de la identidad/vínculo, recreación de reserva, hold en carrera, concurrencia y pérdida del recibo de ordinal.
* Ante una reserva **v3 íntegra**, los caminos v2 de reserva, admisión y liquidación rechazan la mutación (`server/account/backend.ts:417–424,473–478,534–539`). `status`, `resolution` y el sellado de una reserva existente pueden devolver el estado económico y no conceden permiso para el fragmento (`329–349,593–623`). Si se elimina una reserva y sobrevive su origen, el sellado legacy solo consulta reserva y lápida y puede crear una lápida. Es un límite estático con pérdida previa del documento. La liquidación v3, conciliación y el retiro de rutas v2 todavía precisan contrato y pruebas. El negativo previo de reasignación del puente legacy permanece separado.
* La prueba reproduce el desacuerdo en el límite de ambas piezas usando el código real que construye y consume la tupla. Quedan pendientes emulador, emisor autenticado, continuidad entre bases, conexión con el puente, entrega al proveedor y revisión dual de la versión corregida. No se ejecutaron procesos remotos ni se usaron datos de cliente.

## Evidencia local

Node 24.22.3 y dependencias de la candidata. La comprobación final de tipos con tsc --noEmit devolvió 0. Las nueve suites congeladas fueron repetidas excluyendo expresamente el nuevo archivo independiente. Pasaron 88/88. La suite independiente, ejecutada por separado, conserva el nominal rojo y tres controles verdes. El informe original también registra 126/127 con un fallo conocido del puente legacy en otra selección; esa selección ampliada no se repitió en esta auditoría. La evidencia local está bajo `outputs/voice-origin-audit/`.

| Evidencia | SHA-256 |
| --- | --- |
| `server/account/voiceOriginIndependent.test.ts` | `f5b0b9333f281baab4827b5a153a17b9e28688f2a0b8c66ab34a390a1f003d0a` |
| `independent-final.log` | `258d8bddd3e2773cfd95c129e0dbe6cf79d24b5c7886a08b0b600eabdf2e8e63` |
| `frozen.log` | `c5d2318dac2ee576756985708eeafaabb582f65990aa4f1106ad7accef4b465f` |

Comando del diagnóstico aislado, con Node 24.22.3 en el PATH:

```powershell
node node_modules/vitest/vitest.mjs run server/account/voiceOriginIndependent.test.ts --maxWorkers=1 --reporter=verbose
```

=== RESUMEN FINAL ===
RESULTADO: FALLA
EVIDENCIA: El test nominal de la línea 183 recibe invalid. El de la línea 175 verifica cero transacciones y cero cambios. Las nueve suites previas pasan 88/88.
NEGATIVOS: Identificadores de reserva discordantes, identidad y titular en carrera, hold, pérdida y recreación de evidencia cubiertos en el alcance descrito.
BLOQUEOS: Ajustar el contrato de entrada v3 y repetir el caso nominal antes de la revisión dual. Emisor y ruta autorizados, integración entre bases, emulador y exclusión de legacy siguen pendientes. Costo no medido.
=== FIN RESUMEN ===
