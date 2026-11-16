> SUPERSEDIDO: Rob aprobó Firestore y prohibió crear Cloud SQL. Este documento es histórico; no ejecutar sus pasos SQL/bootstrap. Ruta vigente: [adaptación Firestore](LV-007-firestore-backend.md). No eliminar la infraestructura privada ya existente.

# LV-007 · B1.SQL privado e identidad administrada · 13nov2026

Continuación autorizada por Rob después de las tres correcciones y B1.base. Proyecto exclusivo vistavo-prod/107404655346; Billing for Robertson ya aprobado y activo. No nuevos permisos rutinarios, compromisos de plazo ni topes monetarios inventados. Mantener separados Techos/ROBATO/ADC global. No publicar aplicación, habilitar pagos reales ni importar datos.

La base privada existente tiene27controles API PASS, recuperación de solo lectura tras fallo inmediato de verificación de última identidad; no se repitieron creaciones. Antes de SQL se requieren recibos por etapa/HTTP sanitizados y lecturas posteriores a creación acotadas, sin reenviar POST ambiguo.

## Corte actual y aceptación

- Cloud SQL vistavo-postgres en us-central1, PostgreSQL17 Enterprise, db-g1-small sólo ensayo sin SLA, ZONAL, SSD10GB/autogrow20GB, sin IPv4 pública ni redes públicas autorizadas, SSL cifrado, IAM DB auth, backups/PITR7d y protección de borrado.
- Base vistavo y principal IAM vistavo-runtime@vistavo-prod.iam, sin contraseña de runtime ni grants de datos/DDL hasta el migrador probado de B2.
- Root CSPRNG en memoria: sólo payloads TLS hacia Secret Manager y SQL Admin; nunca argumentos CLI, variables persistentes, disco, logs, prompts o JSON de cuenta de servicio. Secreto regional vistavo-db-bootstrap-password, accessor explícito sólo bootstrap. No leer ni volcar payload para auditar.
- Runtime recibe cloudsql.client/instanceUser a nivel del proyecto dedicado (no afirmar alcance por instancia); bootstrap recibe cloudsql.client y accessor del secreto específico. No nuevos Owner/Editor ni permisos de despliegue para builder.
- Intent durable antes de crear SQL y LRO guardada. Una respuesta ambigua no reenvía creación; inspeccionar operación/instancia antes de reanudar. Recursos existentes incompatibles bloquean, no se parchean ni eliminan. Toda política conserva etag/condiciones/bindings previos; roles nuevos sólo en allowlist de Vistavo.
- Preflight: proyecto/billing, conexión PSA, tier/región, flag IAM para PostgreSQL17, contratos REST actuales y permisos necesarios. Verificar nombres y dominios de operaciones. Lecturas pueden repetirse de forma acotada si hay propagación; POST no.
- Negativos: proyecto/cuenta/SQL existente incompatible, secreto/identidad ajenos, respuesta perdida después de crear, creación pendiente/reintento, fallo de persistencia, POST duplicado, campo de solo salida, permisos más amplios; ningún secreto escrito en evidencia. Verificación real de configuración/roles/usuario/bases y ausencia de IP pública.

Este corte no acredita conectividad SQL desde runtime, DML/DDL, migraciones, restore, GCS, Cloud Run o login de cliente. Esos gates siguen B2/B3 y se ejecutan después. La preparación no despliega server/index.ts ni relaja loopback del piloto.

Referencia de costo comprobada13nov:0.035USD/h,25.55USD/730h sólo cómputo, más almacenamiento/backups/red/operaciones/SecretManager/IA; no factura ni presupuesto mensual total. No se adquieren reservas de1/3años. Fuentes: https://cloud.google.com/sql/pricing y https://docs.cloud.google.com/sql/docs/postgres/instance-settings .


## Decisión de costo en revisión · 13nov
Rob cuestiona Cloud SQL fijo frente a Techos.app. SQL0, secreto/grantsSQL aún inexistentes. Se compara PostgreSQL/Firestore con T3 antes de elegir; no migrar ni crear SQL mientras la elección esté en revisión. Ver docs/specs/LV-007-comparacion-postgres-firestore-2026-11-13.md. Avanzar con comparación y frentes independientes; no implica cancelar backend ni borrar la base privada creada.
