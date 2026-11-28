# LV-019.B · Solicitud pendiente y guarda ausente

Se adaptó el caso histórico de solicitud auditada al contrato actual: una respuesta incierta deja el reclamo pendiente, las modificaciones de operador, carga o guarda se rechazan y la repetición no vuelve a enviar la orden. Un segundo caso, con otra fixture sintética, comprueba que una guarda eliminada no se recrea ni permite un segundo envío. Ambos comparan el saldo antes y después.

Pasaron **17/17** controles en Firestore Emulator, cero omisiones y limpieza **17/17**. Los dos casos nuevos son los números 5 y 6 del TAP. El caso de guarda ausente no demuestra continuidad de una guarda recreada. Las firmas comparadas abarcan documentos inmediatos de las colecciones observadas, no el documento raíz ni subcolecciones anidadas. El contador de lecturas verifica al menos una y un aumento en la repetición; el orden de la lectura previa se infiere del código.

- fixture.stdout.tap: SHA-256 c92bccde78f6478ef0490ffa262d7af194b9a47f6dca6bdfe6c22ccfaf112dee.
- result.json: SHA-256 6fe41b3db09f031e4a21331b1a543e52fb67337ab4032037fb82351ea2a50b9d.
- Inventarios antes/después idénticos, 22 colecciones sintéticas vacías, SHA-256 5203bfba25237cfe76b139103b63c6975c9786d35b1a368b6354d4d0719f8864.
- Manifiesto de candidata 33390b4a6dcfddc6a97639e23189c022b0dc1acbdb0f05387285be3121de5ac7; sistema a172f0897943454f80ab01dedbb28252565d1fbbd3d9290974ecf7d78beb9918. Las huellas no cambiaron durante la ejecución.
- run.json: SHA-256 1ada062d13d48044d0e09dcf731795354e7a5569511dcc1a42d88655921050a9. Node salió 0; la JVM propia se terminó por su handle tras el plazo y los listeners compartidos no cambiaron. Autocontrol TAP y sintaxis pasaron.

DeepSeek propuso los casos mediante T3. Codex rechazó las primeras propuestas por errores de sintaxis, un método no incluido en el doble y una recreación de guarda que habría supuesto continuidad; se conservan las respuestas. La última usó un marcador de lectura de saldo que Codex sustituyó por el lector sintético existente. GLM y DeepSeek dieron PASS estáticos acotados antes de terminar la ejecución; no corrieron las pruebas. Sus observaciones sobre firmas, orden y cobertura se conservan en docs/reviews. Tokens, costo por hilo y modelo servido del alias GLM no medidos.

La recuperación automática de un 409 o de un reclamo pendiente sigue sin implementar. Los casos históricos 64 y retry-generation A permanecen abiertos. La lectura fallida del recibo existe en otro caso histórico, pero no forma parte de este foco de 17. Esto no es la batería financiera completa ni acredita red real, IAM o producción. La guarda Node no es un firewall del sistema y las huellas no congelan todas las dependencias.

El primer escaneo marcó tres coincidencias del SHA-256 de firebaseAccess.ts en manifiesto y resultado. Se conserva el reporte redactado y una excepción limitada a esas tres líneas y esa regla.
