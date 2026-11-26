# LV-019.B · Bundle candidato real con navegador móvil simulado

**26 nov 2026 · local, sintético y sin publicación.** En la base `a14eb9353d4da7e09cfedefda109168bd8c84158`, `npm run build:candidate` compiló la candidata y el guion [qaRealCandidateMobile.browser.mjs](../../../scripts/qaRealCandidateMobile.browser.mjs) abrió el bundle generado en Chromium de escritorio. El interruptor de revisión fue el del propio `vite.pilot.config.ts` para modo candidato; no se inyectaron ni reemplazaron módulos de aplicación ni el SDK de Firebase.

## Resultado del corte

- Acceso por correo **simulado**: el SDK incluido en el bundle recibió respuestas inventadas desde la interceptación del navegador. La API local respondió con una cuenta, un proyecto y una traducción inventados. El identificador de proyecto `vistavo-prod` en esa configuración es exigido por el cliente; la clave y los tokens fueron ficticios y no se usaron credenciales reales. No se usó Auth Emulator ni el servicio real de Google.
- Se recuperó el proyecto simulado, se editó una frase, se guardó la revisión y se descargaron TXT y SRT. Los contenidos y tiempos de ambos archivos coincidieron exactamente con las muestras.
- No hubo inicio de procesamiento: **cero POST de jobs**. La selección de voz permaneció deshabilitada y «solo texto» seleccionada. No se generó audio.
- En los tamaños de ventana 320, 390 y 428 px, el ancho de documento fue igual al ancho de ventana. Se enviaron eventos táctiles sintéticos a los botones. No se probó un teléfono físico.
- Se observaron cero excepciones de página y cero solicitudes inesperadas interceptadas. Los dos servidores propios y el Chrome hijo terminaron; la carpeta de perfil sintético se conserva para inspección. El diagnóstico acotado de Chrome clasificó su salida en la categoría genérica `sandbox`: la clasificación sola no identifica su causa ni acredita un fallo o su ausencia.

La historia utiliza una API de memoria y respuestas Firebase inventadas, no los servicios, el ledger o los adaptadores de producción. El original MP4 y la transcripción se precargan como metadatos/resultado simulados: **no verifica carga de video, ejecución de IA, audio, saldo, aislamiento de dos usuarios ni revocación**. La interceptación CDP, proxy y resolución DNS del ensayo son defensas parciales y **no son un cortafuegos del sistema**; procesos y dependencias nativas no están completamente aislados. Una comprobación de hashes antes y después no equivale a una instantánea inmutable.

## Evidencia

La última ejecución usó Node 24.13.0, el Chromium headless fijado por el repositorio y 18 archivos del bundle. El snapshot ordenado de sus rutas y SHA-256 dio `1691bb7143201af0abe95e874f85eb049d9ddc3087d4df6e75663c6381d1bc54` antes y después. SHA-256 del manifiesto Vite: `555a326af58f71d2361aca14d605ef3f945e9eed5e31b65cce3e589850b3fbac`; del `cloudCandidate.js`: `fd554f151c004be7cfe5b1ac33968303ad73b4c64f33252a34ece6c3fb163b2a`.

| Archivo o resultado | SHA-256 |
| --- | --- |
| `scripts/qaRealCandidateMobile.browser.mjs` | `669d005f660dc4fcfa7bdaf6d0ba3b92346788f990e19c380b02966d0e843135` |
| `scripts/runRealCandidateMobile.ps1` | `4f3170b69cc6503ef9f8bf40aaffb50d9caa350e83e7f2ae4ada2d5a2bc087da` |
| `browser-eb68c865-5b66-44bd-a4e1-17e0caa0b798/result.json` | `ef433f06057a5d798048944f55af3efb63466c33a1a314ed5951fc0c33daa6c3` |
| `build.stdout.txt` | `ed138f15cfe6581e3f61e5072abb59cd1e25888e4bbad157556edc2cd5bc3587` |
| `browser.stdout.txt` | `94a655d85ba5d63e03cdb5b26d1213407addf94871ec90685f65f0654d823d69` |

Los tres últimos archivos están bajo `outputs/browser-real-build-b8f5c876-80b2-4384-8760-f9b4467b3837/` del worktree de este corte. `outputs/` no viaja en Git. Los siete controles del arnés anterior y su guard de red también pasaron; no son la historia integrada real.

Las huellas de los guiones corresponden a los bytes exactos ejecutados en esta PC. Al obtenerlos en otra instalación, Git puede cambiar LF a CRLF; comparar también los blobs normalizados antes de atribuir esa diferencia a un cambio de contenido.

Se conservan dos primeros intentos **INCONCLUYENTES** bajo `outputs/browser-real-build-da10c1f4-7922-47fc-a756-b23cc83fcfe5/`: el primero pulsó el botón antes de inicializar autenticación (`browser-6761a417-e63a-4cb0-848c-0dd7c2c4320f/result.json`, SHA `64d6c0c6845cb524414224ab36b234a840c704d800bc33fadc6b3a4c587ec59d`); el segundo llegó hasta ambas descargas, pero el guion consultó `input.disabled` sin considerar el `fieldset` padre (`browser-ad934d0d-2683-4e85-9051-2604ec96d2ac/result.json`, SHA `9e4c68938e58d6909c1af4ed9edd7ea854c709bf3ebf7d588dc1ce1162c030e4`). Ambos cerraron sus servidores y navegador. Se cambió el guion para esperar la inicialización y comprobar `:disabled`; luego se ejecutó la versión final y se obtuvo el resultado anterior. Un PASS intermedio con otro hash no sustituye esa ejecución final.

## Repetición y límites

En Windows, con dependencias ya instaladas, Node 24.13.0 con npm y el navegador fijado en `reviewBrowserBinaryIdentity.mjs` disponibles, desde la raíz del repositorio:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/runRealCandidateMobile.ps1
```

El ejecutor crea una carpeta nueva en `outputs/`, construye la candidata y ejecuta la historia con un ambiente limpio y perfil sintético, sin leer credenciales ni iniciar emuladores. La ruta de Node puede indicarse con `LV_NODE24`; el ejecutable de Chromium sigue fijado a una ubicación y un hash de esta PC, por lo que en otra máquina hay que preparar y revisar esa dependencia antes de repetir. Conservar los resultados de un fallo o interrupción; no borrar otros procesos o carpetas.

Antes de aceptar la funcionalidad, siguen pendientes una prueba independiente de este guion, integración con backend y voz reales, teléfono físico, videos de 2–3 minutos, suspensión/reanudación, recuperación en otro dispositivo y las puertas financieras/de privacidad. Esta evidencia no autoriza habilitar procesamiento ni voz en Vistavo.app.
