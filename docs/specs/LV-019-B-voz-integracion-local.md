# LV-019.B · Integración local propuesta del vínculo de voz

**Estado:** propuesta y casos sintéticos en preparación. No conecta rutas, reservas, proveedores ni recursos reales. Complementa [voz desde revisión](LV-019-B-voz-desde-revision.md), el [canon](LV-019-B-voz-canon-v1.md) y la [lectura local](LV-019-B-voz-lectura-local.md). Ninguna de estas piezas por separado autoriza una activación.

## Reserva y trabajo

1. El router verifica Firebase y entrega UID y cuenta al servicio; el UID de la petición nunca se obtiene de su cuerpo. Dentro de la transacción que crea la intención de voz se llama `voiceBindingInTransaction` para la revisión actual, se comprueban las barreras de admisión y se crea una marca propia, determinista por cuenta y clave de solicitud. La marca fija la identidad, trabajo de texto, revisión y recibo, generación y hash del input, hashes de revisión y voz, perfil de canon, operación elegida y duración que fundamentan la reserva. Contiene identificadores y hashes, no el texto.
2. La marca, la intención y su testigo de origen se crean atómicamente. La forma estricta del testigo financiero anterior no se amplía sin un protocolo versionado. El flujo simulado crea la marca junto a su reserva y trabajo, en la misma transacción. Una marca ausente, dañada, de otra tupla o antigua no se reconstruye por mera ausencia: requiere migración o conciliación.
3. Tras cualquier llamada remota de reserva, la transacción común de `reserve` vuelve a comprobar principal y vínculo antes de crear o devolver un trabajo, incluidos el drenador y la recuperación de respuesta perdida. Un ACK confirmado de Cuenta cuyo vínculo cambió se conserva con su tupla para revisión cuando Firestore lo permita. Si la escritura falla tras el ACK, permanece `UNKNOWN`; una intención previa no demuestra que el ACK se guardó. No atribuir un hold a una cuenta cuya propiedad no se verificó ni asumir una devolución.
4. Un reintento idéntico solo devuelve el mismo trabajo si UID, marca, solicitud e historial siguen verificados. La consulta autorizada de un trabajo existente continúa disponible como lectura; no convierte una reserva incierta en una nueva admisión. La selección actual no permite sustituir silenciosamente una revisión; un cambio de texto o voz requiere otra solicitud.

## Despacho y proveedor

La elegibilidad y la toma de trabajo, `beginInvocation` y la creación de cada `providerCalls` verifican la marca de voz y la procedencia en sus transacciones. La implementación debe cubrir tanto clasificación simulada como externa; no usar la falta de un marcador como prueba de simulación. Antes de cada fragmento, `invoke` serializa una sola vez, valida operación, modelo, voz y cuerpo contra `validateReviewedVoiceCall` y conserva la cadena exacta para enviarla. El texto no se escribe en logs, incidencias ni métricas.

Antes de llamar a Cuenta se conserva la fotografía original de identidad y documentos de revisión relevantes. Después de un ACK de admisión se compara esa misma historia en una transacción y se vuelven a validar intento, vencimiento y barreras antes del proveedor. Un recibo repetido `receiptOnly` no autoriza otra llamada. Si el vínculo cambió durante la admisión, conservar el ACK comprobado y el hash de solicitud para revisión; no afirmar que se envió al proveedor. Si no llegó respuesta, conservar `UNKNOWN` y no inventar un recibo. Una petición ya enviada no puede cancelarse retroactivamente.

Las versiones de documentos pueden detectar cambios y restauraciones, pero no prueban una historia completa frente a borrados o escrituras privilegiadas. Documentos operativos que cambian legítimamente, como el vencimiento de un intento, requieren un criterio propio; una comparación ciega puede producir revisiones innecesarias. Antes de activar, definir cómo se persiste y recupera una fotografía previa si el proceso o Firestore caen después de una respuesta remota.

## Casos que deben medirse por separado

- Revisión, recibo, UID o captura faltantes o cambiados antes de reservar; ninguna solicitud nueva a Cuenta ni trabajo.
- Mismo cambio durante reserva, incluso si el documento se restaura antes del ACK: contar efecto en Cuenta simulada, respuesta, trabajo e incidencia por separado.
- Una respuesta de reserva perdida seguida de `status:reserved` en el drenador no crea un trabajo con revisión retirada. Ni `404` ni timeout equivalen a liberación.
- Voz correcta como control; cuerpo, modelo, voz, ordinal o texto distintos fallan antes de Cuenta y proveedor. Cambios durante `admit`, o entre fragmentos, impiden llamadas nuevas y dejan la admisión incierta o revisable.
- Repetición idéntica y concurrente no crea otra reserva ni repite el proveedor; una repetición con UID o vínculo diferente falla. Un `receiptOnly` y una respuesta del proveedor perdida nunca permiten reenviar sin un protocolo de idempotencia demostrado.
- No mostrar datos ni bloquear una cuenta distinta por evidencia no atribuible; mantener visible la consulta autorizada de otros trabajos ya capturados.
- Comprobar el límite de confianza: si dos registros de revisión se manipulan coherentemente por un escritor privilegiado, su coherencia matemática no demuestra procedencia. En particular, el `baseHash` histórico se compara, pero no se reconstruye al leer; demostrar la historia requeriría evidencia adicional.

Los ensayos usan solamente Firestore Emulator y transporte/proveedor en memoria; no prueban IAM, cuotas, facturación real, almacenamiento GCS ni red de producción. La cuenta recién creada carece de habilitación comercial: el uso actual de `aiPilot` y `simulationOnly` sigue siendo un gate y no se modifica en esta fase.
