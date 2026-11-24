# Paso 1.4b · Desbloqueo auditado y salida de una cuenta bloqueada (encargos preparados)

**Estado (23 nov 2026): pieza 1 CERTIFICADA en local ([recibo](RECIBO-pieza-1.md)); piezas 2 y 3 preparadas.** El dueño recargó US$10 y la pieza 1 se hizo con ese saldo; quedan ≈US$7,4. Contrato: [diseño v2 del paso 1.4](../../specs/LV-019-B-bloqueos-y-cierres-diseno.md), secciones 3.3, 3.5 y 3.6.

El paso toca **Cuenta además de Video**, por eso se parte en tres encargos cortos que se lanzan **en este orden**, cada uno en un hilo nuevo desde el commit actual y certificado por Codex antes del siguiente:

| Pieza | Encargo | Toca | Depende de | Plazo del hilo |
|---|---|---|---|---|
| 1 | [Desbloqueo, lado Cuenta](brief-1-cuenta.txt): operación `unblockVideoBilling` (borra el guard, nunca escribe `blocked:false`; idempotente; exige época y `createdAtMs`), ruta interna y cliente | `server/account/*`, `accountBillingClient.ts` | — | 150 pasos |
| 2 | [Desbloqueo, lado Video](brief-2-video.txt): `epoch` y `createdAtMs` en el guard de Video, fases 0 a 3 con auditoría inmutable, alerta `guard` con época real | `firestoreBackend.ts`, módulo nuevo, billingPendingReport | Pieza 1 integrada | 200 pasos |
| 3 | [Salida bajo bloqueo (A-5) y liberación debida (E-4)](brief-3-bajo-bloqueo.txt): pruebas y correcciones mínimas | `firestoreBackend.ts`, `firestoreAi.ts` | Pieza 2 integrada | 120 pasos |

- **Autenticación del operador:** no es de este paso. Las piezas reciben `authorizedBy` ya autenticado; la herramienta de operador mínima es el paso 3.5.
- **Revisión por riesgo:** las tres mueven bloqueos o saldo: dos revisores (GLM y DeepSeek) por pieza, con el diff incluido en el mensaje; después regresión financiera y protegida de Cuenta, `npm test` y mis propias mutaciones.
- **Costo estimado de T3** (no medido): entre US$10 y US$20 el conjunto, con revisiones; el plan eficiente reservaba US$25–42 para toda la Fase 1.
- **Antes de lanzar:** emulador de Firestore en `127.0.0.1:8185`, T3 abierto, saldo de OpenRouter suficiente y árbol commiteado.
