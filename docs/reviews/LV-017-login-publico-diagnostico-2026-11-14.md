# LV-017.PUBLIC-LOGIN · La portada pública aún deriva el login a disponibilidad

Rob reportó que «Iniciar sesión» muestra «Vista previa comercial». Diagnóstico de sólo lectura: la portada española y la ruta de disponibilidad responden HTTP200; ambos enlaces de login de la portada apuntan a `/disponibilidad/es-419/`. Esa ruta contiene exactamente el mensaje reportado. No se intentó autenticar ninguna cuenta ni comprobar su estado. [Recibo HTTP](../../outputs/vistavo-public-login-20261114/diagnosis.json).

La configuración `firebase.commercial.json` sirve la exportación estática de `outputs/vistavo-public/site`, sin rewrites de backend. `scripts/exportCommercialStatic.ts` sustituye deliberadamente las rutas funcionales por disponibilidad. El CSP comercial bloquea conexiones de aplicación. La candidata con Auth y backend compartido sigue en loopback3002 y los servicios Cloud Run se verificaron privados en el cierre anterior. Publicar sólo una página de login o retirar el aviso no conecta esas piezas.

Por tanto, es el límite de publicación ya documentado, no una excepción OAuth acreditada. Codex dio una instrucción prematura al pedir a Rob iniciar sesión en la web pública. El cierre técnico privado LV-007.CLOSE permanece válido en su alcance y no debe describirse como acceso público operativo.

Siguiente tarea: diseñar y preparar una candidata HTTPS con entrada autenticada al backend, login humano y acceso restringido; revisar sus fronteras con T3 y verificar el recorrido antes de promoverla. No exponer workers o APIs internas ni convertir unidades sintéticas en saldo comercial. La publicación funcional y los cambios de infraestructura/IAM requieren la autorización que corresponda al alcance concreto, conforme a AGENTS y los gates del plan. En este diagnóstico no se publicó ni modificó código.

Se conserva por separado una primera salida de diagnóstico local inválida: el script intentó usar la variable reservada HOME de PowerShell y no capturó la portada. La nueva lectura utiliza variables propias, exige ambas respuestas200 y comprueba exactamente los dos enlaces. Ese fallo de herramienta no se atribuye a Firebase ni al sitio.
