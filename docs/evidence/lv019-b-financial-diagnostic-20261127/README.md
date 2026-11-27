# Diagnóstico financiero aislado · 27 nov 2026

Candidata `61e64070c2ac6245caaee8eaad620feb68d9e246`, con los tres cambios del arnés y el comparador de esta rama. Proyecto exclusivamente local `demo-vistavo-financial`, puerto 8198 y datos ficticios. **No es aceptación financiera.**

La ejecución terminó con **530 pruebas: 519 aprobadas, 6 fallidas y 5 omitidas de voz**, cero canceladas. El archivo `fixture.stdout.tap` conserva cada resultado y `suite-result.json` sus controles; los archivos de evidencia de entrada se registran con sus hashes. El runner comprobó que sus entradas y Node no cambiaron y que las raíces sintéticas quedaron vacías. El lanzador cerró el emulador que él mismo inició por el handle propio tras vencer la espera de parada por nonce; el servicio compartido del puerto 8185 quedó sin cambios. El preload de red no es un firewall del sistema ni cubre todos los procesos nativos.

Cinco fallos están en `billingUnblock.emulator.mjs`: la prueba de la generación auditada usaba un sustituto de Cuenta sin método de recibo; la cuenta de lecturas esperaba 12 frente a 18 observadas; un caso de generación antigua y los escenarios `retry-generation A/B` intentaban continuar después de una solicitud incierta. Cada causa requiere contraste; no se deben cambiar expectativas sin conservar su cobertura ni habilitar un segundo envío inseguro. **La conciliación de 409/pending y el cerco Cuenta/Video aún no están implementados e integrados.**

La sexta falla es una lectura cliente que esperaba 403 y recibió 200. El lanzador Java de esta ejecución no carga `deploy/google-cloud/firestore.rules`; por tanto el diagnóstico no demuestra las reglas. Es necesario cargar la regla exacta en un emulador aislado y repetir los controles antes de concluir. No se ha verificado aquí el estado de las reglas en producción.

Se guardan las respuestas completas de T3, incluidos dictámenes inicialmente inconclusos y seguimientos, y los logs. Costos y tokens por revisión: no medidos. La revisión GLM y la revisión DeepSeek del arnés quedaron limitadas a sus paquetes y no validaron el resultado de esta ejecución ni la corrección financiera del producto.

El primer escaneo de secretos marcó tres apariciones del SHA-256 del archivo `server/commercial/firebaseAccess.ts` en el manifiesto y el resultado; se verificó cada coincidencia contra el archivo local y se repitió el escaneo con excepciones específicas a esas tres líneas. El informe inicial redactado y la lista exacta se conservan aquí.

`git diff --check` indicó una línea vacía adicional al final de `scripts/checkFinancialCandidateIntegrity.mjs`. Se preservó el archivo exactamente como se ejecutó para no alterar su hash de evidencia; la advertencia no representa una prueba aprobada.
