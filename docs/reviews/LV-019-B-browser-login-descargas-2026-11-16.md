# LV-019.B · Login local y descargas desde la interfaz · 16 nov 2026

**Alcance: candidata aislada en `http://127.0.0.1:3003/`.** No es Vistavo.app online ni el backend productivo.

## Resultado manual

- Se creó una cuenta sintética y pre-verificada en Firebase Auth Emulator. Sin correo real: Auth Emulator no envía email. Un ID token emitido por el emulador tuvo `email_verified=true`; `/api/account/bootstrap` respondió 201. Rob confirmó que pudo entrar al panel. El password no se guardó en el repositorio.
- Rob cargó el MP4 sintético negro de 1 s (160×90, 1.815 bytes, sin audio) y reportó que se guardó y leyó desde el almacenamiento privado local en memoria. El archivo no contiene datos de clientes y no pasó por GCS ni por proveedores.
- La interfaz mostró el fixture español fijo: “El técnico revisa la bomba de agua y confirma que no hay fugas.” Rob guardó la revisión; la captura de pantalla muestra las acciones para TXT/SRT y crear el ejemplo inglés.
- Rob confirmó desde la interfaz que se descargaron los archivos ES TXT, ES SRT, EN TXT y EN SRT. El texto inglés fue el fixture fijo “The technician checks the water pump and confirms there are no leaks.”; no lo produjo un traductor.

## Límites de la evidencia

- Descargas confirmadas por Rob desde el navegador. No se obtuvo SHA/lectura de los cuatro archivos descargados: los nombres esperados no estaban en la carpeta normal `Downloads` de Windows; el navegador integrado puede guardar en otro lugar.
- No se verificó una descarga manual del MP4 desde el navegador ni reproducción en dispositivo externo.
- Este resultado no demuestra transcripción, traducción o TTS real, proveedores, coste, cargos, pagos, persistencia tras reinicio, GCS/IAM, Cloud Run o producción.
- El video queda en memoria temporal del proceso y se perderá al reiniciar el servicio/emulador. No se limpió todavía para mantener el estado de la candidata mientras continúa la fase.

## Siguiente paso

Preparar y probar una candidata local del gateway para el diseño de [LV-019.B](../specs/LV-019-B-puente-cloud-run-privado.md). Antes de cualquier despliegue hacen falta aprobación explícita y un paquete exacto de costos, IAM, egress VPC y cambios de Hosting/CSP.
