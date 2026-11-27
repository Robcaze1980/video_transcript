# LV-019.B: reglas del emulador financiero — 27 nov 2026

Se corrigió el arnés local para cargar `deploy/google-cloud/firestore.rules` en el emulador aislado y detener la batería si falla el preflight. Este cambio no configura ni verifica producción.

- El diagnóstico anterior obtuvo `200` en vez de `403` sin cargar reglas. Véase el diagnóstico financiero completo en la rama `codex/vistavo-finance-full-20261127`.
- Se preservan los tres intentos fallidos del arnés: nombre de colección reservado, API Admin incompatible y carpeta temporal incompatible con el guard existente.
- El cuarto ensayo cargó reglas con hash comprobado; un hash falso fue rechazado; el cliente recibió 403; una lectura Admin de documento ausente funcionó. La prueba real verificó GET y PATCH 403 sobre un documento creado por Admin.
- Pasaron 3 de 3 pruebas seleccionadas, sin omisiones: privacidad, captura duplicada y reservas concurrentes. Son un subconjunto; no constituyen la batería financiera completa.
- El resultado registra huellas sin cambios, inventarios vacíos y listeners compartidos intactos. El proceso Java dedicado terminó tras limpieza forzada; no se afirma cierre voluntario.
- GLM y DeepSeek revisaron estáticamente el alcance enfocado. Se conservan sus respuestas, incluidos formatos y límites iniciales. Modelo servido y coste: no medidos cuando no fueron observables.

Limitaciones: no se verificaron reglas desplegadas, IAM, producción, autoridad real, saldo online ni la integración de recuperación. Los otros fallos del diagnóstico siguen abiertos; la prueba local no habilita pagos ni procesamiento público. El guard de red es una precarga de Node, no un firewall del sistema.

Los registros versionados normalizan espacios y finales de línea; se ocultó una huella de `firebaseAccess.ts` después de verificar que coincide con el archivo fuente, para evitar una detección falsa de clave. Los originales permanecen en `outputs/` de esta PC.

Control adicional: el comparador local verificó que los 14 archivos de la batería siguen idénticos a la revisión base y que el manifiesto incluye 83 entradas; esto no equivale a volver a ejecutar la batería.
