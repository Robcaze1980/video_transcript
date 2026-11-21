# Recibo T3 · protocolo de escucha nativa (voz en inglés y español) · 20 nov 2026

Alcance: [protocolo y rúbrica](../../specs/LV-019-B-voz-escucha-nativa-en-es.md) (documento; no se generó ni escuchó ningún audio). [Prompt](prompt-a.txt) · [GLM FALLA](reply-a-glm.txt) · [DeepSeek FALLA](reply-a-deepseek.txt). Modelos pedidos `~z-ai/glm-flash-latest` y `deepseek/deepseek-v4.1-flash`; el servido no es observable.

| Hallazgo | Decisión |
| --- | --- |
| La escucha no es ciega: el dueño conoce el texto (GLM 1, DeepSeek 5) | **Adoptado:** prueba mecánica de fidelidad (transcripción automática contra el guion, cifras exactas, ≤ 3 % de palabras) y, cuando exista, un oyente que transcribe sin guion; el límite de una sola persona queda declarado. |
| No se prueba el no determinismo (GLM 2, DeepSeek 2) | **Adoptado:** cada guion se genera dos veces por voz y se mide estabilidad. |
| Falta texto largo y fragmentación (GLM 3, DeepSeek 1/3) | **Adoptado:** dos guiones de 60–90 s y uno de unos 3 minutos. |
| El acta sin audio impide reauditar (GLM 4, DeepSeek 7) | **Adoptado:** audios aprobados en almacenamiento privado fuera del repositorio con transcripción, modelo, versión y parámetros (contenido sintético). |
| Reevaluar todo lo afectado; presupuesto agotado = no aprobado; filtro mínimo declarado; formato final (GLM 5, 6, 7) | **Adoptado.** |
| Umbrales y muestra arbitrarios (DeepSeek 1) | **Adoptado en parte:** se declaran como criterio de partida ajustable con registro del cambio y se fijan antes de escuchar; no se invente una validación estadística con 12 muestras. |
| «Falla crítica corregible» ambigua (DeepSeek 4); control negativo y pre-registro (DeepSeek) | **Adoptado:** lista cerrada, anotación de instante y causa, guion con error conocido y criterios congelados antes de escuchar. |
| Respaldo con una sola voz (DeepSeek 6) | **Adoptado como límite y plan de sustitución;** no se exigen dos voces para abrir. |
| Prueba a 1,25× y con ruido (DeepSeek 7) | **No adoptado ahora** (baja prioridad); sí altavoz del teléfono y formato final. |

Clasificación: dos FALLA con mejoras reales ya incorporadas; el protocolo no valida nada hasta que se escuche. No se pidió segunda ronda.
