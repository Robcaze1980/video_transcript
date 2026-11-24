# Recibo · paso 3.1 (A0, lectura previa de nube): T3 programa, Codex certifica · 20 nov 2026

Alcance: `scripts/a0CloudReadback.mjs` y `scripts/a0CloudReadback.test.ts`. Lectura previa de **solo lectura** de metadatos de `vistavo-prod` para saber si se podrán aplicar el índice `billingHoldOutbox`, el canal y la política de alertas, un servicio de operador nuevo y una revisión nueva del mantenimiento. **No se ejecutó contra la nube**: falta la autorización expresa del dueño.

## Cómo se trabajó
- **Codificación (T3, DeepSeek en un worktree propio, sin red ni commits):** [encargo](brief-a0.txt) y [informe final de T3](t3-informe-codificacion-a0.txt). Pruebas primero; el propio T3 pasó mutaciones sobre cada garantía.
- **Revisión independiente (T3, dos modelos, solo lectura):** [encargo](review-a0.txt) · [GLM PASS](review-a0-glm.txt) · [DeepSeek FALLA](review-a0-deepseek.txt). Hallazgos adoptados: el diario se escribe también ante error, la ruta del diario exige `.json`, un nombre de servicio inseguro no aborta toda la lectura, host y ruta del Scheduler se redactan, `failure()` solo copia estados conocidos, se rechaza cualquier puerto, el texto `notRead` ya no afirma una sección de Firestore que no existe y se añadieron pruebas de 500, forma inesperada y paginación interrumpida.
- **Defecto hallado por Codex en la certificación:** el POST de `testIamPermissions` iba sin `Content-Type: application/json` (las APIs de Google podrían rechazarlo y dejar ilegible justo la sección más importante). T3 lo corrigió con pruebas que fallaban primero (12 rojas) y mutaciones.

## Verificación de Codex (independiente)
- `npx vitest run scripts/a0CloudReadback.test.ts`: **38 aprobadas**; `npx tsc --noEmit`: sin errores; sin argumento el script responde `usage` sin pedir credenciales ni tocar la red.
- **Prueba adversarial propia** ([script](../../../scripts/a0CloudReadback.test.ts) no la incluye; se ejecutó aparte): 18 URL hostiles rechazadas (proyecto con sufijo, `..`, `%2e%2e`, `%2F`, puerto, `http`, host ajeno, credenciales, fragmento, consulta no permitida o duplicada, `pageSize` negativo, carácter de control, `\@`, punto final, subdominio engañoso, doble barra, tabulador), 3 aceptadas correctamente (incluido un `pageToken` en base64), contrato de métodos correcto (solo el POST fijo; PUT, DELETE, PATCH, GET con cuerpo, POST con otro cuerpo, otra ruta, con consulta y en minúsculas rechazados) y redacción correcta de correos y miembros.

## Certificación y límites
**Codex certifica el script como listo para ejecutarse tras la autorización del dueño.** Límites honestos: (1) no se ha ejecutado contra la nube, así que no se sabe si el ámbito de solo lectura admite el POST de permisos (si no, esa sección quedará ilegible, sin daño); (2) una lectura vacía no prueba capacidad y las bases vacías no validan la conciliación; (3) no lee la política IAM del proyecto, VPC, costos ni Secret Manager; (4) la cuota de cuentas de servicio es un límite, no un margen disponible.
