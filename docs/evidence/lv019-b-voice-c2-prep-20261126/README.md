# LV-019.B · Recibo de preparación C2 · 26 nov 2026

Copia de trabajo `vistavo-voice-c2-20261126`, rama `codex/vistavo-voice-c2-20261126`, base `1b122ceb92e7a409dd0fd50ea21a5dd5a076b8b5` del respaldo local de la rama de checkpoint. El corte consiste en [especificación y pruebas](../../specs/LV-019-B-voz-c2-fragmento-sintetico.md). La candidata de voz permanece cerrada y sin integración productiva.

## Verificación ejecutada

- **60/60 unitarias** de `reviewedVoiceCanonical.test.ts`, sin fallos ni omisiones. La prueba nueva verifica que el receptor en memoria reciba los bytes UTF-8 exactos del único fragmento tras la validación del canon. Rechaza reserialización, voz, modelo u ordinal distintos sin que el receptor reciba bytes. Comprueba un límite del canon, no autoriza admisión.
- **Sintaxis verificada** con `node --check server/commercial/firestoreReviewedTranslation.emulator.mjs`. `git diff --check` sin errores.
- Se reutilizó Vitest 5.0.5 de la instalación local del checkpoint con una configuración Node y salida en el directorio ignorado `outputs/lv019-b-voice-c2-prep-20261126/`. Se desactivaron las cachés del ejecutor. Las pruebas cargaron los archivos de este worktree. No hubo instalación, red ni arranque de emulador.

La coordinación repitió independientemente la unidad en esta copia: **60/60**, con dependencias instaladas desde la caché local mediante `npm ci --offline --ignore-scripts`. No se inició el emulador ni se llamó a ningún proveedor; el registro de esta segunda ejecución está fuera de Git.

## Pruebas de emulador preparadas

La caracterización nueva se registra con `LV_VOICE_C1_FIXTURE=1` y `LV_VOICE_C2_PREPARATION=1`. Reusa el `AccountStore` de la fixture C1, comprueba el ACK realmente escrito de su reserva sintética y ensaya dos admisiones concurrentes del mismo fragmento. Espera un solo recibo nuevo, un `receiptOnly`, un único registro de llamada y ningún cambio adicional de saldo o despacho. **Pendiente de ejecución.** La ruta de prueba de C1 mantiene su conteo anterior mientras la opción de C2 esté apagada. El lanzador revisado aún no habilita el modo C2 ni su conteo de 61 limpiezas.

Quedan cinco casos declarados como `todo` para la admisión completa de C2. Esperan una entrada aislada que valide la evidencia durable de C1 y compare la misma historia antes y después de Cuenta, además del contrato de recuperación de B1. La prueba que consulta directamente el primitivo de Cuenta no autoriza una llamada ni alimenta el receptor. Ninguna de estas pruebas pendientes se incluye en el 60/60.

| Registro | SHA-256 |
| --- | --- |
| `docs/specs/LV-019-B-voz-c2-fragmento-sintetico.md` | `2b317444fe733dc47a96fa733b836181e35926a89d99ae655819e69f80becee9` |
| `server/commercial/reviewedVoiceCanonical.test.ts` | `2e2b56c8a47efae14654e4e9ca2a581f091884db61d7d85c9013cf7e3c2b106e` |
| `server/commercial/firestoreReviewedTranslation.emulator.mjs` | `755289cc4e9afe49ef73eff9c969c90e8f3cc0912b08326cdf5148eb65d4939e` |
| `outputs/lv019-b-voice-c2-prep-20261126/units.json` · ignorado por Git | `774ea22a81461c85315ff3e74954488a87c912d5310e4b0a3d1f618aef0c9c91` |
