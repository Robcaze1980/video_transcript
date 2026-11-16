# LV-019.B · Integración del video con transcripción y traducción

## Estado incremental · carga y fixture de texto local · 16 nov 2026

La carga privada sintética y el puente de texto por el mismo origen están probados en candidata local/emuladores. `textFixture` crea una muestra española fija independiente del MP4, permite editarla y produce un placeholder inglés determinista; no son resultados de reconocimiento o traducción AI.

Aceptación local: propietario carga/descarga MP4 con SHA-256 igual, revisa la muestra, descarga ES/EN TXT/SRT; otro usuario recibe 404; revisiones obsoletas 409; borrar el MP4 elimina el doc de muestra. `providerCalls=0`, pagos/AI real apagados. Evidencia: [aceptación](../../outputs/lv019-b-video-text-20261116/local-text-fixture-acceptance-20261116.json).

Límites: video en RAM que desaparece al reiniciar; fixture no usa bytes del MP4 y no invoca proveedor. Sin E2E de navegador, GCS/IAM, Auth revocation, precio, pagos o producción. LV-007.GCS se verificó en fase independiente y esta candidata no apunta al bucket. Qwen PASS con residuales menores documentados; revisiones completas en `outputs/lv019-b-video-text-20261116/`. Siguiente: verificar login/descargas en navegador local y diseñar puente privado a Cloud Run interno, sin cambiar IAM ni publicar. No Cloud SQL.

## Objetivo

Desde la cuenta Vistavo, permitir que un usuario autenticado suba un video privado en español, solicite transcripción en español y traducción al inglés, revise el resultado y descargue TXT/SRT. La voz en inglés queda como paso posterior y opcional.

## Arquitectura actual confirmada

- El panel publicado usa Firebase Auth y la API de cuenta en Firestore `vistavo-live`. Los proyectos de esa API son texto/SRT; sus capacidades de transcripción, traducción, voz y pagos son `false`.
- La API de cuenta está aislada deliberadamente: `server/account/runtime.ts` comprueba acceso a `vistavo-live` y denegación a `(default)`. `deploy/google-cloud/account.plan.json` excluye GCS, IA, Jobs y acceso a la base candidata.
- El backend privado de archivos/IA vive aparte: Firestore `(default)`, raíz `vistavo/candidate-v1`, objetos GCS bajo `candidate-files-v1`, API `/api/cloud/*`. Su catálogo es `ai-candidate-v1` y las unidades son simuladas (`test-unit`); no representan precio ni crédito comercial.
- El `CloudCandidate` existente es una experiencia privada/local de ensayo, con una prueba sintética. No es la página de cuenta publicada ni evidencia de procesamiento disponible a clientes.
- Las dos APIs derivan sus registros de propiedad del UID Firebase verificado, pero crean IDs internos de cuenta independientes. No se deben igualar IDs, copiar saldos ni ampliar los permisos de `vistavo-account-api`.

## Incremento técnico propuesto

1. Enlazar la experiencia de cuenta y el flujo de video por la misma sesión Firebase y el mismo ID token, enviándolo por dos rutas del mismo origen a sus APIs respectivas. Cada servicio vuelve a verificar el token revocado y deriva su propio propietario desde `uid`; el navegador no elige `accountId`.
2. Añadir al área de cuenta la carga, estado, cancelación, revisión y descarga usando el contrato privado ya existente de archivos/IA. Mantener la cuenta financiera y los proyectos de texto/SRT en `vistavo-live`; no replicar el ledger en `(default)`.
3. Hacer que la integración quede desactivada por defecto en Hosting y no mostrar las unidades `test-unit` como precio o saldo. Se puede validar en emulador/candidata con fixtures sintéticas y negativos de otro usuario.
4. Antes de una prueba de proveedor con el video de Rob, registrar el coste estimado y confirmar que el alcance autorizado cubre esa llamada. Antes de permitir uso de clientes, falta decisión comercial de tarifas, cotización/redondeo, reserva/liberación de saldo, cancelación/reconciliación y límites de video.
5. No desplegar esta integración ni activar facturación/procesamiento de clientes como parte de este diseño. No crear Cloud SQL.

## Aceptación para el puente local

- Cuenta autenticada puede subir únicamente al espacio privado propio; contenido y resultados no aparecen a otro usuario.
- Transcripción ES y traducción EN se pueden revisar y descargar TXT/SRT sin que el endpoint invente unidades o descuente un saldo.
- Reintento idempotente conserva el mismo trabajo; estado `unknown` bloquea duplicados hasta reconciliar; cancelación y borrado retiran acceso y purgan objetos según el contrato existente.
- Sin token, con token revocado/no verificado, origen extraño, propietario ajeno o artefacto vencido, la solicitud falla cerrada.
- Las rutas de cuenta y de archivos permanecen separadas; no hay acceso nuevo de una identidad al Firestore ajeno.
- No se anuncia precio, no se habilitan pagos y no se publica hasta completar los criterios de producto, coste, seguridad y aprobación aplicables.

## Revisión independiente

Kimi recibió una consulta arquitectónica acotada (LV-019.B-ARCH-01) por el respaldo OpenRouter autorizado. La respuesta terminó por límite (`finish_reason=length`) tras 9.383 tokens de entrada y 2.048 de salida; faltó el bloque final y el último párrafo quedó truncado. Se clasifica INCONCLUYENTE y no se reintenta. El informe señaló correctamente que cada servicio debe resolver la propiedad desde el Firebase UID; la afirmación de que los IDs internos de cuenta deban coincidir no se adopta, porque ambas bases crean identificadores independientes. Codex verificará localmente el contrato de identidad antes de codificar.

Evidencia: `outputs/lv019-b-video-text-20261116/kimi-architecture-{prompt,response,status,report}.(md|json)` y `outputs/lv019-b-video-text-20261116/architecture-review-context.md`.

## Comprobación local de identidad y privacidad · 16 nov 2026

120 pruebas focalizadas pasaron en localhost/emulador: cuenta, panel, API candidata, mapeo UID→cuenta independiente, tokens no válidos, aislamiento de trabajos/archivos y revocación por borrado. Evidencia: `outputs/lv019-b-video-text-20261116/local-security-check.json`. La suite agregada no se declara aprobada: una invocación no recibió `FIRESTORE_EMULATOR_HOST`; la siguiente se atascó tras 15 casos y se detuvo.

La inspección confirma que no hace falta igualar `accountId` de Cloud Files con `AccountView.id`; cada backend deriva el suyo desde el UID verificado. El candidato de loopback tiene CSP/origen restrictivos. El paquete comercial estático sigue con `connect-src 'none'` y no tiene rewrite `/api/cloud`. Además, `cloudCandidateLocal.ts` apunta a `vistavo-prod` y a sus adaptadores Firestore/GCS aunque la página corra en localhost. Por eso la UI todavía no está integrada ni se probó con video real. Siguiente gate: habilitar una ruta de candidata verdaderamente aislada y probar el puente same-origin con fixtures sintéticas, manteniendo el flag desactivado y sin publicar.

## Candidata aislada y puente same-origin · 16 nov 2026

**Preparada localmente.** `candidate:isolated` coordina tres procesos loopback y usa solo los emuladores de Firebase con el proyecto demo `demo-vistavo-ledger`. El proxy/UI `127.0.0.1:3003` no inicializa Firebase Admin ni Firestore; las APIs escuchan solo en `127.0.0.1:3004` y `:3005`, reciben el Origin local fijado por el proxy y no quedan expuestas fuera del equipo. El proxy no es abierto: destinos fijos, allowlist de tres combinaciones método/ruta y reenvío acotado de `Authorization`, `Content-Type` y `Accept`. No acepta rutas de carga/IA. CSP `connect-src` solo permite el mismo origen y Auth Emulator.

La API de cuenta usa la base emulada `account-candidate`; Files API usa `(default)`. Cada una verifica el mismo token del Auth Emulator y deriva su cuenta desde el UID. Los IDs internos se mantienen distintos. El cliente conserva Auth solo en memoria. Se bloquea el inicio si hay credenciales/configuración de GCP/Firebase de producción o si los puertos del candidato ya están ocupados; `FIRESTORE_EMULATOR_HOST` y `FIREBASE_AUTH_EMULATOR_HOST` deben coincidir exactamente con loopback.

Flags obligatoriamente `false`: flujo de video, uploads, IA y pagos. Es una prueba de identidad/rutas/separación, no habilita transcripción, traducción ni voz, ni usa GCS/Drive o datos reales. No se desplegó ni cambió IAM/Hosting.

**Evidencia:** integración emulada PASS con dos usuarios verificados y un usuario no verificado; ambos servicios aceptan el token común válido, rechazan token inválido (401) y correo no verificado (403); separación de cuentas/IDs, origen hostil (403), parámetro de propietario y rutas uploads/AI (404) comprobados. Compilación/typecheck y `npm run test:candidate:isolated` PASS. Ver `outputs/lv019-b-video-text-20261116/isolated-candidate-20261116.json` y recibo Kimi en `kimi-isolated-candidate-20261115-v2-*`.

**Revisión independiente Kimi:** INCONCLUYENTE, respuesta truncada por límite de salida; sin reintento. Ocurrió antes de la separación final del módulo del proxy; no es aprobación de la versión actual. Sus observaciones sobre handlers no incluidos se contrastaron directamente: `accountHttp` llama `verifyIdToken(token,true)` y exige `email_verified`; `firestoreHttp` también exige token verificado y correo verificado. Los negativos se cubren en el test específico de candidata. El revisor no recibió esos archivos, por lo que su falta de evidencia no equivale a PASS.

**Revisión vigente Qwen4 Max:** Rob reemplazó Kimi por `qwen/qwen4-max`. Una revisión focalizada del código final por OpenRouter directo terminó PASS, con bloque completo y sin razonamiento interno. Uso 6.501 tokens de entrada +248 de salida =6.749; costo observado USD0.010758825. El revisor confirmó la separación del proxy sin Firebase SDK/Firestore, destinos y rutas fijas, separación de bases, validación independiente del token común y apagado de funciones. No indicó bloqueos accionables. Su PASS cubre únicamente el puente local, no el flujo de video/almacenamiento/proveedores ni producción. Evidencia completa: `outputs/lv019-b-video-text-20261116/qwen4-max-isolated-candidate-20261116-{prompt,response,content,status,intent}.*`.

**Reemplazo del informe Kimi truncado:** Qwen hizo una segunda síntesis breve usando el recibo Kimi incompleto, la revisión PASS del código final y evidencia local. Generation `gen-1794806543-0hVgVxJhrBwmr5MQzLbB`, HTTP200/stop, cuatro campos y cierre íntegros: PASS. Uso 1.520 entrada +277 salida =1.797 tokens; costo USD0.003491235; reasoning 0. La versión completa resuelve las dudas sobre autenticación cubiertas por el código/test actual y conserva dos límites: no verifica la identidad del proceso que escucha en puertos de emulador y la revisión frontend se limita a smoke/CSP. No es aprobación de video funcional ni producción. Evidencia `outputs/lv019-b-video-text-20261116/qwen4-max-kimi-report-completion-20261116-*`.

**Siguiente gate:** en el navegador, comprobar registro/login en Auth Emulator y que el estado de ambas APIs aparezca en la pantalla. Después añadir el flujo privado de archivos solo en emulador, antes de tocar el `CloudCandidate` que usa GCS o cualquier servicio desplegado. Revisar por separado los puertos Firestore/Auth: el comando exige puertos locales libres para las APIs y emuladores escuchando en los endpoints fijos; una verificación más fuerte de identidad de los procesos emulator antes del arranque queda pendiente. El candidato actual no ofrece rutas de subida ni de proveedor.
