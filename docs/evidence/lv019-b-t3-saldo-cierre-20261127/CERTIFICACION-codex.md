# LV-019.B · Cierre del saldo · Certificación de Codex (27 nov 2026)

Rama: `lv019b/t3-saldo-cuenta-guarda-20261127`. Commits certificados, todos locales y sin publicar:

| Commit | Qué es | Quién lo escribió |
| --- | --- | --- |
| `667b2f0` | Candidata del cerco de Cuenta de la sesión anterior (contraprueba de la carrera tardía: 22/23). | Sesión anterior |
| `837fd88` | Instantánea del trabajo sin guardar de esa sesión (núcleo de la corrección «incidencia tardía» y sus pruebas), tomada sin tocar su carpeta. | Sesión anterior |
| `fbf01bf` | Pase 1: validación `owner-check` en `resolveAccountGuard` (el documento `accounts/<id>` debe nombrar la misma identidad) y dos pruebas de mezcla de cuentas. | T3 (DeepSeek v4.1 flash), verificado por Codex |
| `e5f76f7` | Pase 2: guarda de red propia para la regresión de Cuenta (`scripts/accountEmulatorNetworkGuard*.cjs`), fijada a 8185/`demo-vistavo-ledger`; la guarda financiera no cambió. | T3 (DeepSeek v4.1 flash), verificado por Codex |

El archivo `RESULTADO-pase1.md` de T3 cita el hash `1bb4102`, de un estado anterior a su último ajuste; el commit final del pase 1 es `fbf01bf`.

## Lo que Codex comprobó por su cuenta (no se aceptó el resumen de T3)

Todo se ejecutó en emulador local con datos sintéticos; no se tocó ningún saldo real ni la nube.

| Comprobación | Resultado |
| --- | --- |
| `tsc --noEmit` sobre `fbf01bf` | exit 0 |
| Suite del desbloqueo `billingUnblock.emulator.mjs` (emulador 8198, entorno completo de la guarda) | 91/91 aprobadas, limpieza 99/99 (`verificacion-codex/verif-pase1-full.*`) |
| Mutación: quitar la comprobación `identityKey` del `owner-check` | fallan exactamente las dos pruebas nuevas («Missing expected rejection»); archivo restaurado y verificado por hash (`mut-ownercheck-key.*`) |
| `npm test` | 3 archivos y 1 prueba fallan, los mismos que la base de esta línea (`validateListeningScripts`, `voiceQuotePreview`, `reviewBrowserNodeFixtures`); ninguno referencia el desbloqueo. El cuarto fallo que T3 vio (`billingDrainSection`, tiempo de espera) no se repitió. |
| Regresión financiera oficial completa sobre `fbf01bf` (`run-f455e130`) | PASS: 559 pruebas, 554 aprobadas, 0 fallos, 5 omitidas por voz pausada; raíces sintéticas vacías al final (`result-financiera-run-f455e130.json`) |
| Regresión de Cuenta protegida sobre `e5f76f7` (`run-a2f34feb`) | PASS: 38/38, limpieza 51/51 |
| Lanzador aislado del desbloqueo sobre `e5f76f7` (`run-7577e8e3`) | PASS: 5/5 |

Los «seis fallos» que mencionaba el informe de la sesión anterior no aparecen en esta versión: la batería completa dio 0 fallos.

## Intentos fallidos y desvíos (conservados como evidencia)

- Primer hilo T3 del pase 1 (`7502a175`): 45 minutos investigando un entorno equivocado de mi encargo (apuntaba al emulador 8185; esta línea exige 8198). El dueño lo detuvo y su parche quedó en `encargos/old-thread-diff-pase1.patch`; se reemplazó por un hilo limpio con el entorno correcto (`MSG-pase1b.txt`).
- Hilo de GLM «carrera integrada» (`3abe4beb`) de la sesión anterior: se repitió hasta unos 700 mil caracteres; no es una revisión válida y el dueño lo detuvo.
- Mi primera repetición de la suite falló en milisegundos por mi consola (definía `HOME`, que la guarda prohíbe). Conservada en `verif-pase1-full-intento1-HOME.*`.
- Primer intento de la batería financiera: su lanzador rechaza un acceso directo (junction) a `node_modules`; se usó una copia real.
- Segundo intento: «Dedicated synthetic roots must start empty» por restos de mi prueba de mutación; se reinició el emulador 8198 limpio.
- Primer intento de Cuenta protegida: falló por una **inconsistencia real de esta línea**: su lanzador usaba la guarda financiera, fijada a 8198, mientras Cuenta exige 8185. Se corrigió en el pase 2 (`e5f76f7`).

## Revisión doble por T3 (código que mueve saldo: dos revisores)

Paquete autocontenido de 56 KB, sin herramientas (`revision-doble/review-saldo-fbf01bf.in.txt`).

| Revisor | Resultado | Notas |
| --- | --- | --- |
| GLM (`~z-ai/glm-flash-latest`, alias dinámico; modelo servido no observable) | PASS | Sin secuencia concreta que deje Video abierto con saldo bloqueado ni libere la cuenta equivocada. |
| DeepSeek (`deepseek/deepseek-v4.1-flash`) | PASS con 7 hallazgos no demostrados | Adjudicación abajo. |

Adjudicación de los hallazgos de DeepSeek, contrastados con el código:

1. **Atomicidad incidente→guarda en Cuenta (hipótesis, media): refutada.** `blockVideoBilling` crea el registro del incidente y crea o actualiza la guarda en una sola transacción (`server/account/backend.ts:225-243`).
2. **La ventana real lectura→commit no se ejercita (media): límite aceptado y declarado.** Las pruebas inyectan la incidencia antes de la transacción final; el aborto por read set descansa en el comportamiento documentado de Firestore y no se midió concurrencia real. Seguimiento: tarea 1.4c.
3. **Guarda con `blocked:false` (media-baja): refutada.** La guarda se crea con `blocked:true` y Cuenta la borra al revisar todos los incidentes (`backend.ts:303-333`); `billingHold` trata cualquier otro valor como invariante.
4. **Comentario de fase 0 inexacto (baja): aceptado.** La sonda previa es una transacción aparte y no ata la creación de auditoría; no libera nada. Corregir el comentario en la integración.
5. **`identityKeyOf` frente a `videoIdentityOf` (baja): aceptado.** El chequeo estricto cubre al laxo y falla cerrado; unificar en la integración.
6. **Filas avanzadas con la guarda viva (baja): intencional**, auditable por `videoBlocked:true`; documentar.
7. **Ambigüedad de identidad con `where(...).limit(2)` (hipótesis, baja): límite aceptado.** Exigiría dos identidades de Video con el mismo `accountId`, que el diseño no permite; no se demostró alta concurrente.

Costo: el saldo de OpenRouter pasó de US$5.49 a US$4.77 en este tramo (≈US$0.72, que incluye los dos hilos de autor, el hilo descartado y las dos revisiones); el costo por hilo no se midió.

## Lo que esta certificación NO cubre

- La ruta legacy sin `successor` conserva la carrera original.
- No se acredita autoridad/IAM real, contrato entre servicios, producción ni saldo real; la atestación certifica clientes de Firestore, no la identidad física de las bases.
- No hay concurrencia real medida durante la transacción final.
- Esta versión **no está integrada** en `codex/vistavo-continue-20261127` (las dos líneas modifican `billingUnblock.ts`), ni publicada, ni desplegada.
- Voz: 5 pruebas omitidas por voz pausada, sin cambio.
- Quedan los límites de diseño de la tarea 1.4c y los pasos 1.7 (regresión final, T3 y revisión Gemini) y la pieza 3.

Dictamen de Codex: **la corrección de la carrera tardía y la validación `owner-check` quedan certificadas solo en local, solo para la ruta con `successor` en emulador**, con las dos revisiones PASS y las tres regresiones oficiales en verde sobre los commits indicados. La integración con la línea principal y la actualización de los documentos activos están pendientes.

## Actualización posterior (27 nov 2026, tarde)

La integración con la línea principal se hizo después de esta certificación: ver [INTEGRACION.md](../lv019-b-t3-saldo-integracion-20261127/INTEGRACION.md). La línea `codex/vistavo-continue-20261127` avanzó en local a esa integración (sin publicar) y los documentos activos se actualizaron. Lo que esta certificación declara como no cubierto sigue sin cubrir.

La rama `codex/vistavo-continue-20261127` se publicó en GitHub el 27 nov (noche) por orden de Rob; el «sin publicar» de este registro describe el momento de la certificación.
