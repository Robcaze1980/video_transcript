# LV-019.B · Contraste de la prueba histórica tras revisión dual

26 nov 2026 · Base publicada `91073d5651f2141fc99c8968f6b6f6e923e708b8`. Diagnóstico reproducible con pruebas nuevas y código original `35993edba0b56458585c8c0cb424d8a070c4e912`. Corrección aislada en `codex/vistavo-account-unblock-history-recheck-20261126`. El [recibo original](PRUEBA-HISTORICA.md) documenta aquel corte.

## Dictámenes del corte original

| Revisor | Resultado conservado | Informe original en los outputs del checkpoint | SHA-256 |
|---|---|---|---|
| DeepSeek | FALLA | `outputs/openrouter-reviews/249dc2c0dc63ff8c8a979ea0bad2fe0aeed7a140c8e4e3d70c14f8d3aab7e792/report.txt` | `273f5fb9983a5cfa1295c8f09e2c11ac87818be7d27fb438aaaaf3feb2bdeea3` |
| GLM | PASS limitado al paquete test-only | `outputs/openrouter-reviews/dcb4f0c90103f6297d5d0eed7ebff2b958c06825d239327138d60a79fd5a30af/report.txt` | `58523fade9052963cd4f3dc2e790eabd55c174ef0fa36291356cffd16accc04c` |

## Contraste local

| Observación | Base con las pruebas nuevas | Corrección o control |
|---|---|---|
| Los bytes omitían `unblockProtocol` | Cuenta aceptó una firma de permiso para protocolo 3 con filas del protocolo 2, escribiendo recibo, incidente y guardia. También confirmó un recibo cuya firma correspondía al protocolo 3. Es un cruce entre versiones del comprobante. La prueba usa un firmante del arnés y no demuestra una vía de cliente. | La serialización incluye el número de protocolo. Los dos dominios de formato cambian a `.v2`. El recibo incluye los bytes del permiso. Ambas firmas cruzadas dan `conflict`. Las firmas experimentales `.v1` carecen de vía de compatibilidad. |
| Llave posterior inválida | Una llave privada Ed25519 o una pública EC permitió `pending` y luego `awaiting_proof`, con un recibo escrito que la configuración no podía verificar. | Antes de abrir una transacción se exigen dos `KeyObject` públicas Ed25519 distintas y ámbito configurado. En ambos casos se obtiene `conflict` con cero transacciones y cero escrituras. |
| Configuración parcial | La llave de permiso ausente o un objeto plano como llave produjo `TypeError`. La llave de recibo ausente produjo `ERR_INVALID_ARG_TYPE`. | La misma validación temprana devuelve `AccountFault('conflict')`. Usa propiedades propias de datos para leer la configuración y comprueba la marca de `KeyObject` antes de comparar las llaves. |
| Lectura legada tras commit v2 | El nuevo control pasó ya sobre la base. Una segunda cuenta mantuvo su lectura y su repetición legadas. | Se conserva el control. El lector legado rechaza un recibo v2 real tras publicar la prueba, mientras el lector v2 lo confirma sin escribir. |

`awaiting_proof` expresa incertidumbre y omite `blocked` deliberadamente. La codificación base64url sin padding es el contrato del formato, incluido en [el recibo original](PRUEBA-HISTORICA.md). La observación de GLM sobre validación en el codificador se conserva como un límite de su uso. El codificador recibe la tupla validada por AccountStore. Este corte no incorpora una interfaz para que un emisor real acepte campos externos. El `updateTime` de identidad o incidente sigue siendo un pin estricto. Una llave pública Ed25519 bien formada pero provisionada para el emisor equivocado puede impedir recuperar el recibo. Validar la forma de la configuración no acredita su procedencia, custodia ni rotación.

## Reproducción y límites

- Node `24.22.3`. En `35993ed`, `node node_modules/vitest/vitest.mjs run server/account/unblockAttemptReceipt.test.ts --maxWorkers=1 --reporter=verbose` dio **27 aprobadas y 7 fallidas**. El resultado completo está en `outputs/unblock-history-review-20261126/91073d5-red.log`. SHA-256 `d5c9d59a2edb5b34a4b941a02ed4da458ae6bb573303fe7fba0614caf8bdea8c`.
- Tras corregir, **127/127 en seis suites**, sin omisiones. Se usó `node node_modules/vitest/vitest.mjs run server/account/unblockAttemptReceipt.test.ts server/account/videoBalanceIdentity.test.ts server/account/videoReservationIdentity.test.ts server/account/accountReadIdentity.test.ts server/commercial/unblockContinuityIndependent.test.mjs server/commercial/alertContractReview.test.mjs --maxWorkers=1 --reporter=verbose`. Log `outputs/unblock-history-review-20261126/green.log` con SHA-256 `3671cced7dcedcaab5a99deb06cebecbe2e8cabd374e6b77e1e4b4fa2fa53dc3`. `node node_modules/typescript/bin/tsc --noEmit` terminó con salida 0.
- El seam conserva `NODE_ENV=test`. Las claves privadas se generan en las pruebas. El cambio carece de ruta, emisor y observador real. Sigue faltando evidencia durable de qué escritor ejecutó el commit original, obtenida fuera de las filas recreables, así como corte, cerco, migración y revisión del corte corregido. Los ensayos excluyen emulador, datos reales, IAM y despliegue.
- Costo y tokens de la adjudicación local no medidos.

=== RESUMEN FINAL ===
RESULTADO: INCONCLUYENTE
EVIDENCIA: Siete fallos reproducidos sobre 91073d5 y preservados en un commit de pruebas. Versionado firmado y validación temprana de ambas llaves en la corrección aislada, con 127/127 y tipos aprobados.
NEGATIVOS: Firmas cruzadas, llaves privadas/de otro algoritmo/ausentes, valor plano como llave, cero transacciones o escrituras con trust inválido y rechazo del lector legado tras recibo v2.
BLOQUEOS: Dictámenes originales conservados. Sigue faltando revisión del corte corregido y un emisor/observador autenticado que acredite el commit original. Corte, conciliación y migración permanecen pendientes.
=== FIN RESUMEN ===
