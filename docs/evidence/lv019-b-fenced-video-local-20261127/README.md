# LV-019.B: conexión local de Cuenta y Video · 27 nov 2026

**Ensayo local, no aceptado para producción.** En la candidata basada en `a0f1cc4`, el primer ensayo pasó **4/4**. El seguimiento reforzado pasó **5/5**, sin omisiones: tres pruebas del cerco de Cuenta, recuperación de una respuesta perdida y rechazo de un recibo de otra incidencia.

En el caso reforzado, Video y `AccountBillingClient` usan transporte ficticio; `AccountStore` y Firestore Emulator son reales en esta PC. El primer envío local confirma en Cuenta y pierde la respuesta. Video consulta el recibo sin enviar otra mutación; dos reservas se devuelven una vez cada una y una segunda cuenta conserva saldo, reserva y libro. El transporte añade datos de un ancla sembrada: **no existe aquí un endpoint real que haga ese paso**.

DeepSeek dio PASS limitado al ensayo reforzado y anotó que el negativo de recibo ajeno prueba el cliente directamente, no el recorrido completo. La primera revisión GLM por T3 falló sin respuesta y se conserva su estado; el respaldo directo autorizado dio PASS limitado a la versión reforzada (modelo servido `z-ai/glm-5.3-flash`, costo US$0.0086095845). Ninguna prueba demuestra sucesor, autoridad/IAM, desactivación de versiones antiguas, red real ni producción. Se mantienen los tres fallos de recuperación del otro foco.

Los procesos y raíces aislados se limpiaron; la JVM propia necesitó cierre forzado y los puertos compartidos no cambiaron. Los registros versionados normalizan espacios y finales de línea; se ocultó una huella de `firebaseAccess.ts` tras verificarla con el archivo para evitar una detección falsa. Originales en `outputs/` local. Modelo servido y costo de T3 no medidos.

Los lanzadores de este ensayo fijan como base `a0f1cc4`; para repetir desde otra PC, recrea un worktree desde esa revisión y aplica sin commit el diff de esta rama sobre los tres scripts y la prueba, instala las dependencias locales y genera manifiestos nuevos. No reutilices manifiestos con hashes anteriores ni apuntes el emulador a datos reales.
