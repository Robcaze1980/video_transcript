# Recibo T3 · plan integral en paralelo · 20 nov 2026

Alcance: el [plan integral](../../specs/LV-019-B-plan-integral-20261120.md) (autorizaciones del dueño del 20 nov y vía de voz). Es una revisión de **plan**, no de código: no toca la nube, no escribe datos reales y no mueve saldo.

Vía: T3 local (`~/.t3/bin/t3.cmd`, instancia `linguistvision-openrouter`), prompts cortos y sin datos personales (no llevan correos, UIDs ni claves). Modelos pedidos: `~z-ai/glm-flash-latest` y `deepseek/deepseek-v4.1-flash`; el modelo efectivamente servido no es observable en la respuesta. Costo y uso real: no observables desde el CLI; no se supone ninguno. Se conservan todas las respuestas, también las FALLA.

## Ronda 1 (versión 1 del plan)

| Prompt | GLM Flash | DeepSeek |
| --- | --- | --- |
| A: orden, nube y autorizaciones ([prompt](prompt-a.txt)) | [PASS](reply-a-glm.txt) con 2 ALTA y 6 menores | [FALLA](reply-a-deepseek.txt) |
| B: plan de voz ([prompt](prompt-b.txt)) | [FALLA](reply-b-glm.txt) | [FALLA](reply-b-deepseek.txt) |

### Adjudicación de la ronda 1

| Hallazgo | Decisión |
| --- | --- |
| Barrido colgado de la pasada de mantenimiento puede morir en silencio o arrastrar archivos/IA (DeepSeek A1, GLM A3) | **Adoptado.** Sub-manejador aislado con `try/catch` que no propaga, presupuesto de tiempo propio, idempotente, latido por pasada y alerta de frescura. Segundo Scheduler descartado por ahora (costo y cuota no medidos). |
| Desplegar cambia la imagen completa; probar antes (DeepSeek A2, GLM A5) | **Adoptado** como revisión etiquetada sin tráfico, prueba de humo de archivos/IA, promover con el barrido apagado. «3001» es el procedimiento del piloto local, no de Cloud Run; se aplicó la idea, no el nombre. Un barrido con 0 filas solo prueba el cableado: declarado. |
| La métrica por registros no es la fuente de verdad; probar la entrega (DeepSeek A3, GLM A4) | **Adoptado.** Prueba E2E con entrada de registro de prueba marcada **antes** de desplegar el código, alerta «sin datos» y spam. |
| Reversión concreta y verificable (GLM A1, DeepSeek A5) | **Adoptado** como regla 5 y paso de cierre de A4. |
| Verificar que el índice no pida otro y que la imagen no escribe en esa cola (DeepSeek A6, GLM A2) | **Adoptado** como verificación con la consulta exacta (`firestoreBackend.ts`: `state==pending`, `nextAttemptAt<=ahora`, `orderBy nextAttemptAt`) y prueba de frontera de importaciones. El razonamiento de GLM de que el índice «habilita escrituras» es impreciso: un índice solo sirve a lecturas. |
| El argumento contra Cloudflare era parcial (DeepSeek A4) | **Adoptado en parte.** Se reescribió: no es «público contra privado», sino proveedor y conector extra sin ganar seguridad sobre IAM + token; Access/Tunnel valen como capa adicional si el dueño lo pide. GLM A6 lo daba por correcto. |
| Puerta para extender el barrido a escrituras (GLM A7); UID solo bloquea A5 (GLM A8); control de crecimiento de las 2 colecciones (DeepSeek A5); confirmar «deploy» por escrito (DeepSeek A7) | **Adoptados.** |
| **Hallazgo propio, no de T3:** los servicios actuales tienen `INGRESS_TRAFFIC_INTERNAL_ONLY` (`deploy/google-cloud/files.plan.json`); desde la PC del dueño no se llega por proxy ni token | Corrige la propuesta 3B: el operador necesita un servicio nuevo con ingreso `all` sin invocadores públicos. Falta A0 para confirmar. |
| Voz: B1 prerrequisito duro de C1 (DeepSeek B1); GLM B5 pide congelar primero el contrato de B | **Adoptado en forma intermedia:** se escribe el contrato de interfaz de B antes de C1; C1 solo en emulador con interfaz apagada y no se cierra hasta B1. |
| Voz: C5 antes de C1/C2 (DeepSeek B2); C6 tarde (GLM B4); C0 antes de C1 (GLM B1) | C5 se parte en prototipo de solo lectura y UI conectada; C6 se parte en decisiones (C0a) y cumplimiento (C6b). **Rechazado en parte** que C1 espere a C0: la reserva es en segundos fuente y no depende del precio ni de la retención; lo que depende de C0a es C2 y C5b. |
| Voz: política sin idempotencia del proveedor (DeepSeek B3, GLM B2); no cobrar voz no entregada o con otro texto (DeepSeek B4, GLM B3); caducidad de `UNKNOWN` y fragmento fallido (DeepSeek B5, GLM B6) | **Adoptados** en C2 y C3. La verificación de artefacto antes de capturar ya existe como patrón en el pipeline de IA (`DEPLOYMENT.md`, LV-007.AI); falta aplicarla a la voz. |
| Voz: decisiones del dueño (DeepSeek B6, GLM B7); regresión continua y umbral de calidad (DeepSeek B7) | **Adoptados** (cinco decisiones y C4 continuo). |

## Ronda 2 (versión 2 del plan, [prompt](prompt-r2.txt))

| GLM Flash | DeepSeek |
| --- | --- |
| [PASS](reply-r2-glm.txt): seis ALTA previas resueltas; deja abiertas, sin bloquear, que las bases vacías no validan la conciliación, que el costo de voz es estimación y que las políticas de voz son del dueño | [PASS](reply-r2-deepseek.txt) con tres MEDIA y dos BAJA |

### Adjudicación de la ronda 2

| Hallazgo | Decisión |
| --- | --- |
| Operador: `all` no equivale a «sin exposición»; falta prueba E2E y de revocación (DeepSeek 1, 5) | **Adoptado:** redacción corregida y pruebas de aceptación, rechazo y revocación desde la PC del dueño antes de cerrar A5. |
| Índice sin uso y alerta de frescura con cola vacía (DeepSeek 2) | **Aclarado:** el latido mide que el barrido corrió, no el contenido de las colas; ninguna alerta depende del modo `billing`. El índice queda creado y sin uso hasta que ese modo exista (0 documentos, sin costo de almacenamiento apreciable). |
| C1 bloqueada sin fecha por B1 (DeepSeek 3) | **Adoptado:** B1 es la siguiente tarea local y no depende del dueño. |
| A4 con 0 filas solo prueba cableado (DeepSeek 4) | Ya declarado; la lógica la prueban el emulador y las mutaciones. |
| Conciliación sin datos reales (GLM 7); costo y políticas de voz abiertos (GLM 8, 9); auditoría de IAM y latencia de «sin datos» (GLM 10, 11) | **Aceptados como límites**; los dos primeros son decisiones o mediciones pendientes, los demás ya están en las reglas de ejecución. |

## Clasificación

Ronda 1: FALLA en 3 de 4 respuestas, con hallazgos reales que cambiaron el plan. Ronda 2 sobre la versión corregida: PASS de ambos. **El PASS valida el orden y las reglas del plan; no es evidencia de que algo funcione en la nube, que la alerta llegue, que el operador sea alcanzable ni que la voz esté lista.**

## Ronda 3 (decisiones del dueño del 20 nov por la tarde; [prompt](prompt-r3.txt))

Delta revisado: puerta G0 (no desplegar nada hasta que la voz esté lista), política «no se cobra si fallamos», costo de voz (US$0,0135/min hasta fin de 2026 y US$0,027/min desde 2027), almacenamiento y retención del audio. Los datos personales del dueño no se enviaron.

| GLM Flash | DeepSeek |
| --- | --- |
| [PASS](reply-r3-glm.txt): costos y almacenamiento coherentes; G0 no es circular si G6 es puerta de apertura al público; avisa de `UNKNOWN` sin plazo, cancelación del cliente y «entrega verificada» sin definir | [FALLA](reply-r3-deepseek.txt): «lista» sin criterio de salida (ALTA) y `UNKNOWN` que retiene saldo sin fin (ALTA); números coherentes |

### Adjudicación de la ronda 3

| Hallazgo | Decisión |
| --- | --- |
| «Lista» sin criterio; G6 no circular (DeepSeek 1, GLM 1); A1/A3 tocan la nube (DeepSeek 2); G0 retrasa la conciliación (GLM 2) | **Adoptado** como §0.1: acta de «lista» en cinco puntos, primer despliegue restringido donde se evalúa G6, lista cerrada de acciones previas a G0 con su reversión y aviso al dueño. |
| `UNKNOWN` retenido sin fin (GLM 3, DeepSeek 3) | **Adoptado con matiz.** Plazo máximo a fijar con datos, estado visible, límite por cuenta, una llamada en vuelo, alerta con ventana de gracia y, al vencer, liberación con marcador para que un artefacto tardío no se descargue ni se cobre. **No** se adopta una liberación inmediata sin evidencia como regla general, y nunca se captura sin entrega verificada. |
| Cancelación del cliente (GLM 4, DeepSeek 4) | **Parcial:** antes de enviar se libera todo; después de enviar queda abierta como decisión del dueño. |
| «Entrega verificada» sin definir (GLM 5) | **Adoptado** en C2 (respuesta con audio, WAV válido, duración, hash del texto, objeto con generación y recibo, acceso del propietario). |
| Retención con regla automática (GLM 7) | **Adoptado con matiz:** se aplica con la purga por lotes con marcadores del pipeline de IA, no con ciclo de vida de bucket, que permitiría resucitar escrituras tardías. |
| Costo 2027 (GLM 8), impuestos y comisiones (DeepSeek 5), tokens de entrada (GLM 6) | Anotados en la nota C0a; los tokens de entrada sí se facturan (US$0,50/1M) y ya están contados como una centésima de centavo por minuto. |

Clasificación: GLM PASS; DeepSeek FALLA con hallazgos reales ya incorporados. No se pidió una ronda 4: las correcciones son las que los revisores propusieron y se vuelven a revisar al implementar C2 y C3.
