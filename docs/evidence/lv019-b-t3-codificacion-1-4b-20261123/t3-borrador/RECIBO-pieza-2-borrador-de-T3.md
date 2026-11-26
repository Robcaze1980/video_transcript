# Recibo · Paso 1.4b, pieza 2 · Desbloqueo auditado, lado Video

Fecha: 24 nov 2026. Worktree `lv019b-t3-unblock-video`, HEAD `d78d66d` (sin commit, sin merge, sin rebase, sin red real).
Cuenta usada REAL (`AccountStore` tras transporte HTTP local); ambas bases en el emulador fijo `127.0.0.1:8185`.

## Qué quedó hecho

- `server/commercial/billingUnblock.ts` (nuevo): `unblockBillingAccount` con fase 0+1 transaccional (alerta `open`,
  `evidenceRef` validado, guard en la misma época/`createdAtMs`/`updatedAtMs` e incidente nombrado, y ninguna fila
  `needs_review` ajena sin resolver; rivales nombrados por la relectura del propio incidente), fase 2 Cuenta primero
  (`AccountBillingClient.unblock` con época y `createdAtMs`) y fase 3 transaccional que relee la guarda y avanza solo
  las filas de este incidente. `authorizedBy` es parámetro de confianza ya autenticado, nunca del cuerpo; `nowMs` del
  reloj del servidor. No toma `billingDrainLease`.
- `server/commercial/billingHoldIdentity.ts` (nuevo): `accountHoldId(kind, sourceId, epoch, createdAtMs)` = id del hold
  y `incidentId` de Cuenta; `legacyHoldId` para filas anteriores. Una ocurrencia nueva siempre tiene id nuevo.
- `server/commercial/firestoreBackend.ts`: `guardEpoch` (lectura) y `writeBlockedGuard` (único escritor) con `epoch:1` +
  `createdAtMs` al crear y `+1` por incidente distinto; guarda antigua sin `createdAtMs` → `invariant` (migración
  declarada). Los cuatro escritores del guard leen antes y comprueban la generación. Arreglo real: el reloj de
  `resolveConfirmedIntentObservation` se unificó (antes `preview` y escritura tomaban dos `Date.now()`, y una guarda
  nueva abortaba con `invariant`).
- `server/commercial/billingPendingReport.ts`: estado de la alerta `guard` = `blocked:<epoch>:<createdAtMs>:<incidentKey>`
  (helper `blockedState`), legado `blocked:1:0:<incidente>`, inválido → `malformed`.
- `server/commercial/billingReadOnlyRoot.ts`: raíz de solo lectura compartida por el módulo nuevo.

## Resultados reales

- `server/commercial/billingUnblock.emulator.mjs`: **20/20 PASS** (prueba 11 completa con Cuenta real —reservar, admitir
  y liquidar tras el desbloqueo—, 11 repetición idéntica `replayed` sin escrituras, 11 carga distinta `conflict`, 11
  negativos de `evidenceRef`/alerta/`needs_review`/segundo incidente, 11 parcial con `blocked:true`, 11 fallo de Cuenta
  sin escrituras, 11 fallo de Video tras Cuenta + repetición que completa, 12 época/`createdAtMs`/`updatedAtMs` antiguos,
  12 época 1 repetida tras borrar y re-bloquear, 12b alerta real por cuenta y generación sin duplicar al repetir, 13 con
  el candado retenido por otro, y re-bloqueo de la misma fila con incidente nuevo que se desbloquea otra vez).
- `tsc --noEmit -p tsconfig.json`: limpio.
- Suites del guard: `firestoreBlocksA.emulator.mjs` 27/27, `firestoreA3Exit.emulator.mjs` 27/27,
  `firestoreAi.emulator.mjs` 166/166 (0 fallos), `billingPendingReport.test.ts` + `billingSweepSection.test.ts` 40/40,
  `firestoreBlocksA.test.ts` 11/11.
- `npx vitest run --maxWorkers=3 server/commercial server/account`: 1548 aprobadas, 1 fallida, 113 pausadas de 1662.
  La única fallida es `server/commercial/web/reviewBrowserNodeFixtures.test.ts`, por un manifiesto de navegador
  sintético ausente fuera del alcance de este paso (`outputs/lv019-b-review-browser-manifests` no existe); no toca el guard.

## Pruebas ajustadas y por qué

- Semillas de guard en `firestoreBlocksA.emulator.mjs` (12b), `firestoreBlocksA.test.ts` y expectativas de estado
  `blocked:<epoch>` → generación completa. Es la migración declarada (los escritores ya estampan `createdAtMs`), no un
  cambio de comportamiento. Se añadió el caso `epoch` sin `createdAtMs` (o al revés) = `malformed`.
- `billingUnblock.emulator.mjs` se amplió con: guarda legada sin marca rechazada y sin época = 1 si hay marca, resultado
  parcial de Cuenta, rival que llega entre fase 0 y fase 3, y guarda cuyo `createdAtMs` se mueve entre fases.

## Mutaciones (restauración por SHA-256, todas las corridas verificaron la restauración)

18 mutantes propios. **17 KILLED**, 1 equivalente:

| Mutante | Resultado |
| --- | --- |
| Fases en orden inverso (Video antes de Cuenta) | KILLED |
| Quitar comparación de época en fase 3 | KILLED |
| Quitar comparación de `createdAtMs` en fase 3 | KILLED |
| Quitar comparación de `updatedAtMs` en fase 0 | KILLED |
| Saltar la precondición de filas sin resolver en fase 0 | KILLED |
| Saltar la relectura de rivales en fase 3 | KILLED |
| Borrar la guarda aunque Cuenta devuelva `blocked:true` | KILLED |
| Avanzar filas ajenas al incidente | KILLED |
| La salida de la intención ignora su liberación preparada | KILLED |
| Idempotencia: un registro completado ya no repite | KILLED |
| Idempotencia: una solicitud pendiente ya no reanuda | KILLED |
| `authorizedBy` aceptado desde el cuerpo | KILLED |
| Otro operador repite como el mismo autor | KILLED |
| Guarda legada sin `createdAtMs` adoptada en silencio (ambos lectores) | KILLED |
| Guarda nueva sin `createdAtMs` | KILLED |
| Guarda nueva creada en época 2 | KILLED |
| Re-bloqueo que no sube la época | KILLED |
| Quitar la comprobación `generation === preview` | EQUIVALENTE (igual snapshot en la misma transacción) |

## Límites declarados

- La autenticación del operador y el endpoint no existen aquí: se integran en 3.5. La época y `createdAtMs` de la guarda
  de **Cuenta** las aporta la herramienta del operador (Video no puede leerlas).
- La salida de una reserva atrapada bajo bloqueo es la pieza 3; aquí queda `reserved` y las pruebas solo verifican que
  reservar/admitir/liquidar vuelven a funcionar.
- `unblocked:true` con `blocked:true` deja el bloqueo de Video; el resultado parcial es visible en el recibo y en el
  registro `unblocked` (`videoBlocked`, `videoRivals`).
- Las bases reales siguen vacías; el rechazo de guardas legadas sin `createdAtMs` es la migración declarada.
