# Recibo · Plan eficiente de bajo costo · 21 nov 2026

Documento: [plan](../../plans/LV-019-B-plan-eficiente-bajo-costo-20261121.md). Lo redactó **T3** (DeepSeek, solo lectura, ≈20 lecturas, sin abrir los archivos grandes) a pedido del dueño; una **revisión independiente** de T3 con `~z-ai/glm-flash-latest` (`review-plan-glm.txt`) respondió **FALLA**; Codex contrastó y reescribió los puntos afectados (v2). Es un plan: no cambia código, nube ni saldo, y **no autoriza gasto**.

| # | Origen | Hallazgo | Adjudicación de Codex |
|---|---|---|---|
| 1 | Codex | El borrador dice que **T3 sigue detenido por falta de crédito**; ya volvió el 21 nov tras una recarga de ≈US$10 | **Corregido** (≈US$9 de saldo, unas 9 horas con dos hilos) |
| 2 | Codex (contra T3 y GLM) | Difiere **1.3b** (ACK durable del solicitante) porque el despliegue «usa la reserva interna»; GLM lo da por correcto | **Rechazado:** la reserva de saldo real pasa por la ruta externa Video→Cuenta, que sigue **cerrada** hasta que el ensayo llegue a 13/13 (seis ventanas rojas en la ruta del solicitante); sin 1.3b una cuenta de verificación no reserva saldo real. 1.3b vuelve al camino crítico |
| 3 | GLM MEDIA y Codex | Contradicción sobre **3.5**: el plan lo difiere pero el diseño 1.4 exige la herramienta de operador para el desbloqueo auditado; operar «a mano» no cumple el protocolo | **Adoptado:** se conserva un **operador mínimo**; diferirlo es decisión del dueño (§E.8), no recomendada |
| 4 | GLM MEDIA y Codex | Los ahorros de **L2** (tope de hilos) y **L6** (regresión focalizada) mezclan dinero y reloj: correr hilos en paralelo y correr pruebas en local **no cuesta tokens**; el coste crece con las **horas de hilo activo** | **Adoptado y medido:** US$0,53 en 31 min con dos hilos (≈US$0,5 por hora de hilo). L2 pasa a ahorro ≈0 % (coordinación); **L6 se rechaza** (la regresión completa tarda ≈8 min, es gratis en dinero y detecta antes; la regla 3 se mantiene) |
| 5 | GLM BAJA | Las cifras de ahorro (55–65 %) dependen de decisiones pendientes del dueño (reglas 3 y 4) | **Adoptado:** dos escenarios, ≈35–50 % con la regla 4 refinada y ≈25–35 % sin ella; coste total ≈US$90–160 (con) o ≈US$120–220 (sin) |
| 6 | GLM BAJA | La tasa horaria implícita no estaba declarada | **Adoptado:** base declarada y regla de medir el gasto real por paso (diferencia de `usage`) y registrarlo en la bitácora |

## Verdicto de Codex

**Aceptado como v2 para presentar al dueño.** Las cifras de dinero son estimaciones con ±50 %; se corregirán con la medición por paso. Lo que ahorra de verdad es **dejar de rehacer y de releer** (menos horas de hilo), no aflojar el dinero.
