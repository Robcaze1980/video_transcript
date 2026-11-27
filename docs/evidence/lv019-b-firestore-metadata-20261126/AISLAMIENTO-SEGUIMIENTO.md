# LV-019.B · Metadatos Firestore · seguimiento de aislamiento

**PASS acotado al paso 1.** Los cuatro casos del [ensayo original](metadata.emulator.mjs) pasaron en Firestore Emulator 1.21.0, JDK 24, Node 24.22.3, Firebase Admin 14.5.0 y cliente Firestore 9.4.1. Se conservan los [dos intentos INCONCLUYENTES](README.md) del commit `c8229d6`. Ninguno de esos dos había iniciado Node. El resultado nuevo se refiere solo a los metadatos observados en esta ejecución del emulador.

## Origen de las escuchas

El JAR local tiene SHA-256 `c3d3680a89d946a90a027365ea14c26c6472a162bcf37f099bbb1ebd66d25e8e`. Se examinó con `javap -c -p -classpath <jar>`, sin invocar la aplicación ni consultar servicios durante el análisis.

- `CloudFirestore.init` consulta `websocketPort` (offset 167) y `webchannelPort` (offset 426) por separado. Si falta cada opción, llama a `findOpenPort` (offsets 186 y 446). Construye ambos adaptadores con el host configurado. Esto explica el WebSocket efímero que el primer log nombró y la presencia del WebChannel cuando quedó sin fijar.
- `CloudFirestore` pasa host y puerto de la API a `buildGrpcServer` (offsets 389–416). `GrpcServer.start` resuelve el host configurado mediante `InetAddress.getByName` (offset 24). Usa esa misma dirección para el proxy en el puerto configurado (offsets 113–122) y para el servidor gRPC interno mediante `InetSocketAddress(dirección, 0)` (offsets 126–135). Después de iniciarlo consulta `Server.getPort` (offset 305) para construir el destino interno del proxy. El puerto privado se asigna al arrancar y no es otro endpoint de cliente.
- El inventario del segundo intento es compatible con WebChannel y backend gRPC adicionales. Los logs de ese intento no permiten adjudicar cuál de los puertos 57785/57998 fue cada rol. En esta ejecución sí quedó atribuido el puerto interno mediante su objeto `Server`.

## Arranque, prueba y limpieza

El [lanzador](run-inspected.ps1) exigió el hash del JAR, un JDK directo, tres puertos fijos libres y un ambiente nuevo sin credenciales. El [inspector Java](InspectOwnedFirestore.java) abrió la instancia demo en IPv4 loopback, fijó API 8194, WebSocket 9194 y WebChannel 9294 y leyó el cuarto socket desde `Server.getListenSockets()`. Rechaza otro resultado, incluso wildcard, IPv6 o más de un backend, antes de escribir la constancia vinculada por nonce y PID. El lanzador comparó los cuatro endpoints exactos con el inventario de Windows antes de iniciar Node. El mismo inventario se verificó al terminar la fixture. El guard del cliente conservó un único destino permitido, `127.0.0.1:8194`, y su control de bloqueo pasó.

En la corrida `run-71da34d2-be9e-41ab-96ed-c726648fb28e`, el backend gRPC fue 56444. Todos los listeners estaban en `127.0.0.1` y pertenecían al PID 9376. Los emuladores compartidos de 8185–8187 conservaron PIDs y direcciones. El cliente Node (14056) salió con 0, con inventario **0→0** y **4/4 raíces limpiadas y releídas**. Después, la JVM empezó a cerrar al recibir el nonce. El proceso aún vivía tras 6,5 segundos y fue terminado mediante el handle propio; el recibo registra salida `-1`. Windows confirmó ambos procesos ausentes y los cuatro puertos libres. Esta limpieza no depende de un cierre elegante de JVM.

| Comparación | Resultado observado |
| --- | --- |
| Tres `create` en una transacción | Guardia, testigo y ancla compartieron `createTime`. Cada `updateTime` inicial coincidió con esa marca. |
| Cambiar la guardia y restaurar exactamente su contenido | `createTime` quedó fijo. `updateTime` avanzó en las dos escrituras y las constancias restantes quedaron intactas. |
| Borrar y recrear solo la guardia con la misma carga | El documento ausente no expuso tiempos. La guardia recreada tuvo una marca nueva que divergió del testigo y del ancla. |
| Borrar y recrear los tres juntos con la misma carga | Recuperaron la igualdad entre sí, con una marca común distinta de la original. La igualdad actual entre tres documentos no prueba su continuidad histórica. |

Los casos cotejan segundos y nanosegundos. Son evidencia sobre esta versión del emulador y su SDK. La lectura privada del JAR depende de esa versión. Los inventarios y el guard Node no equivalen a un cortafuegos del sistema. No se comprobaron producción, IAM, interrupción de red entre bases, retención ni una defensa contra pérdida coordinada de todos los testigos. El corte y el protocolo financiero siguen pendientes.

## Reproducción y evidencias

En PowerShell, desde esta raíz. Sustituir `$node24`, `$jdk24` y `$dependenciesRoot` por el ejecutable Node 24, la raíz del JDK y un árbol local con las versiones indicadas de las dependencias ya instaladas.

```powershell
$jar = Join-Path $env:USERPROFILE '.cache/firebase/emulators/cloud-firestore-emulator-v1.21.0.jar'
& "$jdk24/bin/javap.exe" -c -p -classpath $jar com.google.cloud.datastore.emulator.firestore.CloudFirestore
& "$jdk24/bin/javap.exe" -c -p -classpath $jar io.gapi.emulators.grpc.GrpcServer
& ./docs/evidence/lv019-b-firestore-metadata-20261126/run-inspected.ps1 -Node $node24 -Jdk $jdk24 -Jar $jar -Dependencies $dependenciesRoot
```

Evidencias locales ignoradas por Git bajo `outputs/lv019-b-firestore-metadata-isolation-20261126/`. La corrida comenzó a las 17:20:20 PST del 26 de noviembre y cerró a las 17:20:40 PST.

| Archivo local | SHA-256 |
| --- | --- |
| `CloudFirestore.javap.txt` | `f3560d86490324e682b8d4f53651802394d44809602e16a968595b704877f4ea` |
| `GrpcServer.javap.txt` | `144dece27af311e0113e4a79fcf50ce2524e138da153182f5f438a16707f8c45` |
| `run-71da34d2-be9e-41ab-96ed-c726648fb28e/run.json` | `68b1ee57d5edb5cab8e19edfe0c4b10e94e10070d102f13819c3e396b195ae58` |
| `ready.txt` de esa corrida | `f5abf1e7fcc9c5f0f460166cedca3079657d076876851ccca360518c6966a2ed` |
| TAP `fixture.stdout.log` de esa corrida | `c932b05a0688c0e396891dc925e7b44d553c030eb33f0d57522e287bd6f50992` |
| `fixture.stderr.log` de esa corrida | `6c346041a29196f8d99cc8ef981dacf1afb82e063934081f8fa581c35e9017fb` |
| `emulator.stderr.log` de esa corrida | `d34a285cc0c05bf4faa63fa337958780f7c13bbdd8b43ae039079c3bd6fea36e` |

=== RESUMEN FINAL ===
RESULTADO: PASS
EVIDENCIA: 4/4 casos de metadatos en emulador y limpieza 4/4. El bytecode y el socket real explican y acotan las escuchas. Inventarios del cliente y del sistema controlados antes y después.
NEGATIVOS: Edición restaurada, recreación individual con bytes idénticos y recreación coordinada con igualdad nueva. La JVM requirió terminación propia tras esperar el cierre por nonce. Puertos propios libres y compartidos intactos.
BLOQUEOS: La evidencia solo cubre esta versión del emulador. Permanecen pendientes retención, validación del protocolo, integración y sus puertas. Costos y tokens no medidos.
=== FIN RESUMEN ===
