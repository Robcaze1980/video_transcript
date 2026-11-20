# Recibo T3 · propuesta de nube para el barrido y el endpoint de operador (LV-019.B) · 2026-11-19

Documento revisado: [`docs/specs/LV-019-B-conciliacion-propuesta-nube.md`](../../specs/LV-019-B-conciliacion-propuesta-nube.md) (solo documento; sin código ni cambios de nube). Vía: T3 local (instancia `linguistvision-openrouter`), `t3 thread start --wait`. Modelos pedidos: `~z-ai/glm-flash-latest` y `deepseek/deepseek-v4.1-flash`; modelo servido, tokens y costo no observables. Se enviaron resúmenes cortos de la propuesta (`prompt-a.txt`, `prompt-b.txt`) y se conservan todas las respuestas, también las FALLA.

| Ronda | GLM | DeepSeek |
|---|---|---|
| 1 (`prompt-a.txt`) | **FALLA** | **FALLA** |
| 2 (`prompt-b.txt`, partes corregidas) | **PASS** | **FALLA** (1 hallazgo «bloquea»; ver abajo) |

**Ronda 1, adoptado:** la recomendación 1C quedaba demasiado cerca de escribir en producción (ahora empieza **solo de lectura** y las alertas exigen aprobación y comprobación aparte); se declara que, sin nadie que lo ejecute, 1C no produce barrido ni alertas; redacciones que podían leerse como autorización (ahora «propuesta, nada preaprobado, P0 = acceso a producción no concedido»); costos mal enmarcados (tarifa publicada frente a costo medido, sin cifras inventadas, la cuenta de consultas se atribuye al código); riesgos que faltaban (identidad existente y cuota de cuentas de servicio, retención, limitador en memoria que no limita de verdad con mínimo 0 instancias, postura de red del túnel, entrega real del correo, arranque en frío); una pregunta más al dueño (retención).

**Ronda 2, DeepSeek:** su único hallazgo «bloquea» dice que la recomendación de no programar el modo `audit` deja sin cubrir el modo `billing`. Se **aclara por redacción, no por revisión**: `audit` es una opción del propio barrido (escanea colecciones enteras), no el modo `billing`; el modo `billing`, que mueve saldo, ya estaba excluido en P4 y ahora la frase lo dice. Sus otros dos puntos (cuenta de consultas contra el código; fecha y margen de la cuota de cuentas de servicio) eran «no bloquea»: la cuenta sale de `PENDING_SOURCES` (3+1+2+3+1) y se añadió que el margen actual no está verificado.

**Estado honesto:** una respuesta de la ronda 2 es PASS y la otra FALLA con un hallazgo aclarado por texto; no hubo ronda 3. La propuesta es un borrador para decisión del dueño y no autoriza nada. Cifras: Scheduler se leyó en el resultado de un buscador (la página no se pudo leer directamente) y se marca «confirmar antes de decidir»; Firestore, Cloud Run y Monitoring quedan **no verificados**.
