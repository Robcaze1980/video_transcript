# Auditoría independiente de la compatibilidad C1 y del origen v3 de Cuenta

**PASS acotado a las dos operaciones internas de Cuenta sobre el doble transaccional.** La candidata 387f0d27b6622c40f004149117966c9bc690fbb8 corrige la incompatibilidad reproducida en a5c98e7 sobre 947de81. La pieza v3 acepta ahora el testigo real de reserva de voz. La ruta del puente legacy conserva un fallo reproducido que impide considerar acreditado el flujo integrado.

## Contrato y alcance

Video deriva el digest de intención en minúsculas a partir de la cuenta Video y la clave de solicitud. Su constructor vuelve a calcular el UUIDv4 de reserva y exige que el intento de **reserva** de voz tenga ese mismo valor. Cuenta exige esa forma para reserva y admisión, y coteja todos los campos con el permiso encontrado en el ámbito. El intento de **proveedor** pertenece al trabajo y a sus fragmentos. Puede coincidir por valor con el UUID de reserva o ser distinto; tras la primera admisión queda fijado con el trabajo. Véanse server/commercial/firestoreBackend.ts:142,995, server/commercial/reserveAttemptEvidence.ts:184–198 y server/account/backend.ts:28–40,360–395,449–512.

El único cambio de ejecución desde el diagnóstico modifica el validador compartido. La reserva v3 sigue leyendo identidad, titular, vínculo, autorización, origen y guardia. El débito de disponible, el incremento de reservado, el índice, origen, reserva y asiento comparten la transacción de Cuenta. El replay exacto devuelve la misma referencia. En la primera admisión se ligan el trabajo, intento, familia, modelo y huella del fragmento; bajo un hold, un efecto nuevo se rechaza y un recibo histórico autorizado sigue siendo legible. Los casos congelados comprueban reasignación en ambos órdenes, cambios y restauración de identidad/vínculo, pérdida del recibo y recreación de reserva. La prueba en memoria emplea el constructor real de C1, AccountStore real y dos titulares ficticios. El permiso de Cuenta está preinstalado a efectos de la prueba.

## Resultados

- **98/98** en diez suites sin modificar de la candidata. La antigua prueba nominal crea exactamente una reserva y un asiento de tres segundos para A, conserva B y devuelve el origen previo al repetir. UUID en lugar del digest, digest truncado, mayúsculas, salto de línea y discordancia de los UUID de reserva fallan antes de la transacción. Un digest bien formado distinto falla al consultar la autorización sin escrituras.
- **104/104** en la misma selección con los seis controles añadidos. Cuatro sustituciones de forma válida (pareja de UUID de reserva, cuenta Video, segundos y ámbito) dieron conflicto en reserva y admisión. El inventario completo permaneció idéntico. Tras una admisión ya registrada y la recreación exacta del permiso, otra instancia rechazó el replay de reserva y de admisión. Para un segundo ordinal se rechazaron un intento nuevo y otro trabajo. La tupla correcta se admitió, su replay devolvió recibo y cambiar la huella se rechazó; saldo y asiento se conservaron.
- Tipos de toda la copia con las seis adiciones, salida cero. Node 24.22.3. El log adicional de **16/16** repite diez casos incluidos en las 98 más las seis adiciones; no se suma al total.
- **Puente legacy: 1/2**, con 37 fuera del filtro. Sin reserva compatible en B, el control pasó. Con reasignación antes de admitir y una reserva compatible en B, el doble registró tres escrituras de admisión: documento de reserva, cerca y recibo. El puente usa el método v2 y el caso falló de nuevo en esta copia. No se demostró otra reserva financiera, un cargo ni una llamada física al proveedor. Véanse server/commercial/reviewedVoiceFragment.localFixture.ts:135–139 y server/commercial/reviewedVoiceFragment.memory.test.ts:281–309.

## Límites de autoridad

El método está limitado a pruebas y carece de transporte v3. El ámbito de forma válida y las filas de la fixture no identifican a un emisor de servicio autenticado. Cuenta compara la tupla con el permiso durable; necesita que el emisor verifique la procedencia real de la intención, la revisión y el trabajo y acuñe el permiso correcto. No se demostró un camino de cliente para escribir esas filas. El traslado durable de referencia al trabajo de Video y el orden de revocación entre bases permanecen pendientes. Un recibo existente acredita una admisión y no autoriza por sí solo otro envío físico incierto. La liquidación con origen, retirada de escritores legacy, retención, permisos y comportamiento de los metadatos bajo transacciones y reintentos reales en Firestore siguen abiertos. No se ejecutó emulador, red o proveedor. Ninguna revisión anterior se traslada al código nuevo.

## Integridad y reproducción

Para server/account/backend.ts en 387f0d2, Git identifica el blob con SHA-1 39de14ba21f745365d9ee296efedb684d103c8bd. El archivo de trabajo de Windows tiene SHA-256 c6cdca6b7ded44e053162dc0ec06308867d41749a2943f19ae28396a2a08c52b. Al normalizar exclusivamente CRLF a LF, el SHA-256 es ceb29f121ca7c59aebb2162dabf52a6c91978be451cbd226860ba7d9c683610a e igual al SHA-256 de los bytes del blob. El SHA-1 del objeto Git y los SHA-256 de archivos usan representaciones diferentes. Los siguientes son SHA-256 de logs locales sin normalizar en outputs/c1-id-audit.

| Archivo | SHA-256 local |
| --- | --- |
| additional.log | 7cc7617319d4105a1fceb4a1dac8d3e1a44675dc1fc7e86d58327bd366600963 |
| frozen.log | 3e684169708d91f2e7c6f970971dddc2f5e5f854dab3389b5bc7e0b349214f2a |
| integrated.log | 68dd3680cabde5d7348048b2b17650ca06aca92b114317f38d55e986394c87d8 |
| legacy.log | 91b4b71cbfa0c63993efedae7ec0474f47594c287dd683ea711c13e6bf3c9106 |
| types.log | e05222033cd2c7b46b6fad5ec87b44b62f844dbb6f004476498f71d0e3c9875b |

Con las dependencias locales de la candidata:

~~~powershell
$paths = @(Get-ChildItem -Name server/account/*.test.ts | ForEach-Object { "server/account/$_" })
$paths += @('server/commercial/voiceAdmissionOwnershipBoundary.test.ts','server/commercial/accountBillingClient.test.ts','server/commercial/reviewedVoiceFragment.localFixture.test.ts')
node node_modules/vitest/vitest.mjs run @paths --maxWorkers=1 --reporter=verbose
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run server/commercial/reviewedVoiceFragment.memory.test.ts --testNamePattern 'keeps Account admission on the original owner when the binding changes before admission' --maxWorkers=1 --reporter=verbose
~~~

=== RESUMEN FINAL ===
RESULTADO: PASS
EVIDENCIA: Cuenta v3 local y testigo real de voz C1, 98/98 más seis negativos/controles, total combinado 104/104, tipos con salida 0.
NEGATIVOS: Forma, tupla y ámbito, continuidad de autorización, cruce de titulares, separación de intentos, hash por ordinal, hold y replays cubiertos dentro del doble.
BLOQUEOS: El puente legacy volvió a fallar con reserva compatible en B. El emisor autenticado, traspaso entre bases, liquidación, emulador y gate dual siguen pendientes. Costo no medido.
=== FIN RESUMEN ===
