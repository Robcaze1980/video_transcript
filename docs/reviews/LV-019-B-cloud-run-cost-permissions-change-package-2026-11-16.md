# LV-019.B · costo, permisos y cambios del puente a Cloud Run

**Para revisión de Rob · 16 nov 2026.** Es un paquete de decisión, no una autorización para conectar. No se llamó a un servicio Cloud Run real, no se editó IAM/red/Hosting y no se desplegó nada.

## Qué está probado y qué no

- La candidata local usa Auth/Firestore Emulator y servicios de loopback. Sus pruebas pasaron, pero el assertion de gateway es sintético; no acredita IAM, token OIDC de Google, VPC ni Hosting.
- La cuenta activa de `gcloud` es `[correo del dueño]`; su proyecto predeterminado sigue siendo `satellite-ehl-rob` y no se cambió. El readback autenticado por API, fijando el consumidor de cuota en `vistavo-prod`, confirmó proyecto activo, facturación y recursos. Resumen reproducible/sanitizado: `outputs/lv019-b-cloudrun-local-bridge-20261116/cloud-readback-20261116.md`.
- Readback vivo: `vistavo-prod` (`107404655346`) está `ACTIVE`, con facturación vinculada a `Billing for Robertson`. En `us-central1` existen `vistavo-account-api`, `vistavo-files-api` y `vistavo-files-maintenance`. `vistavo-files-api` es `INGRESS_TRAFFIC_INTERNAL_ONLY`, URI `https://vistavo-files-api-v5lc7z6dyq-uc.a.run.app`, 1 CPU, 2 GiB, timeout 300 s, concurrencia 8, máximo 2 instancias, mínimo sin configurar (por defecto 0), revisión `vistavo-files-api-00009-mr2`. No tiene VPC configurada directamente.
- Red viva: VPC `vistavo-private`, subnet `vistavo-us-central1` (`10.40.0.0/24`), `privateGoogleAccess=true`. Existe además la red/subred `default`; no se propone usarla. La existencia no demuestra ruta efectiva del futuro gateway ni su tarifa.
- IAM vivo: la política propia de `vistavo-files-api` devolvió `bindings=[]`; en la política de proyecto no aparece binding explícito `roles/run.invoker`, `allUsers` ni `allAuthenticatedUsers`. **Esto contradice la frase del plan que llama a `vistavo-bootstrap` su invocador actual.** No afirmar que no hay principals efectivos: roles amplios de propietario/administrador pueden dar acceso, y este readback no resuelve todos los permisos heredados/effectivos. La política de proyecto conserva `vistavoFileVerifier` (solo `firebaseauth.users.get`) y bindings `serviceUsageConsumer` para identidades existentes.
- Cuota viva de cuentas de servicio: 11 existentes frente a cuota efectiva 100; el dato histórico `SAquota10` del 13 nov ya no es el límite actual. El proyecto permite creación según la cuota leída, pero **esto no autoriza crear identidades** ni demuestra permisos de creación. El límite de solicitudes de creación observado es 3/min.
- Hosting vivo: release `1794796143133000`, versión `c5bb31bab5c215e3`, publicada `2026-11-16T02:29:03.133Z`. Reescribe `/api/account/**` a `vistavo-account-api`; no tiene rewrite `/api/video/**`. La portada continúa con `connect-src 'none'`; las rutas de acceso/cuenta permiten Firebase Auth y mismo origen, no conectan aún el panel de video a Cloud Run. Configuración/resumen completo en el artefacto citado arriba.
- `firebase.commercial.json` protege la web comercial con `connect-src 'none'` y no contiene un rewrite de video. La configuración de páginas autenticadas se genera/controla en `scripts/publicAuthAssets.mjs`; hoy `accountHosting()` declara solo `/api/account/**` hacia `vistavo-account-api` y cabeceras privadas. No ampliar la CSP comercial.

## Diseño que se somete a revisión

```text
Navegador → vistavo.app/api/video/**
          → Firebase Hosting rewrite
          → nuevo gateway Cloud Run público, pero exige Firebase ID token
          → Direct VPC egress → vistavo-files-api, que sigue internal
```

El gateway comprobaría Firebase ID token, emisor, vencimiento, revocación, correo y rutas. Reenviaría el token del usuario para que `vistavo-files-api` vuelva a comprobar identidad y propiedad. Para IAM entre servicios usaría un ID token Google firmado, audiencia igual a la URL `run.app` del backend y el header `X-Serverless-Authorization`. No enviaría UID confiado desde navegador, no sería un proxy arbitrario y no tendría permisos de Firestore, GCS, Secret Manager ni proveedores de IA. Los trabajos largos seguirían siendo asíncronos por el tope de 60 s de Hosting.

## Coste mensual: estimación explícita del gateway

### Configuración presupuestada

- Región `us-central1` (solo si el readback confirma que coincide con el backend y con la red existente).
- Cloud Run servicio nuevo, facturación por solicitud, 1 vCPU, 512 MiB, mínimo 0 instancias y máximo 2. El máximo limita escalado; no reserva ni cobra dos instancias. `min=0` evita pagar una instancia ociosa fija; se aceptan arranques en frío.
- Supuesto de cálculo: **60 segundos facturables de gateway por video de 3 minutos**, en serie, diez solicitudes al gateway por video. Esto modela aproximadamente la transferencia en bloques y llamadas de control, pero no es una medición de video real.
- Tarifa pública consultada para `us-central1`: CPU activa USD 0.000024/vCPU-s; memoria USD 0.0000025/GiB-s; solicitudes USD 0.40/millón. Cuota sin costo de Cloud Run: 180,000 vCPU-s, 360,000 GiB-s y 2 millones de solicitudes al mes, agregada entre proyectos de la cuenta de facturación. El cálculo sin cuota libre sirve como techo de comparación; no presupone que la cuota esté disponible.

| Videos de 3 min/mes | CPU s asumidos | Memoria GiB-s | Solicitudes | Gateway sin descontar cuota libre | Gateway si la cuota libre completa está disponible* |
|---:|---:|---:|---:|---:|---:|
| 100 | 6,000 | 3,000 | 1,000 | USD 0.15 | USD 0.00 |
| 1,000 | 60,000 | 30,000 | 10,000 | USD 1.52 | USD 0.00 |
| 5,000 | 300,000 | 150,000 | 50,000 | USD 7.60 | USD 2.88 |

\* La cuota libre es compartida por proyectos y puede estar consumida por otros Cloud Run del mismo billing account. La tabla solo estima **el gateway**, no el costo completo del flujo.

**Cálculo reproducible:** `videos × 60 s × (1 × 0.000024 + 0.5 × 0.0000025) + videos × 10 × 0.40 / 1,000,000`. En 5,000 videos, el CPU que excede 180,000 s es 120,000 s = USD 2.88; memoria y solicitudes quedan bajo sus cuotas libres asumidas. Se excluyen tiempo de inicio/parada, concurrencia real, reintentos y variación de transferencia.

Si se exige una instancia siempre caliente, un mínimo de 1 instancia de 1 vCPU/512 MiB agregaría aproximadamente **USD 9.72 por 30 días ociosa**, usando la tarifa idle de instancia mínima (`2,592,000 s × (0.0000025 + 0.5 × 0.0000025)`). No se propone ese mínimo. A tarifa activa, ese mismo mes sería aproximadamente USD 65.45.

### Conceptos fuera de la cifra

- Cómputo del backend `vistavo-files-api` y workers existentes; tiempo/bytes adicionales que origine el nuevo tráfico.
- Almacenamiento/operaciones de GCS, Firestore, logs más allá de cuota libre, Artifact Registry/Cloud Build y cualquier transferencia externa.
- Hosting: sus cuotas gratuitas publicadas son 10 GB de almacenamiento y 360 MB/día de transferencia; uso total se comparte con el sitio. No se midió el consumo actual ni se estimó el exceso.
- ASR, traducción, TTS/voice-over y cualquier proveedor AI; el gateway no debe invocarlos directamente.
- Tarifas comerciales, saldo, compras y costo de un video de mayor duración/tamaño.

Google indica que la transferencia entre servicios Cloud Run en la misma región no tiene cargo de transferencia; el tráfico hacia redes VPC puede seguir SKUs de transferencia de VPC. Aunque el readback confirma la subred, no confirma una ruta efectiva del gateway ni mide tamaño de archivos/tráfico, por lo que no se asigna un cero inventado a la red. Cloud Logging incluye los primeros 50 GiB/proyecto/mes y luego cuesta USD 0.50/GiB; se propone no registrar cuerpos, contenido, tokens ni URLs firmadas.

## Permisos/recursos exactos que requeriría una fase posterior

| Alcance | Cambio propuesto | Límite de seguridad |
|---|---|---|
| Identidad runtime | Crear `vistavo-video-gateway@vistavo-prod.iam.gserviceaccount.com`, sin llave JSON | Identidad administrada del nuevo gateway; sin acceso directo a Firestore, GCS, secretos o proveedores |
| Entrada del gateway | Permitir invocación pública **solo en el nuevo servicio** para que Hosting lo pueda reescribir | En plataforma: `allUsers` con `roles/run.invoker` en el gateway (o mecanismo equivalente de invocación pública). La aplicación rechaza cada solicitud sin Firebase ID token válido. Es una superficie pública y necesita límites, logs seguros y pruebas negativas |
| Backend privado | Conceder `roles/run.invoker` a la identidad del gateway **a nivel del servicio `vistavo-files-api` solamente** | No proyecto entero; conservar `ingress=internal`; no añadir `allUsers`. El readback actual encontró la política del servicio vacía; conciliar el inventario/effective invokers antes de ejecutar. No asumir que `vistavo-bootstrap` es el invocador vigente. |
| Revocación Firebase | Dar al gateway `projects/vistavo-prod/roles/vistavoFileVerifier`, ya definido en el plan de archivos | Rol personalizado con solo `firebaseauth.users.get`, a nivel del proyecto. Lo necesita `verifyIdToken(token, true)` para comprobar revocación; no conceder `firebaseauth.admin` |
| Cuota de API | Añadir `roles/serviceusage.serviceUsageConsumer` al gateway en el proyecto, siguiendo el patrón de runtimes de `files.plan.json` | Incluye `serviceusage.services.use`, no permite administrar/habilitar APIs. Confirmar en el readback si ADC fija `vistavo-prod` como proyecto consumidor; si no se usa como cuota, no añadir el binding |
| Logs | El gateway escribiría únicamente a `stdout`/`stderr` | Cloud Run los envía a Cloud Logging automáticamente; no conceder `roles/logging.logWriter` salvo que una implementación posterior llame directamente a la API Logging |
| Red | Conectar el gateway por Direct VPC egress `ALL_TRAFFIC` a la VPC/subred existentes, si readback confirma ruta/IP disponible y Private Google Access adecuado | No crear conector ni cambiar ingress del backend; no crear VPC/subred hasta nueva decisión explícita |
| Firebase Hosting | Añadir rewrite exacto `/api/video/**` → `vistavo-video-gateway`, región comprobada | No cambiar el rewrite `/api/account/**`; no apuntar el navegador al backend privado |
| Cabeceras/CSP | Añadir `Cache-Control: private, no-store`, `Vary: Authorization` y CSP API `default-src 'none'; frame-ancestors 'none'; base-uri 'none'` a `/api/video/**`; permitir same-origin solo en la pantalla de cuenta | Dejar `firebase.commercial.json` y la CSP de portada intactos; afirmar guards exactos contra rutas de cuenta, comerciales y helpers |

La identidad runtime necesita `roles/run.invoker` en el servicio privado y el rol personalizado de lectura de revocación (`firebaseauth.users.get`) a nivel de `vistavo-prod`. También se propone `roles/serviceusage.serviceUsageConsumer` solo si el ADC del gateway usa explícitamente `vistavo-prod` como cuota de las llamadas Auth; el readback/preflight debe determinarlo. No requiere `roles/firebaseauth.admin` ni `roles/logging.logWriter` para logs por `stdout`/`stderr`. La plataforma de despliegue necesitará permisos de operador para crear identidad/servicio/imagen y escribir los bindings puntuales; **no se solicita ni se concede ahora ningún permiso de operador**.

**Cuota de cuentas de servicio:** el plan de producción conserva un bloqueo histórico del 13 nov (`SAquota10`). El readback del 16 nov muestra cuota efectiva 100 y 11 cuentas de servicio existentes, por lo que ese límite histórico está obsoleto. Aun así, antes de crear `vistavo-video-gateway` hay que repetir el readback cerca de la operación y verificar permisos de creación. El espacio de cuota no autoriza creación ni justifica reutilizar `vistavo-bootstrap` u otra identidad.

## Archivos que cambiaría la implementación, después de aprobación

1. `server/commercial/isolatedCloudRunBridge.ts`: separar adaptador local del cliente de producción; obtener el token OIDC del metadata server/Google Auth, con audiencia exacta, nunca con clave descargada.
2. Nuevo `server/commercial/cloudRunGateway.ts` y pruebas: allowlist `/api/video/**`→`/api/cloud/**`, Firebase ID token, identidad Google del servicio, streaming, límites, headers y errores.
3. Nuevo Dockerfile/plan/creación-verificación, en archivos nuevos bajo `deploy/google-cloud/`; identidad y servicio distintos, `min=0`, `max=2`, sin env vars secretas, sin GCS/AI permisos en gateway.
4. `scripts/publicAuthAssets.mjs`: extender `accountHosting()` con rewrite y headers de video, sin cambiar CSP general.
5. `scripts/checkPublicAuthStatic.mjs`, `scripts/checkCommercialStatic.mjs` y sus pruebas (`server/commercial/publicAuthExport.test.ts`): validar que el rewrite exacto solo aparece en la configuración de cuenta y que comercial/marketing conserva `connect-src 'none'`.
6. Cliente autenticado del panel, en los archivos del flujo de cuenta/video que se identifiquen en la implementación, para usar solo URL same-origin y flag apagado. No se fijan nombres de archivo aún porque la página final de video no está integrada.
7. `backlog.md`, `gantt.md`, `HANDOFF.md`, `bitacora.md` y `errorlogs.md` cuando haya implementación o incidente con evidencia.

**No cambiar:** `firebase.commercial.json`, el servicio privado, Auth/proveedores/Firestore/GCS actuales, el procesador/worker AI, saldo/pagos, dominio/DNS o cualquier servicio de Techos.app. Sin Cloud SQL.

## Reversión y gates

Para retirar la conexión: (1) remover el rewrite y headers `/api/video/**` del config de cuenta y publicar solo Hosting tras aprobación; (2) comprobar que la ruta de Hosting dejó de alcanzar el gateway; (3) quitar `allUsers`/invocación pública del gateway para cerrar su URL directa; (4) quitar, solo del principal gateway, los bindings de `roles/run.invoker` en `vistavo-files-api`, `vistavoFileVerifier` y `serviceusage.serviceUsageConsumer` si se añadieron; (5) revisar tráfico/logs. Cloud Run no ofrece operación de "detener" un servicio: dejarlo escalado a cero no elimina la URL pública ni la superficie. Eliminar el servicio, la identidad o la imagen requiere una decisión/aprobación separada. No se borra el backend, GCS, Firestore ni otros principals.

Antes de cualquier conexión real, exigir: readback fresco explícito en `vistavo-prod`; revisión Qwen4 Max independiente; control de no-secrets/rutas/rewrites; candidata gateway sin proveedores ni cobros; positivos y negativos contra backend; costo real del primer ensayo y apagado confirmado. La activación del flujo comercial y publicación necesitan decisión separada.

## Fuentes oficiales consultadas · 16 nov 2026

- [Cloud Run pricing](https://cloud.google.com/run/pricing): SKU/request billing, cuotas libres agregadas por billing account, same-region y VPC data transfer.
- [Firebase Hosting → Cloud Run](https://firebase.google.com/docs/hosting/cloud-run): rewrites y timeout de 60 s.
- [Cloud Run private networking](https://docs.cloud.google.com/run/docs/securing/private-networking): llamada entre servicios internos debe circular por una VPC elegible.
- [Cloud Run service-to-service auth](https://docs.cloud.google.com/run/docs/authenticating/service-to-service): rol invoker, audiencia del servicio y `X-Serverless-Authorization`.
- [Firebase Hosting quotas/pricing](https://firebase.google.com/docs/hosting/usage-quotas-pricing): cuotas Hosting.
- [Cloud Logging pricing](https://cloud.google.com/logging): cuota incluida y costo de ingestión.
- [Cloud Run logging](https://docs.cloud.google.com/run/docs/logging): salida `stdout`/`stderr` capturada automáticamente, sin cliente API.
- [Service Usage quota project](https://docs.cloud.google.com/docs/quotas/set-quota-project): `serviceusage.services.use` requerido cuando una llamada fija un proyecto como cuota.

## Estado de revisión

- Código local/pruebas de la candidata: PASS según el checkpoint LV-019.B; no se repiten en este paquete.
- `gcloud` activo: cuenta correcta, proyecto local predeterminado ajeno y sin cambios. Readback de APIs completado en modo solo lectura; resumen `outputs/lv019-b-cloudrun-local-bridge-20261116/cloud-readback-20261116.md`. Incluye advertencias sobre el invocador del backend, la política efectiva y los límites de inferencia.
- T3/Qwen4 Max vía CLI local: la revisión original del paquete fue PASS; auditoría del readback detectó y marcó FALLA una frase obsoleta sobre subred; corregida y verificada PASS. Recibos completos en `outputs/lv019-b-cloudrun-local-bridge-20261116/qwen-cost-permissions-review-thread.json`, `qwen-cost-permissions-readback-followup-t3.json` y `qwen-cost-permissions-readback-final-t3.json`. Tokens/costo T3 no visibles en el CLI.
- Cambios cloud, IAM, red, Hosting, despliegue: **ninguno realizado**. La aprobación de Rob aplica a la estimación del gateway; no autoriza conexiones ni cambios.
