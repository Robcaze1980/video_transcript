# LV-019.B · Cierre del saldo · Pase 1 (candidata del cerco de Cuenta)

Eres el autor de código en T3. Trabajas SOLO en tu worktree (rama `lv019b/t3-saldo-cierre-20261127`). Lee primero `AGENTS.md` (secciones «Coordinación y entrega» y «Metodología») y respétalo. Español neutro latinoamericano en todo texto para el dueño (costo, video; sin voseo).

## Contexto mínimo

- Vistavo usa dos bases Firestore independientes sin transacción conjunta: Video (`(default)`) y Cuenta (`vistavo-live`). El desbloqueo auditado de Video (`server/commercial/billingUnblock.ts`) consulta a la Cuenta y luego libera Video en una transacción final.
- La candidata `667b2f0` integra la recuperación con cerco. Una contraprueba real mostró una carrera: si una incidencia nueva llega a la Cuenta DESPUÉS de la última lectura y ANTES de la transacción final de Video, Video quedaba abierto (22/23).
- El commit base de esta rama contiene trabajo SIN CERTIFICAR de una sesión cerrada: el núcleo de la corrección «incidencia tardía» en `server/commercial/billingUnblock.ts` (+81 líneas), unas 30 pruebas nuevas en `server/commercial/billingUnblock.emulator.mjs` (+195 líneas) y ajustes menores a 5 scripts de aislamiento. Nunca se confirmó que esas pruebas pasen. No lo supongas: compruébalo.
- Dos revisores independientes señalaron una posible mezcla de cuentas: `resolveAccountGuard` toma el `accountId` de la identidad de Cuenta pero no valida que el documento `accounts/<accountId>` nombre esa identidad. La propuesta exacta de corrección y sus dos pruebas están en `docs/evidence/lv019-b-t3-saldo-cierre-20261127/propuesta-owner-check.md` (salida previa de otro hilo T3: es una PROPUESTA, no código aceptado; ajústala al código real si algún nombre difiere).

## Objetivo del pase 1 (en este orden)

0. Prepara el entorno: `cmd /c mklink /J node_modules C:\Users\rob62\Documents\Codex\2026-11-11\vamos-a-continuar-linguistvision-en-esta-2\node_modules` (si no existe). Verifica el emulador sin tocarlo: una lectura GET de `http://127.0.0.1:8185/v1/projects/demo-vistavo-ledger/databases/(default)/documents/probe/x` DEBE responder 403. Si responde otra cosa, DETENTE e informa; no inicies ni detengas emuladores.
1. `tsc --noEmit` (con Node 24, ver comandos). Debe pasar.
2. Aplica la corrección «owner-check» de la propuesta a `server/commercial/billingUnblock.ts` y añade sus dos pruebas (cambio de `accountId` de A hacia B tras la última lectura; identidad ya alterada antes de empezar) a `billingUnblock.emulator.mjs`. Conserva las pruebas existentes.
3. Ejecuta la suite del emulador (comando abajo). Objetivo: TODAS aprobadas. Si algo falla, diagnostica la causa real. Corrige el código de producción solo cuando la prueba sea correcta; corrige la prueba solo cuando sea defectuosa y explica por qué. NUNCA debilites ni borres una prueba negativa para hacerla pasar.
4. Ejecuta `npm test` (vitest, excluye `outputs/`) y confirma que no hay regresiones.
5. Haz commit local en tu rama (sin push) con mensaje claro y deja un resumen en `docs/evidence/lv019-b-t3-saldo-cierre-20261127/RESULTADO-pase1.md`: qué cambiaste, comandos exactos, cifras (aprobadas/falladas/omitidas), qué NO pudiste comprobar.

## Comandos (PowerShell)

```
$env:PATH = "C:\Users\rob62\AppData\Local\LinguistVision\tools\node-v24.13.0-win-x64;" + $env:PATH
Remove-Item Env:OPENROUTER_API_KEY, Env:OPENROUTERROB_API_KEY -ErrorAction SilentlyContinue
$env:NODE_ENV = 'test'; $env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8185'
node --no-network-family-autoselection --import tsx --test server/commercial/billingUnblock.emulator.mjs
npx tsc --noEmit
npm test
```

## Límites (obligatorios)

- Puedes modificar SOLO: `server/commercial/billingUnblock.ts`, `server/commercial/billingUnblock.emulator.mjs` y archivos nuevos bajo `docs/evidence/lv019-b-t3-saldo-cierre-20261127/`. Para cualquier otro archivo (p. ej. `server/account/*`), DETENTE y justifícalo en el informe; no lo toques.
- No inicies, detengas ni reinicies emuladores. No hagas push. No uses red externa, claves, ni llames a ningún modelo desde las pruebas. No toques otros worktrees ni el repositorio principal.
- Tope: 60 llamadas a herramientas. Si repites el mismo comando fallido 3 veces sin una hipótesis nueva, DETENTE: conserva la salida y responde INCONCLUYENTE con el bloqueo exacto. Un comando que tarda más de 8 minutos se corta; informa.
- No afirmes que algo pasó sin haber visto la salida del comando. Tu informe debe distinguir lo ejecutado de lo supuesto.

## Entrega

Tu último mensaje debe terminar con este bloque (sin cambiar las etiquetas):

=== RESUMEN FINAL ===
RESULTADO: PASS|FALLA|INCONCLUYENTE
EVIDENCIA: (comandos y cifras reales, hash del commit)
NEGATIVOS: (qué pruebas negativas protegen la corrección y qué no se pudo probar)
BLOQUEOS: (lo que impidió terminar, o ninguno)
=== FIN RESUMEN ===
