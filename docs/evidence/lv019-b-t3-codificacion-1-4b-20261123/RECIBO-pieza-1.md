# Recibo · Paso 1.4b, pieza 1 · Desbloqueo auditado, lado Cuenta

**Fecha:** 23 nov 2026 · **Estado:** certificado en local por Codex · **Desplegado:** no (G0: nada se despliega hasta que la voz esté lista).
**Escribió:** T3 (`deepseek/deepseek-v4.1-flash`, hilo `1ae4a5ff`, dos rondas: encargo y corrección). **Revisaron:** GLM Flash Latest (PASS) y DeepSeek V4.1 Flash (FALLA con tres MEDIA y dos BAJA, adjudicadas abajo). **Certifica:** Codex.
Diseño: [bloqueos y cierres v2](../../specs/LV-019-B-bloqueos-y-cierres-diseno.md), §3.3. Encargos: [pieza 1](brief-1-cuenta.txt) y [corrección](brief-1b-correccion.txt).

## Qué quedó hecho

Hasta hoy **no existía ningún desbloqueo**: una cuenta bloqueada por una divergencia de facturación no podía volver a mover saldo. Ahora hay una operación nueva y propia de Cuenta:

- `AccountStore.unblockVideoBilling(identityKey,{incidentId,epoch,createdAtMs,reviewRef})` ([backend.ts](../../../server/account/backend.ts)), en **una transacción**: lee identidad, cuenta, guarda, registro del incidente y registro de desbloqueo, y **borra el documento de la guarda** (nunca escribe `blocked:false`, que el lector `billingHold` rechazaría con `invariant` y dejaría inutilizados `reserveVideo`, `admitVideoCall` y `settleVideo`).
- **Unicidad y orden:** exige guarda existente y bloqueada, incidente `active` y que `epoch` **y** `createdAtMs` coincidan con los de la guarda vigente (al borrar y volver a bloquear, la época vuelve a 1: solo `createdAtMs` distingue generaciones). Un desbloqueo viejo no puede limpiar un bloqueo nuevo.
- **Varios incidentes:** el incidente pasa a `reviewed`, la guarda cuenta `reviewedCount` y **solo se borra cuando `reviewedCount===incidentCount`**; mientras tanto la cuenta sigue bloqueada. Un incidente nuevo que llega entre dos desbloqueos conserva el contador.
- **Idempotencia:** el registro inmutable `videoBillingUnblocks/<hash([cuenta,incidente,'unblock'])>` hace que la repetición idéntica sea `replayed:true` **sin escrituras** y que una carga distinta sea `conflict`.
- **Recibo `{unblocked:true, replayed, blocked}`:** `blocked` es «la guarda sobrevive después de esta llamada». **`unblocked:true` nunca implica cuenta abierta** (hallazgo MEDIA de DeepSeek). La pieza 2 debe respetarlo.
- Ruta interna `POST /api/internal/video/billing-holds/unblock`, solo para `internal.settlementCaller`, cuerpo estricto ([http.ts](../../../server/account/http.ts)); método `AccountBillingClient.unblock` con validación estricta del recibo ([accountBillingClient.ts](../../../server/commercial/accountBillingClient.ts)).
- **Lector de estado `videoBillingHold`** (`/status`, solo lectura): un incidente `reviewed` (con o sin guarda) devuelve `{blocked,recorded:false}` en vez de `invariant`; exige `reviewedAtMs` entero; estado desconocido o `active` sin guarda siguen fallando cerrado. `recorded:false` significa «no hay incidente ACTIVO con ese id».
- No mueve saldo ni reservas, no toma el candado del ejecutor.

## Evidencia

| Verificación | Resultado |
|---|---|
| `tsc --noEmit` | limpio |
| `npm test` | **1682 aprobadas**, 113 omitidas, 0 fallidas (antes 1680) |
| Pruebas de Cuenta con emulador (`unblockAudited.emulator.mjs`, 10 casos con Cuenta real) | 10/10 |
| `backend.emulator.mjs` y `settlementPartial.emulator.mjs` | 38/38 y 25/25 |
| Regresión protegida de Cuenta (`run-e7ed12b9-6749-410b-98a6-6ddd76495c0d`) | **PASS** (38/38) |
| Regresión financiera completa (`run-47801742-0ec3-4011-a47c-7d2e351b6991`) | **PASS: 403 pruebas, 398 aprobadas, 5 pausadas, 0 fallidas** (sin cambio de conteo: la pieza no agrega fixtures a esa regresión) |
| Mutaciones propias de Codex ([arnés](mutaciones/mutate_unblock.py), [resultado](mutaciones/resultado-ronda-2.log)) | **55 mutantes** sobre store, HTTP y cliente: 54 detectados, 1 equivalente (`not-blocked-allowed`: sin guarda, `guard.get('epoch')` es `undefined` y nunca coincide con una época entera) |
| Mutaciones de T3 | 8 + 5 de la corrección, todas detectadas |

**Huecos de pruebas que mis mutaciones destaparon y cerré** (pruebas solo, sin tocar producción): forma estricta de la petición (clave extra o ausente), el carácter de control U+001F en `reviewRef` (en las tres capas: store, HTTP y cliente), identidad sin cuenta (`account_not_provisioned`), incidente `active` con guarda ausente en el lector de estado. Un mutante de mi arnés sobre la ruta HTTP resultó ser equivalente por error mío (`slice(0,5)`); lo reemplacé por el real y se detectó.

## Revisión independiente: adjudicación

| Hallazgo | Veredicto de Codex |
|---|---|
| DeepSeek MEDIA 1: el recibo no distingue «guarda borrada» de «un incidente de varios» | **Adoptado:** campo `blocked` en store, HTTP (pasa tal cual) y cliente, con pruebas. |
| DeepSeek MEDIA 2: sin prueba de la guarda con `reviewedCount>0` más un incidente nuevo | **Adoptado:** prueba A,B → desbloquear A → llega C → B con época vieja `conflict`, B y C con la vigente → la guarda se borra solo al final. (`blockVideoBilling` actualiza con merge: el contador se conserva.) |
| DeepSeek MEDIA 3: la rama `reviewed` con guarda presente no estaba probada; `recorded:false` sobrecargado | **Adoptado en pruebas y comentario;** sin cambiar la forma de la respuesta (no hay consumidor de producción: `holdStatus` no tiene llamadores). |
| DeepSeek BAJA 4: `reviewed` sin `reviewedAtMs` pasaba | **Adoptado** (`invariant`). La guarda malformada que lanza `invariant` en vez de `conflict` es comportamiento previo y falla cerrado: **sin cambio**. |
| DeepSeek BAJA 5: la prueba HTTP no comparaba el cuerpo del 200 ni probaba al otro llamador con cuerpo válido | **Adoptado.** |
| GLM BAJA 4: sin prueba de un incidente `reviewed` que vuelve a bloquearse | **Fuera de esta pieza:** `blockVideoBilling` lanza `invariant` (comportamiento previo); la pieza 2 debe usar un id nuevo por ocurrencia (quedó en su encargo). |

## Límites declarados

- **El conjunto `unblockAudited.emulator.mjs` aún no está en la regresión oficial protegida** (esos lanzadores usan copias adaptadas con red cerrada): entra en la regresión financiera junto con la pieza 2, que corre la completa. Mientras tanto se ejecutó con el emulador local y con 55 mutaciones.
- **La carrera lectura→escritura** se prueba lanzando dos operaciones juntas (seis rondas): el emulador toma bloqueo pesimista de lectura y no permite inyectar una escritura en la ventana. La serialización dura la da Firestore.
- **Reservas abiertas:** el diseño 3.3 pedía verificar que no impidan liberar; esta pieza no mueve saldo y esa salida es la **pieza 3** (A-5). Hasta entonces no hay ruta de operador que llame a esta operación.
- **Autenticación del operador:** no es de este paso (3.5). Un incidente ya revisado no se vuelve a bloquear con el mismo id.
- **Costo:** el gasto de la cuenta de OpenRouter entre el lanzamiento y este cierre (T3 en dos rondas, dos revisiones y el revisor automático de aprobaciones) fue de **≈US$2,4**; medido por diferencia de `total_usage`, no por modelo. Quedan ≈US$7,4.
