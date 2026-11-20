# Recibo T3 · código del endpoint de operador (pieza D) · 2026-11-19

Código revisado: `server/commercial/billingOperatorHttp.ts`. Vía: T3 local (instancia `linguistvision-openrouter`). Modelos pedidos: `~z-ai/glm-flash-latest` y `deepseek/deepseek-v4.1-flash`; modelo servido, tokens y costo no observables. El código se envió en dos partes cortas (A: configuración, identidad, ventana; B: lecturas, escritura y errores) porque los prompts largos se truncan. Se conservan todas las respuestas, también las FALLA y las inválidas.

## Ronda 1 (`prompt-a.txt`, `prompt-b.txt`): cuatro respuestas, todas **FALLA**
Hallazgos reales, ya corregidos con pruebas: `enabled` no exigía verificador, reloj ni registro; un reloj `NaN` dejaba pasar la comprobación de reautenticación (bypass real); la lista no tenía cursor y `truncated` era falso positivo con una página exacta; cualquier error no mapeado se presentaba como 409; el tipo de contenido distinguía mayúsculas.
No adoptado, con razón: limitador antes de verificar identidad (la política es por operador verificado; el límite general del servicio es previo); que 401 frente a 404 revele que el endpoint está encendido (no se considera sensible, queda anotado en el código); tolerancia al desfase de reloj (sería un número arbitrario y falla cerrada); registro de sondeos de no operadores (es el registro del servidor, no la respuesta); la validación de la clave (la hace el enrutado con una expresión hexadecimal exacta antes de cualquier uso) y el `cast` de la acción (la ruta solo llega con `acknowledge`/`resolve`).

## Ronda 2
| Parte | GLM | DeepSeek |
|---|---|---|
| B (lecturas, escritura, errores) | **PASS** | **PASS** |
| A, primer envío (`prompt-2a.txt`) | **INVÁLIDA**: mi comando detuvo el servidor T3 mientras respondía (`reply-2a-glm.INVALID-…txt`) | **INVÁLIDA**: mi `grep` omitió por error dos líneas del fragmento y el revisor «encontró» una variable sin asignar (`reply-2a-deepseek.INVALID-…txt`) |
| A, reenvío completo (`prompt-2a-v2.txt`) | **INCONCLUYENTE**: sin respuesta (tiempo agotado) | **FALLA**, dos hallazgos que **no se confirman** (ver abajo) |

Contraste de Codex sobre esos dos hallazgos de DeepSeek: «`route` nunca se asigna» y «`nowMs` se evalúa antes del guard de `enabled`». Lo primero es falso: las rutas de lista, detalle y escritura funcionan (24 pruebas y el chequeo de emulador con servidor HTTP real). Lo segundo también: `enabled` exige `typeof config.now==='function'`, y hay pruebas de «sin función de reloj», «reloj inválido» y «reloj que lanza», todas con 404. Del mismo envío se adoptó lo útil: un reloj que lanza se trata como reloj inválido. No se adopta el esquema `Bearer` insensible a mayúsculas (el servicio ya lo exige tal cual en sus rutas internas).

**Estado honesto:** la parte A **no tiene un PASS limpio** de ningún revisor; sus FALLA restantes están refutadas con pruebas, no aceptadas por revisión. La parte B tiene PASS de ambos.

## Contraste de Codex
- 24 pruebas nuevas del endpoint con un servidor HTTP real en proceso y Firestore simulado; suite completa: 96 archivos, **1204 aprobadas, 113 omitidas**; tipos sin errores.
- Mutaciones que hacen fallar pruebas: sin comprobación de origen, 403 para no operadores, sin reautenticación (incluidos `NaN` y fraccionario), autor aceptado en el cuerpo, token o cuerpo en el registro, sin limitador, autor sin clave del servidor, siempre habilitado, reloj `NaN`, cursor ignorado, `truncated` desfasado y verificador no exigido.
- `scripts/checkBillingOperatorHttpEmulator.mjs`: servidor HTTP real contra un emulador propio de Firestore (verificador falso, sin credenciales, datos sintéticos, limpieza verificada): cuatro llamadas concurrentes dan exactamente un 201 (más un 200 de repetición y dos 409); las ramas negativas no escriben; páginas de 200 con cursor exacto, sin duplicados ni huecos (205 alertas abiertas); filas y saldos intactos; respuestas y registro sin identidades ni secretos.
- Límites: **nada importa este módulo fuera de sus pruebas y su chequeo**; no hay ruta cableada, ni configuración real, ni verificador de Firebase real probado, ni límite de frecuencia real (se inyecta).
