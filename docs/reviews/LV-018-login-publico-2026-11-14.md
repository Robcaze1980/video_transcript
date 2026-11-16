# LV-018 · Login público permanente · cierre técnico publicado

[Auditoría independiente online PASS](../../outputs/vistavo-public-auth-20261114/online-peer.json).

**14 de noviembre de 2026 (PST) · PUBLICADO Y VERIFICADO TÉCNICAMENTE.** Acceso permanente autorizado por Rob: [iniciar sesión](https://vistavo.app/acceso/es-419/), [registro](https://vistavo.app/registro/es-419/) y perfil real Firebase Authentication, con Google oficial y correo/contraseña en diez idiomas. Hosting `vistavo-prod`, versión `7327d2ad13d21070`, release `1794715814243000`, publicado UTC `2026-11-15T04:10:14.243Z`. Sustituye el estado pendiente de LV-017.PUBLIC-LOGIN; el diagnóstico anterior se conserva como historia.

[Informe de cierre](../../docs/reviews/LV-018-login-publico-2026-11-14.md), [Gemini íntegro](../../docs/reviews/LV-018-gemini-final-2026-11-14.md), [HTTPS95](../../outputs/vistavo-public-auth-20261114/https-proof.json), [nativo online17](../../outputs/vistavo-public-auth-20261114/native-online.json), [registro online11](../../outputs/vistavo-public-auth-20261114/registration-online.json), [frontera privada](../../outputs/vistavo-public-auth-20261114/private-boundary-online.json) y [costos](../../outputs/vistavo-public-auth-20261114/accounting-final.json).

La aceptación Gemini es prepublicación: Batch batch-1794715209-Fhjg2vvbCmfgF6QX15yf, observado completed UTC 2026-11-15T04:08:31.003Z, contexto 19a28d372916c1f6f48ce5474eab380169a1b6956e8c2ac08b604dde2bfba59e; informe íntegro leído, PASS. Alias pedido google/gemini-4-hydrogen, resolución proveedor google/gemini-4-hydrogen-20261112 tras HTTP202. Se conservó la ambigüedad original del helper estricto y se consultó sólo el mismo ID: no resubmit ni elección de nuevo modelo. Los recibos online posteriores son verificación del coordinador, no acciones atribuidas a Gemini.

570/570 generales en65 archivos, tipos/dos builds exit0; 21focales y8export solapados. 13rollback y32helper separados. Exportación95 archivos/40páginas Auth/10idiomas/20SVG oficiales, manifiesto de archivos 88f432f4ce9ada6c89cb3b213c124e9e49a07590afeefc4bfea055c9a0c1cf5d; 72fuentes privadas intactas. Recuperación postlogout: baseline2FAIL y Kimi candidato FALLA preservados, solución nueva con regresiones. Binding Hosting: peer original FALLA conservado, CLI confirma public=site. CandidateDS PASS declarado no aceptado como gate fuente por alcance/truncación; correctedDS PASS fuente. Kimi corregido FALLA se preserva; claim cadena refutado frente a objeto Version oficial, normalizador local y readback; helper13PASS con UNKNOWN/no replay. [Disposición T3](../../outputs/vistavo-public-auth-20261114/t3-corrected-disposition.md) y [peer completo](../../outputs/vistavo-public-auth-20261114/corrected-local-peer.md).

Publicación Hosting concreta: [readback](../../outputs/vistavo-public-auth-20261114/hosting-postpublish.json) FINALIZED/release UTC2026-11-15T04:10:14.243Z. HTTPS confirma95SHA, cincoalias, www301, configuración de proyecto correcta, Auth no-store/CSP distinta de comercial. Chrome escritorio1280×900 y móvil390×844 sin overflow/violaciones. Nativo online17PASS: identidad sintética real, verificación/reset con códigos reales por API, perfil inerte/persistencia/logout y denegación de password antiguo/usuario deshabilitado. Registro online11PASS: creación real SDK y recuperación tras logout con éxito/error neutrales. Ambas fixtures eliminadas; ningún correo enviado, requests de correo interceptados sólo dentro del QA. Frontera online: cinco runtimes mismas UIDs/imagen89ab, IAM no público; dos servicios internos anónimos404, CloudSQL0.

Alcance: identidad y perfil públicos permanentes. Procesamiento, compras, ledger y backend de negocio siguen privados; Drive pendiente. No se acredita Google personal, recepción en buzón, recorrido UI alojado `/__/auth/action` ni Pixel físico. El reto Google y códigos reales consumidos por API no sustituyen esas comprobaciones. Ningún verde retroactivo de fallos previos ni causa histórica E55/500 resuelta por este cierre.

Contabilidad única fase: seis generaciones T3 (474625tokens/US$1.1765915271) + Batch (143524tokens/US$0.152883) =618149tokens/US$1.3294745271 observados. No se suman otros cierres ni el costo de resultado y Batch dos veces. Codex, runtime/proveedor, Firebase/Google y factura no medidos.

Esta reconciliación documental es posterior al release; no altera fuente/config/activos ni pretende que todos los inputs84 sigan sin cambios documentales. Su snapshot y hashes originales permanecen conservados.

=== RESUMEN FINAL ===
RESULTADO: PASS
EVIDENCIA: Gemini fuente PASS + peer corregido; Hosting versión7327d2ad13d21070/release1794715814243000; HTTPS95, navegador2, nativo17 y registro11 con limpieza; frontera privada5/SQL0.
NEGATIVOS: FAIL históricos intactos; sin atribuir QA online a Gemini; sin correos/persona Google, hosted action UI o Pixel físico; sin compras/procesamiento/ledger públicos ni causa histórica500 atribuida.
BLOQUEOS: Ninguno para la publicación técnica de identidad/perfil observada. Verificación humana Google/buzón/handler/Pixel y gates de negocio/Drive siguen pendientes.
=== FIN RESUMEN ===
