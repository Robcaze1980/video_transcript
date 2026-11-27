# LV-019.B: primera propuesta de recuperación del sucesor · 27 nov 2026

**No aplicada y no aceptada.** DeepSeek elaboró una propuesta de costura local para reconciliar un intento incierto. La revisión DeepSeek en un hilo distinto al del autor quedó **INCONCLUYENTE** y GLM por el respaldo directo dio **FALLA**. No se modificó el código con esta propuesta.

Codex confirmó los puntos que deben corregirse: la prueba debe comprobar host/proyecto del emulador; un recibo del sucesor debe corresponder al claim durable de Video; Video debe revisarse antes y después de la conciliación de Cuenta; un cambio entre bases debe conservarse como estado pendiente sin otro envío; la semilla de marcas debe usar el formato exacto de Cuenta y `create` inmutable; la ruta inicial cercada y los errores de recepción necesitan pruebas. El caso de guarda de Cuenta que cambia de generación también debe probarse, pues una lectura del intento anterior puede devolver `conflict` antes de la conciliación.

Dos inferencias de la revisión GLM requieren corrección: un epoch sucesor mayor no falla necesariamente si la guarda de Cuenta ya avanzó legítimamente a ese epoch; y en la rama parcial `record` proviene del cierre `done`, que conserva el epoch aceptado. Ninguna de esas correcciones convierte la propuesta en aprobada. Persisten la falta de autoridad/emisor, IAM, endpoint cercado y corte real de versiones antiguas.

GLM fue consultado por el respaldo autorizado después de fallar una ejecución de T3. El modelo servido fue `z-ai/glm-5.3-flash`; el recibo reporta 15.673 tokens de entrada, 52.661 de salida y **US$0.021295976625**. Modelo servido/uso/costo de la revisión T3 de DeepSeek: no medidos. Se conserva el texto completo de la propuesta y de ambas revisiones; una revisión corregida y pruebas reales quedan pendientes.

La revisión documental posterior señaló la coincidencia de modelo entre autor y revisor DeepSeek. Fueron hilos separados; GLM aportó además un contraste de otro modelo. El ancla sembrada está indicada en `MASTERPLAN.md`. La huella de `firebaseAccess.ts` se verificó contra el archivo local antes de ocultarla, por una alerta falsa del detector; no se ocultó una clave.
