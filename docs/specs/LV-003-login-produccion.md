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
