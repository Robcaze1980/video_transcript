# 1.4d · Porte de cinco pruebas al desbloqueo vigente · 27 nov 2026

Commits locales: `4bd7db8` (porte), `c044257` (refuerzo de una prueba por la sugerencia de GLM).

| Comprobación | Resultado |
| --- | --- |
| Cinco pruebas portadas en código intacto | 5/5, limpieza 5/5 (`port-new5.head.txt`) |
| Suite completa del desbloqueo | 96/96, limpieza 104/104, producción sin cambios (`main-full-96.*`) |
| Regresión financiera completa sobre `c044257` | PASS: 564 pruebas, 559 aprobadas, 0 fallos, 5 omisiones previstas de voz (incluye las cinco portadas) |
| Cuenta protegida y lanzador aislado sobre `c044257` | PASS |
| GLM (un solo revisor, por ser solo pruebas) | PASS; su sugerencia de comprobar que el intento rechazado no escribe se aplicó; la de comprobar «ningún recibo» tras reabrir la alerta era incorrecta: tras reabrirla el sistema sí lee el recibo y rechaza el reenvío |

## Mutación (`mutate_ported*.log`, `mut-port-*.head.txt`)

| Rotura | Resultado |
| --- | --- |
| Reanudación sin comprobar que la alerta siga abierta | detectada (tras reescribir la prueba; la versión original sobrevivía porque ya no ejercía la reanudación) |
| Repetición parcial sin comprobar la alerta | detectada |
| Fase final sin comprobar la alerta | detectada |
| Fase 0 sin estado de alerta / sin cuenta de la guarda | detectadas |
| Fase final sin `sameGuard`, sin su condición de bloqueo, sin su condición exclusiva, o sin `sameGuard` ni el candado de versión | **sobreviven**: defensa en profundidad; la prueba fija el resultado observable |

Intentos y desvíos conservados: el resultado de la primera versión de la prueba de reanudación (el mutante SOBREVIVE) está en `mutate_ported.log`; el de la versión reescrita (MATADO) en `mutate_ported2.log`.
