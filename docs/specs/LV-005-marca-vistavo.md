# LV-005 · Nombre comercial Vistavo

El 12 de noviembre de 2026 Rob eligió **Vistavo**, de una sola palabra, como nombre comercial de la app anteriormente llamada LinguistVision. Es una decisión del propietario; no es un nombre propuesto pendiente de elección.

Esta decisión no certifica disponibilidad de marca, dominio o usuarios en redes, ni autoriza compras o publicación. No se ha efectuado esa comprobación para Vistavo.

Siguiente cambio de interfaz: aplicar Vistavo coherentemente a las diez portadas, metadatos y área privada, conservando rutas locales, integraciones, credenciales, identificadores técnicos, datos y evidencia histórica. Registrar y verificar esa adaptación como entrega propia; este registro no afirma que la interfaz haya sido renombrada.

El siguiente frente funcional sigue siendo LV-016.D: encaje por segmentos y exportación de video con narración inglesa. Drive y la revisión nativa conservan sus pendientes.

## Aplicación local autorizada · 2026-11-12

Rob solicita aplicar Vistavo y T3. Alcance: nombre y monograma visibles, metadatos, textos de las diez portadas, acceso y área privada, sin modificar diseño/precios/rutas/IDs de Firebase/Postgres/cookies/variables técnicas. Conservar el hash histórico de la plantilla española aprobada mediante normalización exclusivamente del nombre Vistavo→LinguistVision; regenerar rangos UTF16/hash actual sin cambiar el orden de claves. Verificar catálogos completos, título/marca y ausencia de marca anterior en HTML servido; tipos, pruebas DB completas, ambas builds y navegador. No equivale a revisión nativa de traducciones.

Nueva instrucción de Rob: no desplegar ni habilitar facturación ni borrar proyectos ni cambiar recursos Firebase existentes sin aprobación. CLI y proyectos se consultan sólo lectura. No ejecutar firebase login si la sesión es válida. Se solicita aprobación explícita de la propuesta: reutilizar Vistavo/vistavo-prod existente y separar desarrollo en linguistvision-dev existente, app web Vistavo Web, Analytics desactivado, Spark sin activar billing, us-central1 como recomendación futura regional, Google/correo verificado/recuperación y localhost/127.0.0.1/vistavo.app/www.vistavo.app además de dominios Firebase. Ningún recurso se modifica por el mero registro de esta propuesta.

El backend ya verifica ID token y sesión con Admin SDK/checkRevoked y vincula UID a la cuenta PostgreSQL; conservarlo. ADC externo/identidad administrada; no archivos JSON de cuentas de servicio. Config cliente por variables existentes apropiadas; no exponer secretos en VITE ni importar credenciales privadas al frontend. No crear proyecto duplicado: vistavo-prod ya fue creado bajo la autorización anterior y actualmente no tiene app web ni Auth inicializado.


12 de noviembre · Marca Vistavo aplicada localmente a diez portadas y panel; Firebaseprod configurado tras aprobación explícita (Google/correo, Vistavo Web, dominios autorizados), separado de dev.306/306pruebas43archivos, tipos/builds0 y DeepSeek/KimiPASS técnico acotado. [Informe](docs/FIREBASE-VISTAVO-2026-11-12.md). No desplegar ni habilitar billing según última instrucción; pruebas humanas/prodcloud y gates globales pendientes. Sin nueva fecha pública.


12nov · El frontend Vistavo ya fue publicado bajo autorización posterior (ver despliegue-dominio). Logo en exploración: tres direcciones vectoriales, recomendación A V+encuadre coincidente entre DeepSeek/Kimi, elección de Rob pendiente. [Brief y evidencia](LV-005-logo-vistavo.md). No confundir nombre aprobado con símbolo final aprobado.
