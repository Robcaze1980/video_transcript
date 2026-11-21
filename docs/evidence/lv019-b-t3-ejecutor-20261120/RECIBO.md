# Recibo T3 · diseño del ejecutor periódico de drenajes (paso 1.6) · 20 nov 2026

Alcance: [diseño](../../specs/LV-019-B-ejecutor-periodico-drenajes.md) (revisión de diseño; sin código, nube ni saldo). Vía: T3 local, modelos pedidos `~z-ai/glm-flash-latest` y `deepseek/deepseek-v4.1-flash` (el servido no es observable). Se conservan las respuestas. [Prompt](prompt-a.txt) · [GLM FALLA](reply-a-glm.txt) · [DeepSeek FALLA](reply-a-deepseek.txt).

| Hallazgo | Decisión |
| --- | --- |
| Verificar el token antes de cada fila; renovar y liberar condicionados al titular (GLM 1, DeepSeek 3) | **Adoptado** en 3.2. |
| Sin orden ni rotación: inanición, filas que quedan fuera del subconjunto (GLM 2, DeepSeek 4) | **Adoptado:** cursor persistente por tipo con vuelta, tope por cuenta y sub-presupuestos por sección (3.3). El orden por antigüedad estricta no es posible con los selectores por id de documento. |
| Con el interruptor apagado no se emite latido (GLM 3) | **Ya estaba** en 3.6; se aclaró que `disabled` y `skipped` son sanos (3.5). |
| Alertas solo por «sin latido»; sin señal de edad (GLM 4/5, DeepSeek 6) | **Adoptado** en 3.5: error sostenido, `failed` sostenido y edad de la fila más antigua. |
| Prueba de caída tras la respuesta de Cuenta (GLM 6) | **Adoptado** en las pruebas. |
| Presupuesto agotado por los bloqueos (GLM 7) | **Adoptado:** presupuesto por sección. |
| Errores de infraestructura no avanzan la fila (DeepSeek 2) | **Adoptado:** toda ruta de error deja un intento y hay edad máxima hacia `needs_review` (3.4). |
| Capture y Release sobre la misma reserva con ACK perdido (DeepSeek 1, ALTA) | **Refutado con código:** Cuenta tiene un único estado terminal por reserva (`reserved → captured o released`); la acción opuesta recibe `conflict` y Video nunca libera por reloj ni por 404 (invariante I2). |
| Comparar «todo el historial» manda a cuarentena por cambios benignos (DeepSeek 5) | **Aceptado como límite:** con el arriendo vigente solo la propia pasada cambia las versiones; la pérdida del arriendo a mitad de fila puede causar una cuarentena evitable, mitigada por la comprobación previa y por la reconciliación del doble ACK. |

Clasificación: dos FALLA con hallazgos reales; ninguno muestra un camino de doble cobro. No se pidió una segunda ronda del diseño: se revisará sobre el código.
