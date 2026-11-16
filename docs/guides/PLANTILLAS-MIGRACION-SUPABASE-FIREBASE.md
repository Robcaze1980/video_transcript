# Plantillas para una migración de Supabase a Firebase

Anexo del [manual de migración A–Z](MANUAL-MIGRACION-SUPABASE-FIREBASE.md). Son formularios de planificación y aceptación, no instrucciones para ejecutar una migración cloud. Copia las secciones necesarias al proyecto de destino y sustituye los campos entre corchetes. Una casilla vacía, un dato desconocido o una prueba no ejecutada permanece **PENDIENTE**; no equivale a cero ni a PASS.

Cada proyecto conserva sus cuentas, credenciales, permisos, presupuesto y autorizaciones. La configuración de otro proyecto no concede permiso para reutilizar su identidad, clave, facturación, infraestructura o proveedor de modelos. Estas plantillas no contienen credenciales ni datos personales reales.

## 1. Ficha del proyecto y decisiones reservadas

| Campo | Completar antes de intervenir |
|---|---|
| ID de migración / versión del plan | `[ID]` / `[versión y fecha UTC]` |
| Producto y propietario | `[producto]` / `[Rob u otro propietario expresamente designado]` |
| Repositorio / rama / revisión | `[URL del remoto]` / `[rama]` / `[commit completo]` |
| Workspace y rutas permitidas | `[rutas absolutas]` |
| Entorno | `[desarrollo / ensayo privado / producción]` |
| Origen | `[organización y proyecto Supabase; región; identificadores no secretos]` |
| Destino | `[cuenta/organización Google autorizada; project ID y project number; región]` |
| Facturación | `[cuenta autorizada identificada sin secretos; estado observado y fecha]` |
| Identidad de operador y cuota | `[principal observado]` / `[proyecto de cuota observado]` |
| Identidad de cada runtime | `[recurso → principal → capacidad mínima]` |
| Configuración externa | `[referencias a archivos o recursos de secretos; nunca sus valores]` |
| Datos sensibles | `[clasificación, ubicación restringida, responsable y retención]` |
| Servicios incluidos / excluidos | `[lista explícita; no asumir Firestore, Cloud SQL o publicación]` |
| Ventana, RPO y RTO aceptados | `[ventana]` / `[pérdida máxima de datos]` / `[tiempo de recuperación]` |
| Evidencia vigente | `[índice de recibos y hashes; ubicación persistente y respaldo]` |

Registrar la identidad efectiva y el recurso consultado por separado: estar autenticado en una cuenta, usar un proyecto de cuota y operar sobre un proyecto no son la misma comprobación. No incluir contraseñas, tokens, cookies, archivos ADC, claves privadas ni cadenas de conexión en esta ficha.

### Matriz de autorización

| Acción concreta y recursos afectados | Autoriza | Estado / fecha | Evidencia de la autorización | Límite o condición |
|---|---|---|---|---|
| Inventario de solo lectura | `[responsable]` | `[pendiente/aprobado]` | `[referencia]` | `[alcance]` |
| Exportación de datos/identidades y copia de objetos | `[responsable]` | `[estado]` | `[referencia]` | `[destino restringido]` |
| Implementación y ensayo privado | `[responsable]` | `[estado]` | `[referencia]` | `[datos sintéticos/permitidos]` |
| Crear servicios, habilitar APIs o cambiar IAM | `[responsable]` | `[estado]` | `[referencia]` | `[lista exacta]` |
| Vincular facturación, usar proveedores o ampliar gasto | `[responsable]` | `[estado]` | `[referencia]` | `[presupuesto/condiciones]` |
| Cambiar dinero, saldo, captura o conciliación | `[responsable]` | `[estado]` | `[referencia]` | `[contrato y pruebas patrón]` |
| Corte, DNS, tráfico público y lanzamiento | `[Rob]` | `[estado]` | `[referencia]` | `[gates previos]` |
| Reversión y tratamiento de escrituras nuevas | `[Rob]` | `[estado]` | `[referencia]` | `[plan aprobado]` |
| Borrar origen, respaldos o datos de clientes | `[Rob]` | `[estado]` | `[referencia]` | `[retención y verificación]` |

Rob conserva `decide`, la aceptación comercial, el presupuesto y la publicación en sus proyectos. El permiso para preparar una candidata no autoriza el corte público, cargos nuevos o borrados. Reutilizar una autorización existente requiere que cubra la acción y los recursos actuales; no se pide de nuevo por cada intercambio técnico dentro de ese alcance.

## 2. Inventario de servicios y dependencias

| Componente del origen | Uso real / consumidor | Contrato que se conserva | Destino propuesto | Dependencias | Evidencia y criterio de equivalencia | Estado / dueño |
|---|---|---|---|---|---|---|
| Auth: proveedores, sesión, MFA, correo y enlaces | `[rutas/clientes]` | `[alta, verificación, recuperación, revocación]` | `[servicio por aprobar]` | `[OAuth, dominio, correo]` | `[prueba humana y de servidor]` | `[estado]` |
| PostgreSQL: tablas, vistas y restricciones | `[esquemas/casos]` | `[claves, relaciones, precisión, consistencia]` | `[colecciones o SQL por decidir]` | `[modelo y consultas]` | `[conciliación lógica y negativos]` | `[estado]` |
| RLS y grants | `[roles/políticas]` | `[quién puede ver/modificar qué]` | `[controles explícitos]` | `[identidad y API]` | `[matriz de autorización]` | `[estado]` |
| RPC, funciones, triggers y extensiones | `[llamadores]` | `[efectos, atomicidad, errores]` | `[servicio/operación]` | `[transacciones]` | `[prueba por efecto]` | `[estado]` |
| Storage: buckets, objetos, versiones y políticas | `[subida/descarga/borrado]` | `[privacidad, integridad, retención]` | `[bucket y API propuestos]` | `[IAM, generaciones]` | `[SHA/tamaño/negativos/purga]` | `[estado]` |
| Realtime y suscripciones | `[clientes/canales]` | `[eventos, orden, desconexión, aislamiento]` | `[mecanismo propuesto]` | `[autorización/coste]` | `[reconexión y evento perdido]` | `[estado]` |
| Edge Functions, cron, colas y webhooks | `[tareas y proveedores]` | `[idempotencia, entrega, reintento]` | `[runtime y programador]` | `[identidades/outbox]` | `[reinicio, duplicado, acuse perdido]` | `[estado]` |
| Hosting, dominios y OAuth callbacks | `[orígenes actuales]` | `[rutas, cookies, retornos]` | `[destino propuesto]` | `[TLS/DNS]` | `[recorrido real por dispositivo]` | `[estado]` |
| Pagos, ledger, trabajos y resultados | `[sistema de registro]` | `[reserva/captura/liberación/UNKNOWN]` | `[persistencia y workers]` | `[proveedor y conciliación]` | `[pruebas financieras]` | `[estado]` |
| Backups, auditoría y observabilidad | `[fuentes vigentes]` | `[restore, trazabilidad, privacidad]` | `[destino y acceso]` | `[RPO/RTO/retención]` | `[restauración medida]` | `[estado]` |

### Tablas, consultas e índices

| ID | Tabla/vista/RPC de origen | PK/FK/unique/check/default/trigger | Consulta real: filtros, orden y paginación | Volumen y concurrencia | Modelo de destino e índice exacto | Transformación y prueba |
|---|---|---|---|---|---|---|
| `[Q-001]` | `[recurso]` | `[invariantes]` | `[consulta o referencia sanitizada]` | `[filas/pico medido]` | `[colección/scope/campos/orden]` | `[evidencia]` |

Documentar monedas y unidades enteras, precisión decimal, valores nulos, timestamps/zonas, UUID, referencias, borrado lógico y orden estable. Una tabla SQL no se convierte automáticamente en una colección equivalente. Para cada JOIN, agregación, búsqueda, suscripción o transacción, registrar el comportamiento requerido y su prueba, antes de elegir la estructura final.

Comprobar la consulta real sobre el destino y la colección exacta del índice. Registrar consultas paginadas, checkpoints y filas defectuosas: una página de errores no debe ocultar trabajo sano posterior. La corrupción del propio campo de orden necesita un procedimiento explícito; no se arregla inventando vencimientos o cambiando saldos.

### Equivalencia de RLS, permisos de API y acceso a objetos

| Recurso / operación | Sujeto y condición de RLS original | Regla equivalente de negocio | Punto de control: cliente, backend, IAM, Storage | Negativo obligatorio | Resultado / evidencia |
|---|---|---|---|---|---|
| `[leer/modificar/borrar/listar]` | `[rol, owner, tenant, estado]` | `[predicado explícito]` | `[archivo/servicio/regla]` | `[anónimo, cuenta ajena, revocado, caducado]` | `[pendiente]` |

Inventariar también los accesos del backend administrativo; probar su autorización por propietario y tenant sin asumir que una regla del cliente protege esa ruta. Identificar el momento de autorización de una descarga y qué ocurre si se revoca durante una transferencia ya autorizada.

Incluir vistas/funciones privilegiadas, rutas `service_role` y políticas de Storage. Las Security Rules de Firestore no filtran consultas: probar el listado con filtros autorizables y el rechazo de una consulta demasiado amplia; nunca descargar todo con privilegios y filtrar después en el navegador. Para escrituras/reservas, autoridad y recurso se revalidan en la transacción protegida. Cada intento de worker presenta su fencing vigente antes de publicar o liquidar.

## 3. Identidad y correspondencia de UID

El archivo cumplimentado de correspondencias puede contener identificadores personales o seudónimos. Guardarlo con acceso restringido fuera del repositorio y entregar aquí sólo conteos, hashes y excepciones sanitizadas. Las filas siguientes son marcadores de plantilla, no identidades reales.

| Campo por correspondencia | Valor a completar |
|---|---|
| Namespace y subject del origen | `[namespace]` / `[UID_ORIGEN]` |
| UID de destino y cuenta interna | `[UID_DESTINO]` / `[ID_CUENTA]` |
| Tenant, proveedores y vínculos | `[referencias verificadas]` |
| Estado de cuenta | `[activa/deshabilitada/borrada; origen y fecha]` |
| Correo verificado / MFA / claims | `[estrategia aprobada y evidencia; sin correo literal aquí]` |
| Estrategia de contraseña | `[importación compatible comprobada / recuperación / otra aprobada]` |
| Método y versión de conversión | `[regla determinista]` |
| Conflictos y decisión | `[duplicado/colisión/vínculo pendiente; dueño]` |
| Referencia de evidencia y hash de fila | `[ubicación restringida]` / `[SHA canónico]` |

Gates de identidad:

- [ ] Cero UID duplicados o cuentas unidas por simple coincidencia de correo.
- [ ] Cada cuenta y objeto conserva una correspondencia única y verificable; huérfanos y conflictos quedan enumerados.
- [ ] Compatibilidad de importación de credenciales comprobada con el método real y documentación vigente; secretos y hashes de contraseña nunca se adjuntan al prompt.
- [ ] Contraseña original aceptada e incorrecta rechazada en Auth real autorizado con cuentas controladas; importUsers/emulador no sustituyen esa prueba. Reimportación no sobreescribe cambios recientes en destino.
- [ ] Se conserva la condición de cuenta deshabilitada, verificación y pertenencia; no se autoacredita saldo por importar un usuario.
- [ ] Sesiones antiguas, expiración, revocación, vinculación de proveedores y retorno OAuth tienen un plan explícito.
- [ ] Google, confirmación y recuperación se prueban con personas autorizadas en escritorio y móvil. Un stub o un token sintético no cierra ese gate.

## 4. Manifiesto de datos y objetos

Primero fijar la canonicalización del registro lógico: proyección de campos de negocio, orden de claves/listas, UTF-8, tratamiento de nulos, timestamps y números. Si el esquema cambia, comparar la misma proyección lógica del origen y destino; sus serializaciones físicas pueden diferir. Para objetos copiados sin transformación, comparar SHA-256 de los bytes y tamaño. Registrar el algoritmo observado de cualquier checksum de plataforma; no equiparar automáticamente ETag y SHA-256.

```json
{
  "migrationId": "[ID]",
  "manifestVersion": "[VERSION]",
  "createdAtUtc": "[ISO_UTC]",
  "sourceSnapshot": "[ID_SNAPSHOT]",
  "sourceWatermark": "[MARCA_DELTA]",
  "targetRevision": "[REVISION_INMUTABLE]",
  "canonicalizationVersion": "[VERSION_CANONICA]",
  "record": {
    "sourceReference": "[REFERENCIA_RESTRINGIDA]",
    "targetReference": "[REFERENCIA_RESTRINGIDA]",
    "ownerMappingReference": "[ID_MAPA_UID]",
    "sourceLogicalSha256": "[SHA256]",
    "targetLogicalSha256": "[SHA256]",
    "observedAtUtc": "[ISO_UTC]",
    "deletedAtUtc": null,
    "reconciliationState": "PENDIENTE"
  },
  "object": {
    "sourceKey": "[CLAVE]",
    "sourceVersion": "[VERSION_O_GENERACION]",
    "targetKey": "[CLAVE]",
    "targetGeneration": "[GENERACION]",
    "sourceSizeBytes": null,
    "targetSizeBytes": null,
    "sourceSha256": "[SHA256]",
    "targetSha256": "[SHA256]",
    "tombstone": false,
    "oldGenerationsRecordedBeforeDelete": [],
    "oldGenerationsVerifiedAbsent": [],
    "evidenceReference": "[RUTA_RESTRINGIDA]"
  }
}
```

Este JSON es un esquema ilustrativo, no un manifiesto aceptado. No incorporar URLs firmadas, tokens, cuerpos de clientes o credenciales. Guardar los manifiestos completos en el destino restringido aprobado; el resumen versionado conserva hashes y resultados sanitizados.

### Conciliación por lote

| Lote / watermark | Esperado en origen | Leído realmente | Escrito confirmado | Coincidencia lógica / SHA de objetos | Duplicados / huérfanos / borrados | Diferencias y dueño | Evidencia |
|---|---|---|---|---|---|---|---|
| `[lote]` | `[conteos]` | `[conteos]` | `[conteos]` | `[comprobado/pendiente]` | `[conteos]` | `[lista o referencia]` | `[ruta + hash]` |

Separar inventario, copia, lectura independiente y aceptación. Registrar también versiones descartadas y tombstones. Un número de objetos actuales vacíos no demuestra que se comprobaron todas las generaciones antiguas: sólo declarar ausentes las versiones identificadas y verificadas. Conservar los identificadores antes de borrar y no reconstruir bytes ausentes para presentarlos como evidencia original.

## 5. Corte por etapas, deltas y escritores

| Etapa | Escritor autoritativo | Trabajo y evidencia exigida | Condición de salida | Reversión disponible |
|---|---|---|---|---|
| A. Preparación | `[origen]` | `[backups/restauración probada; captura de deltas preparada antes del snapshot]` | `[snapshot y marcas sin huecos]` | `[sin tráfico modificado]` |
| B. Copia base privada | `[origen]` | `[identidades, datos y objetos; manifiestos y reconciliación]` | `[errores bloqueantes resueltos]` | `[retirar candidata sin borrar origen]` |
| C. Reproducción de deltas | `[origen]` | `[altas/cambios/borrados ordenados e idempotentes, hasta marca observada]` | `[retraso y divergencia aceptados]` | `[origen sigue autoritativo]` |
| D. Congelación de escrituras | `[origen congelado; hora y fence]` | `[bloquear nuevos escritores; drenar jobs/webhooks; resolver ambiguos]` | `[último watermark W verificado en destino]` | `[descongelar origen sólo si no hubo escrituras nuevas en destino]` |
| E. Cambio de tráfico | `[destino]` | `[revisión exacta, auth/callbacks/rutas/caché y observabilidad]` | `[salud y recorrido privado/público según permiso]` | `[plan posterior a escrituras, sección 6]` |
| F. Observación | `[destino]` | `[deltas nuevos durables, cuotas, dinero, errores y soporte]` | `[ventana y gates de negocio aceptados]` | `[reversión conciliada ensayada]` |
| G. Retirada del origen | `[destino]` | `[aprobación separada, retención, export final y accesos retirados]` | `[restore y requisitos de conservación satisfechos]` | `[estrategia aprobada, no copia antigua sin deltas]` |

Completar antes del corte:

- Mecanismo de deltas y garantías: `[CDC/outbox/journal aprobado; versión, orden y deduplicación]`.
- Cómo demostrar ausencia de huecos entre snapshot y delta: `[transacción/marca/recibo]`.
- Fuente y orden de borrados, expiraciones y tombstones: `[protocolo; prioridad frente a copias atrasadas]`.
- Escritores a detener: `[API, cron, jobs, reintentos, integraciones, administración y cargas en vuelo]`.
- Tratamiento de trabajos running/UNKNOWN, reservas y llamadas externas: `[responsable y conciliación, sin replay ciego]`.
- Marca final de corte y confirmación de que el origen ya no acepta escrituras: `[W, horaUTC y recibos]`.
- Condiciones de abortar y quién decide: `[umbrales, evidencia y Rob]`.

No activar doble escritura improvisada. Si se propone, diseñar antes su idempotencia, fallos parciales, autoridad, deltas y reversión. Un cambio de configuración o DNS no drena por sí solo los escritores anteriores.

## 6. Reversión después de escrituras nuevas

| Campo | Plan que debe estar probado antes de abrir escrituras en destino |
|---|---|
| Disparador y decisor | `[síntoma/umbral; Rob y evidencia]` |
| Último punto conocido común | `[snapshot y watermark conciliado]` |
| Journal de escrituras nuevas | `[ubicación durable desde antes de E; altas/cambios/borrados]` |
| Congelación del destino | `[fence de API/workers/webhooks/cargas y verificación]` |
| Deltas que volverán al origen | `[rango cerrado de marcas, orden y deduplicación]` |
| Transformación inversa | `[campos reversibles, UID, objetos y excepciones irreversibles]` |
| Tombstones y generaciones | `[cómo impedir resurrección de datos u objetos borrados]` |
| Dinero y proveedores | `[IDs externos, capturas/liberaciones, receipts y UNKNOWN a conciliar]` |
| Sesiones, OAuth y archivos | `[qué se revoca, conserva o comunica; pruebas reales]` |
| Prueba de conciliación inversa | `[conteos, hashes lógicos/bytes e invariantes]` |
| Reapertura del origen | `[sólo después de confirmar los deltas y la autoridad única]` |
| Alternativa si no es reversible | `[recuperación hacia delante o pérdida explícitamente aceptada; decisión Rob]` |

Registrar explícitamente nuevas cuentas y cambios de contraseña posteriores al corte: `[estrategia de retorno/recuperación, sesiones invalidadas y prueba]`. No asumir que puede copiarse un hash nuevo de Firebase a Supabase sin conocer su formato y probar la compatibilidad.

Volver al binario anterior no restaura las escrituras que sólo existen en el destino. Antes de redirigir tráfico al origen, congelar y conciliar esas escrituras, también sus borrados e identidades. Los efectos ya confirmados en un proveedor de pagos o procesamiento conservan su ID y no se repiten al reproducir el journal. Si la inversa no existe o el resultado es ambiguo, declarar la reversión bloqueada y seguir el plan de recuperación aprobado; no adivinar saldos ni devolver dinero para cuadrar un ensayo.

## 7. Matriz de aceptación

Cada fila requiere resultado, revisión exacta, evidencia independiente y negativos. Usar `NO APLICA` sólo con motivo aprobado. Separar aceptación técnica privada, equivalencia de migración, aceptación humana/comercial y permiso de publicación.

| Gate | Pruebas mínimas a adaptar | Estado / revisión | Evidencia y responsable |
|---|---|---|---|
| Datos | Conteos por tipo/tenant, proyección canónica, unicidad, referencias y diferencias; deltas incluidos | `[pendiente]` | `[ruta/hash]` |
| Identidades | Mapa UID completo, conflictos, deshabilitados, verificación, sesiones, recuperación y vínculos | `[pendiente]` | `[ruta/hash]` |
| Humano | Alta/login Google/correo, recibir enlaces reales, salir/reentrar y revocar en escritorio/móvil | `[pendiente]` | `[observación autorizada]` |
| Seguridad | Anónimo, otro tenant/owner, flags revocados, input caducado/borrado/cambiado; rutas administrativas, Storage, GET/HEAD/Range | `[pendiente]` | `[negativos reales]` |
| Archivos | SHA/tamaño de cada original y resultado, descarga privada, carga interrumpida, reanudación y borrado/versiones | `[pendiente]` | `[manifiestos]` |
| Concurrencia | Misma clave/otra carga, acuse perdido, dos clientes, callbacks repetidos, cursores y páginas defectuosas | `[pendiente]` | `[efectos únicos]` |
| Workers y colas | Reinicio, lease/fencing, entrega duplicada, llamada ambigua, UNKNOWN y purga; estado de negocio y salida de plataforma | `[pendiente]` | `[Run/Task/exit/retries y recibos]` |
| Rendimiento | Carga representativa, cuenta caliente, cola y picos; p95/p99/límites definidos antes del ensayo | `[pendiente]` | `[perfil, medidas y coste]` |
| Dinero | Saldo por cuenta/moneda, reserva/captura/liberación única, duplicados de pago, sandbox separado, UNKNOWN y conciliación | `[pendiente]` | `[pruebas patrón y ledger]` |
| Respaldo y restore | Restaurar realmente datos, identidades permitidas, objetos y referencias; medir RPO/RTO | `[pendiente]` | `[ensayo aislado]` |
| Corte y reversión | Autoridad única, deltas hasta W, tombstones, nuevos escritos y vuelta sin duplicar efectos externos | `[pendiente]` | `[ensayo privado]` |
| Operación y costes | Logs sanitizados, alertas, soporte, cuotas, gastos observados/desconocidos y responsables | `[pendiente]` | `[recibos e inventario]` |
| Candidata | Instalación, tipos, pruebas/builds pertinentes, fuente exacta dentro del artefacto y readback real | `[pendiente]` | `[manifiesto/digest/UID]` |
| Revisión y publicación | T3 y revisión final requeridos por el proyecto; aceptación de Rob del alcance/fecha/tráfico | `[pendiente]` | `[informe íntegro y autorización]` |

### Invariantes financieros y contabilidad de ensayos

```text
Cuenta/moneda/unidad: [identificador restringido / unidad exacta]
Saldo inicial acreditado: [valor observado]
Disponible + reservado + consumido = acreditado: [definición y prueba del contrato]
Compras/capturas/liberaciones/reembolsos: [IDs estables y movimientos únicos]
Importación no crea una compra ni convierte saldo sandbox en saldo comercial.
Trabajo/llamada ambigua: [UNKNOWN y procedimiento del operador; sin replay pagado]
Errores históricos y movimientos reales del ensayo: [preservados, incluso si falló]
Modelos/revisiones: [proveedor autorizado, generación, uso y usage.cost observados]
Deduplicación del coste: [ID único; agregado Batch/resultado contado una vez]
Costes no observados: no medido
Factura y gastos de runtime/proveedor: [observados con recibo / no medido]
```

Adaptar la ecuación al ledger real, incluidas devoluciones y ajustes explícitos. No convertir un porcentaje de pruebas en aceptación financiera. Un fallo de carga antes de proveedor, un Job de negocio succeeded y un proceso cloud con exit1 son hechos diferentes. Guardar cada uno y comprobar el contrato de la dependencia real antes de modificar una API correcta por un hallazgo estático.

No existe una transacción compartida entre Firestore, Auth, GCS, cómputo y proveedores. Por efecto externo registrar `[operationId / huella de petición / intento / clave soportada por proveedor / estado durable / recibo / conciliación]`. Mantener la misma clave sólo para la misma operación; UNKNOWN exige inspección, no replay ni una identidad nueva.

### Recuperación por componente

| Componente | Copia y versión protegidas | Procedimiento y límites | Ensayo real / RPO / RTO / responsable |
|---|---|---|---|
| Firestore y ledger | `[export/PITR o estrategia elegida]` | `[restore, invariantes y workers detenidos]` | `[pendiente]` |
| Auth y credenciales | `[export compatible y protección]` | `[UID/proveedores/contraseñas/MFA; excepciones]` | `[pendiente]` |
| GCS y generaciones | `[inventario y versiones retenidas]` | `[bytes/referencias/retención/borrados]` | `[pendiente]` |
| IAM, reglas e índices | `[configuración versionada]` | `[aplicar y esperar disponibilidad]` | `[pendiente]` |
| Secretos, OAuth y correo | `[referencias/rotación/recuperación autorizadas]` | `[sin valores en Git; validación de acceso y entrega]` | `[pendiente]` |
| Workers, colas, DNS y frontend | `[configuración y artefacto]` | `[reapertura ordenada y un escritor, sin replay de pagos]` | `[pendiente]` |

Un respaldo de base de datos no acepta automáticamente el resto de filas. Cada servicio necesita recuperación y comprobación propias.

## 8. Registro de incidentes y evidencia

| ID / hora UTC literal | Intento, revisión y recurso | Hecho observado | Causa acreditada / hipótesis | Negativo y corrección | Resultado nuevo | Evidencia original preservada |
|---|---|---|---|---|---|---|
| `[INC-001]` | `[IDs no secretos]` | `[status/exit/estado durable, sin cuerpos]` | `[causa demostrada o INCONCLUYENTE]` | `[prueba que falla antes]` | `[alcance exacto]` | `[rutas y hashes]` |

Antes de repetir una operación, comprobar su intención y estado autoritativo. Una pérdida de respuesta no prueba que falló el commit o que no se cobró. Conservar el FAIL original, el recibo remoto, la salida local y el ensayo posterior por separado. Un helper puede fallar después de guardar una respuesta correcta; tampoco se debe ignorar un proceso cloud fallido porque publicó un resultado.

Mantener el índice de evidencia en almacenamiento persistente y respaldado, con copia íntegra de informes visibles y recibos originales del proveedor donde esté permitido. Si se pierde un raw, marcar la pérdida: un resumen, un hash o una consulta posterior de metadata no reconstruye el contexto ni autentica por sí solo el texto perdido. Verificar la persistencia de rutas externas y sincronizadas antes de basar en ellas una fase nueva.

## 9. Prompt reutilizable para Codex

Completar los campos antes de copiarlo. Por defecto sólo autoriza inventario y planificación; las fases con escritura se habilitan por autorización concreta del proyecto. No pegar credenciales ni dumps de clientes.

```text
Proyecto: [PRODUCTO]. Repositorio/workspace: [URL Y RUTA]. Revisión: [COMMIT].
Tarea: [ID Y FASE]. Propietario: Rob. Modo inicial: DOCUMENTAR / SOLO LECTURA.
Objetivo y aceptación: [RESULTADO CONCRETO, PRUEBAS Y LÍMITES].
Autorizaciones vigentes y evidencia: [ACCIONES, RECURSOS, FECHA, REFERENCIA].
Exclusiones: [OTROS PROYECTOS, CUENTAS, RECURSOS, GASTO, PUBLICACIÓN, BORRADOS].

Lee AGENTS.md y HANDOFF.md, especificación vigente, plan/backlog y últimos incidentes.
Confirma remoto, revisión, cambios de trabajo y fuente de cada decisión. Para descubrir
código usa el grafo disponible; usa búsqueda textual para literales/configuración y
cuando el grafo sea insuficiente. No heredes permisos de otro producto.

Primero completa las fichas de identidad, inventario, RLS/consultas, UID, manifiestos,
aceptación y corte/reversión. Separa Auth, datos, objetos, workers y tráfico público.
No crees proyectos, claves, identidades, APIs, IAM, facturación, modelos pagados,
tráfico público o borrados sin autorización concreta que los cubra. Dentro del alcance
ya autorizado resuelve y continúa el trabajo técnico sin pedir confirmaciones repetidas.
Rob conserva decide, presupuesto, alcance comercial, aceptación y publicación.

Para arquitectura, dinero, seguridad y cierre aplica el flujo T3 del proyecto:
DeepSeek propone el cambio mínimo y sus pruebas; Kimi audita independientemente;
Codex contrasta con código, dependencia instalada, fuentes oficiales y pruebas.
Proveedor/instancia/modelos y vía de respaldo: [LOS AUTORIZADOS EN ESTE PROYECTO].
No copies claves, selección de modelos o permisos de Vistavo ni de otros proyectos.
Si faltan ejecutores autorizados, registra el límite y avanza los frentes independientes.

Conserva salida completa de cada revisión a archivo y un bloque final con exactamente
RESULTADO, EVIDENCIA, NEGATIVOS y BLOQUEOS. Lee el bloque primero y contrasta las
evidencias; inspecciona el informe completo ante FALLA/INCONCLUYENTE y cuando el
gate lo exija. Un NULL sin informe queda INCONCLUYENTE aunque tenga uso/coste.
Deduplica por generación/cargo; desconocido se registra no medido, nunca cero inventado.

Antes de implementar un cambio de criterio, actualiza especificación y dependencias.
Prueba con datos sintéticos o expresamente permitidos, aislamiento por cuenta/tenant,
idempotencia, acuses perdidos, concurrencia, expiración, borrado y reversión con nuevas
escrituras. Ningún proveedor/archivo externo dentro de callbacks transaccionales que
pueden repetirse. UNKNOWN no autoriza otra identidad, refund o repetición pagada.

Entrega una candidata inmutable y evidencia local/cloud diferenciada; comprueba
fuente/artefacto/readback y salida de plataforma, no sólo estado del Job. Ejecuta los
checks pertinentes sin ampliar o repetir ensayos pagados para fabricar un PASS.
El corte y rollback deben reconciliar deltas, tombstones, UID, objetos y efectos externos.
No vuelvas a un origen desactualizado después de escrituras nuevas sin ese protocolo.

Al cerrar actualiza HANDOFF y registros autorizados, con gates, costes observados y
pendientes. Preserva errores históricos y distingue cierre privado de publicación.
Termina con:
=== RESUMEN FINAL ===
RESULTADO: [PASS o FALLA o INCONCLUYENTE; elegir uno]
EVIDENCIA: [rutas, hashes, revisiones, pruebas y alcance]
NEGATIVOS: [controles, fallos preservados y límites]
BLOQUEOS: [dependencias y decisiones reservadas; ninguno si procede]
=== FIN RESUMEN ===
```

## 10. Plantilla de HANDOFF

```markdown
# [PROYECTO] · [FASE] · estado vigente [FECHA Y ZONA]

## Alcance y autoridad
Repositorio/revisión: [remoto y commit]. Cambios existentes: [referencia acotada].
Especificación vigente: [ruta/versión]. Tarea y aceptación: [ID y referencia].
Autorizado: [acciones y recursos con evidencia]. Excluido: [límites].
Rob conserva: decide, presupuesto, alcance comercial, aceptación y publicación.

## Estado real
- Origen/destino y autoridad de escritura: [inventario + watermark].
- Identidad y correspondencias: [mapa restringido; conteos/conflictos].
- Datos/objetos/deltas/borrados: [manifiestos, hashes, pendientes].
- Candidata: [fuente, artefacto/digest, recursos/UID, readback UTC].
- Pruebas: [corridas exactas; omisiones; no sumar suites solapadas].
- Humano/comercial: [aceptado o pendiente; stub no sustituye persona].
- Dinero: [ledger observado, reservas, UNKNOWN, capturas y releases].
- Proveedores/modelos: [IDs de intento, uso, coste; no medido si falta].
- Corte/reversión/restore: [estado probado, RPO/RTO y escrituras nuevas].

## Evidencia y conservación
Índice persistente: [ruta]. Copia independiente: [ruta y verificación].
Inputs de revisión y fuente congelados: [manifiestos].
Informes/raws originales: [rutas/hashes; faltantes explícitos].
Intenciones ya enviadas: [ID/estado; inspeccionar, no reenviar].
Entorno y procesos propios: [puerto/versión/estado observado, sin secretos].

## Decisiones, incidentes y gates
T3/independencia: [roles, revisión real y disposición de cada hallazgo].
Fallos originales: [rutas; causa demostrada o INCONCLUYENTE].
Gates técnicos/financieros/humanos/publicación: [estado y evidencia].
Bloqueos: [dueño, acción necesaria y frentes independientes].

## Siguiente paso autorizado
[Una actividad concreta, requisitos de entrada y evidencia de salida].
No reejecutar seed, migración, prueba pagada o creación de recursos al retomar.
No modificar credenciales globales ni otros proyectos. Conservar historial abajo,
marcado como histórico; no ejecutar sus instrucciones obsoletas como estado vigente.
```

## 11. Acta de aceptación y entrega

| Decisión | Resultado y alcance | Evidencia / firma / fecha |
|---|---|---|
| Equivalencia de identidad, datos y objetos | `[PASS/FALLA/INCONCLUYENTE]` | `[referencia]` |
| Candidata y ejecución privada | `[resultado; qué se ejecutó realmente]` | `[referencia]` |
| Seguridad, rendimiento, dinero y restore | `[resultado por gate, sin agrupar pendientes como PASS]` | `[referencia]` |
| Pruebas humanas y comerciales | `[resultado separado]` | `[referencia]` |
| Reversión con escrituras nuevas | `[probada/pendiente/bloqueada; límites]` | `[referencia]` |
| Corte público | `[autorizado por Rob / pendiente]` | `[referencia explícita]` |
| Retirada del origen y conservación | `[autorizada por separado / pendiente]` | `[referencia]` |
| Incidentes y deuda aceptada | `[lista, responsables y plazos]` | `[referencia]` |

Adjuntar índice final de evidencia y hashes, versión exacta del plan, autorizaciones, resultado de revisión independiente, manifiestos de conciliación, prueba de reversión y HANDOFF. La aceptación debe decir qué quedó demostrado y qué queda fuera; no convertir una migración privada correcta en permiso de lanzamiento o eliminación del origen.
