# Continuidad de Vistavo · 26 nov 2026

Repositorio `Robcaze1980/video_transcript`. Este corte se preparó en `vistavo-checkpoint-20261125`, rama `codex/vistavo-checkpoint-20261125`, sobre la base `255aa5e`. Desde otra PC, abre el commit que incorpore este corte y comprueba la rama y la revisión antes de continuar. La base sola precede los cambios de este corte.

Empieza por [MASTERPLAN](MASTERPLAN.md), [backlog](backlog.md) y [gantt](gantt.md). El [recibo del corte](docs/evidence/lv019-b-checkpoint-20261126/README.md) identifica las instantáneas probadas, los informes disponibles en `docs/reviews/` y las rutas de evidencia local. Git ignora `outputs/`; esos registros no viajan al clonar. [HANDOFF anterior archivado íntegro · histórico](docs/history/HANDOFF-before-checkpoint-2026-11-26.md).

## Estado para retomar

| Frente | Estado al corte |
| --- | --- |
| LV-019.B · Bloqueo y devolución 1.4b.3 | En curso. Las pruebas focales dieron **10/10** en una candidata anterior. La regresión financiera de otra instantánea anterior registró **482 aprobadas, 6 fallos y 5 omisiones previstas de voz**. Los seis casos adaptados pasaron en el foco de la candidata combinada. GLM y DeepSeek devolvieron **INCONCLUYENTE** sobre la candidata focal. |
| Diagnósticos de bloqueo | La alerta neutral para sondeo corrupto, reloj, limpieza y contador agotado pasó **6/6** focales en emulador. La batería completa en curso empezó antes del último ajuste; falta la regresión del corte final y su revisión externa. D2 conserva **7/9** en el diagnóstico completo; su fase escritora aislada pasó **4/4** y está respaldada en `codex/vistavo-d2-fence-receipt-20261126` (`f78ef98`). El lector y la continuidad siguen abiertos. [Auditoría](docs/reviews/LV-019-B-sondeo-alerta-auditoria-local-20261126.md). |
| Admisión después de vencer una devolución | La guardia para detener nuevos videos del dueño identificado sigue sin implementar. El [borrador](docs/specs/LV-019-B-admision-video-devolucion-vencida.md) conserva el trabajo ya admitido y permite resolver la devolución y reparar el bloqueo. |
| Voz C1 | La candidata integra localmente saldo y voz, con **618/618** unitarias de integración y **96/96** focales independientes. La variante anterior pasó **72/72** en emulador y el ajuste de ACK tardío **2/2** focales. Falta ejecutar **74** en el conjunto, la regresión final de saldo y las dos revisiones. Respaldos anteriores: `codex/vistavo-voice-c1-a2-20261126` (`3c081ad`) y `codex/vistavo-c1-marker-attribution-20261126` (`fed814e`). [Integración](docs/evidence/lv019-b-finance-voice-integration-20261126/README.md). |
| Voz C2 | La preparación y el puente en memoria están respaldados en `codex/vistavo-voice-c2-20261126` (`c893932`) y `codex/vistavo-voice-c2-bridge-20261126` (`238e7d9`). La unidad corregida pasó **36/36** y el seguimiento de GLM y DeepSeek dio PASS limitado a esa pieza. Sus observaciones, el adaptador persistente, el proveedor y el audio siguen pendientes. [Contraste](docs/reviews/LV-019-B-voz-c2-memoria-adjudicacion-20261126.md). |
| Vista previa de precio | Prototipo local **6/6**, con recorrido en Chromium simulado. El teléfono físico sigue pendiente, al igual que la revisión de Gemini prevista para 1.7. |
| A0 · Lectura de producción | Ejecutada con alcance parcial. Devolvió 14 permisos para la identidad de lectura. Cloud Quotas devolvió 403 y Monitoring registró 0 canales, políticas y métricas basadas en registros. Files y Maintenance tienen ingreso interno. Account tiene ingreso `ALL` e invocación pública en Cloud Run. [Alcance y límites](docs/reviews/LV-019-B-a0-readback-20261126.md). |

## Siguiente paso

Al retomar, ejecuta la suite C1 de 74 casos sobre la combinación y contrasta la corrección financiera con sus revisores. Ejecuta la regresión financiera completa sobre el corte integrado final. D2 y la guardia de admisión siguen pendientes. C2 necesita un adaptador con evidencia durable antes de Account real y del proveedor. Las pruebas en iPhone y Android físicos y el gateway siguen pendientes; no habilitar video ni voz antes de sus puertas.

Este corte es un respaldo WIP sin certificar. GLM dio un PASS documental acotado al seguimiento del plan y se añadió G0 a A4. El FALLA documental anterior permanece en el [recibo](docs/evidence/lv019-b-checkpoint-20261126/README.md#lectura-a0-y-revisión-del-plan). El corte no publicó a clientes ni desplegó cambios. Sigue vigente [G0](docs/specs/LV-019-B-plan-integral-20261120.md). Video y voz siguen cerrados a clientes. No crear Cloud SQL.
