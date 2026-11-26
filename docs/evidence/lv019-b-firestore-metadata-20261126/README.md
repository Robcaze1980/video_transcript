# LV-019.B · Prueba local de metadatos Firestore

**INCONCLUYENTE.** Contraste limitado a la dependencia de versiones documentales del diseño `aa1d16b961c0635aa81b9700f1b6bc5fe9608d2d`. Se prepararon el [ensayo](metadata.emulator.mjs) y su [lanzador Windows](run-local.ps1). Pasaron la comprobación de sintaxis de Node 24 y el análisis de PowerShell. Los dos intentos se detuvieron en el control de arranque, antes de iniciar Node. No hubo TAP, lecturas de metadatos ni escrituras de la fixture.

## Intentos y limpieza

Los dos arranques usan el JAR local Firestore Emulator 1.21.0, proyecto `demo-vistavo-metadata`, loopback y perfil separado. El lanzador construye el ambiente de los procesos desde una lista explícita. El guard copiado del repositorio limita el cliente de prueba a `127.0.0.1:8194`. La fixture no llegó a ejecutarlo. No se importaron datos ni se usaron servicios remotos.

| Intento y hora UTC | Control que se activó | Limpieza comprobada |
| --- | --- | --- |
| `run-ba19960f-116f-4b8c-8839-1fe234ff9f81`, 23:11:25–23:13:30 | El proceso que el lanzador siguió (10460) era el envoltorio Java. La JVM hija (5716) escuchó en 8194. El JAR abrió un WebSocket efímero 52554 al omitir su puerto. El lanzador abortó antes de Node. | Se cotejaron el PID 5716, su padre, el ID exclusivo de corrida, el proyecto y el listener antes de detener ese único PID. No quedaron procesos de esa corrida ni listeners 8194/52554. |
| `run-d585a547-5dcf-4faa-b0d6-42aa21d04f85`, 23:15:30–23:15:36 | El binario directo del JDK (9992) abrió 8194/9194 explícitos y además los listeners loopback 57785/57998. El lanzador detectó cuatro sockets en vez de los dos autorizados y abortó antes de Node. El origen de los dos sockets auxiliares queda sin caracterizar. | El lanzador cerró su propio proceso 9992. Se verificó que 8194, 9194, 57785 y 57998 quedaron libres. |

En ambos recibos, `ownedNodePid` y `nodeExit` son nulos. Se confirmó la ausencia final de los procesos del ensayo y de sus cinco puertos observados. Los listeners compartidos de 8185–8187 conservaron sus direcciones y PIDs entre los inventarios. No se les hizo ninguna consulta de aplicación. El resultado de limpieza se refiere a los procesos y puertos. El inventario documental interno estaba a cargo del cliente que no se inició.

## Qué falta observar

La fixture incluye cuatro casos para observar con el SDK: igualdad de `createTime` al crear guardia, testigo y ancla en una transacción, cambio de `updateTime` al editar y restaurar campos, recreación individual con el mismo contenido y recreación coordinada con nuevas versiones iguales entre sí. Estas son expectativas preparadas, no resultados. La versión del JAR probada necesita un arranque cuyas escuchas puedan acotarse y comprobarse antes de iniciar el cliente. Este corte no aporta evidencia de producción, serialización del protocolo ni autoridad entre bases.

Evidencia local bajo `outputs/lv019-b-firestore-metadata-20261126/`; queda fuera de Git. Se conserva una copia del primer lanzador en su corrida. No se repitió la operación tras el único reintento autorizado.

| Archivo local | SHA-256 |
| --- | --- |
| Primer `run.json` | `f4f5275a236077aa82cf17715769d11d12da12c616d174633ace1d11424281e3` |
| Primer `manual-stop.json` | `cbcf6a8855ebde9b6dace21a020f2f1936333bb49f5b54034b2a5f5bdb41a478` |
| Primer `emulator.stderr.log` | `894125e878fb66a7762d9b98fa2571db7cfefc81a81ddc2fb5747bb46436247b` |
| Segundo `run.json` | `189f6a270bde63282b318df6896e0d5c13389994108025b9c426f6693c1c11ba` |
| Segundo `emulator.stderr.log` | `e1769fad2aa34c953670d63d68182ebf80ca2aabb83d764a1e39f1d2c402bc82` |
| `emulator.stdout.log` de ambos | `c653ae1c1e09644d8eaa94f1230b5b1136fa3a9a72a006f764bc7b0776226d66` |

=== RESUMEN FINAL ===
RESULTADO: INCONCLUYENTE
EVIDENCIA: Dos arranques propios con perfil separado, detenidos antes de Node. Registros de PID, listeners, ambiente e inventarios antes y después. Todos los listeners propios desaparecieron.
NEGATIVOS: El primer arranque no pudo atribuir la escucha al PID directo. El segundo detectó escuchas adicionales aun fijando 8194/9194. En ambos casos el control impidió ejecutar la fixture. Los emuladores compartidos conservaron sus procesos.
BLOQUEOS: Hace falta una configuración local que acote y compruebe las escuchas. Los cuatro casos de metadatos siguen sin evidencia de ejecución. Costos y tokens no medidos.
=== FIN RESUMEN ===
