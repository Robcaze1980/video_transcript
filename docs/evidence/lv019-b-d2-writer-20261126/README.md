# LV-019.B · D2: escritor de evidencia A-3

Candidata local aislada del 26 nov 2026, basada en `1b122ceb92e7a409dd0fd50ea21a5dd5a076b8b5`. **Es solo la fase escritora.** Los dos casos de reconocimiento D2 previamente fallidos siguen abiertos. No se integró a la candidata principal ni se publicaron cambios.

La coordinación ejecutó **4/4** casos en Firestore Emulator con AccountStore y raíces sintéticas separadas, sin fallos ni omisiones. La copia diagnóstica adaptó exclusivamente la puerta local al puerto 8187 y congeló 427 huellas. El guard de red pasó y las cuatro limpiezas se verificaron. La implementación informó **98/98** unitarias, tipos y sintaxis correctos.

El TAP local ignorado por Git está en `vistavo-d2-8187-65580632/outputs/lv019-b-financial-runs/run-20642a06-1c3e-4a8e-a3e1-b95833e424ab/fixture.stdout.tap`, SHA-256 `59305ca73aeedc3cd80e30b9ccc924888f85693d9a1c1156eacbbc04c51df4ce`. El `result.json` tiene SHA-256 `67cfc85aeb147b2ea55eacbfd2c75d269d5990efe18f75fc65a19c069f0e069a`. Ninguna salida de `outputs` viaja en Git.

Faltan el lector que reconozca el avance, el comprobante de posimagen resistente a cambios, la continuidad entre Cuenta y Video, las carreras y negativos completos, la regresión financiera y la revisión de GLM y DeepSeek. No se llamó a proveedores ni se modificó saldo real. [Contrato de este corte](../../specs/LV-019-B-cerca-A3-evidencia-local.md) · [Contrato D2](../../specs/LV-019-B-progreso-concurrente-saldo.md).
