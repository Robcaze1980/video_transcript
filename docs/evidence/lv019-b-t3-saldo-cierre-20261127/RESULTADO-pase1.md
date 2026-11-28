# LV-019.B · Cierre del saldo · Pase 1 · Resultado

Rama: `lv019b/t3-saldo-cierre-b-20261127` · Worktree: `lv019b-t3-saldo-cierre-b-20261127` · Fecha: 27 nov 2026.

## Que se hizo

1. `npx tsc --noEmit` limpio (exit 0) antes y despues del cambio.
2. Correccion `owner-check` aplicada a `resolveAccountGuard` en `server/commercial/billingUnblock.ts` (+8 lineas): tras derivar `accountIdCuenta` de la identidad de Cuenta, se lee en la MISMA transaccion `accountRoot/accounts/<accountIdCuenta>` y se rechaza con `UnblockFault('conflict')` si falta el documento o si `identityKey !== video.identityKey`, `schemaVersion !== 1` o `unit !== 'video_seconds'`. La lectura queda en el read set (un cambio concurrente aborta). Nunca se lee la guarda de B ni se escribe. La ruta legacy (`seam` ausente) queda intacta.
3. Dos pruebas nuevas en `server/commercial/billingUnblock.emulator.mjs` (+77 lineas), conservando las existentes:
   - `successor: swapping identity A to account B after the last receipt rejects, keeps Video blocked and leaves B untouched` (positiva de aislamiento + sabotaje tardio).
   - `successor: an identity already pointing at another account rejects before any write` (negativa: identidad ya alterada antes del inicio, sin escrituras).
4. Suite del emulador: TODA aprobada.
5. `npm test` (vitest): sin regresiones atribuibles al cambio.

## Ajuste respecto de la propuesta

La propuesta capturaba la firma de Video (`rootSignature`) ANTES de la llamada, cuando la fase 0 aun no habia escrito el `unblock_requested`/continuidad. Para que "sin escrituras de Video despues del sabotaje" sea exacto, la prueba 1 captura la firma en el punto de sabotaje (`receiptCalls===2`), es decir despues de las escrituras legitimas de fase 0 y de la confirmacion de Cuenta, y justo antes de la transaccion de liberacion. El resto de la propuesta se aplico sin cambios; los nombres del codigo real coinciden.

## Entorno y comandos exactos

El emulador aislado ya estaba levantado en `127.0.0.1:8198` (proyecto `demo-vistavo-financial`). Verificacion: GET a `http://127.0.0.1:8198/v1/projects/demo-vistavo-financial/databases/(default)/documents/probe/x` respondio 403 (reglas deny-all). No se inicio, detuvo ni reinicio ningun emulador. No se uso el puerto 8185.

Ademas de las variables del encargo, el guard `financialOwnedRootGuard.mjs` exige `LV_REVIEW_CONTRACT=1`, `METADATA_SERVER_DETECTION=none` y `CODEX_HOME` ausente (no venian en el brief; sin ellas la suite falla cerrado en `assertScope`).

```powershell
$env:PATH="C:\Users\rob62\AppData\Local\LinguistVision\tools\node-v24.13.0-win-x64;"+$env:PATH
Remove-Item Env:OPENROUTER_API_KEY, Env:OPENROUTERROB_API_KEY, Env:CODEX_HOME, Env:NODE_OPTIONS -ErrorAction SilentlyContinue
$env:NODE_ENV='test'; $env:FIRESTORE_EMULATOR_HOST='127.0.0.1:8198'; $env:GOOGLE_CLOUD_PROJECT='demo-vistavo-financial';
$env:GCLOUD_PROJECT='demo-vistavo-financial'; $env:LV_FINANCIAL_REGRESSION='1'; $env:LV_REVIEW_CONTRACT='1'; $env:METADATA_SERVER_DETECTION='none'
npx tsc --noEmit
node --no-network-family-autoselection --import tsx --test server/commercial/billingUnblock.emulator.mjs > salida-suite.txt 2>&1
npm test > salida-npm-test.txt 2>&1
```

## Cifras (salidas reales)

- `tsc --noEmit`: exit 0 (sin diagnosticos).
- Suite emulador: `tests 91`, `pass 91`, `fail 0`, `cancelled 0`, `skipped 0`, `todo 0`; `duration_ms 544301`; limpieza `Synthetic unblock-1.4b cleanup total: 99/99`. Ambas pruebas nuevas aparecen `✔` (5.597s y 4.829s).
- `npm test`: `Test Files 4 failed | 118 passed | 12 skipped (134)`; `Tests 2 failed | 1764 passed | 113 skipped (1879)`.

## Fallos de `npm test` (todos preexistentes, ninguno en archivos tocados)

1. `scripts/validateListeningScripts.test.ts`: `SyntaxError: Invalid or unexpected token` (error de parseo del propio archivo).
2. `server/commercial/web/voiceQuotePreview.test.mjs`: `No test suite found in file`.
3. `server/commercial/web/reviewBrowserNodeFixtures.test.ts`: `expected 1 to be +0` (el helper de navegador sintetico devuelve exit 1).
4. `server/commercial/billingDrainSection.test.ts` > `a drain that reports error or skipped changes neither the status nor the failure count`: `Test timed out in 5000ms`.

Los 4 archivos no referencian `billingUnblock` (busqueda literal vacia). Con mis cambios guardados (`git stash`) y `npm test` sobre el commit base, el resultado fue identico: `Test Files 3 failed | 119 passed | 12 skipped`; `Tests 1 failed | 1765 passed | 113 skipped`. Es decir, los fallos 1-3 existen en la base. El fallo 4 (timeout de `billingDrainSection`) es intermitente por carga paralela: al correr ese archivo solo, `Test Files 1 passed`, `Tests 38 passed (38)`. Ningun fallo se origina en mi cambio.

## Que NO se pudo comprobar

- No se ejecuto el lanzador aislado oficial (`scripts/runUnblockFenceEmulator.mjs` / `runUnblockFenceIsolated.ps1`): segun el encargo, lo ejecuta Codex al certificar.
- No se probo concurrencia real durante la transaccion (Firestore daria reintento/aislamiento, pero no se midio).
- La atestacion del seam certifica clientes de Firestore, no la identidad fisica de la base ni la autoridad productiva.
- La ruta legacy sin `seam` conserva la carrera original y no recibe esta defensa.
- `npm test` completo tiene fallos preexistentes ajenos al alcance; no se corrigieron (fuera de los archivos permitidos).

## Commit

Commit local en la rama, sin push: `1bb410284005c138c437af4911e74f82e37c6220`.

