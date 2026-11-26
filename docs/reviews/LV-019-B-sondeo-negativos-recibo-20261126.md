# LV-019.B · Recibo de diagnóstico de la alerta de sondeo

Respaldo WIP del 26 de noviembre de 2026, rama `codex/vistavo-poll-neutral-negatives-20261126`, base `1b122ceb92e7a409dd0fd50ea21a5dd5a076b8b5`. Conserva el [parche candidato](../specs/LV-019-B-alerta-sondeo-corrupto.md) y añade dos pruebas diagnósticas sin corregir la implementación. El respaldo no certifica el corte ni autoriza publicación o despliegue.

## Resultado de la única corrida

El emulador sintético `demo-vistavo-ledger` en `127.0.0.1:8187` ejecutó los dos casos seleccionados entre las 19:04:02 y las 19:04:10 UTC. Hubo **0 aprobadas, 2 fallos, 0 omisiones, 0 cancelaciones**. Se conservó el primer resultado sin reintento.

1. Un turno ligado a evidencia genuina, con la espera aritméticamente coherente y una fecha cinco años posterior al commit, omitió la alerta neutral bajo un guard vigente. Al comprobar una alerta abierta por separado con el mismo turno, el barrido la marcó `cleared`. El control de un segundo de desfase pasó. Las comprobaciones de integridad del turno, reclamo, guard, intención, reserva y saldo pasaron antes del fallo esperado. [Caso de fecha futura](../../server/commercial/firestoreAi.emulator.mjs#L1030)
2. Un fallo de lectura de evidencia durante la limpieza dejó abierta la primera alerta y registró `sweep_failed`. Se conservó la evidencia de ambas filas. El barrido no leyó la segunda alerta, que seguía abierta, y declaró cero cierres. El caso mide la disponibilidad de la limpieza. El aborto temprano era preexistente y el candidato añade una nueva lectura que puede provocarlo. El requisito de continuar tras un fallo del [diseño candidato](../specs/LV-019-B-alerta-sondeo-corrupto.md#descubrimiento-y-señal) cubre el descubrimiento. [Caso de limpieza](../../server/commercial/firestoreAi.emulator.mjs#L1085)

## Entorno y límites

Se usó Node v24.22.3, perfil temporal inicialmente vacío y protección de las API de red de Node limitada a `127.0.0.1:8187`. La autocomprobación pasó y la corrida no registró denegaciones. El guard de Node no es un cortafuegos del sistema para procesos nativos. Las adaptaciones de puerto y el guard estricto quedaron en una copia local bajo `outputs/`. El código financiero y los verificadores conservaron sus hashes. Los inventarios de raíces sintéticas coincidieron byte a byte antes y después. Se eliminaron las raíces creadas por las pruebas y se preservaron las dos preexistentes.

Pasaron la comprobación de sintaxis y `git diff --check`. La corrida no abarcó la regresión financiera, las otras pruebas del parche, IAM, volúmenes reales ni costos. No se consultaron servicios reales y no se desplegó nada.

## Evidencia local

Ruta relativa `outputs/lv019-b-financial-runs/run-134b2cbe-896c-4f27-b673-67206d0ae32b/`. Git ignora ese directorio. Este recibo contiene los resultados y hashes necesarios para identificar los originales cuando estén disponibles.

| Archivo | SHA-256 |
| --- | --- |
| `fixture.stdout.tap` | `787567879de98c04c2bef0e4299281567691a04affe1e122169fbbf2963e0ad3` |
| `fixture.stderr.log` | `cee9b83c4d8e30e3f71ee921f337a604341a8663cb7049c8b1aaf90dc0ff56a2` |
| `results.json` | `4793b202e208d0e1038ba0f9059c9c4396e1c760168ed3e3fc000e94d4a2f2c5` |
| `run-inputs.json` | `6dc326b4be988afceebb864ca375a5d2e4a4b07b23c3b6e368ed4a4d54d49046` |
| `roots-before.stdout.json` | `74a6ec28edbf823a47a7ae29e0f143d09103f8b6a4beb14a97d60c9602ec728e` |
| `roots-after.stdout.json` | `74a6ec28edbf823a47a7ae29e0f143d09103f8b6a4beb14a97d60c9602ec728e` |

La fixture congelada en el worktree tiene SHA-256 `5cd9c590c9eaee5abb47fccbd6778b032a87cf438299a8b5c44036945adb4219`. El bloque de los dos casos con finales LF tiene `fd386428de328974848477973cc4015580232d5a9f51f5faf8afe70214e8d3f0`. La copia de la fixture ejecutada, adaptada solo al puerto 8187, tiene `5bb3de0b36c3265bd78981583846e0402f75044ab807e22754b7bbbe342744ad`.
