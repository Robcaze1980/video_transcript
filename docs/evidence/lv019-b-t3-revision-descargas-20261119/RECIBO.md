# Recibo T3 · revisión estructurada y descargas · 2026-11-19

Pregunta aprobada por Rob (resumen agregado, sin UID/claves/rutas, en `prompt.txt`): ¿qué casos podrían servir texto viejo, texto de otro usuario o saltarse la revalidación de acceso? Criterio observable. Máx. 140 palabras.

Vía: T3 local (`t3 serve`, instancia `linguistvision-openrouter`). Modelos pedidos: `~z-ai/glm-flash-latest` y `deepseek/deepseek-v4.1-flash`. Modelo efectivamente servido, tokens y costo: no observables en la salida. Respuestas íntegras: `reply-glm.txt`, `reply-deepseek.txt`. Ambos: PASS (opinión sobre un resumen; no prueba código).

## Casos de T3 → prueba (fixture `firestoreReviewedTranslationHttp.emulator.mjs`, 10/10 en emulador)
| Caso T3 | Prueba | Resultado |
|---|---|---|
| Caché/ETag o respuesta sin `no-store`; revisión previa servida | `verified owner edits… downloads matching reviewed TXT and SRT` (ya existía: `no-store`, `nosniff`, `x-vistavo-revision`) | cubierto |
| Huella/solicitud reutilizada devuelve revisión anterior; descarga de N tras existir N+1 | **nueva** `every saved revision downloads its own exact text…`: rev. 2 devuelve exactamente su texto tras guardar la 3 | pasa |
| Fallback silencioso al original o a otra revisión (id ausente/inexistente) | misma prueba nueva: revisión 1 (original) y 9 → 404/409 sin contenido | pasa |
| IDOR: propiedad no ligada a revisión/trabajo; IDs mezclados | **nueva** `review identifiers cannot be mixed…`: otro `inputId`/`jobId` con token del dueño → sin contenido, sin lecturas de GCS ni cambios | pasa |
| Usuario sin acceso / autorización no revalidada / cuenta suspendida | **nueva** (sesión anterior) `a verified user without access…` + ya existentes `another account…` e `identity removed/reassigned/uid_changed after routing` | pasan |
| Token caducado o revocado | ya existente `invalid or unverified tokens…`; el fixture exige `checkRevoked=true` | cubierto |
| Carrera guardar↔descargar leyendo estado intermedio | no se añadió prueba nueva: la revisión es inmutable por número y la carrera de descarga en vuelo ya tuvo prueba y T3 acotado (2026-11-17) | solo anotado |

## Se adopta
- Los 3 criterios observables (403/404 sin texto con token ajeno; descarga de la revisión N exacta tras existir N+1 con `no-store`; autorización retirada → denegación) están ahora como pruebas.
- Conexión solo en el entorno candidato: servicio registrado en `cloudCandidateLocal.ts` y interruptor de interfaz activo solo con `npm run build:candidate` (`--mode candidate`). El valor por defecto y `npm run build` siguen en `false`.

## No se adopta / queda anotado
- Ninguna de las respuestas exige cambios de código: las pruebas nuevas pasaron sin tocar el servicio. Son opiniones de modelos sobre un resumen, no revisión del código.
- 401 vs 403/404 exactos y el estado `503 disabled` para cuentas sin piloto: la prueba acepta 403/404/503 sin contenido (diferenciar el motivo no filtra texto).
- Carrera guardar↔descargar, audio en vuelo, retención/borrado, autenticación real y dispositivos físicos: siguen pendientes (ver spec LV-019-B-video-text).
