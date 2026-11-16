<!-- LV-018-PUBLISHED-20261114 -->
## Estado de aceptación · publicación técnica del 14nov2026

**14 de noviembre de 2026 (PST) · PUBLICADO Y VERIFICADO TÉCNICAMENTE.** Acceso permanente autorizado por Rob: [iniciar sesión](https://vistavo.app/acceso/es-419/), [registro](https://vistavo.app/registro/es-419/) y perfil real Firebase Authentication, con Google oficial y correo/contraseña en diez idiomas. Hosting `vistavo-prod`, versión `7327d2ad13d21070`, release `1794715814243000`, publicado UTC `2026-11-15T04:10:14.243Z`. Sustituye el estado pendiente de LV-017.PUBLIC-LOGIN; el diagnóstico anterior se conserva como historia.

[Informe de cierre](../../docs/reviews/LV-018-login-publico-2026-11-14.md), [Gemini íntegro](../../docs/reviews/LV-018-gemini-final-2026-11-14.md), [HTTPS95](../../outputs/vistavo-public-auth-20261114/https-proof.json), [nativo online17](../../outputs/vistavo-public-auth-20261114/native-online.json), [registro online11](../../outputs/vistavo-public-auth-20261114/registration-online.json), [frontera privada](../../outputs/vistavo-public-auth-20261114/private-boundary-online.json) y [costos](../../outputs/vistavo-public-auth-20261114/accounting-final.json).

Actualización documental posterior al release; criterios inferiores conservados. Gemini evaluó el snapshot inmutable previo, contexto `19a28d372916c1f6f48ce5474eab380169a1b6956e8c2ac08b604dde2bfba59e`; las modificaciones documentales posteriores no son inputs nuevos del Batch. Fuente y95 activos publicados permanecen iguales. Alcance: identidad y perfil públicos permanentes. Procesamiento, compras, ledger y backend de negocio siguen privados; Drive pendiente. No se acredita Google personal, recepción en buzón, recorrido UI alojado `/__/auth/action` ni Pixel físico. El reto Google y códigos reales consumidos por API no sustituyen esas comprobaciones. Ningún verde retroactivo de fallos previos ni causa histórica E55/500 resuelta por este cierre.
<!-- /LV-018-PUBLISHED-20261114 -->

# LV-018 · Acceso público definitivo de Vistavo

Rob autoriza «Crea de una vez y habilita el login page…nada temporal ni de prueba». Esto autoriza construir y publicar el acceso permanente en Vistavo.app con el Firebase de producción existente. No es autorización para publicar procesamiento, compras, saldos ficticios ni exponer workers privados. Repositorio video_transcript/main c435068 con trabajo previo conservado.

## Resultado de producto

- Rutas permanentes para iniciar sesión, crear cuenta, recuperar contraseña y consultar/cerrar la sesión de la propia cuenta.
- Google y correo/contraseña mediante Firebase Authentication real de vistavo-prod. La cuenta y su verificación pertenecen al servicio real; no stubs, emuladores o unidades de piloto en producto.
- La cuenta muestra nombre/correo/estado de verificación desde Auth, sin aparentar tener proyectos, compras o saldo que la API privada aún no publica. No se reutiliza el ledger candidato como datos comerciales.
- Registro envía verificación; correo no verificado no obtiene permisos de negocio. Recuperación genérica sin enumeración; logout elimina inmediatamente información de cuenta de la vista.
- CTA «Iniciar sesión» llega al acceso real. CTA de registro puede llegar al registro; precios/procesamiento no habilitados mantienen su disponibilidad y mensajes exactos. La portada no debe seguir afirmando que el acceso no existe.

## Arquitectura y decisiones

Usar Firebase Hosting existente y Firebase Authentication como backend de identidad. La sesión cliente se gestiona por el SDK con persistencia de sesión; no almacenamiento manual de tokens, cookies backend simuladas ni clave privada en navegador. La primera entrega pública definitiva cubre identidad y perfil Auth; las API de proyectos y procesamiento conservan su autorización/verificación servidor y no se conectan por inferencia. No hace falta un nuevo Cloud Run sólo para mostrar el perfil del usuario autenticado.

Reutilizar estilos y arte Google oficiales ya aprobados, idiomas del acceso existente y marca A3. Generar una exportación con allowlist y hashes, assets Firebase limitados a su cierre de dependencias, sin copiar chunks privados por glob. Configuración cliente pública vía Hosting reservado o JSON whitelisted que valide proyecto/app/authDomain. No publicar configuración externa completa.

Antes de elegir authDomain, comprobar OAuth/authorized domains reales y documentación de redirect. Preferir helper same-origin para el dominio Hosting definitivo cuando los retornos OAuth estén configurados. No cambiar a un callback no autorizado. Popup iniciado por gesto y flujo de retorno probado; no redirección automática a una URL recibida del usuario. `www` sigue redirigiendo al dominio raíz.

CSP debe permitir sólo los orígenes Firebase/Google necesarios en las páginas Auth y assets correspondientes; conservar política comercial estricta para las demás rutas. No resolver un bloqueo con comodines generales o `unsafe-eval`. Formularios no envían contraseñas a rutas estáticas si falla JS: controles de submit deshabilitados hasta inicialización válida, más CSP de form-action. Perfil renderizado con textContent/escape, sin HTML de nombre/correo externo.

## Aceptación y publicación

1. Contraste de diseño y candidata con T3 (DeepSeek propone, Kimi audita, Codex verifica), informes completos/cargos reales preservados.
2. Pruebas significativas de configuración/host/proyecto, flujos y denegación, prevención de XSS/open redirect, borrado de UI al salir y fallos de inicialización. Tipos y builds pertinentes. Cambios en exportador exigen allowlist/hash/links/CSP/regresión de diez portadas y prueba de residuales.
3. Candidata local aislada antes de promover. Publicar únicamente Hosting y cambios mínimos OAuth autorizados necesarios para este login; sin cambiar IAM o recursos de procesamiento. Guardar release previo/artefacto/config y procedimiento de reversión que no borre cuentas creadas.
4. Readback HTTPS: login ya no muestra disponibilidad, módulos y CSP correctos, dominios/proveedores configurados, endpoints privados siguen protegidos. Probar el flujo real con identidades controladas y retirarlas al terminar donde proceda, sin dejar credenciales de prueba en producto.
5. No afirmar Google humano/correos recibidos/Pixel si Rob no los completó; reportar exactamente qué verificó automatización y qué requiere su interacción personal. Ese límite de prueba no cambia las rutas ni convierte el acceso en un modo temporal.

Estados: diseño en curso; implementación/revisión/publicación/aceptación se registran con evidencia. La instrucción explícita de este turno concede publicación de este login; no pedir otra aprobación equivalente.

## Decisiones de integración tras el diseño

DeepSeek y Kimi aprobaron el diseño en sus informes completos; Codex conserva esos dictámenes como gate de diseño, no aceptación de release. Se añade un módulo público independiente y se conserva sin cambios el acceso privado anterior: no modificar su intercambio de cookie PostgreSQL para reutilizarlo como una página estática.

Rutas definitivas: `/acceso/{locale}/`, `/registro/{locale}/`, `/recuperar/{locale}/` y `/cuenta/{locale}/`, diez locales. `/acceso/` redirige a español. Botones de Google: reutilizar exactamente el SVG oficial aportado por Rob y las reglas gsi aprobadas; comprobar signo/color/proporción y las veinte variantes login/registro, sin recrear el icono.

El readback real confirma Google/correo habilitados, dominios vistavo.app/www autorizados y app `1:107404655346:web:15c4589a314cf3e4d9ae6b`. Se conserva `vistavo-prod.firebaseapp.com` como authDomain registrado y se elige **signInWithPopup**, opción2 documentada por Firebase para evitar el problema de almacenamiento de terceros del redirect. No introducir un fallback redirect ni un callback custom-domain no verificado. El popup sale del gesto directo; si el navegador lo bloquea, muestra una indicación concreta para reintentar/abrir el navegador habitual. No exige cambios OAuth para esta entrega. Fuente: https://firebase.google.com/docs/auth/web/redirect-best-practices . No prometer aceptación del Pixel físico sin observarla.

Recuperación y verificación utilizan el **manejador oficial Firebase** existente `/__/auth/action`, con oobCode y retorno fijo a la ruta de acceso. La app ofrece la solicitud/reenvío/relectura; no exporta el handler reset antiguo incompleto ni afirma implementar uno personalizado. Probar los códigos reales sin enviar correos a terceros mediante enlaces generados exclusivamente para una identidad sintética autorizada; eliminarla al terminar. Esto no acredita recepción de correo humano.

Auth mantiene form-action none incluso con JavaScript activo: las operaciones van por SDK, nunca por POST convencional de contraseña. CSP comercial y Auth se emiten por conjuntos de rutas que no se solapan; no aplicar una CSP global que bloquee helpers reservados de Firebase. La exportación incluye sólo los cierres de publicAuth/accountUi y las páginas aprobadas. Dependencias compartidas con otro bundle no implican publicar la entrada privada; comprobar el cierre real y los residuales.
