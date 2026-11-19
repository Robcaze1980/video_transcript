# tools/clean-env · ambiente limpio para la prueba con navegador

El lanzador `scripts/runReviewedTranslationBrowserEmulator.mjs` es estricto a propósito: rechaza cualquier variable de entorno fuera de una lista cerrada. Estos scripts lo ejecutan desde un proceso con ambiente limpio **sin debilitar sus reglas** (no cambian el lanzador ni lo evitan). Solo datos sintéticos; sin claves, `HOME`, `NODE_OPTIONS` ni ambiente del shell. Requieren Windows, Node 24.13.0 (`%LOCALAPPDATA%\LinguistVision\tools\node-v24.13.0-win-x64`, o `LV_NODE24` apuntando al mismo binario), Firebase CLI global y Java 24.

Orden (guía completa: `docs/reviews/LV-019-B-navegador-integrado-emuladores-preparacion-2026-11-17.md`):

1. `powershell -File tools/clean-env/new-boot.ps1` → imprime la carpeta `boot-<UUID>`.
2. `powershell -File tools/clean-env/clean-launch.ps1 -Boot <boot> --check-environment`, luego `--prepare`. Revisar el manifiesto, la configuración (solo loopback, puertos 18765–18769) y el JAR copiado antes de seguir.
3. `powershell -File tools/clean-env/start-emulators.ps1 -Boot <boot> -Config <config-*.json> -Cache <cache-*>` y esperar «All emulators ready» en `<boot>\emulators.log`.
4. `clean-launch.ps1 -Boot <boot> --attest <manifest>`; revisar el comprobante.
5. `clean-launch.ps1 -Boot <boot> --run <manifest> <proof>`.
6. `powershell -File tools/clean-env/stop-emulators.ps1 -Boot <boot>`: detiene solo el árbol de procesos guardado en `emulators.pid` y comprueba que los puertos queden libres.

Límites: el guard del lanzador y estos scripts no son un cortafuegos del sistema; Firebase CLI y Java quedan fuera del guard. La historia usa Chromium headless con tamaño móvil simulado y un plugin de prueba que sustituye el interruptor del editor: **no prueba `npm run build:candidate` en navegador ni un teléfono físico.**

## Variables extra de `start-emulators.ps1` (añadido a la guía)

La guía de preparación solo pide para los emuladores: perfil/temporales propios sin credenciales, `FIREBASE_EMULATORS_PATH` y `PATH` con Java y System32. `start-emulators.ps1` añade tres variables **que no están en la guía**; se dejaron a propósito y conviene no quitarlas sin repetir la prueba:

- `HOME`: apunta a la carpeta sintética `emu-profile`. Evita que Firebase CLI o Java resuelvan configuración, caché o credenciales desde el `HOME` real del usuario.
- `CI=true`: modo no interactivo; el CLI no pide confirmaciones ni abre avisos durante el arranque.
- `FIREBASE_CLI_DISABLE_UPDATE_CHECK=true`: evita la consulta de actualizaciones del CLI, una conexión de red innecesaria.

Ninguna lleva credenciales ni datos reales. Con ellas se verificó el ciclo de arrancar y parar los emuladores y la historia con navegador (PASS, 20 nov 2026). Si se eliminan, repetir `--attest` y `--run`.
