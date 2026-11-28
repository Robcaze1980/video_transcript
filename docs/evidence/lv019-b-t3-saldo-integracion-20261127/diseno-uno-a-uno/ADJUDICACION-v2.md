# Adjudicación de la segunda ronda de revisión doble · diseño «incidentes uno a uno» v2 · 27 nov 2026

[Paquete](ronda2-paquete-v2.txt) · [GLM](ronda2-glm.txt) · [DeepSeek](ronda2-deepseek.txt). Resultados: GLM **FALLA**, DeepSeek **INCONCLUYENTE**. Ambos confirman los hechos 1 a 3 y 6 y la mayor parte de los demás, y reconocen que v2 cerró los huecos centrales de v1 (direccionamiento por filas, alerta mixta, ruta Cuenta primero). Piden fijar por escrito detalles que v2 dejaba implícitos y no pudieron comprobar lo que el paquete no mostraba (el barrido de alertas, `recheck` completo, `nextGuardReview`).

| Hallazgo | Decisión |
| --- | --- |
| DeepSeek a y GLM: una clave presente en las dos colecciones de incidentes haría ambiguo el tipo | **Aceptado; v3 §2.1 y P17**: `conflict` sin llamar a Cuenta. |
| DeepSeek b: la fórmula de alerta debe validar el identificador como el informe | **Aceptado; v3 §2.4 y P23**: una sola función exportada por el informe, usada por los dos. |
| DeepSeek c: si se «corrige» también la fase final, desbloquear el último incidente con otro abierto borraría la guarda | **Aceptado; v3 §2.3 y P19**: la fase final no cambia y queda fijada por una prueba. |
| DeepSeek d: el localizador de hold no contrasta la época con el incidente | **Parcialmente aceptado; v3 §2.2 y P18**: exactamente un hold, con el tipo del incidente y el `createdAtMs` de la guarda; un hold de un ciclo anterior queda fuera. El `epoch` del hold es por diseño el de su propio incidente. |
| DeepSeek e: los identificadores de solicitud, hecho y envío deben ser por incidente | **Verificado en el código**: `requestedRef`, `doneRef`, `releasedRef`, el testigo y el envío salen de `unblockAuditId(incidente, acción, epoch, createdAtMs)` (`billingUnblock.ts:486-490`), así que no colisionan entre incidentes; P1 y P2 lo afirman. |
| DeepSeek f y GLM: ruta Cuenta primero y Cuenta sin guarda con un incidente de Video en espera | **Cubierto por P11, P15, P16 y P21**. |
| GLM: orden de recibo, adopción y decisión en una repetición parcial | **Aceptado; v3 §2.1 y P20**: primero los registros y el recibo; la comprobación de incidente abierto solo a solicitudes nuevas o reanudadas. |
| GLM: relación exacta de cada fila con su incidente | **Se conserva la lógica vigente de `incidentOf`** (sus conjuntos `owned` y `planned`); la implementación solo cambia cómo se localiza el incidente. P22 cubre la deriva de relación. |
| GLM y DeepSeek: no pudieron ver el barrido, `recheck` completo ni `nextGuardReview` | **Limitación del paquete**; la revisión de la implementación recibirá el código completo de esos fragmentos. |
| Ambos: faltan pruebas negativas | **Incorporadas**: P17 a P24. |

Decisión de Codex: se acepta v3 como base de implementación con pruebas primero. Más rondas de diseño sobre fragmentos darían rendimientos decrecientes; la evidencia siguiente es el código y las pruebas, con revisión doble sobre el código completo, mutaciones y la regresión financiera completa.
