# LV-019.B · Revisión independiente del puente Hosting → gateway público → Cloud Run privado

**Tipo:** revisión de arquitectura, solo lectura. No se editó código ni configuración, no se desplegó nada.
**Alcance:** propuesta de `vistavo.app` (Firebase Hosting) → gateway Cloud Run público → servicio privado de video/IA.
**Revisión:** 2026-11-16 · `df96e12` (+ `docs/specs/LV-019-B-puente-cloud-run-privado.md` sin trackear).

## Qué se inspeccionó

- `deploy/google-cloud/files.plan.json` (servicios, invokers, jobs, notas).
- `deploy/google-cloud/account.plan.json` (constraints `noVpc`, `hostingRewriteDeferred`).
- `firebase.commercial.json` y `outputs/vistavo-account-services-20261114/firebase.json` (CSP publicada y rewrite vigente).
- `scripts/publicAuthAssets.mjs`, `scripts/checkCommercialStatic.mjs`, `scripts/checkPublicAuthStatic.mjs` (guards).
- `server/commercial/firestoreHttp.ts`, `server/commercial/privateObjectPlan.ts`, `server/commercial/isolatedCandidateProxy.ts`.
- `docs/specs/LV-019-B-puente-cloud-run-privado.md`, `LV-019-B-video-text.md`.

## Lo que está bien planteado

- Separar identidad de persona (`Authorization: Bearer <Firebase ID token>`) de identidad servicio-a-servicio (`X-Serverless-Authorization: Bearer <Google ID token>`) es el patrón correcto de Cloud Run y es coherente con el handler, que lee el token de usuario desde `authorization` (`server/commercial/firestoreHttp.ts:56`) y revalida con revocación (`verifyIdToken(token, true)`).
- Mantener el backend en `INGRESS_TRAFFIC_INTERNAL_ONLY` y no añadir `allUsers` al servicio de video es correcto: Hosting no debe apuntar el rewrite al servicio interno.
- El modelo de carga por bloques de 8 MiB (hasta 128 bloques, objeto ≤ 500 MB, `server/commercial/privateObjectPlan.ts:4-12`) y el límite JSON de 400.000 B (`firestoreHttp.ts:17`) caben bajo el tope de 60 s de Hosting si cada operación es acotada y las descargas se transmiten en streaming (`firestoreHttp.ts:101-104`).
- Trabajos largos asíncronos con ID de trabajo es la única opción viable con el tope de 60 s.

## Brechas materiales (3)

### 1. «Sin cambios a servicios/IAM existentes» es insatisfacible con este diseño
El gateway no puede invocar `vistavo-files-api` sin ser añadido a la lista de invokers de ese servicio. Hoy esa lista es exactamente una identidad: `serviceAccount:vistavo-bootstrap@vistavo-prod.iam.gserviceaccount.com` (`deploy/google-cloud/files.plan.json`, `services.api.invokers`), con `ingress: INGRESS_TRAFFIC_INTERNAL_ONLY`. Conceder `roles/run.invoker` al SA del gateway en el servicio privado **es** un cambio de IAM sobre un servicio existente, y es obligatorio. Además, la llamada necesita salida por VPC: la única configuración Direct VPC/`ALL_TRAFFIC` existente está en el job `proof`; el gateway requiere su propia adhesión de egress. La propia especificación lo admite (gate 5: aprobación explícita de Rob para IAM). El enunciado «no changes to existing services/IAM» es, por tanto, incorrecto: la ruta no es de solo-lectura sobre el estado actual.

### 2. La configuración publicada de Hosting está fail-closed contra la llamada de mismo origen
La CSP comercial es `connect-src 'none'` en todos los orígenes de página (`firebase.commercial.json` en `**`; `outputs/vistavo-account-services-20261114/firebase.json` en `/es-419/**`, `/en-us/**`, `/` y demás). Un `fetch('/api/video/...')` desde una página comercial queda bloqueado hasta relajar `connect-src` a `'self'` solo en las páginas que usan la API. Ese cambio no es inocuo: `scripts/checkCommercialStatic.mjs:17` lanza `Release guard` y `scripts/checkPublicAuthStatic.mjs:18` lanza `Commercial policy weakened` si la CSP comercial deja de contener `connect-src 'none'`. En paralelo, `assertAccountHosting` (`scripts/publicAuthAssets.mjs:8`) lanza `Account-only rewrite boundary` salvo que `hosting.rewrites` sea exactamente el único rewrite `/api/account/**`, y la línea 10 rechaza cualquier header con origen `/api/**`. Es decir: el rewrite `/api/video/**`, su header `private, no-store`/`Vary: Authorization` y la relajación de CSP exigen modificar el sitio publicado y reescribir los guards de forma intencional.

### 3. Detalles de contrato del handler que el puente debe congelar
El handler privado rechaza con 403 cualquier petición con `Origin` presente y distinto de `https://vistavo.app` (`server/commercial/firestoreHttp.ts:55`) y solo lee el token de usuario de `authorization` (`:56`); el gateway debe por tanto preservar `Origin` exacto, inyectar `X-Serverless-Authorization` y eliminar cualquier `X-Serverless-Authorization` aportado por el navegador. Además, la ruta de contenido devuelve siempre `Content-Disposition: inline` (`:100`) y ningún handler lee `download=1`: el comportamiento de «descarga» como adjunto no está implementado y debe declararse dentro o fuera de alcance antes de congelar el contrato.

## Condiciones antes de implementar

- Recalificar el enunciado: la ruta implica cambios de IAM (invoker del gateway), VPC egress nuevo y cambios de Hosting/CSP/guards. Requiere aprobación explícita de Rob.
- Congelar la tabla fija `/api/video/**` → `/api/cloud/**`, allowlist de métodos/headers/query, formato de error y presupuesto, con pruebas de token expirado/revocado/no verificado, ruta/método desconocido, carga fragmentada y descarga/HEAD/range.
- Verificar en un proyecto/candidata aislado el ID token del invocador con audiencia igual a la URL del servicio, `roles/run.invoker` solo para el gateway y el acceso positivo/negativo al servicio interno.
- No habilitar el flag comercial ni publicar; no tocar precios, saldo, proveedores ni las bases de cuenta/video.

## Base documental

- Firebase Hosting con Cloud Run: rewrites y tope de 60 s.
- Ingress de Cloud Run: fuentes admitidas por `internal` y exigencia de tráfico por VPC.
- Autenticación servicio a servicio: ID token firmado por Google, `roles/run.invoker` y `X-Serverless-Authorization` cuando `Authorization` lleva auth de aplicación.
- Verificación de ID tokens de Firebase.

=== RESUMEN FINAL ===
RESULTADO: FALLA
EVIDENCIA: `vistavo-files-api` es internal-only con un solo invoker (`vistavo-bootstrap`) en `deploy/google-cloud/files.plan.json`; CSP comercial `connect-src 'none'` reforzada por `scripts/checkCommercialStatic.mjs:17` y `scripts/checkPublicAuthStatic.mjs:18`, y `assertAccountHosting` limita rewrites a `/api/account/**` (`scripts/publicAuthAssets.mjs:8`); `server/commercial/firestoreHttp.ts:55` rechaza otro `Origin` y `:100` entrega inline sin `download`.
NEGATIVOS: «sin cambios de IAM» es incompatible con invocar un servicio interno protegido; la ruta no funciona hoy sin cambiar Hosting, CSP y guards.
BLOQUEOS: aprobación de Rob para IAM, VPC egress y CSP/rewrites.
=== FIN RESUMEN ===
