# LV-019.B: ensayo inicial de reparación de pruebas · 27 nov 2026

**No aceptado.** En una candidata local sobre `61e6407`, el ensayo enfocado ejecutó seis casos con cuentas ficticias: **5 aprobadas, 1 fallo y ninguna omisión**. `retry-generation A` permaneció intacto y falló: la recuperación del intento incierto no está resuelta. No es una batería completa ni una publicación.

GLM y DeepSeek calificaron **FALLA** a la propuesta de pruebas: detectaron pérdida de cobertura anterior y controles incompletos de lecturas directas, generación de Cuenta y conteo de envíos. Se conserva el diff rechazado, la salida TAP y ambas respuestas; no se debe aplicar la propuesta como aceptada. Codex prepara un seguimiento que mantenga las pruebas anteriores y agregue los controles faltantes.

El emulador era local, el inventario se limpió y los puertos compartidos no cambiaron. El lanzador reportó el fallo como tal y terminó su JVM propia mediante el mecanismo previsto de cierre forzado. Los registros versionados normalizan espacios y finales de línea; una huella de `firebaseAccess.ts` fue ocultada tras verificarla contra el archivo fuente para evitar una detección falsa de clave. Los originales permanecen en `outputs/` local.

Los modelos servidos, uso y coste no fueron observables. No se tocaron saldo real, recursos cloud ni producción; las autorizaciones reales y el corte de escritores continúan sin demostrar.
