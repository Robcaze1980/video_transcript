# LV-019.B · Fallo incierto de Cuenta

El 27 nov 2026 se adaptó el caso histórico 77 a la regla vigente: si la respuesta a una orden de desbloqueo es incierta y el recibo sigue pendiente, Video mantiene el bloqueo y no vuelve a enviar esa orden. El doble sintético lanzó antes de modificar Cuenta; desde Video el resultado se trata como incierto. La prueba contó una sola llamada de desbloqueo y dos consultas del recibo, conservó la solicitud auditada, la guarda, la fila en revisión y el saldo comprobado.

Pasaron **11/11** controles en Firestore Emulator, cero omitidos y limpieza **11/11**. El caso nuevo es el número 5 del TAP; los otros diez ya estaban en el foco anterior. Las 22 colecciones inventariadas estaban vacías antes y después. Las firmas comparadas cubren documentos inmediatos de las colecciones observadas bajo las raíces sintéticas, no el documento raíz ni subcolecciones anidadas. No es una prueba HTTP real ni la regresión financiera completa.

- fixture.stdout.tap: SHA-256 14636d10ff7120bf783cf776835d5c270d6c858284850d3aa02925416a8f7ae9.
- result.json: SHA-256 6f88de906753d069f1fed97675af824be4eee3d14acea037b84f80d75fdd0594; confirma selección, conteo, limpieza y huellas sin cambios durante la ejecución.
- roots-before.json y roots-after.json: SHA-256 5203bfba25237cfe76b139103b63c6975c9786d35b1a368b6354d4d0719f8864.
- Manifiesto de candidata 0e3bbf355335590646eb1d28fafb5f194410be873965c5baf48c93fbcb0281db y del sistema 1639cb1165beb762c05d72c2e73a40ea7c731e128ec8cd4b15adb767db7f1845. Los ejecutables se verificaron antes de arrancar.
- run.json: SHA-256 80459043437999e2ddd7bfffd5cb2dcfce5225da9d7be8031cf2bd2d47c48737. Node salió con código 0; la JVM propia se terminó por su handle después de agotar el plazo de cierre. Los listeners compartidos conservaron su estado y los propios quedaron libres.

El primer autocontrol del arnés falló al ampliar la selección porque el positivo seguía fijado en diez casos; no se había iniciado ningún emulador. Una corrección propuesta por T3 parametrizó el recuento y conservó doce contrapruebas; el autocontrol pasó después.

DeepSeek propuso el caso y el ajuste del arnés mediante T3; Codex los integró y ejecutó. GLM dio PASS inicial condicionado a precisar el texto del contrato. DeepSeek dio INCONCLUYENTE inicial por información omitida y la misma precisión. Se aportaron el alcance de las firmas, la función de error, los controles completos y el resultado ejecutado; ambos dieron PASS acotado tras corregir la especificación. Sus informes completos permanecen en docs/reviews. No ejecutaron los ensayos. El alias GLM no mostró modelo servido; tokens y costo por hilo no medidos.

Esta prueba no resuelve automáticamente el estado incierto sin recibo: sigue pendiente la conciliación y la exclusión demostrada de escritores. También faltan los demás casos históricos, D2, la admisión por cuenta y la regresión integrada. La guarda Node no es un firewall del sistema ni las huellas congelan todas las dependencias.

El primer escaneo marcó tres coincidencias del SHA-256 de firebaseAccess.ts en los manifiestos de entrada y salida. Se conserva el reporte redactado y una excepción limitada a esas tres líneas y esa regla.
