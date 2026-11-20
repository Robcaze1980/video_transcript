# Recibo T3 · diseño del endpoint de operador de la pieza D · 2026-11-19

Pregunta (resumen agregado sin datos privados, `prompt.txt`): riesgos y huecos de autenticación, autorización, enumeración, abuso, registro y fallo cerrado; prueba adicional; criterio observable. Vía: T3 local (instancia `linguistvision-openrouter`), servidor cerrado al terminar. Modelos pedidos: `~z-ai/glm-flash-latest` y `deepseek/deepseek-v4.1-flash`; modelo servido, tokens y costo no observables. Respuestas íntegras: `reply-glm.txt` (**FALLA**) y `reply-deepseek.txt` (**PASS**). Opinión sobre un diseño; no vieron código ni probaron nada.

## Se adopta (reflejado en `docs/specs/LV-019-B-conciliacion-endpoint-d-diseno.md`)
| Sugerencia | Origen |
|---|---|
| Tabla exacta condición → código, con `429` y sin filtrar estado a quien no es operador | GLM, DeepSeek |
| Autor derivado con **HMAC y secreto del servidor** (un hash simple de un UID conocido es verificable); secreto ausente = 404; la rotación exige un procedimiento aparte | DeepSeek |
| Comparación de `auth_time` definida (presente, no futuro, dentro de la ventana); `401 reauth_required` solo para operadores verificados; token sin `auth_time` falla cerrado | ambos |
| GET también falla cerrado con la lista vacía; 404 uniforme para alerta inexistente y para no operadores | ambos |
| Clave del límite de frecuencia = operador verificado (no IP ni token) | DeepSeek |
| Registro de acceso también para denegaciones; sin `evidenceRef` ni `note` en el registro; nada sin validar se escribe tal cual | DeepSeek, GLM |
| Contrato de formato del contenido, `Content-Type` JSON obligatorio, sin credenciales en la consulta | ambos |
| Pruebas: mismo operador con carga distinta = 409; idénticos concurrentes = un 201 y el resto 200; metacaracteres en `alertKey`; cero mutaciones en toda rama negativa; una prueba por fila de la tabla | GLM, DeepSeek |
| Criterio de cierre: tabla completa validada, cero mutaciones en ramas negativas, una disposición por alerta y acción bajo concurrencia, registros sin secretos | ambos |

## No se adopta / queda anotado
- **422 para el contenido inválido** (GLM): el servicio ya usa `400 invalid`; `422` queda solo para una alerta almacenada corrupta.
- **Números** (ventana de `auth_time`, topes de frecuencia): ninguna respuesta aportó evidencia; siguen como configuración obligatoria o valores existentes, nunca inventados.
- Ambos revisores opinaron sin ver código: son hipótesis que la implementación debe convertir en pruebas.
