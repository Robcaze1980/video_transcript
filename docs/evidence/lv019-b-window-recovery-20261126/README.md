# LV-019.B · Recibo del prototipo de recuperación por ventana

**26 de noviembre de 2026.** Respaldo WIP `codex/vistavo-long-video-window-recovery-20261126` sobre `97be72f02796a2726a285e5165b05a15ebc14c54`. Incluye el [diseño](../../specs/LV-019-B-video-largo-recuperacion-ventanas-local.md), el [prototipo de prueba](../../../server/commercial/longVideoWindowRecovery.fixture.ts) y sus [pruebas](../../../server/commercial/longVideoWindowRecovery.test.ts). El prototipo se importa solo desde la prueba y queda apagado por defecto.

## Resultado local

Pasaron **63/63 pruebas en cinco suites**, incluidas **17/17 del prototipo**, y `tsc --noEmit` salió con código 0. El primer chequeo de tipos detectó que `Promise.withResolvers` quedaba fuera de la biblioteca configurada. Se sustituyó la barrera por promesas compatibles y se repitieron las pruebas y los tipos sin cambiar la configuración del proyecto.

Se perdió de forma simulada la respuesta posterior a la escritura del segundo recibo. Una **instancia nueva en el mismo proceso** reconstruyó dos resultados confirmados y completó las seis ventanas sin repetir las dos primeras llamadas. Una tercera lectura reprodujo el mismo SRT. Se conservaron los tiempos absolutos hasta `02:30,250`, seis admisiones sintéticas y una sola reserva preexistente de 151 segundos. La prueba niega entrega o reenvío ante cambios de dueño, revisión, generación u orden, reserva ausente o de otros segundos, bytes o recibo alterados, objeto huérfano y dos ejecutores concurrentes dentro del arnés.

## Qué se persistió y qué permanece pendiente

El doble de almacenamiento escribió **archivos locales reales** en un directorio temporal de prueba con creación exclusiva y `fsync`. La reapertura usó nuevos manejadores de archivos y no reutilizó el estado del objeto worker anterior. No se reinició el proceso Node ni se simuló la pérdida del disco. El contenido fue inventado y los archivos se limpiaron al terminar.

Cuenta y Video fueron dobles independientes. El prototipo puede verificar la reserva de prueba y consultar admisión, pero carece de operaciones de reserva, captura o devolución. GCS y Firestore no se ejecutaron. Falta verificar autoridad y concurrencia en las dos bases, vincular los resultados privados a generaciones de objeto y resolver retención, purga, revocación y confirmaciones perdidas entre servicios. Este ensayo no habilita recuperación productiva. El límite de 30 segundos, el runtime y el checkpoint permanecen intactos.

## Evidencia local y hashes

| Evidencia | SHA-256 |
| --- | --- |
| `server/commercial/longVideoWindowRecovery.fixture.ts` | `745b06d3f692711ac7f2205a18671f61e75d850305c60430345caf2e2b8789cc` |
| `server/commercial/longVideoWindowRecovery.test.ts` | `c97a993fb18c499fd36b4e242dcb993b95f851196f0552699f495a63e0b601ea` |
| `docs/specs/LV-019-B-video-largo-recuperacion-ventanas-local.md` | `81f97a05b593968c5678f07202935b4e1c7b663085099d508361f318f9bc4964` |
| `outputs/lv019-b-window-recovery-20261126/verified-unit.log` | `7814d784d587483778baa994310f82c5bb99def64f9bb7eeb162e57105129507` |
| `outputs/lv019-b-window-recovery-20261126/verified-types.log` (vacío) | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

Los hashes corresponden a los bytes de la copia de trabajo verificada. Git ignora las salidas de `outputs/`. El respaldo contiene únicamente documentación y código de prueba. Costo y tokens no medidos.
