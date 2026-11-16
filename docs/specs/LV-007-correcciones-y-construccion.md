# LV-007 · Correcciones previas y continuación cloud · 13nov2026

Autorización: Rob pide corregir los tres problemas reproducidos (AUD-01, AUD-02 y AUD-06), continuar backend Firebase/Google Cloud con T3 y revisión Gemini, y aplicar los botones oficiales Google al login/registro. Mantener proveedor Firebase, PostgreSQL y guardas del piloto local; no publicar funcionalidades hasta gates. Ruta y facturación Cloud ya aprobadas; recursos exclusivamente vistavo-prod, candidata privada, sin pagos reales ni cambios en Techos/ROBATO.

Aceptación de esta fase: input caducado nunca invoca proveedor y libera reserva una vez; publish perdido/lease ambiguo nunca dispara repetición ciega y conserva reconciliación/reserva segura; creación de checkout perdida recuperable con referencia idempotente persistida, sin segundo abono ni captura automática antes de aprobación. Probar concurrencia, reinicio y errores de persistencia. Migración fresh/upgrade y rollback compatible documentados; no romper conservación ledger ni reabrir trabajos terminales.

Google: HTML/SVG oficial aportado por Rob y guía developers.google.com/identity/branding-guidelines; icono multicolor sin deformar, texto localizado de acción, botón accesible/teclado/estados, CSS local compatible con CSP. Conservar handlers Firebase y no convertirlo en GIS One Tap ni pedir nuevos permisos. Registro y acceso distinguibles en los diez locales.

Tras cerrar correcciones: B1–B3 de LV-007-backend-completo-firebase.md, manifiestos/recursos privados, migrador y almacenamiento durable/runtime propio. Cada candidata instala/verifica tipos/suite/builds y revisión independiente; Gemini Batch revisa integración. No declarar app operativa por crear infraestructura.

## Decisiones contrastadas durante integración

- Los archivos conservan TTL de 24 horas. La metadata de conciliación (SHA-256, intento, clave de petición, fecha y reserva) permanece; no se amplía retención para UNKNOWN. Un resultado verificado después de caducar se resuelve failed y libera reserva; no se cobra un entregable indisponible.
- Una cancelación queued libera; running pasa a UNKNOWN y conserva reserva hasta verificación. No se reintenta un proveedor ambiguo ni se renueva automáticamente una intención de compra UNKNOWN.
- Migración 0017 aditiva/idempotente: enum UNKNOWN, columnas de conciliación/checkout y huella de entradas bytea preexistentes. Las cargas privadas guardan SHA mediante streaming y rellenan cargas antiguas al leer. Bytes ya ausentes dejan hash desconocido/null, nunca inventado.
- Secundarios de almacenamiento: las rutas HTTP usan descriptor validado y revalidan tamaño; borrar separa tombstone confirmado de unlink. Un rollback conserva bytes; un unlink fallido conserva tombstone/cupo para limpieza posterior.
- Recuperación Firebase usa handler alojado Google. La página reset del acceso anterior no es una ruta Firebase expuesta. No se añade un segundo flujo por el hallazgo condicional del revisor.
- Rollback: detener workers nuevos antes de revertir aplicación. Conservar columnas/migración y reservas; NO reiniciar workers antiguos que reclamen leases vencidos. Ante duda, mantener procesamiento detenido y conciliar UNKNOWN. La reversión no borra ledger ni convierte UNKNOWN a queued.

## Corte B1 base

Plan y cuerpos REST en deploy/google-cloud/foundation.plan.json y resources.mjs. preflight.mjs verifica proyecto/cuenta de facturación sin cambiar ADC global. foundation-base.mjs hace dry-run por defecto; --apply crea únicamente VPC/subred/rango y conexión PSA, buckets privados, Artifact Registry e identidades sin claves. No crea SQL, secretos, grants o Cloud Run. Recursos existentes incompatibles bloquean; no se parchean ni eliminan. PSA usa listado completo acotado a red porque la API no ofrece GET singleton; paginación inesperada bloquea.

SQL db-g1-small es candidato de ensayo, sin SLA; Google desaconseja producción con shared-core. Tamaño de producción y capacidad se validan antes de lanzamiento. Referencia vigente 0.035 USD/h, 25.55 USD/730h sólo cómputo; disco/backups/operaciones/red/IA aparte. No es factura ni presupuesto mensual total. Sigue pendiente SQL privado cifrado/IAM/bootstrap seguro, grants, backups/restauración, adaptador GCS, activación durable, API propia y negativos de producción.
