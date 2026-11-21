# Recibo T3 · plan paso a paso hasta producción · 20 nov 2026

Alcance: el [plan paso a paso](../../specs/LV-019-B-plan-paso-a-paso-20261120.md) (revisión de **plan**, no de código). No toca la nube, no escribe datos reales y no mueve saldo. Vía: T3 local (`~/.t3/bin/t3.cmd`, instancia `linguistvision-openrouter`), modelos pedidos `~z-ai/glm-flash-latest` y `deepseek/deepseek-v4.1-flash` (el modelo servido no es observable; costo y uso no observables). Los prompts no llevan correos, UIDs ni claves. Se conservan todas las respuestas.

## Ronda 1 (versión 1) · [prompt](prompt-a.txt)

[GLM FALLA](reply-a-glm.txt) · [DeepSeek FALLA](reply-a-deepseek.txt). Todos los hallazgos eran omisiones reales de «production ready» y se **adoptaron**:

| Hallazgo | Dónde quedó |
| --- | --- |
| El primer contacto con el proveedor real era en la fase 6 (GLM 1) | Paso 4.3b: prueba controlada desde la PC, sin desplegar, dentro del tope |
| Cuentas de verificación solo en Video (GLM 2) | Regla 10 y puertas: impuesto en el servidor desde el primer despliegue de Cuenta |
| Privacidad y términos en la fase 7 (GLM 3, DeepSeek 2) | Puerta G8 antes de cualquier cuenta real; consentimiento en la interfaz (4.4) |
| Observabilidad solo con correo (GLM 4, DeepSeek 8) | Paso 3.8: métricas, panel y quién atiende cada alerta |
| Restauración no ensayada (GLM 6, DeepSeek 1) | Paso 3.9 y puerta G9 |
| Barrido y `unknown` solo como lógica local (GLM 7); reconciliador como precondición (DeepSeek 4) | **Paso 1.6, el más importante:** hoy ningún planificador ejecuta los drenajes de saldo; se añade un ejecutor periódico; el despliegue de la fase 6 incluye mantenimiento con barrido y ejecutor |
| Conciliación del gasto (GLM 8); abuso y capacidad (GLM 9, DeepSeek 3, 7) | Fase 6 paso 5 y paso 3.10 |
| Versionado de esquema, etiquetas y reversión de datos (GLM 10, DeepSeek 7) | Paso 3.9 |
| Barrera de aborto al final (DeepSeek 5); canario sin tráfico para todo (DeepSeek 6) | Ensayo en seco de reversión y apagado antes de encender; Hosting en canal de vista previa |
| Bloqueos permanentes por fallos transitorios (GLM 5) | Paso 1.4: reintentos acotados; bloqueo permanente solo con divergencia demostrada |

**Matiz:** DeepSeek propuso una regla de ciclo de vida de GCS para el borrado a 90 días; se adopta solo como respaldo de los objetos y nunca para los marcadores (una regla así podría resucitar escrituras tardías, según [LV-007](../../DEPLOYMENT.md)).

## Ronda 2 (versión 2) · [prompt](prompt-r2.txt)

[GLM PASS](reply-r2-glm.txt): ocho hallazgos ALTA previos resueltos, residuos no ALTA. [DeepSeek FALLA](reply-r2-deepseek.txt): siete hallazgos que persisten.

| Hallazgo | Decisión |
| --- | --- |
| Interruptor del proveedor en el plano que puede fallar (DeepSeek 1, ALTA) | **Adoptado:** configuración externa consultada en cada llamada y orden de apagado medido (subidas → voz → proveedor → despliegue). |
| Ejecutor sin arriendo con valla (DeepSeek 2, ALTA) | **Adoptado:** arriendo con fencing y prueba de dos ejecutores simultáneos y de uno pausado que despierta tarde. Nota: Cuenta ya es idempotente por acción y reserva, así que un doble drenaje no puede duplicar el cobro; la prueba lo exige igualmente. |
| Vigilancia circular (DeepSeek 3) | **Aclarado:** la alerta de «sin latido» la evalúa Cloud Monitoring, fuera del servicio de mantenimiento. |
| 4.3b envía contenido a Google antes de G8 (DeepSeek 4) | **Adoptado:** solo contenido sintético propio, nunca de clientes. |
| La restauración puede resucitar datos purgados (DeepSeek 5) | **Adoptado:** la purga prevalece y se reejecuta tras restaurar. |
| Moderación sin decidir bloquea G8 (DeepSeek 6) | **Adoptado:** valor por defecto (sin moderación automática, política de uso aceptable, suspensión manual) y decisión del dueño antes de G8. |
| Umbrales, tiempos de respuesta y conciliación del gasto tardía (DeepSeek 7) | **Adoptado:** umbral y tiempo de respuesta por alerta; la conciliación manual del gasto empieza en 4.3b. |

Clasificación: ronda 1, dos FALLA con omisiones reales; ronda 2, un PASS y una FALLA con hallazgos incorporados. No se pidió una tercera ronda: los cambios son aclaraciones que los revisores propusieron y se revisarán al ejecutar cada paso. **Ningún PASS valida que algo funcione; valida el orden y la cobertura del plan.**
