# LV-019.B · Seguimiento del puente Hosting → gateway público → Cloud Run privado

**Tipo:** seguimiento de revisión, solo lectura. No se editó código/config ni se desplegó nada.
**Alcance:** verificar si el borrador corregido de `docs/specs/LV-019-B-puente-cloud-run-privado.md` está bien acotado y completo para planificar.
**Revisión:** 2026-11-16 · spec sin trackear, `df96e12` para el resto.
**Se conserva la FALLA original** (`outputs/lv019-b-video-text-20261116/deepseek-cloud-bridge-review.md`): la solicitud inicial decía «sin cambios de IAM», condición incompatible con la ruta.

## Qué cambió en el borrador y si es correcto

- **Estado y alcance.** Línea 3 declara «propuesta, no aprobada para implementación» y admite que implementar exige un cambio explícito de IAM en `vistavo-files-api`, salida VPC propia y cambios acotados en Hosting/CSP/guards. Corrige de forma directa la contradicción que motivó la FALLA.
- **IAM del invocador.** Línea 33 y gate 5 (línea 45) piden autorización concreta de Rob para que el SA dedicado del gateway reciba `roles/run.invoker` solo sobre `vistavo-files-api`, y aclaran que la solicitud anterior no la concede. Coincide con el hecho verificado: hoy el único invoker es `serviceAccount:vistavo-bootstrap@vistavo-prod.iam.gserviceaccount.com` (`deploy/google-cloud/files.plan.json`, `services.api.invokers`), con `ingress: INGRESS_TRAFFIC_INTERNAL_ONLY`.
- **VPC egress.** Líneas 34 y gate 3 (línea 43) exigen Direct VPC egress `ALL_TRAFFIC` + Private Google Access, audiencia del ID token igual a la URL del servicio y prueba positiva/negativa contra el servicio interno. Correcto y completo para planificar.
- **Hosting/CSP/guards.** Línea 23 limita la relajación de `connect-src` a `'self'` solo en las páginas/recursos que usan la API, mantiene CSP estricta en portada y marketing y extiende de forma intencional `assertAccountHosting` y las guardas. Coincide con lo verificado: `scripts/checkCommercialStatic.mjs:17` (Release guard) y `scripts/checkPublicAuthStatic.mjs:18` (Commercial policy weakened) exigen `connect-src 'none'`; `scripts/publicAuthAssets.mjs:8` lanza `Account-only rewrite boundary` salvo el rewrite único `/api/account/**`. La relajación queda acotada y con pruebas que la preservan.
- **`download=1`.** Línea 24 y la aclaración de la línea 28 restringen `download=1` a las rutas de artefactos AI que ya lo aceptan y declaran el MP4 `/content` fuera de alcance. Verificado en código: `server/commercial/firestoreAiHttp.ts:28` (`/api/cloud/ai/jobs/<id>/results/<name>`) aplica `attachment` cuando `download=1`; `server/commercial/firestoreHttp.ts:100` mantiene el MP4 en `inline`. La afirmación es exacta.

## ¿Está bien acotado y completo para planificar?

Sí. Las tres brechas materiales de la FALLA quedan resueltas o explícitamente diferidas a aprobación: el cambio de IAM se nombra y se somete a autorización, el egress VPC queda como gate propio, y la modificación de Hosting/CSP/guards es acotada y verificable. La separación de identidades (`Authorization` del usuario vs `X-Serverless-Authorization` del gateway) sigue siendo correcta, y el backend conserva `ingress=internal` sin `allUsers`. No hay brecha material nueva.

## Residuales menores (no bloquean la planificación)

- Gate 2 (línea 42) aún lista `download=1` en la prueba de contrato sin repetir que aplica solo a rutas AI; conviene reflejar ahí el alcance de la línea 28.
- No se fija en qué página vive la UI de video. Si es `/cuenta/**`, su CSP ya usa `connect-src 'self'` (`scripts/publicAuthAssets.mjs`, `authCsp`) y la CSP comercial podría no requerir relajación; si vive en páginas comerciales, sí. Definir la página destino evita trabajo de guard innecesario.
- Conviene dejar explícito que el gateway nuevo se invoca sin autenticación de plataforma (entrada pública) y que eso es un grant sobre un servicio *nuevo*, distinto del cambio de IAM sobre `vistavo-files-api`.

## Base documental

- Firebase Hosting con Cloud Run (rewrites y tope de 60 s); Ingress de Cloud Run (`internal` y tráfico por VPC); autenticación servicio a servicio (ID token firmado por Google, `roles/run.invoker`, `X-Serverless-Authorization`); verificación de ID tokens de Firebase.

=== RESUMEN FINAL ===
RESULTADO: PASS
EVIDENCIA: spec revisada líneas 3, 23, 24, 28, 33, 34, 43, 45; `firestoreAiHttp.ts:28` `download=1`→attachment; `firestoreHttp.ts:100` MP4 inline; invoker único en `files.plan.json`; guards `checkCommercialStatic.mjs:17`, `checkPublicAuthStatic.mjs:18`, `publicAuthAssets.mjs:8`.
NEGATIVOS: gate 2 aún lista `download=1` sin acotar a rutas AI; no fija la página que hospeda la UI (decide si la CSP comercial se relaja).
BLOQUEOS: ninguno para planificar; FALLA original preservada.
=== FIN RESUMEN ===
