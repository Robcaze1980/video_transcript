# LV-019.B · Consulta sobre la recuperación de una respuesta perdida

**26 nov 2026.** GLM y DeepSeek examinaron extractos de `708c414`, no una implementación final. Ambos devolvieron **FALLA** para la recuperación de los dos estados ya conocidos: solicitud local confirmada sin respuesta y cambio legítimo de generación. No demostraron un doble cargo ni revisaron C2.

[GLM](LV-019-B-recuperacion-708c414-consulta-GLM-20261126.txt) propuso devolver la generación actual al consultar `pending`. Eso podría aportar información, pero Codex **no acepta que la generación y la ausencia de recibo autoricen por sí solas un nuevo envío**: una petición anterior aún podría estar en camino. La repetición automática de resultado incierto sigue prohibida por la política vigente.

[DeepSeek](LV-019-B-recuperacion-708c414-consulta-DeepSeek-20261126.txt) propuso un intento previo en Cuenta y estados diferenciados. Codex lo considera una pieza posible, no una solución completa: faltan autoridad verificable, vínculo con Video, manejo de una petición en vuelo, corte de escritores anteriores y migración. La consulta no demuestra que exista ya ese emisor o contrato.

Ambos señalan que `pending` solo demuestra ausencia de recibo en ese momento. La prueba local de metadatos también mostró que la igualdad actual de marcas entre documentos recreados no acredita continuidad histórica. El diseño y cualquier código posterior siguen sujetos a pruebas y revisión dual sobre el corte final.

OpenRouter, respaldo autorizado de T3, reportó para GLM `z-ai/glm-5.3-flash` **3.960/13.863 tokens de entrada/salida** y **US$0,0056857086**; para DeepSeek **4.288/9.446** y **US$0,0055188243**. Se preservan los informes completos y sus límites. No hubo cambios de nube ni de saldo real.
