# LV-019.B · Evidencia del cierre de NACK en voz C1

**26 nov 2026 · 60/60 en la rama aislada.** Las corridas usaron `vistavo-voice-c1-20261125` sobre la base `255aa5e`, con Cuenta y Video en raíces sintéticas del emulador local. Falta probar el backend combinado y someter esta corrección a revisión independiente. La ruta sigue limitada a la fixture, con el procesamiento de voz apagado y sin proveedor activo. [Contrato local de voz](../../specs/LV-019-B-voz-integracion-local.md)

| Instantánea | Corrida local | Resultado y limpieza |
| --- | --- | --- |
| Anterior, con los cinco negativos nuevos | `run-df36070a-ab63-41b4-99f7-2b224107c72d` | **51/56**. Fallaron los cinco casos 51–55. Limpieza verificada **56/56**. |
| Corrección aislada | `run-5b712c3e-f1e7-42a3-9351-9a2fb5d6a9ef` | **60/60**, cero fallos, cancelaciones u omisiones. Limpieza verificada **60/60**. |

Los cinco negativos de la primera corrida reprodujeron una clasificación incorrecta de `insufficient` tras alterar el intento, la tupla, el reclamo o el origen mientras llegaba el NACK de Cuenta. Para intenciones aún pendientes, también reprodujeron la escritura sobre una historia alterada. Los controles de la segunda corrida incluyen esos casos, la pérdida de respuesta antes y después del commit, estado `insufficient` sin recibo C1, origen alterado y restaurado, y evidencia de ACK contradictorio antes y después del NACK. Verifican un solo POST, ninguna creación de trabajo ni despacho de voz y ningún movimiento nuevo de Cuenta cuando llega el NACK.

## Corrección verificada en la rama aislada

El asentador privado C1 revalida, dentro de la transacción, el intento preparado, la tupla, el origen, el reclamo, los guards, la fuente revisada y la ausencia de evidencia contradictoria. Escribe `insufficient` junto con el recibo de ese intento en `localVoiceReserveNacks`. La relectura tras perder la respuesta de Firestore y la repetición de la solicitud exigen el mismo recibo vinculado al intento. Al faltar la prueba se conserva `UNKNOWN` sin repetir el POST. Se conserva el contrato del asentador genérico de texto.

| SHA-256 del archivo en el manifiesto | Corrida anterior | Corrección aislada |
| --- | --- | --- |
| `server/commercial/firestoreBackend.ts` | `d9c5291e1746c3cf7982609d6ca45084c33bf1549fe7445288e8b53259827d49` | `3a8af884f87dce254a378659eff937880575c5bd982ee8a241e990af9c3cd929` |
| `server/commercial/firestoreReviewedTranslation.emulator.mjs` | `f3f42fff38cf87c1c2fbf88544abddd17d2a1a102f50bfe86270115f9a53e36e` | `0606fd82308e839aa258378dcf45a89d53d51923c33d032da52503e9fb783785` |
| `scripts/runReviewedTranslationEmulator.mjs` | `81358f3bfd9c47b55e9c52b5ca82c23f4b28e459bb3b051b48b506b23a976d7b` | `39b53fbb9813cbd2408b02c7b74a4165bb9d90c479bbd67dfc098ba1f552f6db` |

En la rama aislada también pasaron TypeScript con `tsc --noEmit`, **314 pruebas unitarias en ocho archivos** con Vitest, la comprobación de sintaxis de la fixture y del ejecutor con `node --check`, y `git diff --check`.

## Revisiones y límites

- **DeepSeek FALLA**, sobre la versión integrada anterior. Identificó que el asentador genérico podía devolver `true` para `insufficient` sin comprobar el intento y saltarse la relectura estricta. [Informe DeepSeek](../../reviews/LV-019-B-voz-c1-integrada-DeepSeek-20261126.txt)
- **GLM INCONCLUYENTE**, sobre la misma etapa anterior. Revisó la relectura, pero su conclusión sobre el NACK no cubrió el atajo anterior a esa lectura. Las pruebas rojas reprodujeron el defecto. [Informe GLM](../../reviews/LV-019-B-voz-c1-integrada-GLM-20261126.txt)
- Pendientes la prueba de la corrección sobre el backend combinado y las revisiones independientes de GLM y DeepSeek sobre esa corrección. Este corte no cubre el mapeo general de `ReviewedTranslationFault`, la recuperación autónoma de intentos preparados o ACK huérfanos, ni operación con servicios reales.

Los registros originales están en `outputs/lv019-b-review-runs/<corrida>/` del worktree de voz, con `manifest.json`, `result.json` y `fixture.stdout.tap` por corrida. Estos archivos de `outputs/` están excluidos del control de versiones y no viajan a GitHub ni aparecen al clonar. Este recibo conserva los resultados, ubicaciones e identificadores de los archivos comprobados.
