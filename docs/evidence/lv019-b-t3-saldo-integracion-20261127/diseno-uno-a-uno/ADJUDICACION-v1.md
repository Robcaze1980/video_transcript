# Adjudicación de la revisión doble de v1 del diseño «incidentes uno a uno» · 27 nov 2026

Paquete de v1 y las dos respuestas, tal como llegaron: [paquete](ronda1-paquete-v1.txt) · [GLM](ronda1-glm.txt) · [DeepSeek](ronda1-deepseek.txt). Resultados: GLM **INCONCLUYENTE**, DeepSeek **FALLA**. Los seis hechos de la sección 1 de v1 se confirmaron; el diseño de la sección 2 tenía huecos demostrados. v2 los corrige y se enviará a una segunda ronda.

| Hallazgo | Decisión |
| --- | --- |
| DeepSeek a: v1 solo relajaba `sameGuard`, pero `incidentOf` (`billingUnblock.ts:420`) sigue exigiendo que la guarda nombre el incidente: P2 y P3 seguirían fallando | **Demostrado; corregido en v2 §2.1**: `incidentOf` busca el incidente en las filas abiertas. |
| DeepSeek b: `sameGuard` no lee filas y no puede comprobar «incidente abierto» | **Demostrado; corregido en v2 §2.1**: `sameGuard` se divide en generación y pertenencia, y la pertenencia va donde ya se leen las filas. |
| DeepSeek c y GLM: la alerta de guarda mixta nombra un solo incidente y se compara con el elegido en dos sitios | **Demostrado; corregido en v2 §2.4**: el estado esperado se deriva de la guarda con la regla «salida primero» que usa el informe (`billingPendingReport.ts`, caso `guard`), en los dos sitios. |
| DeepSeek d: si Cuenta ya confirmó y la fase final aborta, Cuenta queda adelantada | **Mitigado por el mecanismo existente y fijado con prueba**: el reintento adopta el recibo de Cuenta por hold (v2 §2.5, P11); si la generación de Video cambió, `conflict` y el operador relee (P15). |
| DeepSeek e: fila huérfana sin salida | **Aceptado como límite 4 (paso 3.5)**; v2 añade la prueba del huérfano que apunta a un incidente inexistente (P12). |
| DeepSeek f: varios holds por incidente | **Corregido en v2 §2.2**: exactamente uno; ninguno o varios es `conflict` (P13, P14). |
| DeepSeek g: tras un incidente nuevo, el reintento con la generación vieja da `conflict` | **Aceptado como comportamiento correcto**: el operador relee (P15); sin repetición silenciosa. |
| GLM P5: un incidente nuevo entre la lectura y la escritura «confirmaría parcial» | **Refutado con el código**: un incidente nuevo reescribe la guarda, y `recheck` aborta por `sameVersion(observed.guard, guard)` y por la comparación de generación (`billingUnblock.ts:601-603`); v2 lo dice en el hecho 7. |
| GLM Q1 a Q3 bloqueantes: esquema de holds, alerta mixta, alertas antiguas | **Resueltas leyendo el código** (v2 §4): el hold lleva `sourceKind`, `sourceId`, `epoch` y `createdAtMs`; la alerta nombra la salida primero; el barrido deja `superseded` las anteriores. |
| GLM: guarda recreada con el mismo `createdAtMs` | **Aceptado**: P10 ahora cubre también `epoch` 1 con el mismo `createdAtMs`. |
| GLM: pruebas negativas que faltan | **Incorporadas**: P11 a P16. |
