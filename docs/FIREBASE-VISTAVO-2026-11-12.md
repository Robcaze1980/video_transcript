# Vistavo · Firebase y marca · 12 de noviembre de 2026

## Autorización y recursos

Se siguió el procedimiento solicitado por Rob: `firebase --version` devolvió15.19.1; `firebase login:list` mostró correo personal omitido; `firebase projects:list --json` confirmó los proyectos dedicados. No hizo falta iniciar ni automatizar un login, solicitar credenciales o instalar CLI. Antes de modificar recursos se presentó la configuración completa y Rob respondió «Apruebo esta configuración».

Producción reutiliza **Vistavo / vistavo-prod**, creado y añadido a Firebase en la fase anterior; no se creó otro proyecto. Desarrollo conserva **LinguistVision Dev / linguistvision-dev**. No se modificó Techos.app ni RoofPrecision. La lectura anterior/posterior del proyecto de desarrollo coincide exactamente en los campos consultados.

Se registró **Vistavo Web**, appId `1:107404655346:web:15c4589a314cf3e4d9ae6b`, tras comprobar que no existía otra app. Authentication se inicializó en Firebase Console; se habilitaron Google y correo/contraseña. El nombre público del proveedor Google es Vistavo. Su correo de soporte OAuth usa el propietario verificado correo personal omitido; **support@vistavo.app aún no es un buzón verificado** y no se anuncia operativo.

Dominios autorizados leídos de vuelta: localhost,127.0.0.1,vistavo.app,www.vistavo.app,vistavo-prod.firebaseapp.com,vistavo-prod.web.app. No se configuró DNS ni se desplegó contenido por autorizar dominios. El proyecto sigue sin facturación (Spark), sin Analytics vinculado y sin nueva base de datos/almacenamiento. us-central1 es recomendación para futuros servicios regionales; no una región que se haya aplicado a Hosting/Auth globales.

## Código y credenciales

El backend existente conserva Firebase Admin SDK: ID token y cookie de sesión con comprobación de revocación, correo verificado, frescura de autenticación, validación de origen y vinculación transaccional firebase_uid→cuenta PostgreSQL. No se sustituyó por un login nuevo ni se mezclaron identidades por correo.

El cliente existente incluye Google, correo/contraseña, envío de verificación y recuperación. La aplicación deniega sesión privada a un correo no verificado; habilitar el proveedor por sí solo no equivale a completar esas pruebas humanas.

La configuración pública de Vistavo Web se guardó fuera del repositorio en `%LOCALAPPDATA%/LinguistVision/.firebase.vistavo-prod.env`, con `LINGUISTVISION_FIREBASE_PROJECT_ID` y `LINGUISTVISION_FIREBASE_WEB_CONFIG`. No se cambió el archivo de desarrollo ni se arrancó el piloto local con el proyecto de producción. `.env.example` documenta el formato; `.gitignore` cubre configuraciones Firebase por entorno y credenciales. Admin utiliza ADC externo local y requerirá identidad administrada propia al desplegar. No se generaron cuentas de servicio JSON ni se versionaron secretos.

## Marca y verificación

Vistavo sustituye la marca visible en36archivos: diez portadas, metadatos, acceso, panel, locales y aplicación. Monogramas HTML exactos LV→V sólo donde existían. Identificadores, rutas, namespaces, variables, precios y credenciales conservados. El cuerpo español sólo cambia la marca: al normalizar Vistavo→LinguistVision conserva el SHA histórico aprobado019ccc5ffa450d4d8108a64302acf70097dea501436feb6caac3794284cbf1ff. Hash nuevo dd7315c2aa21879ba08a3609b7a6620cd8cc6c3926b287e70549c60f9e0488ff;361rangos UTF16 regenerados y246claves ordenadas por catálogo.

Gates:306/306pruebas en43archivos sin omisiones, tipos y ambas compilaciones correctos; diez portadas HTTP200 con marca/OG/CSP/noindex/16FAQ/8videos y cuatro rutas de acceso/panel correctas. Tipos repetidos después de añadir evidencia: correctos. CUA confirma marca local y ambos proveedores habilitados; capturas de portada, acceso y Firebase guardadas. Cuenta1/proyecto1/ledger0 y sus hashes conservados, cero trabajos activos. Búsqueda de claves privadas en archivos versionados sin coincidencias; configuraciones sensibles ignoradas.

Primer tsc falló porque los respaldos .ts de evidencia quedaban dentro del alcance del compilador. Se conservaron logs y se trasladaron respaldos al directorio privado fuera del workspace, sin cambiar tsconfig. La corrida completa posterior pasó. Baseline del manifiesto: copia del árbol de trabajo al empezar esta fase, **no main c435068**, porque había cambios anteriores. No seguir la sugerencia del revisor de comparar esos beforeSha contra main.

DeepSeek y Kimi revisaron independientemente por el respaldo OpenRouter autorizado sin herramientas; T3 no está disponible con aislamiento demostrado. Informes iniciales INCONCLUYENTE/FALLA describen la línea base previa al cambio y se conservan. Los finales PASS son técnicos/documentales acotados; Codex leyó informes completos y contrastó fuentes, hashes y pruebas.36pares de hashes coinciden con backups privados y nueve fuentes incluidas en ambos contextos finales coinciden exactamente.4llamadas/109112tokens/US$0.36300468006usage.cost; factura y coste Codex no medidos. Sin generaciones Gemini de video/voz ni compras reales.

Evidencia: outputs/vistavo-brand/ (check-results.json, tests.log, types-final.log, http-proof.json, template-proof.json, manifest-verification.json, reviewed-source-hashes.json, isolation-proof.json, firebase-configured.json, firebase-readonly-before.json, firebase-readonly.json, accounting.json y capturas). Los snapshots de registro web y Auth corresponden a momentos distintos y están fechados; el segundo sustituye al primero para estado de Authentication. Informes/contextos privados en LOCALAPPDATA/LinguistVision/t3-review/vistavo-brand-20261112/.

## Pendientes

No hay despliegue ni facturación activada. Pendientes: prueba humana real de Google, verificación/recuperación de correo y sesión completa de producción; soporte de correo Vistavo; backend/SQL/almacenamiento cloud y posterior autorización de despliegue. No se ejecutó registro de usuario real ni se enviaron emails de prueba por esta fase. Los gates nativos, Pixel, pagos reales y render de voz conservan su estado. No afirmar login de producción probado sólo por tener proveedores habilitados.
