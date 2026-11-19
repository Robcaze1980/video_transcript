# LV-019.B · Propuesta de puente para la API privada de Cloud Run

**Estado vigente · 16 nov 2026: Rob autorizó conectar el flujo y publicar la integración si el trabajo pasa los gates técnicos y solo procesa contra saldo real.** La autorización previa de solo prototipo local queda superada para este alcance. Se permite preparar/modificar de forma acotada el gateway, IAM del servicio, red VPC, rutas/CSP de Hosting y los servicios de video necesarios. El diseño y el costo estimado del gateway fueron revisados; el usuario pidió que no se cree Cloud SQL ni se habiliten compras/PayPal o créditos ficticios. No se ha cambiado Cloud Run, IAM, VPC o Hosting todavía. La lectura de gcloud de esta sesión no respondió; antes de mutar, completar readback de recursos y permisos efectivos, reconciliar invocadores y validar que el diff respeta este diseño. Si un readback no puede verificarse, no desplegar con estado incierto.

**Histórico del diseño:** cuando se escribió este documento la autorización cubría únicamente el prototipo emulado. Las frases de aprobación pendiente más abajo describen esa etapa y se sustituyen por el estado vigente anterior; los PASS T3 revisaron diseño/prototipo y no se interpretan como revisión del deploy nuevo.

## Diseño recomendado

```text
Navegador (vistavo.app)
  ── mismo origen /api/video/* + Firebase ID token ──>
Firebase Hosting
  ── rewrite selectivo ──>
Cloud Run API Gateway dedicado (entrada HTTPS pública; auth de aplicación obligatoria)
  ── VPC + X-Serverless-Authorization (token IAM de gateway) ──>
Cloud Run de video/IA (ingress interno, roles/run.invoker solo para gateway)
  ──>
Firestore / GCS / proveedores según las APIs existentes
```

## Alcance autorizado del prototipo local · 16 nov 2026

- El navegador sigue llamando al origen local `127.0.0.1:3003`, con Firebase ID token del Auth Emulator.
- El proxy local enruta `/api/video/**` a un gateway de loopback. El gateway verifica usuario, emisor, revocación y correo verificado; solo traduce rutas de la tabla fija `/api/video/...` → `/api/cloud/...`.
- El gateway reenvía el Firebase ID token del usuario y agrega un `X-Serverless-Authorization` sintético. El servicio local en `3005` exige ese valor sintético y vuelve a verificar el token/propiedad del usuario. El secreto sintético se genera al arrancar y no se registra.
- Toda petición sin autenticación, ruta/método/query no permitidos o invocación directa del backend sin identidad del gateway debe rechazarse. Se conservan respuestas privadas `no-store` y streaming acotado.
- El token sintético sirve para probar separación de roles y headers solamente. No equivale a un ID token firmado por Google, IAM, Direct VPC egress, ingreso interno ni una llamada real a Cloud Run.
- Flags de transcripción/traducción/voz real, IA, pagos y publicación permanecen apagados; el almacenamiento local es efímero.

### Resultado de la prueba local · 16 nov 2026

**PASS local únicamente.** Se conectó la UI por `/api/video/**` al proxy de `3003`, luego al gateway aislado de `3006` y finalmente a la API privada emulada de `3005`. El Auth/Firestore Emulator mantiene sus puertos y bases separados. El runner crea un assertion efímero aleatorio de 64 hex y solo lo entrega al gateway y a la API. La API falla cerrada si el assertion falta y rechaza llamadas directas sin él; el navegador no puede suplirlo. Ambos lados verifican el Firebase ID token con `checkRevoked=true` y correo verificado, y el backend conserva la comprobación de propiedad.

El proxy y el gateway aceptan solo rutas/métodos explícitos; las consultas se limitan a `offset` en chunks y `download=1` en TXT/SRT. El gateway fija audiencia/destino a `http://127.0.0.1:3005`, reenvía el token Firebase del usuario, agrega el assertion sintético y conserva streaming/backpressure, límites de 400.000 B JSON y 8 MiB por bloque, respuestas `private, no-store` y `Vary: Authorization`. Se limita el drenaje de requests rechazadas a 16 MiB o 10 s. Test 1/1 sin omisiones; incluye revocación, correo no verificado, usuario ajeno, header de identidad falso, bypass directo, tamaños, query, ruta, rango, descarga y borrado. `npm run lint` y ambas builds PASS. Revisiones Qwen4 Max vía T3: PASS inicial y PASS de seguimiento. Evidencia completa en `outputs/lv019-b-cloudrun-local-bridge-20261116/`; uso/costo T3 no observables desde CLI.

**Cobertura restante del prototipo:** no se ejercitó la rama que cierra una conexión por exceder 16 MiB/10 s durante el drenaje, un `offset` de más de 20 caracteres ni una identidad Google firmada. Esta implementación no llama a Cloud Run real y no prueba sus grants, red VPC o Hosting. El token de loopback no es una credencial Google.

El gateway es la única pieza nueva que recibe tráfico desde Internet. Aunque el endpoint sea alcanzable públicamente para que Hosting pueda invocarlo, ninguna ruta de negocio acepta solicitudes sin autenticar: el gateway verifica el Firebase ID token y el servicio privado vuelve a verificarlo para resolver UID y propiedad. Esto separa la identidad de la persona (`Authorization: Bearer <Firebase ID token>`) de la identidad de servicio a servicio (`X-Serverless-Authorization: Bearer <Google-signed ID token>`). No se confía en un UID enviado en el cuerpo o en un encabezado del navegador.

## Responsabilidades y límites

1. **Firebase Hosting:** alojar la pantalla de video dentro del panel autenticado `/cuenta/**` y reenviar solo `/api/video/**` al gateway. Confirmar la ruta exacta del bundle publicado antes de programar headers. En Hosting, no apuntar el rewrite al servicio privado. La guía requiere invocación de plataforma sin autenticación en el servicio de destino del rewrite; por tanto, el gateway nuevo será invocable desde Internet a nivel de Cloud Run, pero exigirá Firebase ID token en cada ruta de API y no reenviará solicitudes anónimas al backend. Hosting limita las solicitudes a 60 segundos; los trabajos largos deben ser asíncronos y devolver un ID de trabajo. Para las páginas de cuenta la configuración existente ya permite `connect-src 'self'`; no ampliar la CSP de portada/marketing. Definir para `/api/video/**` `Cache-Control: private, no-store` y `Vary: Authorization`. Extender de forma intencional `assertAccountHosting` y las guardas de `checkCommercialStatic`/`checkPublicAuthStatic`, con pruebas que preserven la CSP estricta en portada y páginas de marketing.
2. **Gateway público dedicado:** servicio sin acceso directo a Firestore, GCS ni secretos de proveedores. Verifica token, proyecto emisor, expiración, revocación y correo verificado según la política existente; acepta solamente métodos/rutas permitidos, aplica límites de tamaño y tiempo, elimina encabezados de identidad aportados por el cliente, no es un proxy de URL arbitraria y registra un ID de correlación sin tokens ni contenido de clientes. El mapeo debe ser una tabla fija: Hosting conserva el path `/api/video/...`, mientras el backend espera rutas absolutas `/api/cloud/...`; toda ruta no mapeada responde 404. Conserva `Origin` cuando venga y solo reenvía los encabezados/query que necesita cada handler: Firebase `Authorization`, `Content-Type`, `Accept`, `Range`, `If-Range`, `offset` y, **solo en las rutas de artefactos AI que ya lo aceptan**, `download=1`. Quita `X-Serverless-Authorization` del request del navegador antes de insertar el token de gateway. El cuerpo JSON del backend admite 400.000 bytes y cada bloque de carga admite 8 MiB; usa stream para bloques/descargas, no cargues un video completo a memoria.
3. **Acceso interno:** identidad administrada exclusiva del gateway; `roles/run.invoker` concedido únicamente en el servicio privado. La llamada enruta por una VPC que Cloud Run reconozca como interna. El backend privado conserva `ingress=internal`, verifica el Firebase ID token y determina UID/propiedad. No se agrega `allUsers` al backend.
4. **Navegador:** manda el Firebase ID token en `Authorization` al mismo origen. Las decisiones de autorización descansan en token y propiedad del backend, nunca en CORS u `Origin` solamente. Descargas privadas se entregan con `no-store` y sin enlaces duraderos.

**Contrato pendiente de decisión:** los artefactos TXT/SRT de IA sí tienen `download=1`; la ruta actual `/content` del MP4 siempre devuelve `Content-Disposition: inline`. La primera prueba de descarga de esta fase cubre TXT/SRT. No cambiar el comportamiento del MP4 hasta decidir si se requiere una descarga con `attachment`.

## Riesgos y condiciones antes de implementar

- La guía de Firebase para Hosting → Cloud Run pide permitir invocación no autenticada en el servicio receptor. Por eso el receptor debe ser el gateway aislado, que impone autenticación Firebase a nivel de aplicación; no el backend de video. Sus controles no sustituyen la verificación de ID token y propiedad que el backend privado ya ejecuta.
- El readback disponible mostró vacía la política IAM propia de `vistavo-files-api` y no concilió permisos heredados/efectivos; por eso no se debe afirmar que `vistavo-bootstrap` sea el único invocador actual. Rob ya autorizó el 16 nov conectar el flujo completo, condicionado a saldo real, y aceptó la estimación del gateway como base. Bajo esa autorización, preparar la identidad dedicada y el `roles/run.invoker` mínimo en el servicio privado después de obtener un readback fresco. No desplegar si la lectura falla o el estado difiere materialmente del alcance/costo acordado.
- Cloud Run clasifica como interno el tráfico originado en una VPC elegible y pide enrutar las llamadas entre servicios por una VPC. La configuración exacta de salida VPC, DNS, URL destino y región debe verificarse para el proyecto real antes de tocar IAM.
- El límite de 60 s de Hosting descarta procesar una transcripción larga en la misma petición. El flujo debe separar crear trabajo, consultar estado y obtener resultado. Para medios, confirmar tamaño máximo por bloque, memoria, tiempo y reintento idempotente.
- El gateway público añade cómputo, transferencia y superficie expuesta. La estimación para volúmenes acordados fue aceptada como base; aplicar límites de instancias/cuotas y revisar logs. Si el readback o la cotización actual muestran un costo materialmente distinto, detener ese cambio y explicarlo antes de continuar.
- No unir las bases de cuenta y video ni reutilizar la identidad/rol de los servicios existentes. El precio y la reserva en saldo real están definidos en LV-019.B; no despachar sin reserva válida. Compras/PayPal y Drive no son parte de este puente.

## Gates de implementación propuestos

1. **Local/en paralelo:** conectar la reserva existente al worker/UI en candidata aislada. Probar dos cuentas y estados suficiente/insuficiente, token revocado/no verificado, idempotencia, captura, fallo confirmado, UNKNOWN, descargas y eliminación. Flags de proveedores reales apagados en estas pruebas.
2. **Readback cloud:** con proyecto `vistavo-prod` explícito, verificar IAM efectivo/heredado del servicio, ingress, identidad que lo invoca, VPC/egress/Private Google Access, cuotas, Hosting y CSP. Si no se obtiene evidencia actual, no mutar ni desplegar.
3. **Implementar conexión real bajo autorización vigente:** gateway dedicado y público solo como entrada de Hosting, ID token Firebase obligatorio en API, service account exclusivo, `roles/run.invoker` mínimo sobre la API privada, ruta interna VPC/OIDC con audiencia exacta, rewrite `/api/video/**` y CSP limitada a la página de cuenta. Mantener la API de video interna.
4. Probar positivos y negativos con identidades Google reales y servicios Cloud Run: token de usuario válido, correo/UID/propiedad, caller de servicio válido, rechazo de bypass/token falso, no exposición de rutas ajenas, límites, timeout e idempotencia. Revisión T3/Qwen del conjunto y pruebas/types/builds antes de producción.
5. Publicar Hosting y comprobar online con un saldo real suficiente disponible; sin saldo, demostrar que no se crea job ni se llama proveedor. Si el readback revela permisos/costos materialmente fuera de la autorización acordada, escalar ese delta antes de aplicarlo.

## Base documental

- [Firebase Hosting con Cloud Run](https://firebase.google.com/docs/hosting/cloud-run): rewrites a Cloud Run y timeout de Hosting de 60 s.
- [Ingress de Cloud Run](https://docs.cloud.google.com/run/docs/securing/ingress): fuentes admitidas por `internal` y exigencia de tráfico por VPC para llamadas desde otro Cloud Run.
- [Autenticación servicio a servicio](https://docs.cloud.google.com/run/docs/authenticating/service-to-service): ID token firmado por Google e `roles/run.invoker` en el servicio receptor.
- [Verificar ID tokens de Firebase](https://firebase.google.com/docs/auth/admin/verify-id-tokens): verificación del token de usuario en el backend.

Esta propuesta no acredita que Hosting pueda alcanzar directamente un servicio con `ingress=internal`; el gateway separado evita depender de esa premisa.

## Implementación local de reserva y liquidación · snapshot histórico del 16 nov 2026

Este bloque conserva lo observado el 16 nov. Para el estado vigente del emulador y el readback posterior, consultar el Master Plan y HANDOFF.

`AccountBillingClient` reserva `ceil(duración fuente)` segundos mediante Account API antes de crear el job; voz se reserva como segundo servicio solo para la revisión guardada. Un ID estable vincula reintentos. El backend de video no carga unidades en su ledger simulado cuando se usa esta ruta. La reserva se vuelve a verificar antes del procesamiento; job terminal guarda una acción en `billingOutbox`; el resultado no se puede descargar hasta confirmar capture. Reintentos de capture/release son idempotentes en Account API. UNKNOWN no genera liquidación automática. Un modo `billing` del worker puede drenar la outbox; el Scheduler/Job que lo ejecute todavía no está configurado.

La ausencia de habla comprobada libera saldo por decisión expresa de Rob, aunque el paso local de análisis de audio ya ocurrió. Esta excepción no se aplica a errores ambiguos. Cotización de texto y voz usa el mismo ceil de segundos y prorratea US$0.10/min por cada servicio elegido; la vista actual del candidato sigue en simulación. Tests unitarios focalizados PASS; la suite Firestore Emulator quedó colgada sin resultados y no acredita estas transacciones.

Este bloque no acredita conexión del gateway Hosting, permisos Cloud Run, IAM, VPC, proveedores reales, costo/factura, ni online con saldo positivo. La consulta de Cloud Run/IAM/VPC de esta sesión no respondió; no se modificaron recursos.

## Revisiones T3

- [Qwen4 Max · PASS condicionado](../reviews/LV-019-B-cloud-bridge-qwen-t3-2026-11-16.md).
- [DeepSeek v4.1 Flash · FALLA inicial, preservada](../reviews/LV-019-B-cloud-bridge-deepseek-t3-initial-2026-11-16.md).
- [DeepSeek v4.1 Flash · PASS de seguimiento tras aclarar gates](../reviews/LV-019-B-cloud-bridge-deepseek-t3-followup-2026-11-16.md). El PASS valida que el borrador sirve para planificar; no autoriza grants, red VPC, publicación ni costos.
