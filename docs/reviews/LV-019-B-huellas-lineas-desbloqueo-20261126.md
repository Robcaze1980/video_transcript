# LV-019.B · Conciliación de huellas del corte financiero 5d949a0

Revisión interna del 26 de noviembre de 2026. El dictamen de GLM del corte 4cb0cf0..5d949a0 conserva **INCONCLUYENTE** en `docs/reviews/LV-019-B-alertas-desbloqueo-conjunto-GLM-20261126.txt` del checkpoint. Este recibo concilia las huellas concretas que el informe cuestionó. El original está en `outputs/openrouter-reviews/7f415c937be0e19caaf44eb10438eacaf99474c970fb94f6b106bb0c3c6f80f0/report.txt`, SHA-256 `bdd769fc4daabbf679438077b8c60d123e7b08f5c0474593aa107d5f472649a6`. Costo y tokens de esta revisión interna: no medidos.

## Comparación de bytes

Leí los blobs con `git show 5d949a0fcae9858d23a709d9530775afac963878:<ruta>` y los archivos de la copia `vistavo-alert-confirmed-audit-20261126` en modo binario. Los conteos indican LF sin CR, CRLF y CR sin LF, en ese orden. La única transformación para comparar fue convertir CRLF a LF en memoria. Los cinco pares coinciden byte a byte después de la conversión y el SHA-256 normalizado de cada par es el del blob. Los dos bytes NUL de `billingPendingAlerts.ts` se conservaron. Las huellas crudas de los blobs y de los archivos fijados por la corrida representan esos dos orígenes; el paquete las citó en secciones distintas sin explicar la diferencia de finales de línea.

| Archivo bajo `server/commercial/` | SHA-256 del blob Git | LF / CRLF / CR del blob | SHA-256 del archivo local | LF / CRLF / CR local | Igual tras CRLF→LF | Fijado por el 9/9 |
| --- | --- | --- | --- | --- | --- | --- |
| `billingPendingAlerts.ts` | `d03f4388836cd112f7480cb4e9bb4ec4f570c5a7d857ab066d7540621d64e707` | 256 / 0 / 0 | `d03f4388836cd112f7480cb4e9bb4ec4f570c5a7d857ab066d7540621d64e707` | 256 / 0 / 0 | Sí | Sí |
| `billingPendingReport.ts` | `6ddbc5e6dfac4156ba4f048b10ff75a3b6e122cbfafcf5ae4084389ee8607195` | 295 / 0 / 0 | `9c8ac42ac6ee63b4ac925d025b0e32f24c2afa8e843bd3670b20046d63915202` | 0 / 295 / 0 | Sí | Sí |
| `billingUnblock.ts` | `2c701e17c1afaf0f517cbe3077fbf6020cc351fcc466eba23b55548cc45ce3e9` | 456 / 0 / 0 | `17eedb0b99bf7a448207009e5c1f4c060fbc8833588b7f341bb54ebd7712a2b2` | 0 / 456 / 0 | Sí | Sí |
| `alertContractFocus.emulator.mjs` | `bc2063e087afc773e92a58246ac4c369f2e683f0597d002e798cd37fa540b9f5` | 435 / 0 / 0 | `9ffab8b1e3a00042cd8b263cbe377ed3cd398ee1ac88a3276b9aad82fa979330` | 199 / 236 / 0 | Sí | Sí |
| `billingUnblock.emulator.mjs` | `177733ba6fd1804ba0b0812361138333c588d7bef1d4fa08b737ac64b3fbd760` | 1310 / 0 / 0 | `177733ba6fd1804ba0b0812361138333c588d7bef1d4fa08b737ac64b3fbd760` | 1310 / 0 / 0 | Sí | Ausente |

## Alcance del 9/9

En `vistavo-alert-confirmed-audit-20261126/outputs/lv019-b-alert-contract-runs/run-a77e310b-66d9-439e-9326-78d8fadbb0e7/`, el SHA-256 crudo de `manifest.json` coincide con `result.manifestSha256`. Las 62 entradas de `manifest.files` son iguales a `result.before` y `result.after`. Los tres módulos y la fixture focal coinciden con sus huellas crudas en los tres mapas. El arnés `scripts/runAlertContractFocusEmulator.mjs` ejecutó solo `alertContractFocus.emulator.mjs`. El TAP y el resultado registran 9/9, sin fallos, omisiones, cancelaciones ni pendientes. El resultado registra limpieza completa y guard sin denegaciones. Los inventarios antes y después son idénticos byte a byte.

| Artefacto | SHA-256 crudo |
| --- | --- |
| `manifest.json` | `a3b2990ce6c02732ab6c215161fffcf02ad56efdfe8370ec7d9fe1dea1ad41fd` |
| `result.json` | `551dd50386b5031cb93d6abb39e580e0e6f2e12cc14101352e4e0dd1a6b9abcf` |
| `fixture.stdout.tap` | `3412b8664b814d9de1b4e24650326291d6dde61ca02276bb37ab83c4de62efd7` |
| `roots-before.json` y `roots-after.json` | `35742e528c97f13cca922c9d69f06fd4d106a263e054ddead5d9f5afdc27a30e` |

La fixture histórica `billingUnblock.emulator.mjs` queda fuera del manifiesto y del 9/9. La verificación de su expectativa modificada requiere evidencia de la regresión que la incluya. Este cotejo se limita al 9/9 y no revalida el 165/165. Los artefactos de `outputs/` son locales y quedan fuera de Git. No se repitieron corridas ni se hizo una nueva consulta externa.

## Estado del corte

El diagnóstico posterior `ce4409fd77d93626f1f981c8a670b88c6208cc13` conserva cuatro negativos unitarios de ACK directo sobre el mismo base. En la primera llamada y en la reanudación desde `pending`, una alteración persistente de `unblock_requested` o su alteración y restauración permiten que Video cierre tras el ACK. Los dos controles intactos pasan. La prueba siembra una escritura privilegiada en el doble después de la decisión de Cuenta y antes de entregar el ACK. Conserva saldo, reserva y asiento, y no acredita una vía normal de cliente ni atomicidad entre bases. El corte sigue sin aceptación final.

=== RESUMEN FINAL ===
RESULTADO: INCONCLUYENTE
EVIDENCIA: Cinco pares iguales tras convertir únicamente CRLF a LF. Los tres módulos y la fixture focal están fijados por el manifiesto y el resultado del 9/9, con 62 huellas coincidentes antes y después.
NEGATIVOS: La fixture histórica no se ejecutó en el 9/9. Cuatro controles posteriores de ACK directo fallan en la base; los dos intactos pasan.
BLOQUEOS: Continúan pendientes la resolución de los negativos de ACK directo, las verificaciones de regresión correspondientes y la aceptación del corte. Se conserva el dictamen original de GLM.
=== FIN RESUMEN ===
