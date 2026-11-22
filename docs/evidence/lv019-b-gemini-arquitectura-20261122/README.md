# LV-019-B-ARQ-001 · Revisión independiente de arquitectura, rendimiento y costo (Gemini)

**Estado (22 nov 2026): PREPARADA; se lanza al cerrar el paso 1.7** (decisión del dueño). Complementa la «revisión Gemini del backend de saldo» que ya figura en el paso 1.7 del [plan paso a paso](../../specs/LV-019-B-plan-paso-a-paso-20261120.md): aquella mira que el saldo sea correcto; esta mira costo, rendimiento y escala, que ninguna revisión de T3 ha cubierto.

- **Encargo:** [encargo.txt](encargo.txt), adaptado de la auditoría que el dueño corrió en otro proyecto (sin lo de LiveKit y las voces; con el costo por pasada del ejecutor y por trabajo de video).
- **Por qué esperar a 1.7:** los pasos 1.3a, 1.3b y 1.4b cambian `firestoreBackend.ts`; una auditoría antes revisaría código que va a cambiar.
- **Antes de lanzar:** 1.7 cerrado con la regresión completa en verde y el árbol commiteado; saldo de OpenRouter suficiente (el costo de una corrida de solo lectura con ese contexto no está medido: confirmar el precio del modelo elegido); elegir el modelo (`google/gemini-4-neon` o `google/gemini-4-hydrogen:batch`, el del plan) y comprobar que su identificador existe en OpenRouter.
- **Lanzamiento** (desde la raíz del repositorio, con T3 abierto): `t3 thread start --provider linguistvision-openrouter --model <modelo> --wait --title "LV-019.B revision arquitectura Gemini" . - < docs/evidence/lv019-b-gemini-arquitectura-20261122/encargo.txt`
- **Después:** Codex inspecciona `REVISION-GEMINI-ARQUITECTURA.md`, adjudica cada hallazgo contra el código (se conservan todos, también los rechazados) y registra el resultado y el gasto real en la bitácora; ningún hallazgo se implementa sin pasar por el backlog.
