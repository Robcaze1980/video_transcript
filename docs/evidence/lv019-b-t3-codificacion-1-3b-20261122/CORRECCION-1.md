# LV-019.B 1.3b - Correccion 1 (revisiones independientes GLM / DeepSeek)

Fecha: 2026-11-23. Rama `lv019b/t3-a3-ack`, HEAD `9e5c07d` + trabajo 1.3b sin commit.

## Hallazgos corregidos

1. MEDIA (GLM 2 / DeepSeek 3): el POST a Cuenta se armaba con `data` calculado antes
   de `prepareExternalReserveAttempt`, sin compararlo con el testigo del intento
   persistido. Ahora, justo despues de preparar y antes del POST, se exige
   `identityKey`, `reservationId` y `seconds` iguales al testigo; si difieren lanza
   `AiFault('conflict')` sin enviar el POST.
   Decision conservadora: la prelectura ya hizo commit, asi que el intento queda
   PREPARADO, sin ACK y sin trabajo; la intencion sigue `reserve_pending` y la trata
   la salida por plazo de 1.3a / la escalada por edad.

2. BAJA (DeepSeek 6): el comentario de `prepareExternalReserveAttempt` decia que
   devuelve `null`; la funcion nunca devuelve null (lanza). Comentario corregido.

## Pruebas

- `server/commercial/textAccountReserveAckWindow.emulator.mjs`: caso 14 nuevo,
  `the Account POST must use exactly the prepared attempt history`. Rojo antes del
  cambio por POST enviado con la tupla vieja (1 !== 0 en el conteo de POST).
- Resultado real: 14/14 verde.
- Referencia congelada `textAccountReserveIdentity.emulator.mjs`: 13/13.
- Unitarias `reserveAttemptWindow` + `reserveAttemptEvidence` + centinela: 32/32.
- `tsc --noEmit`: limpio.
- Regresiones: `firestoreAi` 166 pass / 0 fail / 4 skipped; `firestoreA3Exit` 27/27;
  `firestoreBlocksA` 27/27; `firestoreVideoSettlementC2a` 21/21;
  `reserveAttemptEvidence.emulator` 8/8.

## Mutacion

`mutaciones/mutate_13b_corr1.py` sustituye la igualdad por `if(false)` y ejecuta la
suite propia. Resultado: `post-tuple-equality-removed  KILLED`. Restauracion
verificada por hash (`final restore verified: True`). Ver `run-corr1.log`.

Total acumulado: 34 mutantes KILLED, 0 supervivientes.