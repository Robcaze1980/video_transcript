# LV-007 · Correcciones y preparación B1 · 13 de noviembre de 2026

## Estado

Candidata local: **325/325 pruebas en 44/44 archivos, sin omisiones**, tipos y ambas compilaciones correctos. DeepSeek y Kimi emiten PASS limitado a la candidata; Gemini Hydrogen Batch final emite PASS sobre325, después del ajuste adicional de original Buffer solicitado por Kimi. Instalación limpia npm ci y nueva corrida325/44, tipos y2builds correctos; npm audit0conocidas. El PASS anterior324 y los FALLA previos se conservan históricos. Backend online aún no aceptado.

Codex integró y ejecutó pruebas. Los revisores externos recibieron código y evidencia sin herramientas; sus propuestas baseline no eran parches completos ejecutables. Se leyó el informe íntegro de cada dictamen recibido, no se aceptó un PASS sólo por su resumen.

| Problema | Cambio y evidencia |
|---|---|
| AUD-01: input inline caducado invocaba proveedor | Reaper y comprobación previa al adaptador; pruebas TTL queued y TTL después de claim; cero invocaciones, una liberación. |
| AUD-02: publicación/lease ambiguo repetía proveedor | UNKNOWN durable con reserva, SHA e intento; claim sólo queued; publicación confirmada con respuesta perdida sigue succeeded. Cancelación running requiere verificación. |
| AUD-06: creación de compra perdida sin recuperación | Intención/payload/clave y lease guardados antes del proveedor; misma referencia dentro de cinco horas; después UNKNOWN; sin captura automática y sin segundo abono. |
| Secundarios contrastados | Huella streaming/backfill, upgrade repetido, SRT distinto devuelve409, locks account/input/job, conciliación expirada failed/refund, descriptor seguro HTTP, tombstone antes de unlink. |

Controles de pagos simulados y aislamiento local conservados. No acreditan PayPal real, Google login alojado ni Pixel. La conciliación requiere evidencia real externa para su uso operativo; no hay endpoint de cliente para liberar reservas arbitrariamente.

## Google

SVG oficial aportado por Rob y etiquetas diferenciadas de acceso/registro en diez idiomas. CSS local, foco visible, icono sin deformar. Codex verificó escritorio/móvil388px, RTL árabe y teclado; no hubo autenticación real en ese ensayo. Evidencia: outputs/vistavo-backend-fixes/google-browser-proof.json y google-register-mobile-final.jpg.

## Infraestructura · preparación previa al apply

APIs habilitadas en vistavo-prod; proyecto/número y Billing for Robertson comprobados. Las lecturas posteriores responden200; SQL0, buckets0, Run0. Se observa la red default y dos identidades gestionadas; no se modifican ni se atribuye a esta fase la creación de todas las identidades. Dry-run identifica sólo recursos propios nuevos. Nueve cuerpos REST contrastados con Google Discovery, cero campos desconocidos. SQL tier disponible en us-central1, aún no creado.

B1 base tiene revisión propia y aún no se ejecutó apply. SQL/secretos/IAM efectivos, datos durables, API, workers y recorrido completo siguen abiertos. El plan abstracto inicial obtuvo FALLA/INCONCLUYENTE; esos resultados históricos permanecen. No afirmar Direct VPC efectivo por declararlo en un JSON.

## Evidencia

Logs y snapshot: outputs/vistavo-backend-fixes/{check-results.json,tests.log,types.log,build-main.log,build-editor.log,final-snapshot.json}. Respuestas completas/recibos de cada intento: LOCALAPPDATA/LinguistVision/t3-review/backend-fixes-20261113. Batch final: outputs/vistavo-backend-fixes/gemini-submission.json. No se usaron datos de clientes ni se modificó Techos/ROBATO.

Fuentes oficiales: [botones Google](https://developers.google.com/identity/branding-guidelines), [idempotencia PayPal](https://developer.paypal.com/api/rest/reference/idempotency/), [Orders](https://developer.paypal.com/sdk/orders/v2/orders-create/), [máquinas SQL](https://docs.cloud.google.com/sql/docs/postgres/instance-settings), [precios SQL](https://cloud.google.com/sql/pricing), [PSA](https://docs.cloud.google.com/sql/docs/postgres/configure-private-services-access), [Direct VPC](https://docs.cloud.google.com/run/docs/configuring/vpc-direct-vpc), [Storage REST](https://docs.cloud.google.com/storage/docs/json_api/v1/buckets).

La candidata3001 arrancó y verificó HTTP/CSP/401privado. Usa acceso por código y compras simulados: esa pantalla no expone el rendererGoogle; la verificación Google separada usa el componente real y no acredita login alojado. La primera sonda HTTP esperaba equivocadamente el botónGoogle en modo por código; se conserva candidata-http-first.json como FALLA de alcance de la sonda, después candidata-http.json acotado PASS. No se cambió código de producto para volver verde esa expectativa.

Actualización posterior: B1.base creado y verificado; ver LV-007-base-cloud-2026-11-13.md y foundation-base-verification.json. Los conteos previos anteriores al apply son históricos; SQL/Run siguen0 y ahora hay2buckets/3identidades dedicadas nuevas. No backend online aceptado.
