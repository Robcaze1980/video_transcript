# Recibo T3 · doble ACK de liquidación · 20 nov 2026

Alcance: cambio local en [`firestoreBackend.ts`](../../../server/commercial/firestoreBackend.ts) (`quarantineExternalBillingOutbox`, fase `after_ack`) descrito en la [especificación](../../specs/LV-019-B-doble-ack-liquidacion.md). No toca la nube, no escribe datos reales y no mueve saldo.

Vía: T3 local (`~/.t3/bin/t3.cmd`, instancia `linguistvision-openrouter`), prompts cortos con el código completo de cada parte. Modelos pedidos: `~z-ai/glm-flash-latest` y `deepseek/deepseek-v4.1-flash`; el modelo efectivamente servido no es observable en la respuesta. Costo y uso real: no observables desde el CLI; no se supone ninguno. Se conservan todas las respuestas, también las FALLA.

## Ronda 1 (primera versión del bloque, sin comprobar el `createTime` de la fila)

| Prompt | GLM Flash | DeepSeek |
| --- | --- | --- |
| A: bloque, `markExternalBillingSettled`, llamada del drenador ([prompt](prompt-a.txt)) | [FALLA declarada](reply-a-glm.txt), pero sus propios hallazgos son «no bloquea»/«bien» | [FALLA](reply-a-deepseek.txt) |
| B: captura de versiones y funciones auxiliares ([prompt](prompt-b.txt)) | [PASS](reply-b-glm.txt) | [FALLA](reply-b-deepseek.txt) |

Adjudicación de Codex, contra el código:

- **Adoptado (real).** DeepSeek B-1: una fila `settled` borrada y recreada con la misma tupla pasaba como benigna, porque `outbox` quedaba fuera de la comparación. Se escribió primero la prueba `outboxRecreated` (falló con el código anterior) y se añadió la condición de que la fila conserve el `createTime` que tenía antes del POST (solo su `updateTime` puede moverse). Su mutación se detecta.
- **Refutado por el código (los extractos no lo mostraban).** DeepSeek A-2/A-3: «`current` quizá se lee fuera de la transacción». Se lee en la primera línea de la transacción, antes del bloque. A-1: «no revalida el job»: el trabajo y su clasificación son dos de los 13 documentos cuyas versiones deben seguir intactas desde la validación previa al POST. A-4: «`JSON.stringify(undefined)`»: la captura rellena siempre los 14 nombres o devuelve `null`. B-2: «la premisa de que el POST solo toca `outbox` no está verificada»: `markExternalBillingSettled` solo actualiza esa fila (visible en el código) y la prueba benigna lo demuestra en emulador.
- **Límites ya conocidos, no nuevos.** DeepSeek B-3/B-4/B-5 y GLM A: las versiones solo cubren los 14 documentos del contrato de liquidación (límite registrado el 17 nov), la fila `settled` no guarda el ACK, y el camino benigno silencia el duplicado. Quedan en la sección «Límites» de la especificación.

## Ronda 2 (bloque final, con el inicio de la transacción incluido y la consecuencia sobre el `catch`)

| Prompt | GLM Flash | DeepSeek |
| --- | --- | --- |
| A2: bloque final con el inicio de la transacción ([prompt](prompt-a2.txt)) | [PASS](reply-a2-glm.txt) | [FALLA](reply-a2-deepseek.txt) |
| C: consecuencia sobre el `catch` del drenador ([prompt](prompt-c.txt)) | [PASS](reply-c-glm.txt) | [FALLA (evidencia)](reply-c-deepseek.txt) |

Adjudicación de Codex:

- **DeepSeek A2-1** («`after.expected` sale de la incidencia previa, no del llamador»): falso. `after` se construye en memoria al inicio del método a partir de `options.expected` y `options.ack` del propio llamador; ninguna incidencia guardada interviene (el extracto empezaba después de esa construcción). **A2-2** («orden de claves al persistir»): por lo mismo no hay persistencia de por medio; ambos lados salen de la misma función en memoria, y la prueba benigna pasa en emulador. **A2-3** («una incidencia anterior sigue bloqueando»): cierto pero no es una regresión: el retorno temprano no crea ni resuelve incidencias; el bloqueo de un caso anterior lo sigue resolviendo la resolución auditada de siempre.
- **DeepSeek C (aceptado como límite, sin cambio).** Cuando `markExternalBillingSettled` hace commit y falla después, ya no queda una incidencia que distinga commit propio de ajeno ni guarde el ACK; el registro durable pasa a ser la fila `settled` con historial intacto y Cuenta conserva el suyo. No hay doble cobro ni bloqueo indebido. DeepSeek sugiere una marca durable y no bloqueante; no se adopta ahora porque añade escrituras al camino de liquidación sin un caso que la exija. El drenador sigue contando ese intento como `failed`. El cambio obligó a actualizar la prueba `confirmed capture response with after_commit` (antes exigía la incidencia).

## Nota de trazabilidad

La primera versión de `prompt-c.txt` se regeneró antes de enviarse (nunca se envió); solo queda la versión enviada. `prompt-a.txt` y `prompt-b.txt` son los de la ronda 1, enviados tal cual.

Pruebas citadas: ver la bitácora del 20 nov (emulador de liquidación, mutaciones, regresión financiera).
