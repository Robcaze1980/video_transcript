# Vistavo · Dominio y despliegue

## Resultado comprobado · 12nov22:05PST

https://vistavo.app/ publicada como vista previa comercial noindex. https://www.vistavo.app/ redirige301alraíz; raíz302aES. Ambas rutas aceptan TLS normal;47archivosHTTP con SHA exacto,7rutas privadas/inexistentes404,Range206/1024bytes,headerCSP/noindex y navegador ES/EN/FAQ/CTA correctos. Ambos recursos HOST_ACTIVE/OWNERSHIP_ACTIVE y certificados emitidos: la API sigueCERT_PROPAGATING en este corte, no afirmar propagación mundial terminada. Snapshot22:05 y aceptación acotada en outputs/vistavo-public/acceptance.json.

Versión Hosting e3a9dad2b9671663;release1794548323220000.48archivosapp+2initpúblicosFirebase,48hashesgzip coinciden; billingfalse después. Captura vistavo-publicada.jpg. Revisores PASS del frontend alojado antes de activar dominio; Codex completó después los gates reales del dominio. No hay nuevo cambio del artefacto desde su revisión.8consultas/210550tokens/US$0.74204357535 totalusage.cost, no factura; detalles accounting.json.

Alcance cerrado sólo para frontend preview público. Backend/loginE2E/compras/procesamiento/Drive/soporte/nativos/indexación siguen pendientes. Las entradas inferiores de dominio pendiente son historial superado.

## Autorización vigente · Publica a Vistavo.app

El12nov2026 Rob autoriza publicar en vistavo.app después de aclarar que se publica el frontend comercial y no el backend. Esta autorización sustituye la prohibición anterior de desplegar únicamente para este alcance; no habilita facturación, procesamiento, compras reales o exposición de la PC. No se cambia Firebase Authentication ni otros proyectos.

Entregable: exportación estática del diseño comercial aprobado con marca Vistavo, diez portadas, medios públicos sintéticos/ilustrativos del repositorio y comportamiento de idioma/FAQ/animaciones. Usar Firebase Hosting Spark del proyecto propio vistavo-prod, con dominio y HTTPS; Cloudflare sólo DNS. Sin secretos, datos de clientes, código del backend, credenciales ni archivos locales privados en la carpeta publicada.

Las traducciones siguen como borradores y el sitio se mantiene noindex. Aviso visible y localizado: vista previa comercial; acceso, compras y procesamiento no habilitados online. Botones conducen a explicación estática localizada y enlace de vuelta, no a una app simulada ni a formularios que creen cuentas sin backend. Enlaces reales de demo/SRT se exportan con sus recursos. No sustituir el diseño por una página «Próximamente». Canonicals/hreflang/OG usan https://vistavo.app, sin localhost. Raíz redirige a portada española.

Aceptación: builder reproducible, inventario/hash de archivos permitidos, comprobación local de links/media/CSP/noindex/ausencia de formularios o endpoints privados, contraste independiente DeepSeek/Kimi y navegador, despliegue Hosting demostrado, registros DNS tomados del recurso real del dominio, resolución pública y HTTPS verificado sin ignorar TLS. Preservar versiones/valores para reversión. Si Google requiere tiempo para certificado, mantener la tarea y comprobar avances razonablemente, sin fingir que el dominio está conectado.

El backend cloud, Google login de extremo a extremo, pagos, correo support y render conservan sus fases pendientes. El frontend público debe decirlo claramente. Hosting en Spark sujeto a cuotas; no afirmar gratuidad ilimitada ni activar Blaze.

## Estado observado · 2026-11-12

Rob registró vistavo.app en Cloudflare y eligió support@vistavo.app como correo de soporte. Codex comprobó una sesión autenticada en Chrome de la PC: dominio activo, DNS Full y cero registros DNS. No se crearon registros, claves, servicios o reglas. Elegir una dirección de correo no configura su recepción o envío.

Rob pidió posponer DigitalOcean hasta mañana y avanzar con dominio/despliegue. Se requiere resolver qué contenido quiere publicar hoy: página temporal «Próximamente», demostración estática de portadas sin acceso/compras o app completa cuando haya servidor. Pregunta presentada; elección pendiente. No interpretar esta pregunta como una falta de autorización general para desplegar: falta concretar el entregable y su comportamiento público.

## Dependencias

La aplicación actual usa Node, PostgreSQL, archivos privados y FFmpeg. Pages admite assets estáticos; Workers no ejecuta los procesos hijo requeridos por el procesamiento FFmpeg actual. No conectar la candidata privada de esta PC a Internet ni trasladar credenciales/archivos de usuarios a una publicación estática. Migrar todo el backend a otra arquitectura sería trabajo adicional, no consecuencia automática de aplazar DigitalOcean.

Una página temporal puede alojarse en Cloudflare y usar vistavo.app sin DigitalOcean. Propuesta concreta: marca Vistavo, mensaje «Estamos preparando Vistavo», descripción de traducción de videos y aviso «Próximamente»; sin formularios, acceso, compras, promesas de disponibilidad inmediata ni enlace de soporte hasta verificar recepción. HTTPS, DNS del dominio y www se configuran contra el proyecto real creado, nunca con una IP o destino inventado. Reversión: mantener versión previa y registrar los valores exactos de cada registro creado antes de cambiarlo.

Si se elige publicar portadas comerciales, requiere adaptación explícita de botones y avisos a modo demostración, marca nueva, revisión de contenido público y comprobación de links/medios/idiomas. Los textos extranjeros continúan pendientes de revisión nativa. Las pruebas locales anteriores no certifican este despliegue.

Fuentes: https://developers.cloudflare.com/pages/ y https://developers.cloudflare.com/workers/configuration/compatibility-flags/ .


## Ejecución autorizada · 12nov
Hosting comercial noindex desplegado en https://vistavo-prod.web.app/, versión e3a9dad2b9671663, release1794548323220000.10portadas/48archivos/7.146.893bytes. Exportador scripts/exportCommercialStatic.ts, whitelist scripts/commercialStaticFiles.json, comprobador scripts/checkCommercialStatic.mjs. Cada build usa staging vacío y contrasta árbol físico/hashes; se conserva la versión local previa.306tests/types/2builds,2builds reproducibles/681links/negativo, navegadorES/AR y CSP correctos. Único form: búsqueda FAQ local cancelada con preventDefault, sin alta/captura/POST.
DeepSeek y Kimi PASS PREDEPLOY tras corregir residuales; no certifican dominio/backend. Coste6llamadasUS$0.63604946295,187721tokens; respuestas completas privadas y accounting.json.
Firebase CLI15.19.1 deploy --only hosting --project vistavo-prod --config firebase.commercial.json.47respuestas con SHA exacto (raíz302 cubre index duplicado),7rutas404,Range206; billingfalse después.5DNS de recursos reales de Firebase, DNS only/300s; antes0registros observado en herramienta, límite del before diff registrado sin fingir snapshot. No release previa para rollback. Valores/reversión en outputs/vistavo-public/{vistavo-dns.bind,dns-before.json,cloudflare-after.txt,rollback.md}.
**Dominio pendiente de gate HTTPS:** raíz OWNERSHIP_ACTIVE, cert CERT_VALIDATING al último corte. No declarar vistavo.app publicada aún. Evidencia outputs/vistavo-public/{deploy,release-proof,hosting-http,domain-status,build-proof,local-proof,content-proof,browser-proof,reproducibility,negative-proof,check-results}.json. Las traducciones siguen borrador, noindex; backend/login/pagos/Drive/soporte/nativos e indexación conservan pendientes. Detalle en bitácora y HANDOFF.

Postdeploy: ambos revisores PASS sólo web.app;8consultas/210550tokens/US$0.74204357535 total(incluye6predeploy). Hosting50entradas=48app+2initpúblicos Firebase,48hashesgzip coinciden. RestriccionesAPIkey noobservadas403, sin habilitarAPI ni cambios. DominioTLSsiguependiente. Detallebitácora/version-file-proof.json/accounting.json.
