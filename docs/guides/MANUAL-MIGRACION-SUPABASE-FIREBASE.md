# Manual para migrar Supabase a Firebase con las cuentas de Rob

Versión 1 · 14 de noviembre de 2026 · Procedimiento reutilizable para otro proyecto.

Este manual permite trasladar una aplicación, sus usuarios, datos, archivos y procesos desde Supabase a Firebase y Google Cloud. El objetivo es conservar acceso, propiedad, historial y funcionamiento, con una salida segura si algo falla. Cambiar el login o publicar la portada es sólo una parte de la migración.

**Este documento prepara el trabajo; no autoriza crear recursos, vincular facturación, modificar otra aplicación, importar datos personales ni cambiar producción.** En el proyecto de destino se completa la ficha de decisiones y se registra la autorización correspondiente. Las aprobaciones de Vistavo no se transfieren automáticamente.

El punto de partida de Vistavo incluía PostgreSQL e integración anterior con Supabase. Allí se construyó y probó un backend privado con Firestore y Google Cloud; **no se acreditó una migración completa de todos los clientes y contraseñas de un Supabase alojado**. Los pasos de exportación e importación que siguen necesitan su propio ensayo en el nuevo proyecto.

## Cómo usarlo si no eres programador

Rob confirma las cuentas, el proyecto permanente, el presupuesto y el momento de cambiar el sistema público. Codex hace el inventario, propone el diseño, construye y prueba. DeepSeek propone mejoras y Kimi revisa de forma independiente cuando el proyecto autorice T3. Un resultado favorable de una IA no sustituye las comprobaciones.

El recorrido tiene cinco entregas: inventario y decisiones; ensayo con datos sintéticos; migración de una copia real autorizada; cambio controlado; operación y retiro del sistema anterior. Cada entrega termina con una evidencia y un criterio de aceptación. No hace falta pedir permiso por cada corrección técnica ya autorizada.

Las [plantillas complementarias](PLANTILLAS-MIGRACION-SUPABASE-FIREBASE.md) contienen la ficha, las tablas para llenar, el registro de corte y un prompt para el nuevo Codex. Copia ambos documentos al otro repositorio; sustituye los marcadores antes de ejecutar comandos.

## Qué tendrás que hacer tú en las pantallas

Codex puede preparar y ejecutar las operaciones técnicas que autorices. Tú completas los accesos personales y tomas las decisiones de cuenta, coste y publicación. Los nombres de menús pueden cambiar; comprobar siempre el proyecto seleccionado antes de guardar.

1. Abre [Firebase Console](https://console.firebase.google.com/) con la cuenta Google que quieres usar y confirma su avatar. Abre también [Google Cloud Console](https://console.cloud.google.com/) y confirma que sea la cuenta correcta. No envíes sus cookies ni contraseñas.
2. Entrega a Codex la ruta del otro repositorio, nombre del producto, proyecto Supabase de origen y dominio. Recibe primero el inventario y la ficha A; no es necesario compartir claves por chat.
3. Aprueba nombre, ID permanente, entornos, Analytics, región y coste. Sólo después, Codex crea/reutiliza el proyecto autorizado o tú lo haces con «Crear proyecto». El ID merece una revisión especial porque permanece asociado al proyecto. [Alta de proyecto y app web](https://firebase.google.com/docs/web/setup).
4. Si el diseño requiere facturación, revisa en **Google Cloud → Facturación** la cuenta y el proyecto exactos. Autoriza la vinculación y las alertas; no confundas esa decisión con permiso para crear cualquier recurso.
5. En **Firebase → Configuración del proyecto → Tus apps**, registra o comprueba la aplicación web. La configuración cliente va al entorno adecuado; no hace falta crear una clave privada de servicio.
6. En **Authentication**, comprueba los proveedores aprobados, dominios y plantillas. Acepta tú cualquier autorización Google pendiente. Prueba que el correo de soporte exista y que lleguen realmente los mensajes de verificación y recuperación; escribir una dirección en la configuración no crea el buzón. [Correo y contraseña](https://firebase.google.com/docs/auth/web/password-auth).
7. Cuando Codex entregue una candidata HTTPS, entra con una cuenta controlada y realiza el recorrido de U. Tu acceso al dashboard no prueba que el cliente de la app pueda entrar.
8. Recibe el ensayo de importación, las diferencias y la prueba de vuelta atrás. Autoriza por separado el cambio público. Supabase se conserva hasta cumplir Z; no tienes que borrarlo para completar el login nuevo.

## A Acordar el alcance y las decisiones

Antes de tocar la nube, registrar:

| Decisión | Información que debe quedar aprobada |
|---|---|
| Repositorio | Ruta, remoto Git, rama, revisión y cambios previos que se conservarán |
| Cuenta Google | Cuenta humana administradora y propietario de recuperación |
| Proyectos | Nombre visible e ID permanente de desarrollo y producción; crear o reutilizar, con motivo |
| Facturación | ID y nombre de la cuenta, recursos autorizados y presupuesto de ensayo/operación |
| Datos | Qué se migra, quién autoriza su lectura, ubicación y plazo de conservación de copias |
| Diseño | Firestore, autenticación, cómputo, almacenamiento, regiones y servicios especiales |
| Analítica | Activada o desactivada; finalidad y consentimiento si corresponde |
| Corte | Ventana, interrupción tolerable, condiciones de vuelta atrás y quién decide |
| Retiro | Fecha o criterio para apagar Supabase; nunca borrarlo al completar sólo la primera prueba |

**Termina cuando:** la ficha tiene valores reales y decisiones registradas. Rob conserva publicación, aceptación comercial, eliminación de producción y ampliaciones de presupuesto. No convertir un permiso de auditoría en permiso para importar o desplegar.

## B Buscar todo lo que hoy depende de Supabase

Confirmar repositorio, revisión y estado de trabajo. Leer instrucciones locales, plan, backlog, cronograma, bitácora e incidentes. Usar el grafo de código si existe; completar con búsquedas de configuración y literales.

Inventariar tanto el código como los recursos realmente desplegados: tablas, vistas, índices, claves y restricciones; triggers, funciones SQL/RPC, extensiones, cron, colas y webhooks; RLS y roles; Auth y proveedores; buckets y archivos; Edge Functions, secretos, Realtime, dominios, correos, CI y procesos externos. Identificar consultas desde el navegador que hoy llegan directamente a Supabase y código con `service_role`.

Para cada función de negocio, anotar origen, destino propuesto, propietario, prueba positiva y prueba de acceso denegado. Clasificar cada pieza como conservar, adaptar, reemplazar o retirar. Buscar clientes antiguos: móvil, aplicaciones instaladas, integraciones y enlaces compartidos también pueden seguir escribiendo.

**Termina cuando:** no queda un servicio usado sin destino o decisión explícita. Un paquete del SDK instalado no demuestra uso en producción; un archivo local tampoco demuestra despliegue.

## C Comprobar cuentas y herramientas por separado

Ejecutar primero comandos de inspección en la carpeta correcta:

```powershell
git remote -v
git rev-parse HEAD
git status --short
node --version
firebase --version
firebase login:list
firebase projects:list
gcloud --version
gcloud auth list
gcloud config list
gcloud projects list
gcloud billing accounts list
```

No publicar la salida completa si contiene información de otras aplicaciones. Si falta la CLI, registrar la versión elegida e instalarla dentro del alcance autorizado; no sobrescribir herramientas de otro proyecto por comodidad.

Hay cuatro accesos diferentes: sesión de Firebase CLI, sesión de gcloud, credenciales ADC para librerías y sesión Google del navegador. Uno no prueba los demás. Si hace falta `firebase login`, `gcloud auth login` o un login ADC, Rob completa personalmente consentimiento y verificaciones. Nunca pedir contraseñas, códigos de recuperación, tokens o JSON de cuenta de servicio por chat. [Firebase CLI](https://firebase.google.com/docs/cli) y [credenciales ADC](https://docs.cloud.google.com/docs/authentication/application-default-credentials).

Para quien está remoto: abrir un `.cmd` en el visor del chat muestra su texto; no lo ejecuta. El operador debe lanzarlo en la PC o dar una instrucción ejecutable dentro de su entorno autorizado. `127.0.0.1` en el teléfono apunta al teléfono. Usar la candidata HTTPS aprobada o el acceso remoto de la PC para las pruebas.

**Termina cuando:** las identidades y permisos reales están registrados y cada acceso necesario ha pasado una lectura de prueba, sin mostrar sus credenciales.

## D Decidir la arquitectura antes de traducir código

Firebase agrupa servicios; Google Cloud aporta también cómputo, IAM y almacenamiento. Firestore es una base documental, no un receptor de un dump SQL. Esta tabla es una guía de diseño, no una conversión automática:

| Supabase | Destino posible | Trabajo que sigue siendo nuestro |
|---|---|---|
| Auth | Firebase Authentication | Identidades, proveedores, sesiones, roles y recuperación |
| PostgreSQL | Firestore si el modelo encaja | Consultas, restricciones, transacciones y migrador |
| RLS | Reglas para clientes y/o autorización del backend | Reproducir cada permiso y sus negativos |
| Storage | Google Cloud Storage / Cloud Storage for Firebase | Objetos, metadatos, acceso, subida y purga |
| Edge Functions/RPC | Cloud Run o Functions | Portar lógica, autenticación e idempotencia |
| Cron/colas | Scheduler y un despachador/cola justificados | Entrega repetida, leases, reintentos y conciliación |
| Realtime | Listeners de Firestore u otro canal | Consultas, permisos, coste y semántica |
| pgvector/PostGIS/búsqueda SQL | Solución específica que cumpla el caso | Validar precisión, consulta, precio y migración |

No forzar Firestore si el producto depende de joins arbitrarios, reportes SQL extensos, transacciones relacionales amplias o extensiones sin equivalente. Plantear una fase híbrida o una alternativa; decidir antes de construir. **Este patrón no necesita Cloud SQL**, y Vistavo lo excluyó expresamente. Si el otro proyecto lo requiere, debe justificarlo y obtener su propia autorización.

Para presencia online, por ejemplo, un listener no sustituye automáticamente `onDisconnect`; existe una solución de Firebase que combina Realtime Database y Firestore. [Presencia](https://firebase.google.com/docs/firestore/solutions/presence).

**Termina cuando:** cada consulta y requisito importante tiene una solución demostrable y un coste previsto.

## E Estimar costes y revisar cuotas al principio

Separar coste fijo, consumo, migración temporal y proveedores externos. Considerar Firestore (lecturas, escrituras, índices y almacenamiento), objetos y transferencia, cómputo, builds, imágenes de contenedor, secretos, logs, respaldos, correo y IA. Una cuenta de facturación puede pagar varios proyectos, pero los informes y credenciales deben mantenerse separados.

Un diseño de cómputo bajo demanda puede reducir tiempo ocioso. No garantiza factura cero: revisar modalidad de facturación, mínimos, concurrencia y servicios auxiliares. El presupuesto anterior de una instancia SQL no describe el coste de una arquitectura Firestore. [Instancias mínimas de Cloud Run](https://docs.cloud.google.com/run/docs/configuring/min-instances).

Verificar el plan vigente: Cloud Storage for Firebase requiere Blaze según las condiciones actuales. No prometer un sistema con archivos y procesamiento en Spark sólo porque Auth o Hosting admitan cierto uso gratuito. [Requisitos de Storage](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024).

Confirmar cuotas y servicios disponibles antes del desarrollo dependiente. Una cuota concedida puede tardar en reflejarse; comprobar la operación real, no sólo el correo. Configurar alertas y límites operativos. Un presupuesto **sólo de alertas** no es un corte automático de gasto; si la cuenta ofrece otra modalidad de límite, comprobar su cobertura y condiciones. [Presupuestos](https://docs.cloud.google.com/billing/docs/how-to/budgets) y [cuotas](https://docs.cloud.google.com/docs/quotas/troubleshoot).

**Termina cuando:** Rob conoce el escenario estimado y el límite del ensayo. Registrar factura/consumo real por separado de estimaciones; usar «no medido» para lo desconocido.

## F Fijar proyectos regiones y entornos

Después de la aprobación, crear o reutilizar el proyecto exacto y registrar la app web. Separar desarrollo y producción siempre que el contexto lo permita; usar datos sintéticos y pagos de prueba en desarrollo. Una segunda app web dentro del mismo proyecto no equivale a aislamiento de backend.

Elegir la ubicación de Firestore antes de crear la base; su ubicación no se cambia simplemente editando una variable. Verificar compatibilidad con usuarios, requisitos de datos, cómputo y almacenamiento. Evitar copiar `us-central1` sin evaluar el nuevo producto. [Buenas prácticas de Firestore](https://firebase.google.com/docs/firestore/best-practices).

Usar alias de Firebase y configuración de gcloud por proyecto sin depender del «último proyecto activo». Cada script de mutación debe exigir el ID esperado, comprobar la identidad y usar selección explícita. Mantener variables, buckets, secretos y salidas en espacios propios del proyecto. `Billing for Robertson` puede ser una pista histórica para Rob, pero el nombre no sustituye comprobar ID y aprobación de la cuenta en el nuevo trabajo.

**Termina cuando:** un manifiesto identifica todos los destinos y evita que un comando apunte por accidente a Vistavo, Techos.app, RoofPrecision u otra aplicación.

## G Guardar respaldos y ensayar la restauración

Antes de exportar clientes, aprobar ubicación, acceso y retención. Guardar copias cifradas fuera del repositorio y del contexto de los LLM. El manifiesto público de evidencia contiene conteos, hashes y resultados; no hashes de contraseñas, correos, JWT ni transcripciones.

Respaldar esquema y datos, permisos/RLS, funciones y configuración desplegada. Respaldar Auth por una vía privilegiada autorizada que incluya lo necesario; un export ordinario de tablas de negocio puede excluir esquemas administrados. Exportar además los **bytes de Storage** y sus metadatos. Un backup de base no contiene por sí solo los archivos almacenados. [Backups de Supabase](https://supabase.com/docs/guides/platform/backups).

Anotar el punto de corte y tratar escrituras durante la copia. Datos, Auth y objetos no forman automáticamente un snapshot único. La estrategia más simple para una aplicación pequeña suele ser una ventana breve sin escrituras más exportación final y reconciliación; una migración sin pausa requiere captura de cambios y borrados diseñada y probada.

Restaurar la copia en un entorno aislado y comprobar relaciones, usuarios autorizados y objetos. No ejecutar triggers, cron, webhooks o cobros reales al restaurar. Mantener esas salidas deshabilitadas por defecto.

Crear además una matriz de recuperación por componente: datos Firestore, usuarios/credenciales Auth, versiones GCS, IAM, reglas, índices, secretos, configuración de workers, OAuth y DNS. Un export o PITR de una base no restaura automáticamente todos esos servicios. Para cada componente anotar qué se respalda, cómo se recupera, qué puede ser irreversible y el resultado del ensayo.

**Termina cuando:** el respaldo se ha restaurado y verificado, con tiempo y resultados registrados. «Descargué el archivo» no es una prueba de recuperación.

## H Hacer el mapa de identidades y propietarios

Crear un mapa determinista de `supabase_user_id → firebase_uid → business_account_id/tenant_id`. Si los UUID originales son compatibles, conservarlos como UID puede simplificar referencias, pero hay que verificar colisiones y proveedores antes. De lo contrario, migrar todas las referencias mediante el mapa. Distinguir usuario de cuenta, empresa o tenant.

Inventariar usuarios activos, deshabilitados, borrados, verificados, invitados, anónimos, con MFA y con identidades enlazadas. Resolver correos duplicados, cuentas fusionadas e identidades sin correo antes del import. No convertir `user_metadata` editable por el cliente en permisos de administrador.

Definir qué ocurre con sesiones existentes: los JWT/refresh tokens de Supabase no se convierten en sesiones Firebase. Avisar del nuevo inicio de sesión. Durante una convivencia temporal, un verificador explícito por emisor y proyecto evita aceptar cualquier JWT con apariencia válida; una fecha de retiro elimina la ruta antigua.

**Termina cuando:** ningún proyecto, archivo, saldo o suscripción queda sin dueño; no hay fusiones basadas únicamente en coincidencia de correo.

## I Importar usuarios y resolver contraseñas

Ensayar con cuentas controladas antes de exportar usuarios reales. Supabase documenta bcrypt para contraseñas y Firebase Admin permite importar bcrypt. Esto hace posible conservar contraseñas **si el hash real, el formato y la ruta de acceso son compatibles**. [Seguridad de contraseñas de Supabase](https://supabase.com/docs/guides/auth/password-security) e [importación en Firebase](https://firebase.google.com/docs/auth/admin/import-users).

El migrador privilegiado lee los hashes desde un respaldo o conexión autorizados sin imprimirlos; usa el formato de bytes que exige el SDK, procesa lotes compatibles con la versión instalada y registra cada resultado. El import masivo no comprueba por nosotros todos los duplicados: prevalidar UID, email e identidades y reconciliar errores por índice. No sobreescribir un usuario que ya empezó a usar Firebase.

Para OAuth, importar proveedores requiere su `providerId` y el identificador correcto del proveedor, no sólo el correo. Si falta una identidad segura, planificar reautenticación y enlace comprobado. No trasladar tokens OAuth de Google ni prometer conservar permisos Drive. MFA, passkeys, SSO y proveedores especiales necesitan una evaluación propia; no se dan por migrados con `auth.users`.

Una respuesta favorable de `importUsers` o un emulador no demuestra que la contraseña se haya conservado. Probar en el servicio Auth real autorizado, con cuentas controladas: contraseña original aceptada, incorrecta rechazada y repetición del lote sin sobrescribir un usuario que ya cambió su contraseña en destino.

Si no se puede importar la contraseña con confianza, aprobar un flujo de restablecimiento. Resolver primero correos duplicados o de propiedad incierta; para cuentas sensibles o identidades en conflicto, exigir una recuperación comprobada fuera de banda. No dar por verificado un correo únicamente por importarlo. Evitar enumeración de cuentas, limitar abuso y no lanzar correos masivos de recuperación sin autorización y ensayo de entrega. No pedir a Rob que recopile contraseñas. Probar login con la contraseña original, contraseña errónea, verificación, recuperación, bloqueo y reejecución del lote sin duplicados.

**Termina cuando:** cada usuario está importado, excluido por decisión o pendiente de una acción explícita. Cero errores sin clasificar; cuentas deshabilitadas y estados de verificación conservados por una política revisada.

## J Juntar los flujos de login con el backend

Habilitar en Firebase Console los proveedores aprobados, correo de soporte, plantillas, dominios y enlaces de acción. Configurar el dominio de autenticación y los retornos OAuth correctos. `localhost` no viene autorizado por defecto en proyectos nuevos según la documentación actual; añadirlo sólo donde corresponda y probar la candidata HTTPS. [FAQ de Auth](https://firebase.google.com/docs/auth/faq-and-troubleshooting) y [Google Sign-In](https://firebase.google.com/docs/auth/web/google-signin).

El navegador obtiene un **Firebase ID token** con el SDK y lo presenta al backend. El backend usa Firebase Admin del proyecto esperado, verifica el token y resuelve la cuenta desde el UID. No confiar en un `accountId` o rol enviado por el navegador. Para operaciones sensibles, aplicar la política de revocación (`verifyIdToken(token, true)` cuando corresponda), usuario habilitado y membresía vigente. Verificar un ID token sin esa opción no comprueba automáticamente revocación. [Verificación](https://firebase.google.com/docs/auth/admin/verify-id-tokens) y [sesiones](https://firebase.google.com/docs/auth/admin/manage-sessions).

Si se usan cookies de sesión, probar `Secure`, `HttpOnly`, política `SameSite` y protección CSRF adecuada. Con Bearer, proteger el token contra filtraciones y XSS. CORS y App Check no sustituyen identidad ni autorización. Una prueba con un stub de identidad no acepta login humano.

**Termina cuando:** Google y correo funcionan en navegador real, el backend rechaza emisor/proyecto incorrecto y se prueban logout, recuperación, verificación y acceso revocado. Consentir Google login no concede automáticamente acceso a Drive/Gemini.

## K Convertir el modelo relacional con sus consultas

Diseñar colecciones desde las lecturas y escrituras reales: cuentas, membresías, proyectos, archivos, trabajos y eventos, según el producto. Preservar IDs de negocio y relaciones mediante campos explícitos. Diseñar paginación y filtros por cuenta desde el principio.

Documentar equivalencias de tipos: `NULL` frente a campo ausente, enteros grandes, decimales, fechas UTC, JSON, enums y binarios. Para dinero, elegir unidades enteras y representación exacta con rango validado; no convertir `numeric` a flotante por comodidad. Archivos grandes, transcripciones extensas o historial ilimitado no deben crecer dentro de un solo documento. El límite de documento de Firestore es 1 MiB. [Cuotas](https://firebase.google.com/docs/firestore/quotas).

Reproducir explícitamente unicidad, claves foráneas, cascadas y restricciones que PostgreSQL imponía. Una opción de unicidad es un documento de reserva de clave actualizado junto a la entidad en una transacción; probar colisiones reales. En las transacciones, leer antes de escribir y respetar los límites vigentes de tamaño, tiempo y operaciones; un lote de migración no puede convertirse en una transacción ilimitada. Verificar el SDK elegido y [sus límites documentados](https://firebase.google.com/docs/firestore/manage-data/transactions), sin copiar cifras históricas como reglas universales. Definir índices necesarios, evitar índices de campos grandes no consultados y esperar a que estén listos antes del corte. No almacenar todos los eventos de todos los usuarios en un único documento contador.

**Termina cuando:** cada consulta crítica se ejecuta en el destino con datos representativos y cada restricción tiene dueño, implementación y prueba.

## L Llevar las políticas RLS a permisos equivalentes

Para cada regla antigua, escribir una prueba: propietario permitido, otra cuenta denegada, membresía revocada denegada, usuario anónimo denegado y rol insuficiente denegado. Incluir listas, búsquedas, exportaciones, archivos y tareas indirectas; proteger una pantalla no protege su endpoint.

Elegir el acceso de datos por función. Si el navegador accede a Firestore, implementar y probar Security Rules. Las reglas **no filtran resultados**: una consulta que podría devolver documentos no autorizados se rechaza; diseñar sus filtros por cuenta/tenant y probarlos. [Consultas seguras](https://firebase.google.com/docs/firestore/security/rules-query). Si accede sólo al backend, las reglas pueden denegar acceso cliente, mientras el servidor comprueba permisos. **Firebase Admin y las librerías servidor omiten las Security Rules de Firestore**: IAM permite al servicio acceder y la autorización de negocio debe limitar a cada usuario. [Reglas e IAM](https://firebase.google.com/docs/firestore/security/rules-conditions).

Las evaluaciones cliente que leen documentos auxiliares con `get()`, `exists()` o `getAfter()` pueden añadir lecturas facturables y latencia, incluso en determinados rechazos. Medir el patrón completo, incluidos listeners, sin quitar una comprobación de membresía necesaria sólo para abaratarla. [Facturación de reglas](https://firebase.google.com/docs/firestore/pricing).

Roles en custom claims pueden servir para información estable; si la revocación debe aplicarse a la siguiente operación, releer la autoridad viva de cuenta/membresía. Acordar el instante de autorización de una descarga. Rechazar peticiones nuevas después de revocar no permite retirar bytes ya entregados o una transferencia ya autorizada.

Cuando la autoridad proteja una escritura o reserva Firestore, validarla junto al recurso dentro de la misma transacción que la mutación; una comprobación anterior aislada deja una ventana de carrera. En workers, un token de fencing vincula cada intento y sólo el vigente puede publicar o liquidar. Un lease vencido por sí solo no detiene a un proceso antiguo. Los efectos externos requieren además el protocolo de Q.

**Termina cuando:** todas las políticas inventariadas tienen una prueba de paridad y ninguna ruta de Admin confía en una identidad suministrada por el cliente.

## M Migrar datos por lotes con reanudación

Construir un migrador propio del proyecto con modo `dry-run`, esquema versionado, ID de migración, selección explícita de origen/destino y checkpoints durables. Transformar un conjunto pequeño, importar a staging, comparar y sólo entonces ampliar. Evitar una herramienta genérica que escriba cualquier tabla en cualquier colección sin validación.

Usar IDs deterministas y un registro de contenido/versión para que reanudar no cree duplicados. No volver a ejecutar ciegamente «upsert todo» sobre producción: puede borrar cambios nuevos o resucitar registros eliminados. Separar carga base, deltas ordenados y tombstones de borrado. Si se usa concurrencia, acotarla según pruebas y cuotas, sin inventar una cifra universal.

Comparar por tenant y entidad: conteos esperados, claves únicas, referencias resueltas, rangos de fechas y hashes sobre datos normalizados. Definir antes la normalización y el orden; un hash JSON sin canonicalización puede diferir sólo por formato. Mantener diferencias explicadas y una cola de errores reanudable. [Escrituras y transacciones](https://firebase.google.com/docs/firestore/manage-data/transactions).

**Termina cuando:** no hay diferencias sin explicar ni referencias huérfanas, el segundo pase no duplica y un corte a mitad del proceso se recupera sin perder datos.

## N Navegar la migración de archivos privados

Crear buckets privados con controles revisados, región y retención aprobadas. Para cada objeto, registrar origen, clave destino, propietario, tamaño, tipo, hash SHA-256 y versión/generación cuando aplique. Copiar bytes y metadatos necesarios; comparar el destino con una lectura/verificación independiente. No asumir que ETag equivale siempre a SHA-256.

Actualizar referencias de proyectos, miniaturas y resultados al destino sólo cuando el objeto exista y coincida. Preservar archivos cuyo nombre se repite en cuentas distintas; nunca deducir propietario únicamente del nombre. Resumable uploads, límites, CORS, expiración y verificación del objeto final necesitan pruebas propias. Una URI de sesión de subida es una capacidad sensible.

Definir el mecanismo de descarga: proxy autorizado por petición, URL firmada de duración acotada o SDK con reglas. Una URL firmada puede seguir usándose por su poseedor durante su validez; bucket privado y Public Access Prevention no la convierten en una comprobación de membresía por descarga. [URLs firmadas](https://docs.cloud.google.com/storage/docs/access-control/signed-urls) y [prevención de acceso público](https://docs.cloud.google.com/storage/docs/public-access-prevention).

Distinguir además las URLs Firebase con token de descarga de las URLs firmadas GCS. Tratar ambos tokens como capacidades sensibles; no guardarlos en prompts o logs. Si el contrato requiere revocación de acceso, probar su vigencia y revocación expresamente, sin presumir que vuelven a verificar membresía en cada GET. Las lecturas directas mediante GCS/SDK servidor se autorizan por IAM y no por las reglas cliente de Firebase Storage; el backend debe comprobar propietario y permiso por objeto. Para descarga cliente con reglas, evaluar la API directa del SDK y probar su comportamiento. [Descarga web](https://firebase.google.com/docs/storage/web/download-files) y [seguridad de Storage](https://firebase.google.com/docs/storage/security).

**Termina cuando:** inventario y bytes coinciden, propietario/otras cuentas se prueban, nuevas descargas se deniegan según la política de revocación y el borrado considera versiones anteriores, retenciones y objetos pendientes.

## O Organizar credenciales IAM y la entrada a la API

Usar identidades de servicio separadas cuando los roles lo requieran: API, subida/validación, procesamiento y limpieza. Dar a cada una sólo acceso a sus datos, operaciones y secretos. El permiso para crear resultados no implica permiso para subir originales ni para leer cualquier archivo.

En Cloud Run/Functions, utilizar identidad administrada/ADC. En desarrollo, usar credenciales locales autorizadas fuera del repositorio y evitar modificar ADC global de otros proyectos. Preferir identidad federada para CI cuando esté disponible. Guardar secretos de IA, pagos o correo en Secret Manager; no en JavaScript público, imágenes, logs, prompts o Git. La configuración cliente Firebase identifica la app; no reemplaza controles de acceso.

**Diseñar cómo llega el navegador a la API.** Un Firebase ID token no equivale al token IAM OIDC que protege un servicio Cloud Run privado. Elegir un proxy autenticado/server-side o una entrada de transporte accesible que verifique Firebase y permisos en cada endpoint; mantener workers y APIs internas privados. No resolverlo exponiendo todos los servicios. Probar ingress, audiencia del token e invocador real del despachador. [Autenticación entre servicios](https://docs.cloud.google.com/run/docs/authenticating/service-to-service).

**Termina cuando:** cada conexión tiene una identidad y una prueba permitida/denegada; no hay claves JSON de servicio guardadas en el repositorio.

## P Portar procesos y trabajos bajo demanda

Portar Edge Functions y RPC con contratos estables: petición, respuesta, autenticación, errores, límites y efectos. Cambiar Deno a Node, SQL a código o una transacción a varias escrituras exige revisar comportamiento, no sólo compilar. Migrar también cron y webhooks con sus firmas, deduplicación y destinatarios.

Para trabajo lento, la API crea/reserva el trabajo, devuelve una identidad y el worker procesa fuera del ciclo HTTP. Persistir estado en Firestore y archivos en GCS; el disco temporal no es almacenamiento durable. Usar outbox/cola o despacho que cierre la brecha entre guardar trabajo y ejecutarlo. La entrega puede repetirse: deduplicar, usar leases, heartbeat, expiración y conciliación. Un ID de tarea de plataforma ayuda, pero no sustituye la identidad de negocio.

Separar el resultado del negocio del resultado de la ejecución Cloud Run: ambos deben verificarse. Un job puede guardar el producto y luego salir con error por una carrera de heartbeat. Revisar checkpoints antes de repetir pagos o IA. [Reintentos y checkpoints](https://docs.cloud.google.com/run/docs/jobs-retries).

**Termina cuando:** un trabajo se recupera de caída y despacho repetido con un único efecto de negocio, y no hay dos cron activos ejecutando el mismo efecto en ambas plataformas.

## Q Quitar ambigüedades de saldo pagos y efectos externos

Antes de migrar dinero, exportar y conciliar eventos, compras, ajustes, saldo disponible, consumido y reservado. Distinguir saldo real de créditos sintéticos. Mantener IDs originales de compra y del proveedor de pagos para deduplicar callbacks, incluso si llegan después del corte.

Usar un ledger de movimientos y una máquina de estados explícita: reservado, en proceso, consumido, liberado o incierto, según el producto. Escrituras relacionadas deben ser atómicas. Una transacción Firestore puede repetirse; no llamar a IA, cobrar, enviar correo ni disparar otro efecto externo dentro de su callback. Probar esa propiedad con fallos y carreras reales.

Si una reserva se confirmó pero se perdió el acuse, buscar una vez la solicitud durable con todos sus vínculos antes de responder o reintentar. Si un proveedor quizá ejecutó la operación, `UNKNOWN` requiere conciliación: ni liberar dinero ni volver a cobrar por adivinación. No imponer «exactamente una vez» como una promesa sin diseño de idempotencia y recuperación.

Firestore, GCS, Auth, la plataforma de cómputo y el proveedor externo no comparten una única transacción. Por cada efecto, guardar `operationId`, huella de petición, estado, identidad de intento y recibo. Reutilizar una clave sólo para la misma operación y conforme al contrato del proveedor; no cambiarla para saltar una deduplicación ni asumir que una API de IA la soporta. Tras una respuesta ambigua, conciliar antes de autorizar otro efecto.

Definir salidas de negocio sin producto, como video sin habla confirmado: liberar una vez cuando exista evidencia suficiente; no confundir silencio exacto con ruido/música ni un fallo de red con ausencia de voz. Reservas financieras y cuotas de almacenamiento pueden liberarse en momentos distintos.

**Termina cuando:** compra duplicada, webhook repetido, ACK perdido, fallo previo y resultado incierto tienen pruebas financieras y ningún saldo cambia para conseguir un ensayo verde.

## R Revisar con T3 y conservar la evidencia

Aplicar las instrucciones del nuevo proyecto. Si T3 está autorizado, Codex coordina el alcance; DeepSeek propone el cambio mínimo y pruebas; Kimi audita riesgos independientemente; Codex contrasta e integra. En Vistavo se utilizaron `deepseek/deepseek-v4.1-flash` y `moonshotai/kimi-k3.1-pro` por respaldo OpenRouter autorizado. El nuevo proyecto debe autorizar su propia instancia, credencial, modelos y gasto; nunca tomar una clave de otra app porque funciona.

Enviar objetivo, ID de tarea, revisión, archivos completos relevantes, dependencias, contrato y negativos. Revisiones independientes pueden ir en paralelo; cambios dependientes se integran en secuencia. Reducir contexto con alcance explícito e índice de omisiones por hash; no ocultar código actual que determina la aceptación ni reenviar todo el historial sin selección.

Guardar respuestas completas, uso, modelo, vía, generación, contexto/hash, coste y errores. Exigir al final:

```text
=== RESUMEN FINAL ===
RESULTADO: PASS|FALLA|INCONCLUYENTE
EVIDENCIA: rutas y comprobaciones concretas
NEGATIVOS: controles y límites comprobados
BLOQUEOS: pendientes reales o ninguno en el alcance
=== FIN RESUMEN ===
```

Leer el resumen primero y el informe completo antes de aceptar. Un HTTP 200 con contenido `null` no es una revisión favorable. Un 402 de OpenRouter no prueba una cuota Google agotada. No reenviar automáticamente una solicitud de gasto cuyo estado sea incierto. La revisión final de Gemini, si se acuerda, debe usar el modelo y la modalidad aprobados; el Batch se consulta por el mismo ID.

**Termina cuando:** hallazgos resueltos o refutados con evidencia, informes originales preservados, independencia real y cobertura de cada revisor declarada.

## S Someter el sistema a pruebas de paridad y fallos

Construir una matriz de aceptación desde B y L. Ejecutar tipos, pruebas y compilaciones pertinentes; verificar la versión real de Node/SDK/herramientas, emuladores y base de pruebas si aún hay compatibilidad PostgreSQL. Separar evidencia de emulador, mocks, nube y usuario humano. No sumar como distintas las pruebas focales incluidas en la suite general.

Pruebas mínimas: login y recuperación; aislamiento de dos cuentas; cuentas suspendidas; lectura/escritura/borrado; consultas y paginación; archivos y rangos; revocación; carreras de transacción; solicitud duplicada; caída tras commit; pérdida de acuse; proveedor ambiguo; reintento de worker; purga y restauración. Añadir casos de dominio: audio débil, multicanal, contenedores, archivo grande o datos especiales.

Conservar el control negativo contra el defecto anterior. Si un test falla por el harness, corregir el harness y mantener su salida original; no declarar que el producto pasó esa ejecución. Medir latencia, bytes, memoria, llamadas y coste con cargas sintéticas representativas antes de archivos de clientes autorizados.

**Termina cuando:** matriz sin pendientes críticos, casos negativos significativos y aceptación humana de los recorridos que no cubre una automatización.

## T Trasladar una candidata privada con fuente verificable

Crear un artefacto de release con lista explícita de fuentes, hash y versiones. Construir una vez y desplegar la misma imagen por digest a los componentes correspondientes. Leer después la configuración real: imagen/revisión, identidad, secretos, ingress, invocadores, memoria, timeout, concurrencia, mínimos, reintentos e índices. Guardar ese readback como evidencia.

Ejecutar primero un preflight con la identidad que usará cada proceso. Probar un archivo y un trabajo pequeños, sin clientes ni dinero real. Registrar intención de cada operación pagada y su identidad antes de enviarla; guardar el ID de operación de plataforma y consultar su estado ante una interrupción. Un fallo de lectura del estado no autoriza volver a crear el trabajo.

Al terminar, reconciliar todos los efectos: estado del negocio, salida de plataforma, recibos de proveedor, saldo, cuotas, archivos y limpieza. Un HTTP 202 sólo acredita admisión. Un contenedor nuevo no acredita que todos los servicios lo estén usando.

**Termina cuando:** fuentes, imagen, configuración y ensayo real corresponden a la misma candidata, con resultados durables y limpieza demostrada.

## U Unir frontend dominio y autenticación humana

Configurar la candidata web para el Firebase correcto y la API elegida. Probar en HTTPS desde computadora y móvil. Si se usa Firebase Hosting para el frontend, desplegar sólo el destino aprobado; distinguirlo del despliegue de backend. No asumir que una regla de rewrite permite por sí sola invocar una API privada.

En el dominio, exportar los registros DNS antes de modificarlos. Conservar MX, SPF, DKIM y DMARC del correo; usar exactamente los registros que entregue el proveedor para dominio raíz, `www` y certificados. DNS, SSL, Firebase authorized domains, OAuth redirect y CORS son configuraciones diferentes y deben concordar. Cloudflare puede gestionar DNS sin ejecutar el backend.

Probar el recorrido humano completo: iniciar sesión, crear, subir, procesar, revisar, guardar, cerrar, reabrir, descargar y borrar. Comprobar qué ve el usuario ante falta de saldo, autorización cancelada o fallo de proveedor. No publicar un botón que apunte a una función sólo disponible en la candidata local.

**Termina cuando:** la web real y el backend trabajan juntos con una cuenta humana; no sólo una portada accesible o un stub de autenticación.

## V Verificar el ensayo de corte y vuelta atrás

Ensayar con una copia autorizada: carga base, pausa de escrituras, drenado o clasificación de trabajos, exportación final, deltas y borrados, reconciliación de usuarios/datos/objetos y cambio de ruta. Medir cuánto tarda y convertirlo en el guion del corte real. No elegir un TTL DNS como única estrategia: clientes instalados y pestañas abiertas pueden seguir usando endpoints viejos.

Definir un único escritor autoritativo por fase. Si se diseña escritura dual, implementar orden, deduplicación, cola de errores y resolución de conflictos; no tratar dos `write()` independientes como migración sin riesgo. Mantener desactivados los cron, webhooks y cobros de la copia de ensayo.

La vuelta atrás después de nuevas escrituras Firebase necesita más que volver al DNS anterior. Pausar entradas, conservar deltas de datos, identidades nuevas, cambios de contraseña, archivos, pagos y borrados; aplicar una sincronización inversa probada o resolverlos mediante un procedimiento aprobado. Las sesiones de Firebase y sus nuevas credenciales no se transforman automáticamente de vuelta a Supabase. Si esa recuperación no está probada, mantener el destino en modo lectura hasta definirla, o elegir una ventana de corte que limite el riesgo.

**Termina cuando:** se puede volver sin perder operaciones aceptadas y el tiempo de recuperación/pérdida tolerable están aprobados y medidos.

## W Ejecutar el cambio de producción autorizado

Rob aprueba el corte concreto con candidata, respaldo restaurado, reconciliación y retorno disponibles. Registrar hora, operador y versión. Activar mantenimiento o barrera de escritura que cubra también backend viejo, clientes móviles, cron y webhooks; drenar trabajos conocidos y clasificar los inciertos sin relanzarlos.

Tomar el punto final de origen; importar deltas y tombstones y reconciliar Auth, datos, ledger y objetos. Confirmar índices y reglas. Cambiar la configuración/ruta del frontend y la entrada de API, habilitar un solo conjunto de consumidores y abrir primero a un grupo pequeño. El backend antiguo debe rechazar escrituras tardías o redirigir mediante un mecanismo diseñado, no seguir aceptándolas en silencio.

Verificar compras y eventos externos por ID original, nuevas cuentas, recuperación de contraseña, proyectos antiguos y archivos. Si se cumplen los umbrales de parada, ejecutar la vuelta atrás ensayada; no improvisar borrados ni reembolsos masivos.

**Termina cuando:** todos los escritores activos usan el destino correcto y el origen permanece protegido durante la observación.

## X Examinar errores rendimiento y factura

Monitorizar al menos: tasas de error y latencia por etapa; login; filas/documentos reconciliados; trabajos atascados; reservas antiguas; resultados sin publicar; cuotas físicas; rechazos de acceso; webhooks duplicados; bytes y consumo. Registrar IDs de correlación, no cuerpos de clientes ni tokens.

Separar fallos del negocio, proveedor, SDK/transporte, plataforma y herramientas del operador. Tener trazas desde el principio evita intentar explicar meses después un 500 sin excepción causal. Comprobar la salida de Cloud Run aunque el trabajo del negocio diga `succeeded`.

Comparar la factura real por proyecto con el escenario aprobado. Coste de revisión LLM, coste de IA del producto y factura de Google Cloud son cuentas diferentes. La ausencia de usuarios activos no elimina necesariamente costes de almacenamiento, imágenes o respaldos.

**Termina cuando:** durante el periodo acordado no hay divergencias críticas y existe un responsable para cada alerta con procedimiento de respuesta.

## Y Resolver pendientes y aceptar con evidencia

Separar cinco estados: implementado, probado localmente, desplegado en privado, aceptado por humano y publicado comercialmente. No llamar «migración terminada» al primero ni al segundo.

La aceptación exige: usuarios y relaciones migrados; datos y archivos reconciliados; autorización de dos cuentas y revocación; recorridos humanos completos; jobs y dinero sin ambigüedades sin dueño; recuperación ensayada; métricas y costes observados; operación responsable. Todo pendiente fuera de alcance debe tener impacto, dueño y fecha/condición, sin esconder un bloqueo crítico bajo una nota.

Documentar también lo que no se puede concluir. En Vistavo, la recuperación actual ante ACK perdido pasó sus pruebas, mientras la causa exacta del 500 original siguió inconclusa. La prueba de silencio digital no certificó clasificación universal de música o ruido. Esa separación evita repetir investigaciones y promesas incorrectas.

**Termina cuando:** el acta de aceptación contiene evidencia, límites y decisión humana correspondiente, no sólo un PASS del revisor.

## Z Cerrar operación y retirar Supabase de forma controlada

Actualizar plan, backlog, cronograma, incidentes y HANDOFF. Guardar manifest de release, configuración, reglas, índices, migradores, validadores, recibos y costes. Mantener originales de fallos y revisiones; no convertirlos retroactivamente en verdes porque otra candidata pasó.

Tras el periodo de conservación aprobado, confirmar que no hay tráfico ni escritores legítimos en origen, que la recuperación destino está probada y que se han tratado obligaciones de datos. Rob autoriza entonces retirar recursos y rotar/revocar credenciales viejas por alcance. Eliminar acceso a backups cuando venza su retención. No borrar Supabase para «evitar confusión» antes de este punto.

El HANDOFF debe permitir retomar sin leer todo el chat: revisión exacta, estado por fase, decisiones, evidencias, costes observables, gates abiertos y próximo paso. Copiar al otro proyecto sólo el manual y herramientas revisadas; nunca copiar carpetas de credenciales, saldos ficticios o configuración de producción de Vistavo.

**Termina cuando:** existe un único sistema autoritativo, su recuperación funciona y el retiro del anterior quedó autorizado y documentado.

## Errores y lecciones comprobadas en Vistavo

Estas lecciones proceden del [cierre técnico privado](../reviews/LV-007-cierre-tres-pendientes-2026-11-14.md) y de su [revisión final](../reviews/LV-007-gemini-cierre-tres-pendientes-2026-11-14.md). Son referencias del repositorio original de Vistavo, no incluidas al copiar sólo este manual y las plantillas; los enlaces son opcionales para quien conserve acceso a ese repositorio. El informe Gemini histórico tiene SHA-256 `07104b73ee15caffb8db4c1c58c64af9bde5b58daccb3ddfffc5ab99cb25a569`. No trasladar archivos privados para completar enlaces. Las lecciones se aplican como controles en el otro proyecto; sus cifras no estiman su coste ni prueban su migración.

| Lo que ocurrió o se detectó | Qué cambió | Cómo ahorrar trabajo en el siguiente proyecto |
|---|---|---|
| Instalación y CLI autenticada se confundían con acceso completo | Se distinguieron sesiones, backend privado y aceptación humana | Comprobar cada identidad y ejecutar un recorrido HTTPS temprano |
| El diseño inicial consideró cómputo SQL permanente | Se aprobó Firestore y procesamiento bajo demanda, sin Cloud SQL | Revisar carga, consultas y coste fijo antes de crear recursos |
| HTTP 500 histórico de unos104s sin excepción SDK causal conservada | Se añadieron trazas y recuperación de una reserva con ACK perdido | Instrumentar etapas/IDs antes del primer ensayo; no adjudicar una causa sin pruebas |
| Se podía retener saldo ante ausencia de habla | Se definió `no_speech` probado, una liberación y barreras de conciliación | Escribir primero estados terminales, efectos financieros y negativos |
| Una respuesta de modelo generó texto para un clip sintético de silencio | Se añadió detector estricto de cero digital antes del proveedor | Usar controles deterministas cuando existan; nunca aceptar la instrucción al modelo como garantía |
| El segundo ensayo fallido capturó23 unidades ficticias | Se conservó100/77/23 como fallo, sin reembolso manual para verdear | Elegir fixtures sin dinero real y registrar cada movimiento original |
| Kimi detectó que un array disperso podía saltarse una validación | Se exigieron índices propios y recibos densos | Probar estructuras malformadas, no sólo respuestas ideales |
| Faltaba revalidación transaccional de input/autoridad para resultados | Estado y descarga releen vínculos y flags en transacción | Diseñar pruebas de revocación antes de construir la pantalla de descarga |
| El primer harness usó una identidad que no podía subir originales | Se usó el rol de validador autorizado; el fallo original quedó registrado | Hacer preflight por identidad y operación, sin ampliar IAM para ocultar un error de diseño |
| Un revisor afirmó incorrectamente que `getAll` no admitía ReadOptions finales | Se contrastó el SDK instalado con positivo y negativo reales | Revisar la versión exacta y fuentes primarias antes de reescribir una API correcta |
| Node descubrió suites de artefactos fuera del conjunto previsto | Se delimitó discovery y se mantuvieron controles separados | Mantener estructura de tests y artefactos desde el inicio; no contar suites solapadas |
| DeepSeek devolvió HTTP200 con contenidoNULL al alcanzar su límite de salida | Se conservó INCONCLUYENTE y su coste; seguimiento más enfocado | Leer contenido y cobertura; usar contextos completos pero acotados, sin fabricar informes |
| OpenRouter rechazó intentos por crédito insuficiente | Se distinguió crédito de revisores de cuotas de Google | Comprobar ambos proveedores antes de bloquear toda la integración |
| Un GET de readback del despliegue perdió conexión | Se consultó la operación existente sin repetir la mutación | Persistir intención/ID y preparar reentrada segura antes del primer PATCH/Run |
| El helper de polling Node24/Windows cerró con UV_HANDLE_CLOSING tras guardar HTTP200 | El Batch real se comprobó por su recibo terminal | Separar fallo local de herramienta y resultado del proveedor; nunca reenviar por el exit code aislado |
| Parte de una cadena histórica de revisión se perdió | Se declararon las lagunas y se creó una revisión nueva trazable | Conservar contexto, full report, raw, hashes, modelo y coste fuera del chat |
| Borrar lógicamente no demostraba retirar todas las versiones de objetos | Se comprobaron marcadores actuales y generaciones antiguas concretas | Diseñar el inventario de versiones antes de purgar; no inventar evidencia de objetos ya desaparecidos |

La candidata final privada pasó541 pruebas generales y201 de backend, tipos y dos compilaciones; sus tres ejecuciones nativas terminaron sin reintentos. Estas cifras son evidencia de esa candidata, no una meta numérica para otro producto ni prueba de login humano o migración de sus clientes. La revisión T3/Gemini de esa fase tuvo US$3.39576499956 de coste observado; Google Cloud, IA del producto y Codex no estaban medidos en ese subtotal.

## Orden recomendado para hacerlo más ágil

Primero inventario, cuentas, cuotas y diseño de coste. Después un único recorrido vertical sintético: Google login real en candidata HTTPS → una entidad → un archivo privado → un trabajo → descarga → revocación → borrado. Ese recorrido revela temprano errores de IAM, rutas y estados que no aparecen en módulos aislados.

Con ese contrato estable, avanzar en paralelo sólo lo independiente: esquema/consultas, identidad, copia de objetos y pruebas de permisos. Un único integrador coordina escritores. Migrar por lotes y reusar evidencia que conserve exactamente el mismo código; repetir pruebas cuando cambie una dependencia relevante, no por rutina.

Antes del primer ensayo pagado, congelar la candidata y ensayar su operador offline con controles de identidad, fuente y reentrada. Después ejecutar una prueba pequeña, conciliarla y limpiarla. Aumentar tamaño sólo al pasar ese control. Cerrar una fase por sesión cuando sea práctico y actualizar HANDOFF al terminar.

## Referencias para volver a comprobar al iniciar otro proyecto

Las tarifas, planes, cuotas, versiones y pantallas pueden cambiar. Volver a verificar la documentación enlazada en la fecha de la nueva ejecución. Los comandos de este manual son de inspección; los scripts de creación, migración, corte y retiro deben construirse para los IDs y permisos del proyecto aprobado.

Usar las fuentes oficiales enlazadas en cada etapa y las [plantillas](PLANTILLAS-MIGRACION-SUPABASE-FIREBASE.md). El otro LLM recibe documentos y contexto técnico mínimo; usuarios, hashes de contraseña, archivos de clientes y secretos permanecen fuera de sus prompts.
