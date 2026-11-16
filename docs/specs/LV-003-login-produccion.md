# LV-003 · Login definitivo con Firebase

Estado: preparación. El propietario pide aplicar el acceso definitivo. Google real, retorno a LinguistVision, compra PayPal Sandbox y salida/reentrada conservando 50 minutos ya están confirmados. Esta evidencia pertenece al proyecto `linguistvision-dev` y al esquema Sandbox; no equivale a publicación comercial.

## Propuesta de configuración

- Proyecto independiente `linguistvision-prod`, nombre visible LinguistVision, con aprobación explícita pendiente del ID permanente. Spark inicialmente y Analytics desactivado, sin habilitar facturación. Authentication no exige elegir una región de datos como Firestore; no crear almacenamiento o base de datos Firebase para este alcance.
- Mantener la arquitectura probada: Firebase Web para Google y correo/contraseña, confirmación y recuperación; servidor Node con Admin SDK, sesión HttpOnly y verificación de revocación; cuenta y permisos en PostgreSQL vinculados al UID validado.
- Dominio definitivo pendiente del propietario. Configurar HTTPS en el servidor DigitalOcean aprobado, dominios autorizados, retorno de Google y enlaces de correo sobre ese mismo origen. Revisar el retorno de Google en escritorio y Pixel antes de aceptar.
- Identidad de servidor propia de producción sin claves privadas versionadas. El acceso ADC de desarrollo no se da por válido para el servidor DigitalOcean: preparar y comprobar su identidad por separado.
- Preservar desarrollo y sus archivos. No importar automáticamente los 50 minutos Sandbox a saldo comercial ni unir identidades entre proyectos por coincidencia de correo. Cada entorno conserva su configuración y su base.

## Orden y evidencia de cierre

1. Confirmar dominio y aprobar el proyecto permanente; crear y configurar únicamente los recursos de LinguistVision.
2. Conectar la candidata a Firebase de producción y PostgreSQL de producción aislado. Mantener PayPal Sandbox durante las comprobaciones; habilitar pagos reales requiere su aceptación separada en LV-007.
3. Alta abierta con Google y contraseña; recibir y abrir confirmación; rechazar acceso de correo sin verificar; recibir y aplicar recuperación; comprobar la vinculación explícita de proveedores sin duplicar cuenta.
4. Verificar sesión tras recarga, salida y reentrada, revocación, saldo conservado y archivos inaccesibles desde otra cuenta. Repetir Google en Pixel, incluido el caso de ventana emergente bloqueada.
5. Preparar la candidata y reversión siguiendo [despliegue](../DEPLOYMENT.md), registrar resultados en [evidencia Firebase](../FIREBASE-VALIDATION-2026-11-10.md), y presentar la publicación al propietario. El cambio de proyecto no publica por sí solo la app ni activa cobros.

Dependencias: [LV-003](../../backlog.md#lv-003), [LV-007](../../backlog.md#lv-007). Se conservan las ventanas orientativas del [cronograma](../../gantt.md); dominio y proyecto final condicionan el recorrido público.

## Protección de intentos de acceso · 12 de noviembre de 2026

Corregido localmente el contador global que permitía que una conexión bloqueara a todas las demás. Reproducción previa:30 intentos Firebase inválidos desde A o10 códigos de invitación inválidos desde A provocaban429 para una credencial válida desde B. Los dos controles fallaron antes del cambio y pasan después.

El contador usa únicamente `socket.remoteAddress`; ignora `Forwarded` y `X-Forwarded-For`. Conserva30 solicitudes de sesión Firebase y10 fallos de invitación por ventana fija de60 segundos, ahora por conexión de origen. Normaliza direcciones IPv4 mapeadas, agrupa origen ausente y no prolonga la ventana con reintentos. Cada instancia conserva como máximo1024 orígenes; elimina ventanas vencidas y rechaza un origen nuevo si la capacidad sigue llena, sin expulsar contadores vivos. Los intentos de invitación que ya estaban en curso no se cancelan retroactivamente.

Evidencia:168 pruebas aprobadas,0 fallidas/omitidas; tipos y ambas compilaciones correctos. Regresión Firebase del handler con dobles y regresiones HTTP reales con clientes loopback127.0.0.2/127.0.0.3 para Firebase e invitaciones; falsificar cabeceras no evita429 en A y B conserva200. Controles de caducidad exacta, capacidad sin expulsión, parámetros inválidos y compatibilidad de fallos de invitación. Archivos locales: `work/login-rate-before.json`, `login-rate-after.json`, `login-rate-final-tests.json`, `login-rate-types-final-fixed.log`, `login-rate-build.log`. La comprobación de tipos intermedia detectó copias de reversión `.ts` dentro de work; se conservaron como `.ts.txt`, sin modificar tsconfig ni ocultar errores del producto. Las factorías de rutas y los limitadores se crean antes del callback de cada servidor, no por petición.

DeepSeek y Kimi K3.1 Pro revisaron independientemente la instantánea de producción y dieronPASS limitado al alcance directo, sin ejecución propia. Codex leyó ambos informes completos, ejecutó los controles y añadió después la regresión HTTP Firebase recomendada (sin cambios posteriores en código de producción). Respaldo OpenRouter autorizado por aislamiento T3 todavía pendiente, sin herramientas ni topes locales. Contexto,hashes,respuestas,contabilidad y comprobación activa: `%LOCALAPPDATA%/LinguistVision/t3-review/login-rate-20261112/`.

Límite explícito antes de publicar: usuarios que comparten NAT/proxy comparten contador; varias instancias no coordinan cuotas y reiniciar borra contadores. El límite de memoria puede rechazar orígenes nuevos mientras esté lleno. Esta entrega no resuelve esos escenarios ni habilita confianza en cabeceras de internet: decidir topología, proxies de confianza y coordinación compartida al preparar producción. No certifica resistencia general a denegación de servicio ni reemplaza controles del proveedor Firebase.

Candidata local3001 reiniciada después de comprobar0 trabajos activos/0 órdenes pendientes; acceso200, cuenta anónima401, origen ajeno403 y noindex correctos. No se publicaron puertos, cambiaron credenciales, compraron servicios ni modificaron reglas de saldo. Reversión de los dos archivos previos disponible en `work/login-rate-rollback/*.ts.txt`; no se tocó el servicio3000.
