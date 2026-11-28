# LV-019.B · Integración de la línea del cerco con la línea principal · 27 nov 2026

Rama de integración: `codex/vistavo-saldo-integracion-20261127` (local, sin publicar). Une `codex/vistavo-continue-20261127` (con sus pruebas de endurecimiento, commit `ee35189`) con `lv019b/t3-saldo-cuenta-guarda-20261127` (certificada: [certificación](../lv019-b-t3-saldo-cierre-20261127/CERTIFICACION-codex.md)).

## Resultado de la fusión

- Solo dos archivos cambiaron en ambas líneas: `billingUnblock.ts` y `billingUnblock.emulator.mjs`. El resto se fusionó sin conflicto.
- `billingUnblock.ts`: el único choque era un comentario sobre dos comprobaciones de relación de fase 3 con la misma lógica en ambas líneas. El archivo integrado es **idéntico, blob por blob, al certificado**; todo el código de producción de la línea principal ya estaba contenido en el del cerco.
- `billingUnblock.emulator.mjs`: se adoptó el de la línea del cerco (91 pruebas), también idéntico al certificado. La suite de 61 pruebas de la línea principal se archivó en `docs/history/lv019-b-unblock-suite-contrato-previo-20261127/`.

## Comprobaciones sobre el árbol integrado

| Comprobación | Resultado |
| --- | --- |
| `tsc --noEmit` | exit 0 |
| Suite vigente del desbloqueo, emulador 8198 | 91/91, limpieza 99/99 (`suite-cerco-sobre-union.*`) |
| Suite previa (61 pruebas) contra el código integrado | falla en bloque por el cambio de contrato (`suite-previa-sobre-union.*`); conservada como evidencia |
| Regresiones oficiales sobre el árbol integrado | ver el estado en el backlog y la bitácora |

## Revisión por T3 de la decisión de integrar (código que mueve saldo: dos revisores)

Paquete de 49 KB sin herramientas (`review-integracion.in.txt`): GLM `~z-ai/glm-flash-latest` y DeepSeek `deepseek/deepseek-v4.1-flash`, ambos **PASS**, con el mismo criterio: fusionar el código ya es seguro (producción idéntica a la certificada), pero **no archivar ni borrar la suite previa** hasta portar sus casos únicos. Coincidencia sobre las pruebas de fase 0 (alerta de otra generación o guarda de otra cuenta) como prioridad alta. Los escenarios de defecto que describen son hipótesis de cobertura, no errores demostrados. El modelo servido y el costo por hilo no son observables en este canal.

## Decisión de proceso del dueño (27 nov 2026, tarde)

Rob señaló que T3 daba muchos problemas para escribir código y propuso avanzar directo con OpenRouter; confirmó que se use la clave ya vinculada al proyecto, sin cambiar el presupuesto. Después pidió revisar con T3 esta integración. Las revisiones estáticas por T3 funcionaron; los hilos de autor de código fueron los problemáticos.

## Actualización posterior (27 nov, noche)

La rama de integración `codex/vistavo-saldo-integracion-20261127` se adelantó por avance rápido a `codex/vistavo-continue-20261127`; ambas apuntan a la misma revisión de integración. La suite vigente pasó de 91 a **96 pruebas** con la tarea 1.4d ([porte](verificacion-1-4d/README.md)); la regresión financiera completa sobre `c044257` dio 564 pruebas (559 aprobadas, 0 fallos, 5 omisiones de voz). La rama se publicó en GitHub el 27 nov.
