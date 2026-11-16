# LV-019.B · Propuesta de puente para la API privada de Cloud Run

**Estado: diseño cloud sin aprobar; Rob autorizó preparar un prototipo local aislado.** Esta autorización cubre solo código reversible y pruebas con Auth/Firestore Emulator y un backend privado simulado en loopback. No permite usar credenciales, URLs, IAM, red VPC, Firebase Hosting o servicios Cloud Run reales. El prototipo simula el token de invocador con un secreto efímero generado por el runner; no prueba una firma OIDC de Google ni acceso a Cloud Run. La web pública permanece en Firebase Hosting. El backend real conserva `ingress=internal` e IAM. Su futura conexión requerirá aprobación explícita para invocador IAM en `vistavo-files-api`, egress VPC, costos y cambios acotados de Hosting/CSP/guards. No se crea Cloud SQL. Qwen4 Max dio PASS condicionado al diseño; DeepSeek dio PASS de seguimiento al borrador corregido. Ninguna revisión autoriza cambios cloud.

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
- `vistavo-files-api` hoy solo permite al service account `vistavo-bootstrap` invocarlo. Antes de implementar, Rob debe autorizar en concreto que el service account dedicado del gateway reciba `roles/run.invoker` únicamente sobre `vistavo-files-api`; sin ese permiso, no habrá conexión entre gateway y servicio privado. La solicitud anterior de diseño no concede esta autorización.
- Cloud Run clasifica como interno el tráfico originado en una VPC elegible y pide enrutar las llamadas entre servicios por una VPC. La configuración exacta de salida VPC, DNS, URL destino y región debe verificarse para el proyecto real antes de tocar IAM.
- El límite de 60 s de Hosting descarta procesar una transcripción larga en la misma petición. El flujo debe separar crear trabajo, consultar estado y obtener resultado. Para medios, confirmar tamaño máximo por bloque, memoria, tiempo y reintento idempotente.
- El gateway público añade cómputo, transferencia y superficie expuesta. Antes de crear o desplegarlo: cotizar el tráfico esperado, acordar límites de instancias/cuotas, revisar reglas de log y obtener aprobación explícita de Rob para costos y cambios de IAM/publicación.
- No unir las bases de cuenta y video ni reutilizar la identidad/rol de los servicios existentes. No activar saldo, precio, compras, proveedores, Drive o voz como parte del puente.

## Gates de implementación propuestos

1. Completar con Rob el inicio de sesión local y observar en navegador la descarga TXT/SRT; la suite API ya cubre propietario y denegación a otra cuenta, pero no reemplaza esa observación.
2. Congelar un contrato del gateway con tabla fija `/api/video`→`/api/cloud`, allowlist de métodos/headers/query, límites de 400.000 B JSON y 8 MiB por bloque, formato de errores y presupuesto. Probar emuladores con dos cuentas, token expirado/revocado/no verificado, ruta/método desconocido, carga fragmentada, descarga/HEAD/range y cacheo; `download=1` solo en rutas de resultados AI, no en la ruta MP4 actual. Probar timeout e idempotencia.
3. Crear una candidata aislada del gateway sin endpoint a GCS ni proveedores. Confirmar configuración Direct VPC egress `ALL_TRAFFIC` + Private Google Access que corresponda al proyecto, probar acceso positivo y negativo al servicio interno y verificar ID token de invocador con audiencia exacta igual a la URL del servicio, además de `roles/run.invoker` solo para el gateway.
4. Hacer revisión independiente T3 de la implementación y ejecutar verificación de seguridad/costos. No habilitar el flag comercial.
5. Presentar inventario, costo estimado, la concesión de `roles/run.invoker` puntual, egress VPC, CSP/rewrites/guards exactos y plan de reversión a Rob. Desplegar/publicar solo después de aprobación explícita.

## Base documental

- [Firebase Hosting con Cloud Run](https://firebase.google.com/docs/hosting/cloud-run): rewrites a Cloud Run y timeout de Hosting de 60 s.
- [Ingress de Cloud Run](https://docs.cloud.google.com/run/docs/securing/ingress): fuentes admitidas por `internal` y exigencia de tráfico por VPC para llamadas desde otro Cloud Run.
- [Autenticación servicio a servicio](https://docs.cloud.google.com/run/docs/authenticating/service-to-service): ID token firmado por Google e `roles/run.invoker` en el servicio receptor.
- [Verificar ID tokens de Firebase](https://firebase.google.com/docs/auth/admin/verify-id-tokens): verificación del token de usuario en el backend.

Esta propuesta no acredita que Hosting pueda alcanzar directamente un servicio con `ingress=internal`; el gateway separado evita depender de esa premisa.

## Revisiones T3

- [Qwen4 Max · PASS condicionado](../reviews/LV-019-B-cloud-bridge-qwen-t3-2026-11-16.md).
- [DeepSeek v4.1 Flash · FALLA inicial, preservada](../reviews/LV-019-B-cloud-bridge-deepseek-t3-initial-2026-11-16.md).
- [DeepSeek v4.1 Flash · PASS de seguimiento tras aclarar gates](../reviews/LV-019-B-cloud-bridge-deepseek-t3-followup-2026-11-16.md). El PASS valida que el borrador sirve para planificar; no autoriza grants, red VPC, publicación ni costos.
