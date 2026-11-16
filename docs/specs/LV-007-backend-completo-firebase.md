# Actualización vigente · 13nov2026

Rob aprobó Firestore y procesamiento bajo demanda para el backend. No crear Cloud SQL. La ruta anterior SQL queda sustituida por [LV-007 Firestore](LV-007-firestore-backend.md). Adaptación en curso: persistencia/UID/ledger/proyectos/outbox, después GCS/API/workers y candidata privada con T3/Gemini; publicación y gates funcionales siguen pendientes.

# LV-007 · Backend completo de Vistavo en Firebase y Google Cloud

## Alcance y resultado esperado

Rob pide auditar todo el backend y revisar el MASTERPLAN para construir la solución completa en la ruta aprobada. El alcance incluye identidad, cuenta, pagos, saldo, API, proyectos, archivos, procesamiento, voz, render, idiomas, Drive, seguridad, operación y recuperación.

El inventario completo es un control de cobertura; no acredita por sí mismo calidad completa, revisión línea por línea o ausencia de vulnerabilidades. Cada componente necesita evidencia de código, configuración, pruebas y operación. Los dictámenes de modelos sin herramientas son revisiones estáticas, no pruebas de producción.

Firebase Hosting y Authentication sirven la web y la identidad. Cloud Run bajo demanda, Firestore y Cloud Storage aportarán ejecución, datos y archivos según la aprobación posterior de Rob; Cloud SQL queda excluido. Supabase es una integración anterior conservada en el código; no se ha acreditado un proyecto alojado de Vistavo que deba migrarse.

La auditoría y el diseño actuales no crean servicios ni publican funciones. La construcción posterior sigue las fases y autorizaciones vigentes. Rob conserva las decisiones de precio, oferta y lanzamiento.

## Configuración actual comprobada

- Producción: proyecto dedicado `vistavo-prod`, separado de `linguistvision-dev` y de otros productos.
- Web: `vistavo.app` publica la vista previa comercial con A3, diez idiomas y noindex; versión `98a81624fa93bb66`. No tiene conectado el backend funcional.
- Firebase Auth: Google y correo/contraseña habilitados; dominios autorizados documentados en el inventario de login. Privacidad mejorada del correo activada. MFA desactivado; la política de contraseña no fue devuelta por esta lectura, por lo que no se supone su contenido.
- Facturación: Billing for Robertson vinculada y activa. El bloqueo anterior de asociación por cuota está resuelto.
- Cloud: Service Usage y consultas con el proyecto de cuota correcto confirman las APIs de Run y SQL Admin deshabilitadas; Storage enumera cero buckets. No se activaron APIs durante la auditoría.
- Local: PostgreSQL 17.11 dedicado, código Node 24, editor, transcripción/traducción y voces inglesas con sus pruebas anteriores. Esto no acredita el recorrido cloud.

Evidencia: `outputs/vistavo-config-quality/{inventory,backend-remote,backend-inventory}.json`, `outputs/vistavo-billing-approved/verification.json` y `outputs/vistavo-a3-publish/acceptance.json`. Detalle del acceso: [inventario de configuración y login](LV-007-configuracion-calidad-2026-11-13.md).

## Matriz de auditoría de todas las superficies

| Área y requisito | Base existente | Brecha y evidencia para aceptar en cloud |
|---|---|---|
| Identidad, LV-003/R8 | `firebaseAccess`, `firebaseRoutes`, `accountAccess`, `web/firebaseAuth` | Recorrido Google/correo PC y Pixel, verificación y recuperación reales, tokens ajenos/revocados, sesiones y vínculo por UID. |
| Supabase anterior | `supabaseAccess`, `supabaseRoutes` y tabla de identidades | Mantener separado; no activar ni migrar sin identificar proyecto y decisión expresa. Las pruebas locales anteriores no acreditan SMTP/OAuth alojados. |
| Cuenta y perfil | Páginas de cuenta, `pilotHttp`, cuentas/identidades | Panel e historial completos, aislamiento, exportación/baja según contrato y protección contra enumeración. |
| Saldo y precios, R4 | Invariante SQL de cuentas, `credit_movements`, paquetes | Unidades de consumo coherentes, reservas concurrentes, ausencia de saldo negativo y una sola liquidación por resultado. |
| Compras | `pilotPayments` Sandbox, órdenes y compras | Importe/moneda/comercio/referencia correctos, acreditación única y reconciliación en PC/Pixel. Pagos reales requieren implementación y gate propio. |
| API y HTTP | `pilotHttp`, Origin, cookies y limitador | Entrypoint cloud propio, límites por ruta, proxy confiable, controles compartidos, CSRF/CORS/headers y errores sin secretos. |
| Datos y migraciones | `schema.sql` y migraciones de cuenta, archivos, proyectos y pipeline | Aplicación versionada desde cero y actualización con lock; mínimo privilegio, conexiones/pool/SSL y prueba de restauración. |
| Carga reanudable | `ResumableUploads`, `PrivateFileStore`, validación MP4/ffprobe | Adaptación a objetos durables, commit autorizado, offset/reintento/checksum/cupo y rechazo de archivos incompletos. No montar GCS como POSIX. |
| Archivos y descargas | Archivos privados, Range, TTL y artefactos | Buckets privados, autorización por cuenta, generación, caducidad y eliminación. Probar URLs ajenas/caducadas, escritura tras borrado y limpieza de huérfanos. |
| Editor y proyectos, LV-008–014 | Borradores, revisión, pistas, estilos, presets e importadores | Guardar/reabrir tras reinicio, conflicto sin pérdida, formatos y fuentes RTL/CJK, PC/Pixel y accesibilidad. |
| Orquestación, LV-016.A | Cola PostgreSQL, claim/lease/SKIP LOCKED y `PipelineStore` | Activación durable, fencing, heartbeat, recuperación tras crash, cancelación y reconciliación. No depender de timers con escala a cero. |
| Texto, LV-016.B | Proveedor/servicio de texto, codec y tiempos | Calidad ES→EN, nombres/medidas/silencios y frases que cruzan bloques; timeout, limpieza remota y coste de fallos. |
| Voz, LV-015/016.C | Proveedor/servicio WAV, Kore y Charon estándar | Escucha humana inglesa, texto y revisiones exactos, chunks/repeticiones, duración/coste y resultado UNKNOWN sin reintento ciego. |
| Render, LV-016.D | FFmpeg y exportación del piloto; contrato de render | Implementar y probar MP4 largo con voz, pistas, encaje, subtítulos, fuentes/códecs y límites de CPU/RAM/tmp. No está cerrado. |
| Idiomas, R1–R3 | Diez locales y objetivo de 90 direcciones | Disponibilidad por capacidad/par y rúbrica con revisión humana. Una lista de idiomas no demuestra cobertura. |
| Drive | Autorizador y cargador del navegador | Consentimiento real y guardar/abrir SRT y MP4 en PC/Pixel. Firebase Auth no concede permisos Drive. Dropbox sigue siendo ampliación. |
| PDF, LV-006/R5 | Adaptador que reutiliza cuenta/saldo/cola | Regresión sintética del núcleo común. No publicar otro producto sin su oferta y aceptación. |
| Infraestructura, R6 | Prueba Linux Node/FFmpeg y estimador | Manifiestos reproducibles, digest de imagen, Artifact Registry, usuario no root y límites medidos de instancias/concurrencia/conexiones. |
| Secretos e IAM | ADC local externo y configuración por entorno | Identidad administrada exclusiva, Secret Manager y permisos mínimos entre servicios; rotación y logs sin credenciales/transcripciones. |
| Limpieza y retención | Purga local, TTL y tombstones | Ejecución durable autenticada, reintentos idempotentes y reconciliación; retención también en proveedores. |
| Observabilidad y coste | Estimaciones y evidencia local | Correlation ID, métricas y alertas; coste de IA, cómputo, SQL, storage, egress, logs y reintentos por resultado. Una alerta no es un corte de gasto. |
| Continuidad | Respaldos/configuración locales | Backups/PITR según diseño, restauración aislada real, rollback compatible y simulacro de interrupción. Definir RPO/RTO antes de aceptar. |
| Privacidad, soporte y legal | Correo elegido y preview noindex | Verificar recepción/envío de soporte, privacidad/términos, retención/baja y revisión nativa antes de lanzamiento. |
| Repositorio, CI y T3 | 306 pruebas históricas, tipos y dos builds | Snapshot/hash por fase, controles negativos, implementador y auditor independientes, coste y evidencia completos. El aislamiento global de T3 sigue pendiente. |

Se conserva el piloto PostgreSQL como referencia. El backend cloud adapta cuentas, saldo, proyectos y cola a Firestore, reutilizando los contratos, editor y proveedores que superen sus gates; render largo y aceptación real siguen pendientes.

## Orden de construcción y puertas de calidad

1. **B0: inventario y contrato.** Revisar fuentes y planes, fijar arquitectura y límites de confianza, resolver discrepancias. Entregar matriz completa, estado por componente y revisión DeepSeek/Kimi; Gemini batch revisa después la versión integrada. Un revisor bloqueado no recibe PASS.
2. **B1: infraestructura privada reproducible.** Preparar manifiestos, IAM/red, tamaños y estimación con precios oficiales vigentes al provisionar. Definir límites de instancias, tareas, conexiones y backups. Crear exclusivamente recursos de Vistavo dentro del alcance autorizado, sin abrir tráfico funcional por anticipado.
3. **B2: datos y archivos durables.** Migraciones versionadas, ledger, adaptador GCS, carga/commit/generación/cupo, proyectos, artefactos y TTL. Probar dos cuentas, acuse perdido, carga incompleta, escritura tras borrado, borrado parcial y doble reserva/cobro. Restaurar antes de importar datos.
4. **B3: identidad y API.** Entrypoint de producción, identidad administrada y proxy/limitador adecuados. Cerrar la matriz de acceso con PC/Pixel y correos reales; no tratar dominios autorizados como una prueba E2E.
5. **B4: workers y procesamiento.** Activación durable, fencing/leases, cancelación, drenaje, UNKNOWN y limpieza. Integrar texto ES→EN, voz inglesa y render LV-016.D. Medir memoria/tmp, duración y coste antes de fijar concurrencia.
6. **B5: calidad de producto.** Videos sintéticos de 120/180 segundos, luego ensayos de 1/5/10 minutos según límites aprobados. Rúbrica bilingüe, escucha, Sandbox en Pixel, saldo entre videos y reapertura. Mantener Drive y cobertura lingüística como gates explícitos.
7. **B6: candidata y lanzamiento.** Tipos, suite pertinente sin omisiones, dos builds, HTTPS/headers, backup/restore, rollback, alertas, costes y recorrido completo. Rob decide oferta/publicación; retirar preview/noindex únicamente cuando corresponda a funciones demostradas.

Los pasos de implementación B1–B6 y Q2–Q6 no están aceptados funcionalmente por este documento. No se promete una fecha o coste mensual total sin carga y mediciones reales.

## Hallazgos contrastados y controles negativos

- **Confirmado: trabajo inline caducado.** Una prueba aislada en la base local de tests encola un input válido, lo caduca y ejecuta `runOnce`: el adaptador sintético se invoca una vez; después el resultado queda failed y la reserva se libera. Puede hacerse trabajo de proveedor evitable. El control positivo ejecuta un input vigente. No se llamó IA ni se usó producción. Evidencia: `expired-inline-proof.json`.
- **Descartado: inexistencia de migraciones.** `pilotLocal.ts` aplica `accountAccess.sql`, `privateUploads.sql` y migraciones de pipeline/texto/voz. La necesidad pendiente es un mecanismo cloud versionado y probado, no recrear tablas porque no estén todas en `schema.sql`.
- **Descartado: append sin idempotencia.** `PrivateFileStore.append` compara bytes de un fragmento ya confirmado y acepta la repetición idéntica. La prueba existente de reanudación comprueba offset conservado. Divergencias/solapamientos sí se rechazan.
- **Acotado: HMAC por proceso.** La clave de códigos de `accountAccess` pertenece al modo anterior simulado, no a la sesión Firebase vigente. Supabase tiene su propia clave PKCE por proceso; no activar esos modos en múltiples instancias sin resolverlo. No añadir un secreto nuevo a Firebase por una inferencia del revisor.
- **Acotado: cancelación.** `cancel` termina el estado en PostgreSQL y aborta localmente; un worker remoto puede detectar pérdida de lease en el heartbeat. Medir la latencia y el trabajo/cargo en curso, no afirmar que el estado sólo cambia localmente.
- **Confirmado en código: límites HTTP.** Aunque jsonBody tiene default4096, pilotHttp instancia FirebaseRoutes con jsonBody(req,8192), compatible con el límite de7000caracteres de token y su envoltura normal. readBody comprueba tamaño declarado y real; el handler exterior captura RequestError y devuelve400/413. Mantener negativos HTTP por ruta, no inferir ausencia de captura por ver sólo el try interior.
- **Confirmado: limitador local.** 30 solicitudes por 60 segundos y hasta 1024 orígenes por proceso. No resuelve proxy compartido ni varias instancias. No confiar indiscriminadamente en cabeceras reenviadas.
- **Estado remoto actual.** Billing activo, APIs Run/SQL deshabilitadas y cero buckets. El primer mensaje SQL usó el proyecto de cuota de ADC; la lectura posterior usa token en memoria y header de cuota correcto, sin cambiar ADC global.

Los informes completos de revisores se conservan con sus errores y límites; Codex contrasta cada hallazgo. No se convierte una observación estática en defecto confirmado sin escenario y evidencia. El informe final debe mostrar qué se corrigió, qué queda abierto y qué revisión cubrió cada versión.

## Cierre de preparación B0 · 13nov2026

Plan aceptado documentalmente por Gemini4Hydrogen batch después del contraste DeepSeek/Kimi; [informe y registro](../AUDITORIA-BACKEND-VISTAVO-2026-11-13.md). B1–B6 siguen abiertos; no aceptar backend funcional. Suite actual306/43sinomisiones, tipos/2builds, npm audit0conocidas,95enlaces locales válidos y103fuentes sin cambios respecto a paquetes auditados. Tres reproducciones sintéticas en base de tests: TTLinline, publish/replay ycreacióncheckout perdida. Las dos primeras se enviaron aGemini; la tercera yverificación explícita1movimientoterminal son comprobaciones posteriores deCodex. No se ha corregido código de producto en esta fase.
