# Recibo · paso 3.4 (A2, barrido de alertas apto para la nube): T3 programa, Codex certifica · 20 nov 2026

Alcance: `server/commercial/billingSweepSection.ts` (sección aislada del barrido de alertas, apagada por defecto), su cableado en `server/commercial/cloudFilesRuntime.ts` y las pruebas `billingSweepSection.test.ts` (vitest) y `billingSweepSection.emulator.mjs`. No se desplegó nada y la sección no se ha ejecutado en la nube.

## Cómo se trabajó
- **Codificación (T3, DeepSeek en worktree propio, sin red ni commits):** [encargo](brief-a2.txt) · [informe final](t3-informe-codificacion-a2.txt). Pruebas primero; T3 pasó 14 mutaciones.
- **Revisión independiente (T3, dos modelos, solo lectura):** [encargo](review-a2.txt) · [GLM FALLA](review-a2-glm.txt) · [DeepSeek FALLA](review-a2-deepseek.txt).

| Hallazgo | Decisión |
| --- | --- |
| Un barrido colgado se acumula entre pasadas (GLM 1) | **Adoptado:** guarda de ejecución en curso por raíz; una pasada nueva no lanza otro barrido y devuelve `skipped` (sano); `timeout` declarado como «puede terminar después y escribir alertas idempotentes». |
| La prueba de frontera de importaciones es burlable (GLM 2, DeepSeek 2) | **Adoptado:** especificadores canonizados, análisis con TypeScript `preProcessFile` y rechazo de `import()`/`require()` no literales. Codex lo comprobó con tres ediciones hostiles: importación estática, importación dinámica concatenada y la detectó; una `require` por propiedad de `globalThis` no la detecta (límite declarado: la prueba es estática). |
| `stage` sin validar podría filtrar texto (GLM 3, DeepSeek 5) | **Adoptado:** lista cerrada `read, raise, clear, review, alert`. |
| El latido no fija el conjunto exacto de claves (GLM 4) | **Adoptado.** |
| La prueba de cableado no fija el orden y usa una comprobación vacua (DeepSeek 4) | **Adoptado:** la sección arranca sin esperarse al principio de la pasada y se espera al final (no retrasa archivos ni IA y emite latido aunque estos fallen), con el orden fijado. |
| El `import` estático puede tumbar todos los modos (DeepSeek 1, ALTA) | **Rechazado con razón:** un fallo de carga sería un error de compilación detectado por `tsc` y las pruebas, no un riesgo de ejecución; se anotó como decisión. |
| `partial` inalcanzable en producción (DeepSeek 5) | **Aceptado:** rama defensiva. |

Además T3 diagnosticó y endureció su propio fixture (el emulador compartido se colgó bajo contención con los fixtures del otro hilo): ahora acota el trabajo y el borrado y siempre termina su sesión.

## Verificación de Codex
`npx tsc --noEmit` sin errores; `billingSweepSection.test.ts` y `billingPendingSweep.test.ts`: **39 aprobadas**; emulador `billingSweepSection.emulator.mjs`: **5/5**; tres ediciones hostiles propias contra la frontera de importaciones (dos detectadas, una exótica no).

## Certificación y límites
**Codex certifica A2 como lista para desplegarse con el primer despliegue restringido (apagada por defecto).** Límites: (1) no se ha ejecutado en la nube; (2) tras `timeout` el barrido real no se cancela; (3) la frontera de importaciones es estática; (4) la alerta de «sin latido» y su entrega son el paso 3.3; (5) el modo `billing` y el ejecutor periódico de drenajes son otro paso (1.6) y no están aquí.
