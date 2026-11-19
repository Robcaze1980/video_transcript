# Recibo T3 · reporte de pendientes (pieza B, solo lectura) · 2026-11-19

Código revisado: `server/commercial/billingPendingReport.ts` y su prueba. Vía: T3 local (instancia `linguistvision-openrouter`), servidor cerrado tras cada ronda. Modelos pedidos: `~z-ai/glm-flash-latest` y `deepseek/deepseek-v4.1-flash`; modelo servido, tokens y costo no observables. Las respuestas originales se conservan sin editar.

## Ronda 1 (`prompt.txt`, `reply-glm.txt`, `reply-deepseek.txt`)
- **GLM: FALLA.** Hallazgos válidos: (1) `where('state','in',…)` omite filas sin estado usable, lo que contradice «marcar malformados en vez de omitir» (bloqueante); (2) `lastErrorCode`/`accountId` inválidos pasaban sin marcar; (3) el cursor estaba tipado como objeto plano y el stub no prueba el contrato real de `startAfter`; (4) faltaba prueba con fila malformada y emulador real.
- **DeepSeek: INCONCLUYENTE** (no emitió la línea final obligatoria; solo comentó el estilo de un fragmento de la prueba). Se adoptó lo útil: separar el caso malformado por campo y añadir un control válido.

## Correcciones adoptadas
Modo `audit:true` (recorre todos los documentos y marca malformado cualquier estado que no sea no-terminal listado ni terminal conocido; el modo rápido documenta su límite); cursor tipado `DocumentSnapshot`; campos inválidos marcan malformado; casos de prueba por campo con control válido.

## Ronda 2 (`prompt-2.txt`, `reply-2-glm.txt`, `reply-2-deepseek.txt`)
- **GLM: INCONCLUYENTE** (recibió un fragmento mal cortado por mí y respondió sobre ese fragmento; sin línea final). No cuenta como revisión del archivo.
- **DeepSeek: PASS** sobre el archivo completo, con tres observaciones: (1) la expresión de `lastErrorCode` era arbitraria → **adoptado**: ahora es la lista exacta de códigos que los escritores pueden guardar (`firestoreBackend.ts` coacciona cualquier otro a `unavailable`); (2) la consulta `in` + `orderBy('__name__')` solo la probaba un stub → **adoptado**: comprobada contra el Firestore Emulator (ver abajo); (3) los trabajos no se auditan y el informe no lo dice → **anotado como límite** en el documento de diseño.

## Contraste de Codex (no es revisión T3)
`scripts/checkBillingPendingReportEmulator.mjs` contra un emulador de Firestore propio y aislado (loopback, proyecto `demo-*`, datos sintéticos, limpieza verificada): modo rápido 135 filas (130 futuras + 5 pendientes, la debida primera, con tandas de 25), modo audit 137 (añade exactamente las 2 filas sin estado usable), ninguna fila terminal listada. Límite: el emulador no exige índices compuestos; que la nube no los pida **no está verificado**.
