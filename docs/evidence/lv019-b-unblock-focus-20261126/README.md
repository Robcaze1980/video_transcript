# Foco aislado: desbloqueo y reservas tras respuesta incierta

**Resultado local del foco: 5/5, sin fallos ni omisiones.** No equivale a la batería financiera completa, que quedó interrumpida con fallos y se conserva en `../lv019-b-financial-regression-red-20261126/`. No se ha probado el flujo online, voz ni el teléfono.

La candidata probada parte de `37c9b939fd81eddd3aceb7e71852d04af7a63d90`, con cambios de fixture y arnés identificados por el manifiesto adjunto. En la raíz sintética recién creada, el test instala un corte inmutable antes de crear guardas y comprueba el orden de sus timestamps. Ese documento es una preparación exclusiva de prueba: su creación no certifica un corte de escritores en producción. Los 46 llamados de test previos se conservaron estáticamente sin alterar; se añadieron dos casos directos y un bucle que genera tres negativos. Las expectativas históricas que eran incompatibles con el contrato nuevo no se han adaptado todavía.

- Sin recibo, se simula una respuesta incierta antes de mutar Cuenta; el segundo intento consulta el estado, no hace otro POST, mantiene las dos devoluciones reservadas y conserva la otra cuenta. Esa otra cuenta puede hacer una reserva en Account: esta prueba no demuestra el recorrido completo de video para ella.
- Con recibo, Account confirma el desbloqueo y se simula pérdida de respuesta. El segundo intento recupera el recibo sin otro POST; se devuelven dos reservas una vez cada una, se captura solo el trabajo completado y la otra cuenta conserva su saldo.
- Ausencia, modificación y recreación tardía del corte rechazan el desbloqueo sin POST y sin cambiar saldos.

## Evidencia y aislamiento

- `fixture.stdout.tap`: SHA-256 `3a674971f92cad95c6e6e6420af991d533c46a48b58f59663898b2827512e1f7`.
- `result.json`: SHA-256 `0a09ec07d2374756faa121df7d3de9dce3607848b6c064109749816587991a34`. Los cinco nombres registrados coinciden con la selección, la guarda Node estuvo activa y los 70 archivos congelados coincidieron antes y después.
- `roots-before.json` y `roots-after.json`: SHA-256 `5203bfba25237cfe76b139103b63c6975c9786d35b1a368b6354d4d0719f8864` cada uno; se inventariaron 22 colecciones, todas vacías antes y después. El TAP reporta limpieza de fixtures 5/5, separada del inventario externo.
- `run.json`: SHA-256 `8709dc829250aab0b094d0fb579950ea769f4e51b979121220111749fd254e3b`. El proceso Node terminó con salida 0. La JVM de prueba no terminó dentro de la ventana de apagado por nonce y fue detenida mediante su handle (`javaStoppedByNonce=false`, salida -1). Los puertos propios quedaron libres y 8185–8187 conservaron sus PID.
- `manifest.json`: SHA-256 `e161ba42c273bcfe197af5c34d038e1f4902292f1c5f6319924914af744ba1f2`; `system-manifest.json`: SHA-256 `a4864a77b7c0b5e36a39f8c739c30eb1f66715675d06fd9e050a9cc427a1840c`. Estos manifiestos acreditan las rutas y bytes de esa ejecución concreta, no una instalación idéntica en otra PC.

Los archivos adjuntos mantienen sus bytes mediante `.gitattributes` y se escanean directamente además del staging. La guarda cubre APIs comunes de Node, no es un firewall del sistema y no cubre esbuild, procesos nativos o dependencias transitivas no enumeradas. Los hashes antes y después no convierten todos los archivos en una instantánea inmutable. No hubo llamadas a nube ni datos de clientes. Costo de revisores externos de esta ejecución: no medido; este foco no invocó revisores externos.

Los originales completos permanecen en `outputs/lv019-b-unblock-focus-runs/run-36f3e9ae-0e9a-49b4-ae6a-c0cf6f96f265/` y `outputs/lv019-b-unblock-focus-isolation-20261126/run-4a61561f-8225-4f65-b84d-558f280ffb44/`. La siguiente actividad es revisar el rojo histórico y adaptar sus expectativas solo después de separar incompatibilidad de fixture de posibles problemas de producto.
## Escaneo de evidencia

El primer escaneo encontró tres coincidencias `generic-api-key` en `manifest.json:47` y `result.json:73,145`. Se comprobó que las tres corresponden exactamente al SHA-256 del archivo de código `server/commercial/firebaseAccess.ts` (81d2874f86c4a5f6ccf5c6495557752b264b4430ee9fdf306db6d7243e60bb3d), tanto en el manifiesto como en las lecturas anterior y posterior. `gitleaks-first-redacted.json` conserva el informe inicial; `gitleaks-exact.ignore` enumera exclusivamente las tres huellas archivo/regla/línea usadas para repetir el escaneo. No se excluyeron archivos ni reglas completas. El staging se escanea por separado porque estos recibos preservan bytes como binarios en Git.
