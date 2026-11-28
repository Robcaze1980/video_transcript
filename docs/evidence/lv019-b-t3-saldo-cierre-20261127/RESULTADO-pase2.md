# LV-019.B pase 2 - Regresion de Cuenta protegida en la linea del cerco

Fecha: 27 nov 2026. Rama: `lv019b/t3-saldo-cuenta-guarda-20261127` (base: commit del pase 1 `fbf01bf`).
Autor: Codex (T3). Sin push.

## Problema

En esta linea, `node scripts/runAccountProtectedRegressionEmulator.mjs --run <manifiesto>` fallaba a
los ~2 s con `Synthetic review network guard requires the fixed demo environment`. El lanzador de
Cuenta cargaba `scripts/financialEmulatorNetworkGuard.cjs`, que en esta linea esta fijado a
`127.0.0.1:8198` / `demo-vistavo-financial` (aislamiento de la regresion financiera), mientras que el
lanzador de Cuenta y su fixture (`server/account/backendProtected.emulator.mjs`) exigen
`127.0.0.1:8185` / `demo-vistavo-ledger`.

## Cambio aplicado

Minimo y sin tocar el guard financiero:

- Nuevos `scripts/accountEmulatorNetworkGuard.cjs` y `scripts/accountEmulatorNetworkGuard.windows.cjs`,
  copias de `git show df11284:scripts/financialEmulatorNetworkGuard.cjs` y `.windows.cjs`
  (fijados a `8185` / `demo-vistavo-ledger`). En la copia windows se ajustaron las dos referencias al
  nombre del archivo (`require('./accountEmulatorNetworkGuard.cjs')` y el comentario de uso).
- `scripts/runAccountProtectedRegressionEmulator.mjs`: `guardFile` apunta a
  `scripts/accountEmulatorNetworkGuard.cjs` y la lista `tracked` (fijada por hash en el manifiesto)
  usa `scripts/accountEmulatorNetworkGuard.windows.cjs`.
- `scripts/financialEmulatorNetworkGuard.cjs` y `.windows.cjs` NO se modificaron.

## Comandos y resultados reales

Entorno: Node `v24.22.3` (`C:\Program Files\WindowsApps\OpenAI.CodexPrimaryRuntime.../dependencies/node/bin/node.exe`),
con `NODE_OPTIONS`, `GOOGLE_APPLICATION_CREDENTIALS`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY` y `K_SERVICE`
quitados del entorno. `node_modules` es copia real (robocopy, no junction).

1. `node node_modules/typescript/bin/tsc --noEmit` -> exit 0.
2. `node scripts/runAccountProtectedRegressionEmulator.mjs --prepare`
   -> `Synthetic manifest prepared: outputs\lv019-b-account-full-manifests\manifest-c02235b7-786c-4df9-9396-d2d15acbe7ef.json`.
3. `node scripts/runAccountProtectedRegressionEmulator.mjs --run outputs\lv019-b-account-full-manifests\manifest-c02235b7-786c-4df9-9396-d2d15acbe7ef.json`
   -> exit 0: `Synthetic Account full fixture: PASS; evidence: outputs\lv019-b-account-full-runs\run-c2a3462e-d27f-4427-ad86-dccbc425c202`.

Cifras del `result.json` de esa corrida:

- `pass: true`, `exitCode: 0`, `signal: null`, `timedOut: false`, `interrupted: false`, `logsReadable: true`.
- `checks`: `guardActive: true`, `guardDeniedDuringRun: false`, `syntheticTsxIpcRequests: 2`,
  `tests: true`, `passed: true`, `noFailures/noCancelled/noSkipped/noTodo: true`, `cleanups: true`.
- TAP: `# tests 38`, `# pass 38`, `# fail 0`, `# cancelled 0`, `# skipped 0`, `# todo 0`.
- Fixtures: `Synthetic Account full cleanup total: 51/51` (51 verificaciones de limpieza).
- Integridad: `manifestSha256 == manifestAfterSha` (`8c927252058971bb2d442b9296d3898c0a8d708f6d3477659fadb3db57ab1c52`),
  `nodeUnchanged: true`, `mismatchAfter: []`, `pathChanges: []`.
- `stderr`: `VISTAVO_FINANCIAL_NETWORK_GUARD_ACTIVE SELF_CHECK=PASS` presente; sin `VISTAVO_REVIEW_NETWORK_DENIED`.

Ruta de la evidencia del lanzador:
`outputs/lv019-b-account-full-runs/run-c2a3462e-d27f-4427-ad86-dccbc425c202/result.json`
(`fixture.stdout.tap`, `fixture.stderr.log`, `manifest.json`, `environment.json` en la misma carpeta).

## Que NO se pudo comprobar

- El directorio `outputs/` esta excluido por `.git/info/exclude`, por lo que la evidencia cruda de la
  corrida no queda versionada; permanece en disco en esta linea. El hash del manifiesto si queda fijado
  por el propio lanzador.
- No se ejecuto el guard windows (`accountEmulatorNetworkGuard.windows.cjs`) como prueba independiente;
  solo se verifico que el lanzador lo incluye en `tracked` y que `tsc` pasa. Su copia conserva los
  controles negativos de la version de `df11284`.
- No se probaron otros entornos ni se toco el emulador de 8198.
