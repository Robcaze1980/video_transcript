# LV-003 · Firebase Dev · 2026-11-10

Repositorio: `Robcaze1980/video_transcript`, base `afe2d4caefd53b8576b066c0f20129095fbcc172`, con los cambios locales preservados. Node 24.13.0. Proyecto aprobado: `linguistvision-dev`; aplicación `1:922534410785:web:42448c25c2a5a335bc4160`.

## Configuración confirmada

Firebase CLI 15.7.0 creó proyecto y aplicación Web. Console inicializó Authentication ordinario en Spark. API administrativa confirmó correo/contraseña y Google habilitados, cliente OAuth propio y dominios localhost, 127.0.0.1 y los dos dominios Firebase del proyecto. Cloud Billing confirmó `billingEnabled: false`. No se activó Analytics, no se desplegó y no se generó una clave privada. El intento inicial de inicializar Identity Platform mediante API exigió facturación y se descartó; se completó desde Firebase Console sin esa actualización.

## Pruebas ejecutadas

- `npm run lint`, `npm test` con PostgreSQL dedicado y `npm run build`: 95 pruebas pasaron en 17 archivos. `npm audit`: cero vulnerabilidades.
- Integración PostgreSQL: correo no confirmado bloqueado, token falso o antiguo rechazado, protección de origen, doble login sin duplicar cuenta, correos iguales con UID distintos sin compartir saldo, archivos ajenos 404, video Range 206 para su dueño y 401 tras revocación.
- Firebase Auth Emulator, proyecto `demo-linguistvision`, puerto 19099: alta, enlace de verificación aplicado, inicio verificado, sesión, recuperación aplicada, contraseña nueva y rechazo de la sesión anterior. No demuestra recepción de correo ni OAuth real.
- Firebase alojado, `linguistvision-dev`: usuario temporal con contraseña, token con correo no confirmado, enlace de verificación generado, confirmación administrativa de la cuenta temporal, token confirmado, cookie de sesión creada y validada, enlace de recuperación generado. El usuario temporal se eliminó al terminar. No se enviaron correos a terceros. ADC funcionó sin archivo de cuenta de servicio.

## Pendientes para aceptar el flujo externo

Completar personalmente Google en el navegador; registrar una cuenta de prueba propia, recibir y abrir el correo de verificación; recibir y aplicar recuperación; volver a entrar y cotejar la sesión. Repetir Google en el Pixel y comprobar comportamiento de redirección. La cuenta debe conservar saldo y archivos únicamente bajo su UID. Verificar en el dominio final antes de publicar. LV-003 sigue en curso.

Configuración externa: `%LOCALAPPDATA%\LinguistVision\.firebase.env`. Candidata aislada: `%LOCALAPPDATA%\LinguistVision\releases\commercial-firebase-20261110`. La copia anterior se conserva para revertir. Las credenciales de ROBATO y Techos.app no se utilizaron.

## Candidata en 3001

La carpeta aislada superó `npm ci --include=dev`, tipos, 95 pruebas y compilación. Tras corregir la carga del cliente Firebase sin la vista experimental de idiomas, volvieron a pasar los tipos y la prueba de integración afectada. Acceso, configuración y paquete cliente respondieron HTTP 200, con `linguistvision-dev` y sin emulador. El proceso 54016 escucha exclusivamente en `127.0.0.1:3001`. Chrome mostró la pantalla localizada en español. Las cuentas del piloto previo conservan su esquema; el acceso Firebase empieza con cuentas propias nuevas.

Abrir: [Iniciar sesión](http://127.0.0.1:3001/pilot/sign-in/?lang=es) · [Crear cuenta](http://127.0.0.1:3001/pilot/register/?lang=es).

## Pixel: preparación privada sin activar

El 10 de noviembre se confirmó que el usuario prueba desde el Pixel. Tailscale está conectado, pero 443 y 8443 sirven las candidatas anteriores (3003 y 3006). Se autorizó `linguistvision-pilot.tail03825d.ts.net` en Firebase y se preparó el soporte exclusivo de Firebase alojado para un origen privado HTTPS *.ts.net. Tipos, 95 pruebas y build pasaron. El comando combinado para cambiar la candidata y añadir Serve 8444 fue rechazado por política de ejecución: no se aplicó ni se verificó esa ruta. El acceso activo continúa siendo loopback. No dar por probado el acceso remoto o Google móvil hasta verificarlo.

## Regresión del botón Google corregida

Chrome aislado reprodujo el error genérico del usuario. Antes de la corrección: `script-src-elem` bloqueó `https://apis.google.com`, requerido por el SDK de Firebase. Después: cero infracciones CSP y una ventana en `https://accounts.google.com`. Se autorizó ese origen únicamente con Firebase configurado y la integración comprueba la cabecera. Pasaron tipos, 95 pruebas y build. Candidata local reiniciada (proceso 60272, loopback 3001); no se completó el login de la persona ni se verificó el retorno autenticado. El bloqueo de la activación privada para Pixel sigue pendiente.

## 2026-11-10 · LV-003 y LV-007 · Google y compra Sandbox de US$5

El propietario confirmó que entró con Google y aprobó la compra Sandbox de US$5; la interfaz mostró 50:00 disponibles y 0:00 reservados. Codex corroboró por lectura de PostgreSQL y consulta GET a PayPal Sandbox: orden COMPLETED, una captura COMPLETED por USD 5.00, una fila de compra, un movimiento de acreditación y una identidad Firebase asociada a la cuenta. La base registra 3000 segundos acreditados, 3000 disponibles, cero reservados y cero consumidos. No se solicitó otra captura ni se alteró el saldo. Es un pago de prueba, no ingreso comercial. Quedan recarga, salida y reentrada con la misma cuenta, recorrido con archivos y prueba en el Pixel. Sin nuevas consultas a revisores ni cargos de LLM.
