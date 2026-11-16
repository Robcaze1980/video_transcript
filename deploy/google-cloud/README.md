# Vistavo · Preparación de Google Cloud

Contrato y autorización: [LV-007](../../docs/specs/LV-007-vistavo-google-cloud.md). Esta carpeta todavía no contiene un despliegue completo de Vistavo.

Prueba Linux sin credenciales, cuentas, archivos del cliente ni red durante la ejecución:

```sh
docker build -t vistavo-cloud-probe:local deploy/google-cloud/probe
docker run --rm --network none --read-only --tmpfs /tmp:rw,noexec,nosuid,size=256m --memory 1g --cpus 2 --cap-drop ALL --security-opt no-new-privileges vistavo-cloud-probe:local
node deploy/google-cloud/estimate.mjs
```

La prueba genera3min de patrón/seno320×180, comprueba H264/AAC/4500frames y rechazo de archivo inválido como usuario no root. No acredita ASR, traducción, voces, subtítulos, sincronía ni los límites de video del producto. /tmp usa RAM; la aplicación cloud requiere almacenamiento durable. La imagen fija versión de Node, pero paquetes apt pueden cambiar: conservar digest e inventario de la imagen concreta probada.

El proyecto dedicado vistavo-prod fue creado el12nov2026. No volver a ejecutar scripts de creación para reanudar. Antes de provisionar recursos pagos, verificar billingEnabled en ese proyecto y la cuenta elegida «Billing for Robertson». El intento inicial falló por Cloud billing quota exceeded; el13nov, tras aprobación explícita de Rob, la vinculación a Billing for Robertson quedó activa y fue comprobada por GET. Evidencia outputs/vistavo-billing-approved/verification.json. No repetir la creación ni cambiar cuentas/proyectos ajenos. Antes de crear servicios, aplicar el plan de auditoría y las autorizaciones vigentes.

El piloto local conserva sus restricciones loopback. No desplegar pilotLocal.ts como si fuera entrypoint de producción ni publicar los archivos/env/ADC de esta PC. Las migraciones GCS, SQL y workers durables requieren sus gates antes de tráfico público.

## B1 · Preparación privada del 13 de noviembre

Contrato de correcciones: docs/specs/LV-007-correcciones-y-construccion.md. resources.mjs contiene cuerpos REST sin secretos; foundation.plan.json documenta intención y roles futuros, no estado efectivo. preflight.mjs inspect es lectura; enable habilita únicamente APIs del proyecto fijo vistavo-prod y comprueba cuenta de facturación. No cambia configuración global de gcloud/ADC.

foundation-base.mjs hace dry-run por defecto. --apply es el corte separado de red/PSA, dos buckets privados, Artifact Registry y tres identidades sin claves. No crea SQL, secretos, bindings IAM ni servicios Cloud Run, ni publica la aplicación. Sólo ejecutar tras revisión de candidata y contraste del script; inspeccionar operaciones pendientes antes de reintentar. Un recurso homónimo incompatible bloquea, no se modifica. El rango PSA es interno; la red default creada por Google se conserva aparte.

El error handler imprime únicamente nombre/código de error; nunca imprimir errores completos del SDK de autenticación. Contratos REST/fuentes/hash y recibos se guardan en outputs/vistavo-backend-fixes. No utilizar scripts históricos de creación de proyecto para continuar.
