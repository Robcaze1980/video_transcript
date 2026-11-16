# LV-007 · Vistavo en Google Cloud

## Autorización y alcance · 2026-11-12

Rob aprueba Google Cloud y el presupuesto de despliegue, y selecciona explícitamente la cuenta «Billing for Robertson». No se ha acordado un límite monetario nuevo; no inventar un importe aprobado ni un techo automático. Preparar piloto medido, sin compromisos de gasto por uno o tres años. Sustituye la elección anterior de DigitalOcean. Dominio vistavo.app ya registrado; soporte elegido support@vistavo.app, aún sin recepción/envío verificados.

Proyecto nuevo dedicado propuesto: vistavo-prod; candidatos privados antes de abrir tráfico. No modificar ni usar recursos de techos.app/ROBATO. El proyecto local linguistvision-dev y su ADC permiten comprobaciones administrativas; los recursos desplegados y datos nuevos van al proyecto de Vistavo. No exportar ni copiar secretos de otros productos. La cuenta de facturación elegida puede ser común: recursos y atribución de cargos se separan por proyecto.

## Secuencia y aceptación

A. Preflight real de acceso/facturación, proyecto dedicado, contraste independiente DeepSeek/Kimi, cálculo reproducible de coste y prueba Linux Node24/FFmpeg con video sintético. Gate: evidencia de recursos creados, facturación correcta, prueba sin datos de usuario, límites/bloqueos explícitos.

B. Cloud Storage privado y repositorio de imágenes; contrato de almacenamiento durable compatible con cargas reanudables, validación MP4, Range, TTL, tombstones, cuotas y generaciones. Conservar adaptación local y sus negativos; no montar un bucket como si tuviera semántica POSIX de append/fsync/truncate. Cloud SQL PostgreSQL17 y migraciones idempotentes; secretos propios, conexiones autenticadas, backups/restauración y aislamiento.

C. Entrypoint Cloud Run propio que respete PORT/HOST, origen HTTPS fijo, proxy confiable y Firebase nuevo. Los límites loopback del piloto local son deliberados y no deben relajarse globalmente. Trabajos invocados/durables con lease, drenaje, reconciliación UNKNOWN y sin retry remoto automático de cargo ambiguo. No depender de un setInterval en un servicio que escala a cero para entregar trabajos o borrar archivos. Instancias/concurrencia configuradas según pruebas, no por suposición.

D. Candidata cloud privada: subir video sintético3min, transcribir/traducir/generar voz, reiniciar y reabrir; negativos de acceso cruzado, subida incompleta y fallos; medición de memoria/coste. Render MP4 con voz depende de LV-016.D todavía pendiente. Prueba10min sólo tras prueba3min. No afirmar exportación final completa hasta implementarla y comprobarla.

E. Marca Vistavo, Hosting/dominio/HTTPS/Google y correo de soporte verificado. Pruebas por ruta, Pixel, permisos, producción de pagos y revisión nativa conservan gates propios. Publicación explícitamente solicitada por Rob, pero no presentar funciones pendientes como disponibles ni exponer candidata local a Internet. No usar una página «Próximamente»: Rob rechazó esa sustitución.

## Estimación, no factura ni precio cerrado

Región de referencia us-central1. Para ensayo pequeño Cloud SQL Enterprise db-g1-small sin HA a0.035USD/h implica25.55USD por730h sólo cómputo; compartido sin SLA. Almacenamiento SQL/backups, transferencia, Hosting, operaciones, logs, builds/registro, secretos e IA se añaden. No crear una instancia desproporcionada o reservas/compromisos para el piloto. Disponibilidad y tarifa regional se comprueban al provisionar.

Cloud Run con facturación por instancia: referencia2vCPU/4GiB a0.000018USD/vCPU-s +0.000002USD/GiB-s =0.1584USD/h;100horas =15.84USD;730horas =115.632USD, antes de descuentos/cuota gratuita. No prometer coste cero por escala a cero con workers periódicos. Cloud Storage Standard regional:0.000027397USD/GiB-h,20GiB×730h≈0.40USD, más operaciones/red. Son escenarios de componentes, no presupuesto mensual total: se desconoce carga, descargas y tiempo real de procesamiento. Estimación de proveedor AI y revisores separada. Alertas de presupuesto no equivalen por sí mismas a un corte de gasto.

Fuentes consultadas el12nov2026: https://cloud.google.com/sql/pricing ; https://cloud.google.com/run/pricing ; https://cloud.google.com/storage/pricing ; https://docs.cloud.google.com/run/docs/container-contract .

## Estado real de preparación

Proyecto vistavo-prod creado y ACTIVE, label application=vistavo/environment=candidate. Firebase añadido mediante API y operación finalizada correctamente. No hay despliegue público, migración de datos, cambios DNS, instancia SQL ni servicio de procesamiento creado por esta fase. La vinculación de la cuenta «Billing for Robertson» falla HTTP400/QuotaFailure/Cloud billing quota exceeded; permiso billing.resourceAssociations.create confirmado. Se conservan primer intento y un reintento justificado por propagación del proyecto nuevo; no reintentos ilimitados ni cambio de cuenta. Solicitar ajuste mediante el enlace devuelto por Google: https://support.google.com/code/contact/billing_quota_increase . Fase A incompleta por este bloqueo externo.

DeepSeek/Kimi hicieron revisión independiente del plan inicial sin herramientas. No aportaron ejecución y no se adopta su dictamen como aceptación. Corrección a DeepSeek: new Map() en CommercialJobs es registro de adapters y activeAttempts guarda cancelación local; la cola sí está en PostgreSQL con claim SKIP LOCKED/renew/lease y PipelineStore también es durable. Se conserva esa capacidad en la migración; falta adaptar activación/limpieza al ciclo Cloud Run y probar drenaje/UNKNOWN allí, no rehacer toda la cola por una inferencia sin fuente. Kimi expresa correctamente que los archivos iniciales eran insuficientes para acreditar o negar la persistencia; su bloque final «ausencia acreditada» no se interpreta como inexistencia demostrada.

La propuesta DeepSeek de rechazar cualquier MP4 truncado sólo con ffprobe tampoco se adopta: metadatos faststart pueden seguir legibles. Prueba de compatibilidad usa archivo inválido como negativo explícito; validación estructural/decodificación/subida truncada tienen gates distintos. Herramientas y fórmula reproducible en deploy/google-cloud/. La prueba Linux sintética no equivale al recorrido de traducción/voz/render de3min.


LV-007 · Cierre de preparación cloud12nov2026: gate A sigue incompleto por cuota de facturación. Revisiones actualizadas DeepSeek/Kimi INCONCLUYENTES sobre evidencia real, informes completos leídos y contrastados, sin PASS ficticio. Confirmaron corrección sobre colaPostgres y separación de prueba FFmpeg frente al pipeline cloud.4llamadas OpenRouter directo autorizado sin herramientas, modelos deepseek/deepseek-v4.1-flash y moonshotai/kimi-k3.1-pro,87200tokens yUS.3135218427 usage.cost; factura/Codex/Google no medidos. Informes/contextos privados LOCALAPPDATA/LinguistVision/t3-review/vistavo-cloud-20261112/; recibos completos por intento en outputs/vistavo-cloud/accounting.json. Cero generaciones Gemini de video/voz, compras de usuario o deploy público en esta fase. Sin nuevos contratos/caps monetarios ni compromisos de plazo. Ficheros nuevos del contenedor/scripts comprobados con node --check y docker Linux sinred/read-only/no-root; no cambió código de negocio y no se repite la suite306 de fase previa como nueva evidencia. Digest e inventario paquetes guardados; grafo actualizado. Reanudar billing del proyecto existente tras ajuste, no volver a crearlo. Scripts de creación efímeros no idempotentes se conservan sólo como evidencia; README impide relanzarlos. Cuenta local/base/candidata3001 y secretos intactos. Dominio todavía sin conectar; correo y fases B–E pendientes.



12 de noviembre · Marca Vistavo aplicada localmente a diez portadas y panel; Firebaseprod configurado tras aprobación explícita (Google/correo, Vistavo Web, dominios autorizados), separado de dev.306/306pruebas43archivos, tipos/builds0 y DeepSeek/KimiPASS técnico acotado. [Informe](docs/FIREBASE-VISTAVO-2026-11-12.md). No desplegar ni habilitar billing según última instrucción; pruebas humanas/prodcloud y gates globales pendientes. Sin nueva fecha pública.


## 2026-11-13 · LV-007 · Facturación vinculada tras aprobación explícita
Rob responde «Sí, vincular Billing for Robertson» a la pregunta que especificaba activar plan de pago sin crear servidores/bases. Esta autorización sustituye la restricción Spark exclusivamente para asociar vistavo-prod a billingAccounts/01EA15-CD60DD-2E4270. Se comprobó nombre exacto y cuenta abierta; antes billingEnabled=false/sin cuenta, PUT único exitoso, GET posterior billingEnabled=true y cuenta exacta; Firebase vistavo-prod ACTIVE. El bloqueo QuotaFailure de asociación queda resuelto mediante operación real, sin afirmar aumento de otras cuotas. No se crearon Cloud Run/SQL/buckets ni se cambió despliegue, DNS, Auth u otros proyectos.
Evidencia outputs/vistavo-billing-approved/{before,link-result,verification}.json y script link.mjs con guardas de identidad/no reemplazo de otra cuenta. Codex ejecutó directamente operación administrativa sencilla y comprobable conforme excepción AGENTS; sin revisores externos nuevos, sin atribuir PASS a T3. Tokens/coste Codex y cargos Google no medidos. No cambia código de aplicación; no corresponde repetir306tests como evidencia nueva. Siguiente fase del plan: preparar almacenamiento durable/Cloud SQL y límites/coste, con gates de seguridad/revisión independiente antes de activar backend. La vinculación no acredita backend operativo ni recorrido completo de video/voz/Drive.

## Auditoría ampliada13nov2026
Rob pide auditar todo backend y MASTERPLAN para construir ruta Firebase/GoogleCloud. Véanse [plancompleto](LV-007-backend-completo-firebase.md) e [informe](../AUDITORIA-BACKEND-VISTAVO-2026-11-13.md). B0documental con matriz y negativos; B1–B6 no aceptados funcionalmente. SQLAdmin/RunAPIsdeshabilitadas, Storage0buckets, billingactivo. No cambiarrecursos durante auditoría ni publicar entrypointlegacy. Primero reconciliación de efectos/UNKNOWN/TTL/checkout, después candidato durable.
