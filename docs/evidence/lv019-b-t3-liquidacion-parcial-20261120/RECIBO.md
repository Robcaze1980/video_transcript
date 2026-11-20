# Recibo T3 · liquidación parcial y liberación tras admisión (C2a) · 20 nov 2026

Alcance: la [especificación](../../specs/LV-019-B-liquidacion-parcial-y-liberacion-posadmision.md), una revisión de **diseño** (no hay código). No toca la nube, no escribe datos reales y no mueve saldo. Mapa de caídas que lo origina: [mapa](../../reviews/LV-019-B-mapa-caidas-video-cuenta-20261120.md).

Vía: T3 local (`~/.t3/bin/t3.cmd`, instancia `linguistvision-openrouter`), prompts cortos con el extracto de código necesario. Modelos pedidos: `~z-ai/glm-flash-latest` y `deepseek/deepseek-v4.1-flash`; el modelo servido no es observable. Costo y uso: no observables. Se conservan todas las respuestas.

## Ronda 1

| Prompt | GLM Flash | DeepSeek |
| --- | --- | --- |
| A: contrato de Cuenta ([prompt](prompt-a.txt)) | [PASS](reply-a-glm.txt) | [FALLA](reply-a-deepseek.txt) |
| B: lado Video ([prompt](prompt-b.txt)) | [FALLA](reply-b-glm.txt) | [FALLA](reply-b-deepseek.txt) |

| Hallazgo | Decisión |
| --- | --- |
| Admisión como una sola ranura con varios intentos (DeepSeek A1, GLM A1) | **Refutado con código:** `sameAdmission` compara `jobId` y `attemptId` y otro intento recibe `conflict` (`backend.ts:285`); hay un único intento admitido por reserva. Se **documenta** como inmutable y única. |
| Admisión no ligada a la reserva (DeepSeek A4) | **Refutado:** se lee del documento de la propia reserva. |
| K = N y asientos de libro (GLM A4, DeepSeek A2); invariantes (GLM A7, DeepSeek A5) | **Adoptado:** `capturedSeconds` solo con 1 ≤ K < N, K = N inválido, tipos de asiento distintos, lista de invariantes. |
| «Sin admisión almacenada, ignorar la suministrada» (GLM A2, DeepSeek A3) | **Adoptado en parte:** la barrera `first` ya hace de comprobación cruzada (`:332`), no se purga la admisión, y la respuesta incluye `admitted`. |
| `unknown_expired` sin cota (GLM A3, DeepSeek A6) | **Adoptado:** edad mínima y cuenta por cuenta. |
| Carrera entre sellado y respuesta tardía (GLM B1, DeepSeek B1) | **Adoptado:** el sellado es el único escritor; subcobro acotado a un fragmento en vuelo, coste asumido por Vistavo. |
| K ambiguo (GLM B2, DeepSeek B2) | **Adoptado** con una elección: suma exacta y un solo `ceil` al final (DeepSeek) frente a redondeo por fragmento (GLM); se eligió lo primero por no cobrar de más. |
| Ampliar la tupla rompe filas antiguas y versiones mixtas (GLM B3, DeepSeek B3) | **Adoptado:** `settlementProtocol`, Cuenta primero, falla cerrado por lista exacta de campos, prueba de drenado mixto. |
| `needs_review` retiene saldo y cupo (GLM B4, DeepSeek B4) | **Adoptado:** entra en el plazo máximo del plan (C3). |
| Exactamente una liquidación (DeepSeek B5, GLM B5) | **Adoptado** como invariantes y pruebas. |

## Ronda 2 (versión 2, [prompt](prompt-r2.txt))

| GLM Flash | DeepSeek |
| --- | --- |
| [PASS](reply-r2-glm.txt): cuatro hallazgos previos resueltos; falta definir qué responde Cuenta si la edad mínima no se cumple y probar que `admitted:false` sobrevive al replay | [PASS](reply-r2-deepseek.txt): pendientes menores (alinear la constante de edad con Video, rechazo de la resolución en Cuenta antiguo, unicidad) |

Adoptado de la ronda 2: error propio `too_early` que no cuenta en el tope de conflictos, constante de edad en un módulo compartido con prueba de que el plazo de Video es mayor o igual, rechazo de cada campo nuevo por un Cuenta antiguo, y las pruebas de `admitted:false`, sellado idempotente y `capturedSeconds` igual a N.

Clasificación: ronda 1, un PASS y tres FALLA con hallazgos reales; ronda 2, PASS de ambos. **El PASS valida el diseño; no hay implementación ni prueba ejecutada.**
