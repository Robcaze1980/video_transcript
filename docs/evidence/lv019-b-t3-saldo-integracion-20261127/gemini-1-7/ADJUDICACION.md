# 1.7 · Revisión Gemini mínima del desbloqueo · 27 nov 2026

Rob aprobó la revisión Gemini del paso 1.7 con **entrada y salida mínimas de tokens**. Se envió un paquete cerrado, sin herramientas ni lectura del repositorio ([brief.txt](brief.txt), unos 8 mil tokens estimados): el código de bloqueo y desbloqueo de Cuenta y las fases 0 a 3 del desbloqueo de Video sobre `355fe35`. Modelo `google/gemini-4-hydrogen` (sincrónico; el plan nombraba `:batch`, que no se usó porque un envío único no se puede repetir con seguridad si tarda). Clave ya vinculada a LinguistVision (huella verificada por el script), sin cambiar presupuesto. [Script usado](reviewGeminiOnce.mjs).

| Intento | Parámetros | Resultado | Tokens (entrada / salida) | Costo |
| --- | --- | --- | --- | --- |
| 1 | salida limitada a 1800 | **INCONCLUYENTE sin informe**: `finish_reason=length`; el modelo gastó todo el tope razonando y no devolvió texto visible | 9 906 / 1 800 | US$0.0281 |
| 2 | salida limitada a 3500, razonamiento bajo | **COMPLETADO**; veredicto del revisor **INCONCLUYENTE** | 9 906 / 2 951 | US$0.0366 |

Costo real total: **US$0.0647**. El segundo envío fue una decisión deliberada tras un fallo conocido (respuesta vacía por el tope), con parámetros distintos y otro hash de solicitud; el primer intento se conserva ([intento1](intento1/receipt.json), [intento2](intento2/report.txt)).

## Adjudicación de los hallazgos contra el código

| # | Hallazgo de Gemini | Decisión de Codex |
| --- | --- | --- |
| 1 | Hipótesis: una incidencia nueva en Cuenta entre la última lectura y el borrado de la guarda podría dejar Video abierto | **Ya conocido y cubierto en el alcance declarado.** La guarda de Cuenta se lee dentro de la transacción final (`localAccountBlocked`) y 96 pruebas deterministas lo ejercitan; no se midió concurrencia real ni cubre la ruta legacy sin `successor` (límite 1.4c). |
| 2 | Mejora: `recheck` relee los mismos ocho documentos en la fase 2 y otra vez en la transacción final | **Aceptada como mejora futura de rendimiento, no defecto.** Son transacciones distintas por diseño: la final es la comprobación atómica previa a escribir. |
| 3 | Mejora: la transacción final es larga (varias lecturas antes de escribir) | **Aceptada como observación.** El desbloqueo es una operación rara de operador, no una ruta caliente; no se cambia sin una medición. |
| 4 | Hipótesis: `cutRef` y `guardRef` como puntos calientes | **Descartada como riesgo actual.** `cutRef` solo se lee en el desbloqueo y solo se escribe al preparar el corte; las lecturas concurrentes no se bloquean entre sí. |

Conteo de operaciones por desbloqueo completo, contrastado con `server/account/backend.ts:303-333`: Cuenta 5 lecturas y 3 escrituras; Video, fases 0, 2 y 3 con los grupos de lectura indicados en el informe. Lo que no verificó (`accountRows`, `resolveAccountGuard`, `readAccountGuard`, la ruta legacy) quedó fuera del paquete mínimo a propósito.

## Dictamen

**INCONCLUYENTE, sin defecto demostrado**: Gemini no observó doble movimiento de saldo ni escritura en la cuenta equivocada en lo que vio, pero declara que faltaban definiciones para cerrar la verificación; es la consecuencia directa del paquete mínimo pedido por Rob. No cuenta como PASS. La auditoría completa de arquitectura, rendimiento y costo ([encargo](../../lv019-b-gemini-arquitectura-20261122/encargo.txt)) sigue preparada y **sin lanzar**; hace falta una decisión de Rob sobre su costo antes de ejecutarla.
