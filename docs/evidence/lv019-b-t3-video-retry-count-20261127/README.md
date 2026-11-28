# LV-019.B · Contar el reenvío tras fallo de Video

El 27 nov 2026 se reforzó el caso local en el que Cuenta confirma el desbloqueo y Video falla antes de terminar. El transporte sintético registró **cero** órdenes /api/internal/video/billing-holds/unblock antes del intento, **una** tras el fallo y **una** después de reanudar; además la recuperación consultó el recibo mediante la ruta distinta /unblock-receipt. El caso conservó las comprobaciones de estado de Cuenta, Video, auditoría y trabajo pendiente.

La batería aislada seleccionada pasó **10/10**, sin omisiones, con limpieza de **10/10**. El caso reforzado es el número 5 del TAP. El autocontrol del arnés pasó su positivo y doce negativos; los análisis sintácticos de los tres archivos JavaScript y del lanzador PowerShell también pasaron. Son pruebas con cuentas ficticias y Firestore Emulator; el contador observa el transporte sintético, no demuestra una conexión HTTP real ni cubre IAM, producción o la batería financiera completa.

- fixture.stdout.tap: SHA-256 74573b7c2a0576e91e7a6935a12a7a3de0afa5d8c3b670c425ac54203c9f7aa2.
- result.json: SHA-256 bef73d76260b317ace3eaecc87093ef83769a4f46d025c93bd86d741378e9c91. Confirma selección exacta de diez pruebas, cero fallos, cero omitidas y bytes controlados sin cambios entre las lecturas.
- roots-before.json y roots-after.json: mismo SHA-256 5203bfba25237cfe76b139103b63c6975c9786d35b1a368b6354d4d0719f8864; 22 colecciones sintéticas estaban vacías antes y después.
- Manifiesto de la candidata 7c6628f5f1b7208dad26afdab775a56d87c6897362c5c5659c11fa0bd5207865; manifiesto del sistema fed3258dfa6ff8c1c52909bfb7da3efa58e7987917fa6084f8dc73efd1d2c7d0. Identidades verificadas antes de arrancar.
- run.json: SHA-256 50886e3d1b9736f358e600e5064ff1be9b28fe4a6212dc24f07e28203b374c30. El Node propio salió con código 0. La JVM propia no se detuvo a tiempo y se terminó por su handle; el listener compartido 8185 conservó su PID y los puertos propios quedaron libres.

[DeepSeek implementó la ampliación en T3](../../reviews/LV-019-B-t3-contador-implementacion-20261127.txt) sin herramientas; Codex integró y ejecutó. [GLM](../../reviews/LV-019-B-t3-contador-GLM-20261127.txt) y [DeepSeek en un hilo independiente](../../reviews/LV-019-B-t3-contador-DeepSeek-20261127.txt) dieron **PASS acotado** al paquete estático; no ejecutaron las pruebas. El [paquete](review-packet.txt) se envió antes de terminar la ejecución y dice que estaba en curso. Codex confirmó después el resultado y el enlace entre deps(c), accountBilling y c.transport, así como la coincidencia de los manifiestos. El conteo del recibo demuestra al menos una lectura adicional, no un número exacto.

Los hilos informaron los modelos solicitados; el alias GLM no mostró el modelo servido. Tokens y costo por tarea: **no medidos**. La guarda Node no es un firewall de sistema y los hashes no hacen inmutables todas las dependencias.

Faltan la regresión financiera integrada y las demás condiciones del plan, incluidos casos de incertidumbre, admisión por cuenta y las comprobaciones de la conexión real. Esta prueba no habilita el procesamiento.

El primer escaneo de evidencia marcó tres coincidencias correspondientes al SHA-256 del archivo firebaseAccess.ts en el manifiesto y las dos lecturas de result.json. Se conserva el informe redactado y una excepción limitada a esas tres líneas y a esa regla.
