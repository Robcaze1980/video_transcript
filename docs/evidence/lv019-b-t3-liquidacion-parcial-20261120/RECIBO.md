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

## Revisión del código de la etapa 1 (Cuenta, transporte HTTP y cliente) · [prompt 1](prompt-c1.txt) · [prompt 2](prompt-c2.txt) · [prompt 3](prompt-c3.txt)

Se enviaron tres extractos completos del código ya escrito (opciones y replay; liquidación nueva y efectos; ruta HTTP y cliente) a los dos modelos. Resultados: [c1 GLM FALLA](reply-c1-glm.txt) · [c1 DeepSeek FALLA](reply-c1-deepseek.txt) · [c2 GLM FALLA](reply-c2-glm.txt) · [c2 DeepSeek FALLA](reply-c2-deepseek.txt) · [c3 GLM PASS](reply-c3-glm.txt) · [c3 DeepSeek FALLA](reply-c3-deepseek.txt).

La mayoría de los hallazgos ALTA parten de que cada extracto no mostraba las comprobaciones previas; se contrastó cada uno con el código real:

| Hallazgo | Decisión |
| --- | --- |
| `partial` sin validar: K = 0, negativo, > N o = N (GLM c2-1, DeepSeek c2-1) | **Refutado:** `settlementOptions` lo rechaza con `invalid` antes de la transacción (1 ≤ K < N, entero) y `seconds === expectedSeconds` se exige después; hay pruebas para cada valor. |
| `admitted:previous!==null` con `previous` indefinido (GLM c2-5, DeepSeek c2-2) | **Refutado:** `storedAdmission` devuelve `null`, nunca `undefined` (`backend.ts`, función `storedAdmission`). |
| Reserva liberada sin `releaseAdmission` pero con admisión almacenada pasa o lanza mal (GLM c2-2) | **Refutado:** debe lanzar `invariant` y lo hace (prueba «released with a provider admission but without releaseAdmission»). |
| La liberación simple sin admisión almacenada no exige resolución ni aplica la edad mínima (GLM c2-3/4, DeepSeek c2-3/4, c1-3/4) | **Refutado por diseño:** sin admisión almacenada no pudo haber llamada, la liberación simple de hoy sigue igual y la resolución solo es obligatoria cuando hay reclamo; el emparejamiento admisión + resolución se exige en `settlementOptions`. Límite aceptado: la admisión reclamada se ignora y no se guarda. |
| Replay de captura completa daría `conflict` (DeepSeek c1-1) | **Refutado:** toda captura guarda `captureAdmission`; hay prueba del replay completo. |
| `capture` con `resolution` no se rechaza (DeepSeek c2-5) | **Refutado:** `settlementOptions` la rechaza. |
| Captura sin admisión pasa el replay (GLM c1-1) | **Refutado:** en protocolo 2 la ausencia de admisión en un estado `captured` ya es invariante (comprobación previa existente). |
| Propiedades heredadas en las opciones (GLM c1-4) | **Adoptado:** solo objetos planos (prototipo `Object.prototype` o nulo). |
| El cuerpo del cliente esparce `admission` y pueda pisar `seconds` (DeepSeek c3-1) | **Adoptado:** el cuerpo se construye con lista blanca `{jobId, attemptId}`; prueba nueva. |
| `too_early` se mapea para cualquier acción (DeepSeek c3-2) | **Adoptado:** solo en `release`; prueba nueva. |
| Un `release` sin reclamo no avisa si Video quería la forma posadmisión (DeepSeek c3-3) | **Trasladado a la etapa 2:** es una regla del llamador de Video (con llamadas registradas, siempre reclamo); se prueba allí. |
| Corrupción de `captureAdmission` ausente se informa como `conflict` (GLM c1-3, DeepSeek c1-1b/5) | **Aceptado como existente:** comportamiento anterior a este cambio, falla cerrado. |
| `json()` con `null` o arrays (DeepSeek c3-4) | **Refutado:** `json()` ya rechaza todo lo que no sea objeto con 400. |
| Regex de hash del cliente distinta del servidor (DeepSeek c3-5) | **Refutado:** `$` en JavaScript sin banderas no admite salto de línea final; ambos rechazan. |

Clasificación honesta: 5 FALLA y 1 PASS, con dos hallazgos reales de endurecimiento y uno trasladado a la etapa 2. No es un PASS limpio: la ronda siguiente se hará sobre el código final.

### Segunda ronda sobre el código, con las comprobaciones previas a la vista · [prompt 4](prompt-c4.txt) · [prompt 5](prompt-c5.txt)

Resultados: [c4 GLM FALLA](reply-c4-glm.txt) · [c4 DeepSeek FALLA](reply-c4-deepseek.txt) · [c5 GLM FALLA](reply-c5-glm.txt) · [c5 DeepSeek FALLA](reply-c5-deepseek.txt). El extracto 5 volvió a no incluir `settlementOptions`, así que sus hallazgos ALTA sobre K sin validar (GLM 2, DeepSeek 1) y sobre `resolution` en una captura (GLM 1, DeepSeek 3) **se refutan igual que en la ronda 1**: están validados antes de la transacción y probados.

| Hallazgo | Decisión |
| --- | --- |
| La corrupción de `captureAdmission` ausente o discordante se informa como `conflict` (DeepSeek c4-1/2, GLM c4-2) | **Adoptado:** ahora es `invariant` cuando la admisión almacenada y la de captura no coinciden (prueba nueva). |
| Una reserva capturada con `releaseAdmission` o `resolution` sueltas se acepta como replay (DeepSeek c4-3) | **Adoptado:** `invariant` (prueba nueva). |
| Opciones con propiedades accesoras (DeepSeek c4-4) | **Adoptado:** solo propiedades de datos. |
| Saldo negativo no comprobado (DeepSeek c5-1) | **Adoptado como defensa en profundidad:** `reserved`, `available` y `consumed` no negativos antes de escribir. No es alcanzable por construcción (K < N); no hay prueba directa. |
| Documentos huérfanos en `providerCalls` sin barrera `first` (GLM c4-1) | **Aceptado como límite:** la barrera y la llamada se crean en la misma transacción. |
| `{resolution:undefined}` en una captura (GLM c4-3) | **Aceptado:** `undefined` equivale a ausente. |
| `too_early` solo bajo admisión almacenada (DeepSeek c5-2) | **Refutado por diseño**, como en la ronda 1. |

Clasificación honesta: todas las respuestas de la segunda ronda son FALLA, pero ningún hallazgo restante muestra un camino que cobre de más, libere de más o permita dos resoluciones; lo adoptado es endurecimiento. No se pidió una tercera ronda: la verificación que sostiene esta etapa es la combinación de pruebas, mutaciones y regresión, no un PASS de T3.
