# LV-019.B · Puerta de identidad en archivos y proyectos

**Auditoría de código local · 17 nov 2026.** Hallazgos y pruebas propuestas; no acredita configuración desplegada, explotación ni una corrección. El estado y orden vigentes permanecen en [MASTERPLAN](../../MASTERPLAN.md).

## Punto de entrada

El handler comprueba el ID token con `checkRevoked: true`, exige usuario verificado y obtiene `accountId` desde el UID. Después pasa únicamente ese `accountId` a las operaciones de archivos/proyectos. La autorización opcional de piloto también se ejecuta antes de esas operaciones. [Handler](../../server/commercial/firestoreHttp.ts#L57).

En el adaptador local, `existingPilotAuthorization` comprueba por separado vínculo y banderas; el constructor del runtime de nube revisado no proporciona ese callback. Esto describe opciones del código, no prueba qué está activo en línea. [Autorizador local](../../server/commercial/cloudCandidateLocal.ts#L25) · [Runtime](../../server/commercial/cloudFilesRuntime.ts#L80).

`accountForUid` lee el documento de identidad y devuelve su `accountId` existente, pero no verifica allí que el campo `uid` almacenado corresponda al solicitante. Si el documento se elimina, se reasigna o resulta inconsistente después de resolver la cuenta y antes de la operación, los métodos siguientes no vuelven a leer ese vínculo. Cambiar el documento de identidad requiere una acción privilegiada en este modelo; no se afirma que un navegador pueda hacerlo. [Resolución](../../server/commercial/firestoreBackend.ts#L467) · [Reglas locales](../../deploy/google-cloud/firestore.rules).

## Rutas que siguen abiertas

| Ruta HTTP | Comprobaciones actuales y límite a revisar |
| --- | --- |
| `POST /api/cloud/uploads` | `begin` lee cuenta y solicitud idempotente dentro de la transacción; no relee el UID ni las banderas aplicables. Puede crear una subida o repetir una anterior usando una cuenta resuelta antes del cambio de identidad. [Código](../../server/commercial/firestoreFiles.ts#L63) |
| `GET /api/cloud/uploads/:id` | `status` lee el upload y compara dueño con `accountId`; no relee identidad. Devuelve nombre y estado, sin leer el objeto. [Código](../../server/commercial/firestoreFiles.ts#L81) |
| `PUT .../:id/chunks` | `append` valida upload en dos transacciones separadas por una escritura de objeto. Ninguna relee el UID; la segunda necesita volver a autorizar antes de confirmar metadatos. Si la autorización cambia después de enviar bytes al objeto, se necesita una estrategia segura para ese objeto y reintento, sin prometer que los bytes no se escribieron. [Código](../../server/commercial/firestoreFiles.ts#L83) |
| `POST .../:id/complete` | Comprueba el upload en una transacción, sin releer UID, y programa validación. [Código](../../server/commercial/firestoreFiles.ts#L109) |
| `DELETE /api/cloud/uploads/:id` | `remove` verifica cuenta del upload/input y marca borrado en una transacción, sin releer el vínculo UID. La prueba propuesta comprueba que un cambio de identidad anterior a esa transacción no modifique input, upload, outbox u objeto. [Código](../../server/commercial/firestoreFiles.ts#L117) |
| `GET`/`HEAD .../:id/content` | `download` comprueba upload, input, dueño y generación en una transacción, sin releer UID. El handler abre el objeto después y puede transmitirlo; deben probarse también `HEAD` y `Range`. Una respuesta autorizada antes de revocar puede seguir en curso: Firebase Auth, Firestore y GCS no comparten una transacción. [Código](../../server/commercial/firestoreFiles.ts#L126) · [Streaming](../../server/commercial/firestoreHttp.ts#L88) |
| `GET`/`PUT /api/cloud/projects/:id` | `readProject` y `saveProject` revisan dueño/vigencia del input dentro de Firestore, pero no el UID. El guardado también debe rechazar un proyecto previo con dueño incompatible, en vez de depender de que input y proyecto ya sean coherentes. [Código](../../server/commercial/firestoreBackend.ts#L479) |

`GET /api/cloud/me` puede usar el saldo por UID del adaptador AI o el saldo local por `accountId`; las rutas de jobs anteriores también reciben `accountId` después de esa resolución. Necesitan revisión propia, especialmente antes de activar saldo real. Las rutas AI de resultados y cancelación se revisan por separado y no se dan por corregidas aquí. La fixture de texto determinista es una herramienta de emulador, no evidencia del flujo productivo.

## Cambio a evaluar

Transportar un principal construido por servidor a cada operación, con UID del token verificado y cuenta esperada; no aceptar esos valores del cuerpo del navegador. En la misma transacción que autoriza cada lectura o cambio, releer `identities/hash(['firebase', uid])`, verificar tanto el UID como la cuenta y aplicar las banderas que correspondan a esa operación. Preservar las comprobaciones de dueño, expiración, revisión y generación ya existentes. La política para permitir o no una eliminación solicitada por el dueño cuando se desactiva una función queda por definir; un trabajador interno de limpieza no debe hacerse pasar por un cliente.

Volver a comprobar un vínculo Firestore no vuelve atómica una revocación externa de Firebase Auth: `verifyIdToken(..., true)` comprueba el token al inicio, y un cambio posterior en Firebase que no actualice un control Firestore no se detecta automáticamente en esa transacción. Cualquier requisito de revocación más fuerte necesita un mecanismo explícito y pruebas de carrera. Los bytes ya autorizados o entregados no pueden retirarse.

## Evidencia y próximos controles

La [prueba existente de archivos](../../server/commercial/firestoreFiles.emulator.mjs#L177) cubre otro usuario, token rechazado al inicio, rangos y revocación por borrado; no cubre cambio de identidad entre `accountForUid` y la transacción. Se preparó [una fixture aislada](../../server/commercial/firestoreFilesIdentityFence.emulator.mjs) y su [lanzador](../../scripts/runFilesIdentityFenceEmulator.mjs), todavía sin ejecutar:

1. Dos controles verifican que el dueño puede descargar o solicitar borrado y que otra cuenta es rechazada.
2. Cuatro carreras suspenden el handler después de resolver la cuenta; eliminan o reasignan la identidad y luego permiten continuar `download` o `remove`. La expectativa es denegar sin leer el objeto ni cambiar input, upload, outbox, cuenta u objeto.
3. Tras ese ensayo deben cubrirse las demás filas de la tabla, incluida la revocación durante `putOnce`, idempotencia, ausencia/corrupción de la identidad y cambio de banderas. No declarar el gate cerrado solo por las cuatro carreras iniciales.

Todo ensayo utiliza identidad y archivos sintéticos en emulador. No sustituye verificar tokens reales, reglas/IAM ni comportamiento y permisos del entorno desplegado.
