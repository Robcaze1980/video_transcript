# LV-019.B: pruebas originales conservadas · 27 nov 2026

**Candidata de pruebas en curso, sin aceptar.** Después de las observaciones de GLM y DeepSeek, se restauraron sin alterar los casos `retry-generation A` y `retry-generation B`; en el test original de auditoría de generación se agregó la lectura de recibo pendiente que faltaba al mock. Se añadieron casos de recibo confirmado y lecturas directas sin sustituir los originales.

Con datos ficticios, el ensayo enfocado ejecutó **8 pruebas: 5 aprobadas, 3 fallidas y 0 omitidas**. Los tres fallos corresponden a la recuperación de un intento anterior que no puede reenviarse solo porque su recibo esté pendiente. La limpieza fue **9/9** y los puertos compartidos no cambiaron. No es la batería completa ni una corrección del código de recuperación.

Se conservan TAP, resultado, lanzador, diff WIP y propuesta T3. Los registros versionados normalizan finales de línea y espacios; una huella de `firebaseAccess.ts` se ocultó después de verificarla contra la fuente para evitar una detección falsa. Los originales están en `outputs/` local. Las revisiones independientes de este seguimiento y la solución real siguen pendientes. No se tocaron producción, recursos cloud ni saldo real.
