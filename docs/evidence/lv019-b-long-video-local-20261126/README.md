# LV-019.B · Recibo del ensayo local de video largo

**26 de noviembre de 2026.** Rama WIP `codex/vistavo-long-video-local-20261126`, base `1b122ceb92e7a409dd0fd50ea21a5dd5a076b8b5`. Este corte conserva el [diseño y sus dependencias](../../specs/LV-019-B-video-largo-corte-local.md) y las [pruebas sintéticas](../../../server/commercial/longVideoLocal.test.ts). La interfaz y el servidor de la candidata siguen limitados a 30 segundos.

Pasaron **46/46 pruebas en cuatro suites**, incluidas **5/5 del ensayo nuevo**, y TypeScript `--noEmit` salió con código 0. FFmpeg generó un MP4 vertical temporal de 150,25 s y extrajo seis ventanas. El muestreo de sus tonos comprobó el orden. Las respuestas inventadas comprobaron los seis cues, los tiempos absolutos del SRT y la última ventana de 250 ms. También se rechazaron huecos, solapamientos e índices duplicados antes del transporte simulado.

`AccountStore` con Firestore simulado mantuvo una sola reserva fuente de 151 segundos, seis admisiones y cero movimientos por ventana. Después del ensamblado completo, el arnés pidió una captura de 151 segundos y el replay no la duplicó. Tras perder una respuesta en la segunda ventana, no se produjo un bundle parcial ni se liquidó la reserva. Los replays de admisión devolvieron recibos, y se rechazó el uso de segundos de un segmento o de una huella diferente.

La prueba no acredita transacciones concurrentes de Firestore, la ruta de captura completa Video→Cuenta, continuidad acústica a nivel de muestra, recuperación tras reinicio, clips de cámara ni teléfonos físicos. Para recuperar una ventana después de reiniciar queda pendiente un contrato privado de persistencia y recuperación de su respuesta validada. No hubo emulador, proveedor, datos reales ni despliegue. El video y sus extracciones se generaron y eliminaron durante el ensayo.

| Evidencia | SHA-256 |
| --- | --- |
| `server/commercial/longVideoLocal.test.ts` | `30c08abdc47fc89eb7f918acc859b68d8b8b41052bec43f7dd214056e0ba8632` |
| `docs/specs/LV-019-B-video-largo-corte-local.md` | `e18f951837b3911f4352b5271483cb60b2ccc6e63871a460fe0d42f0019a4ae8` |
| `outputs/lv019-b-long-video-local-20261126/final-unit.log` | `3cf27e3d6876e10a34e000fa93a404ee2da6b12559074ffb40e0279a5e78d98e` |
| `outputs/lv019-b-long-video-local-20261126/final-types.log` (vacío) | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

Git ignora `outputs/`. Los hashes de los archivos de código y especificación corresponden a la copia de trabajo verificada. El respaldo contiene este recibo, la especificación y código de prueba. Costo y tokens no medidos.
