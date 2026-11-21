# LV-019.B · Plan integral en paralelo (autorizaciones del dueño, 20 nov 2026)

**Estado: PLAN v2 ACEPTADO CON LÍMITES (20 nov 2026).** T3 ronda 1: 4 respuestas (1 PASS, 3 FALLA, todos los hallazgos adjudicados); ronda 2 sobre esta versión: PASS de GLM y PASS de DeepSeek con tres pendientes MEDIA incorporadas; ronda 3 sobre las decisiones posteriores del dueño (G0, política de cobro, costes): GLM PASS y DeepSeek FALLA, con sus hallazgos incorporados (§0.1, C2, C3) ([recibo](../evidence/lv019-b-t3-plan-integral-20261120/RECIBO.md)). No es evidencia de que nada funcione en la nube; es el orden de trabajo. Documento de plan; no cambia código, nube ni saldo. Concreta las «preguntas abiertas» de la [propuesta de nube](LV-019-B-conciliacion-propuesta-nube.md) y, por instrucción del dueño, levanta la regla propia «no empezar ni diseñar la voz hasta cerrar conciliación y privacidad». La **activación** de la voz a clientes sigue sujeta a las puertas de la sección 5.

## 0. Decisiones del dueño del 20 nov, después del plan v2

| Tema | Respuesta del dueño | Efecto en el plan |
|---|---|---|
| Correo de alertas | Lo entregó en el chat | **No se escribe en el repositorio ni en prompts**; solo irá a la configuración de Monitoring al crear el canal (A3). |
| Operadores | «solo yo opero» | Un solo operador, el dueño. Su UID se recibió el 20 nov. |
| Precio de la voz | US$0.10 por minuto | Confirmado. El coste del proveedor es ≈13,5 % de ese precio hasta fin de 2026 y ≈27 % desde el 1 ene 2027 ([C0a](LV-019-B-voz-c0a-hechos-proveedor-20261120.md)). |
| Política de cobro | «no se cobra si fallamos» | **Sin cobro parcial**: un trabajo de voz fallido se libera; una reserva `UNKNOWN` solo retiene saldo, no lo cobra, hasta conciliar (C2/C3). |
| Retención del audio | **90 días** (decidido tras ver las opciones) | Guardar 10 min cuesta ≈US$0,0016 en 90 días; borrado inmediato a petición del cliente y al eliminar el proyecto; se aplica con la purga por lotes con marcadores (C0a). |
| Cancelación del cliente tras enviar al proveedor | «se cobra lo que ya se cobró y proporcional al precio» | **Mi lectura (a corregir si no era así):** se cobra solo la parte ya enviada **y entregada**, proporcional al precio (segundos fuente cubiertos, redondeo hacia arriba); el resto se libera. Antes de enviar nada se libera todo. Los fragmentos en vuelo o sin confirmar al cancelar no se cobran (coherente con «si fallamos, no se cobra»). Si se cobra lo entregado, lo entregado debe poder descargarse. **Requiere ampliar el contrato de Cuenta** (paso C2a). |
| Pares de voz | «analizamos si se puede los mismos pares de transcript» | Análisis en C0a: la voz depende solo del idioma destino y los diez idiomas figuran en el proveedor; falta escuchar y aprobar cada uno (LV-004). |
| Gasto de medir el coste real | Autorizado | Vigente, pero **no se hicieron llamadas nuevas**: no hay clave de Gemini en esta PC; se usan las mediciones reales del 14 nov y la tarifa publicada. |
| Tope de la prueba online | «$5» | Tope de US$5 de gasto de proveedor para la prueba online con saldo real (≈370 min de voz a la tarifa de 2026, ≈185 min desde 2027, sin contar texto ni otros costes). Cualquier gasto mayor se consulta antes. |
| Clave de Gemini | «sí de facturación» | El dueño confirma que la clave de producción es de un proyecto con facturación (servicio de pago). Codex no puede comprobarlo; cuenta como afirmación del dueño. |
| Despliegue | «no hacer deploy hasta que voz esté listo también» | **G0: no se despliega nada** (ni mantenimiento ni operador) hasta que la voz esté lista; la primera salida a la nube es conjunta. Mi lectura de «lista»: la voz cumple G1–G5 en local y se prueba por primera vez en la nube con cuentas de verificación, sin abrir al público. A4 y A5 quedan diferidos; A0–A3 no son despliegue. |

### 0.1 Qué significa «lista» para el primer despliegue (T3 ronda 3)

1. **Voz lista en local:** regresión financiera completa en verde con la voz reabierta (las 5 pruebas pausadas adaptadas y verdes), B1 y B2 cerrados, C1–C3 y C6b implementados, política de cobro probada (sin cobro parcial, `UNKNOWN` con plazo máximo), retención y privacidad decididas, interruptor de emergencia probado y revisiones T3 y Gemini hechas.
2. **Aprobación por escrito** del dueño para el primer despliegue.
3. **Primer despliegue restringido:** sin tráfico público, solo cuentas de verificación, interruptor y reversión comprobados antes de encender. **Aquí se evalúa G6** (con y sin saldo, teléfonos reales); sin G6 no se abre al público.
4. **Antes de G0** solo se permiten, avisando antes al dueño y cada uno con su reversión: A0 (solo lectura), A1 (índice; reversión: borrarlo) y A3 (canal y política de alertas; reversión: borrarlos; la entrada de registro de prueba solo con su permiso). La lista está cerrada.
5. G0 retrasa la conciliación en la nube mientras la voz no esté lista; es una decisión consciente del dueño y el riesgo es bajo (producción vacía, sin clientes).

## 1. Qué autorizó el dueño (sus palabras) y cómo lo entiendo

Una autorización permite hacer algo; no obliga a hacerlo antes de que sea seguro. Cada paso de nube sigue la sección 2.

| # | El dueño dijo | Alcance que entiendo | Falta para ejecutar |
|---|---|---|---|
| 1 | «autorizado el disparador» | Un disparador periódico en la nube para el barrido de pendientes: ruta nueva colgada de la pasada de mantenimiento que ya corre cada 5 minutos (opción 1A), **más una alerta de frescura** (si el barrido deja de correr, avisa). **No** el modo `billing`, que mueve saldo. | Código del barrido aislado y probado; cadencia (propongo heredar los 5 minutos); T3 del cambio. |
| 2 | «canal es email» | Alerta por correo: métrica por registros + política de Cloud Monitoring con canal de correo (opción 2B), más alerta «sin datos». | Correo **recibido el 20 nov** (solo irá a la configuración de Monitoring; nunca al repositorio ni a prompts); confirmar en la documentación oficial; prueba de entrega real. |
| 3 | «solo yo y el email del destinatario de la alerta» | Operadores = solo el dueño (**confirmado el 20 nov**: «solo yo opero»). | **UID recibido el 20 nov** (no se guarda en el repositorio); se comprobará con una sesión real en A5. |
| 4 | «¿un lugar seguro? ¿Cloudflare?» | Pregunta; respuesta en la sección 4. | Confirmación de la recomendación. |
| 5 | «crear índice real» | Crear **solo** `billingHoldOutbox (state, nextAttemptAt)` en `vistavo-prod`, base `(default)`, con `deploy/google-cloud/billing-hold.indexes.json`. Lo usa la consulta de bloqueos del modo `billing` (`firestoreBackend.ts`, `where state==pending, nextAttemptAt<=ahora, orderBy nextAttemptAt`); crearlo no programa ese modo. | Permiso real de la identidad; verificación con la consulta exacta y estado `READY`; comprobar que no exige otro índice. |
| 6 | «autorizo los registros de producción» | Escribir en `vistavo-prod` **únicamente** alertas y auditoría en `billingPendingAlerts` y `billingPendingAudit`. Nunca filas de cola, saldos ni cuentas. | Ejecutor con guardas distintas de las del emulador; diferencias antes/después de **todas** las colecciones; «sin borrar por ahora» más cota de volumen. |
| 7 | «deploy» (después: «no hacer deploy hasta que voz esté listo también», §0) | Desplegar **solo** lo necesario para 1–6: imagen del servicio de mantenimiento con la ruta del barrido y, si procede, un servicio de operador. **Excluido hasta que el dueño lo confirme por escrito:** video a clientes, Hosting `/api/video/**`, modo `billing`, voz, compras, y subir a GitHub (no lo nombró). | Pospuesto por el dueño hasta que la voz esté lista (G0); el alcance se reconfirma entonces; aplicador con ensayo en seco, revisión nueva sin tráfico y reversión. |

## 2. Reglas de ejecución (valen para todo paso de nube)

1. **Lectura previa de solo lectura** y **ensayo en seco** del cambio exacto.
2. **Revisión T3 del cambio** (fachada, script o diff) **antes** de aplicarlo. FALLA o INCONCLUYENTE = no se aplica.
3. **Cadena de alerta probada antes** de desplegar código que dependa de ella.
4. **Despliegue = revisión nueva etiquetada y sin tráfico**; prueba de humo de archivos e IA con esa revisión; solo entonces promover. Barrido apagado por configuración hasta verificar índice `READY` y alerta.
5. **Reversión comprobada** antes de dar un paso por cerrado: apagar el barrido por configuración y verificar en los registros que ya no corre; volver a la revisión anterior con el comando preparado; retirar registros de prueba.
6. **IAM, secretos y permisos de invocación** los ejecuta el dueño con comandos exactos que yo preparo; no concedo roles ni manejo claves. Sin permiso, no se busca rodeo.
7. Cada paso se registra en bitácora con fecha, comando, resultado y evidencia. Nada mueve saldo. **Cualquier extensión del barrido que escriba algo más que las dos colecciones exige regresión financiera completa y reversión probada.**

## 3. Cinco vías en paralelo

### Vía A · Conciliación en la nube (autorizada)

| Paso | Qué | Depende de |
|---|---|---|
| A0 | Lectura previa: permisos efectivos (índices, Monitoring, Cloud Run), APIs habilitadas, margen de cuentas de servicio, permisos de Firestore de la identidad del mantenimiento y **ajustes de ingreso de los servicios** (hoy `INGRESS_TRAFFIC_INTERNAL_ONLY`, `files.plan.json`). Declara el límite: bases vacías **no** validan la conciliación. | — |
| A1 | Crear el índice real (autorización 5). Verificar con la consulta exacta, `READY` y que no se pide otro índice. | A0 |
| A2 | Código: ejecutor del barrido apto para la nube con guardas de escritura (solo 2 colecciones, ensayo en seco); **sub-manejador aislado** con su propio `try/catch` que nunca propaga, presupuesto de tiempo propio e idempotente; un latido por pasada; **prueba de frontera de importaciones** (la imagen del mantenimiento no importa rutas de escritura de colas, bloqueos ni modo `billing`); diferencia antes/después de todas las colecciones. Apagado por configuración. | A0 |
| A3 | Alerta: métrica por registros + política + canal de correo + alerta de **frescura/«sin datos»** (el latido mide que el barrido corrió, no el contenido de las colas: una cola vacía no dispara alerta, ninguna alerta depende del modo `billing`, que está apagado, y se documenta la latencia de detección); prueba de punta a punta con una entrada de registro de prueba marcada (incluye carpeta de spam y fallo del canal). **Antes** de desplegar A2. | A0, correo |
| A4 | Desplegar revisión nueva sin tráfico → prueba de humo de archivos/IA → promover con el barrido apagado → encender → primer barrido con 0 filas (**solo prueba el cableado, no la lógica**; la lógica la prueban emulador y mutaciones) → un registro de prueba etiquetado. Reversión comprobada. | A1–A3 |
| A5 | Operador: ver sección 4. Solo tras A0; el UID ya está recibido. **A0–A4 avanzan sin él.** Antes de cerrar: prueba real de aceptación desde la PC del dueño, prueba de rechazo (otro UID, sin token, sin permiso IAM) y **prueba de revocación** (retirar el permiso IAM y comprobar que deja de entrar); la URL no se publica. | A0, UID |

### Vía B · Integridad del saldo (local)

**B1 es la siguiente tarea local, sin depender del dueño** (así C1 no queda bloqueada sin fecha): recuperación tras caída entre las transacciones de Video y Cuenta; B2 historias antiguas o corruptas, liberación posadmisión y llamadas en vuelo; B3 regresión financiera completa al final de cada integración. **Antes de C1 se escribe el contrato de interfaz de B** (reserva, ACK, `UNKNOWN`, liberación) para no rehacer la voz si cambia la implementación.

### Vía C · Voz (nueva por instrucción del dueño; cerrada a clientes)

Piezas verificadas en local y desconectadas: canon v1 (99 pruebas), codec de marca (64), lectura transaccional de revisión/recibo (28/28), `billableSeconds`, cercas de cierre en el worker. Contrato: [voz desde revisión](LV-019-B-voz-desde-revision.md), [integración local](LV-019-B-voz-integracion-local.md).

| Paso | Qué | Depende de |
|---|---|---|
| C0a | **Hechos recogidos el 20 nov ([nota C0a](LV-019-B-voz-c0a-hechos-proveedor-20261120.md)); la clave de producción es de un proyecto con facturación (confirmado por el dueño el 20 nov; Codex no puede verificarlo); falta leer la adenda de datos.** Hechos y decisiones que condicionan el diseño: términos del proveedor sobre uso, retención y borrado; catálogo de voces; **coste real por minuto medido** frente al precio de US$0.10/min; privacidad y retención definidas (C6a). Decisiones del dueño abajo. | — (solo lectura/documentos; medir coste requiere autorizar gasto) |
| C0b | Criterio de calidad por par y voz (LV-004). Paralelo. | — |
| C1 | Reserva de voz (UID → marca → intención → reserva Cuenta simulada en la misma transacción). La reserva es en segundos fuente: no depende del precio ni de la retención. Solo emulador, con la interfaz apagada; **no se da por cerrada ni se integra hasta que B1 pase**. | contrato de B |
| C2a | **Diseño aceptado por T3 el 20 nov ([especificación](LV-019-B-liquidacion-parcial-y-liberacion-posadmision.md), sin código aún).** **Contrato de Cuenta para liquidación parcial (hallazgo del 20 nov, `server/account/backend.ts`, `settleVideo`).** Hoy Cuenta captura o libera la reserva **entera** (todo o nada), exige que `seconds` coincida con lo reservado (máximo 600 s) y **no permite liberar después de admitir una llamada** (queda cerrado a conciliación manual). Las dos políticas del dueño necesitan lo que hoy no existe: **captura parcial de K segundos con liberación atómica del resto**, y **liberación posadmisión con prueba de fallo o de no entrega**. Es un cambio de contrato financiero: especificación primero, pruebas primero, revisión T3, regresión de Cuenta y de Video, y compatibilidad con reservas antiguas (protocolos 1 y 2). C2 y C3 dependen de este paso. | B1, contrato de B |
| C2 | Admisión y llamada por fragmento. **Política mínima sin idempotencia del proveedor:** una sola llamada en vuelo; jamás reintento automático tras enviar; `callKey + requestSha256` como deduplicación local; envío sin ACK = `UNKNOWN` con reserva retenida; liberar solo con prueba de no inicio; reintento manual solo tras conciliación explícita. **No cobrar voz no entregada ni con otro texto:** la captura solo ocurre tras verificar el artefacto (WAV válido, duración) y que `voiceTextSha256` coincide con la revisión y el recibo vinculados (el mismo patrón de verificación que ya usa el pipeline de IA). **Política del dueño (20 nov): no se cobra si fallamos**; no hay cobro parcial (un trabajo de voz fallido se libera; una reserva `UNKNOWN` solo retiene saldo hasta conciliar). **Entrega verificada** (condición para capturar): respuesta del proveedor con audio, WAV válido (24 kHz, mono, 16 bits), duración coherente con el texto, `voiceTextSha256` igual al de la revisión y el recibo, objeto guardado con generación y recibo, y accesible por su propietario. **Cancelación del cliente (decisión del dueño, 20 nov):** antes de enviar al proveedor se libera todo; después de enviar se cobra solo la parte entregada y verificada, proporcional al precio, y se libera el resto; no se reintenta. Depende de C2a. | C1, C0a |
| C3 | Recuperación y conciliación de voz: ACK perdido y envejecimiento (una reserva `UNKNOWN` no queda retenida sin fin: **plazo máximo** a fijar con datos, estado visible al cliente como «en revisión», límite de `UNKNOWN` simultáneos por cuenta, una sola llamada en vuelo por trabajo; al vencer, alerta al operador con ventana de gracia y, si nadie la resuelve, **liberación con marcador (tombstone) para que un artefacto tardío no se pueda descargar ni cobrar**; nunca se captura sin entrega verificada). | B1, B2, C2 |
| C4 | Regresión **continua desde C1**; las 5 pruebas pausadas (140–143, 182) se reabren adaptadas en C2/C3. | C1 |
| C5a | Prototipo de cotización de solo lectura en navegador sintético; no confirma precio ni muestra saldo reservado. | — |
| C5b | Interfaz conectada (elegir voz, precio adicional confirmado, saldo, revisión que se narrará); teléfonos reales después. | C0a, C1, C2 |
| C6b | Cumplimiento: interruptor de emergencia probado, habilitación por cuenta apagada por defecto (hoy exige `aiPilot` y `simulationOnly`), auditoría. **No publicar la voz sin prueba en teléfono.** | C0a |

**Decisiones del dueño para la voz (no técnicas), estado tras el 20 nov:** (1) precio: **US$0.10/min, decidido**; (2) no cobro por fallo nuestro: **decidido, sin cobro parcial**; (3) cuánto tiempo se guarda el audio: **decidido, 90 días**; (4) pares y voces del lanzamiento: **análisis hecho** (mismos pares por idioma destino), falta elegir el primero y escuchar; (5) gasto de medir el coste real: **autorizado, con un tope de US$5 para la prueba online con saldo real** (≈370 minutos de voz a la tarifa de 2026 y ≈185 desde 2027, sin contar texto ni otros costes). Cancelación del cliente tras enviar: **decidido, cobro proporcional de lo entregado** (§0).

### Vía D · Experiencia móvil y calidad de idiomas

Pendientes del backlog (J1/J2 entre pestañas, MOV, 2–3 min, iPhone/Android físicos, LV-004). Solo requieren al dueño para los dispositivos físicos.

### Vía E · Gateway real, procesamiento real y prueba online (después)

Depende de A0, de B cerrada y de la regresión integrada. Aquí «deploy» alcanzaría al video con clientes: **no** se hace sin las puertas de la sección 5 y sin confirmar el alcance con el dueño.

## 4. Respuesta a «¿un lugar seguro? ¿Cloudflare?» (operador)

**Hallazgo nuevo:** los servicios de Cloud Run de este proyecto tienen ingreso **solo interno** (`INGRESS_TRAFFIC_INTERNAL_ONLY`); desde tu PC no se llega a ellos, ni con proxy ni con token. Un operador solo para ti necesita un servicio **nuevo y mínimo** con ingreso `all` (alcanzable por red, **no** equivale a «sin exposición») pero **sin invocadores públicos** (sin `allUsers`): Google exige tu identidad IAM (rol `run.invoker` concedido por ti) y la aplicación exige además tu token de Firebase verificado y tu UID en la lista. Se llega con `gcloud run services proxy` o con un token de identidad (la documentación del proxy menciona Linux, macOS, WSL y Cygwin, así que en Windows puede hacer falta el token; [documentación](https://docs.cloud.google.com/run/docs/authenticating/developers)). Falta A0 para confirmar permisos y cuota de cuentas de servicio.

**Cloudflare.** Hoy solo es DNS sin proxy para `vistavo.app`. No es «inseguro» y [Cloudflare Access/Tunnel](https://developers.cloudflare.com/cloudflare-one/) podría añadirse como capa adicional, pero la autorización final debe seguir en la aplicación (token + UID). Para un único operador añade un proveedor, otra cuenta con acceso a un endpoint que corrige saldos y, con Tunnel, un conector siempre encendido, sin ganar seguridad real sobre IAM + token. **Recomiendo no usarlo ahora**; si el dueño lo prefiere, se revisa aparte. Límite conocido: el limitador del operador es por proceso y con mínimo 0 instancias no limita; hace falta uno compartido en Firestore antes de depender de él.

## 5. Puertas antes de que algo toque a clientes

G0 **ningún despliegue de nada hasta que la voz esté lista** (decisión del dueño, 20 nov); G1 regresión financiera completa en verde con la integración final; G2 recuperación tras caída (B1) y legado (B2) cerrados; G3 readback de IAM/VPC/cuotas sin sorpresas de costo o permisos; G4 voz: privacidad y retención definidas, interruptor probado, habilitación por cuenta y apagada por defecto; G5 revisión T3 de la integración y revisión `google/gemini-4-hydrogen:batch` de migración/backend; G6 prueba online con y sin saldo, con teléfonos reales y, para voz, prueba en teléfono antes de publicar (se evalúa en el primer despliegue restringido, §0.1); G7 cualquier extensión del barrido que escriba más allá de sus dos colecciones. Ninguna puerta se cumple solo con simuladores.

## 6. Lo que necesito del dueño

1. Nada pendiente de identidad: el correo de alertas, el UID del operador y «solo yo opero» ya están recibidos.
2. Confirmar que «lista» (para el primer despliegue conjunto) significa lo que dice la §0, y que subir a GitHub sigue sin autorizar.
3. Confirmar la recomendación de operador (sección 4) o pedir Cloudflare.
4. Autorizar una **entrada de registro de prueba** en Cloud Logging para probar la alerta (A3), que puede hacerse antes del despliegue.
5. Decidir con qué idioma destino (y variante) se abre la voz primero (opciones en la [nota C0a](LV-019-B-voz-c0a-hechos-proveedor-20261120.md), §2).
6. **Confirmado por el dueño el 20 nov:** la clave de producción de Gemini pertenece a un proyecto con facturación (servicio de pago); Codex no puede verificarlo. De eso depende que el contenido no se use para mejorar productos de Google.
7. Retención de alertas: propongo «sin borrar por ahora», con cota de volumen medida.

## 7. Riesgos principales

Tocar el servicio de mantenimiento que ya atiende archivos e IA (aislamiento, revisión sin tráfico, reversión); primera escritura en producción (dos colecciones, ensayo en seco, diferencias de todas las colecciones); alerta sin entrega probada y barrido que deja de correr sin aviso (latido); identidad sin permisos suficientes (A0 primero); coste real de la voz no medido y términos del proveedor sin leer; un solo agente ejecutando cinco vías: el orden real lo marcan las dependencias.
