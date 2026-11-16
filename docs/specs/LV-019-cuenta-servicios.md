# LV-019 · Cuenta, proyectos y servicios públicos reales

## Estado actualizado · 16 nov 2026

LV-019.A está completado técnicamente y publicado en vistavo.app: Gemini v5 PASS, Hosting version c5bb31bab5c215e3/readback PASS, HTTPS95, smoke desktop/móvil y ejecución nativa 33 pasos/limpieza PASS. Esta entrega cambió Hosting solamente. Se conserva la historia de intentos y revisiones fallidas/inconcluyentes más abajo; no se les asigna PASS retroactivo.

El panel y la identidad están disponibles. Los proyectos privados guardan texto/SRT; no hay compras, saldo acreditable, transcripción/traducción/voz productivas ni despacho habilitado. Drive y videos largos no están validados. Cloud SQL no se creó. El error HTTP500 histórico sigue sin causa confirmada.

Siguiente: LV-019.B integrar video, transcripción española, revisión, traducción inglesa y exportación TXT/SRT. La voz será opcional después. No se fija todavía precio: Rob debe aprobar importe, unidad/redondeo y reglas de saldo antes de cualquier cobro.


Rob confirmó el acceso Google en su teléfono el14nov2026 y pidió avanzar a cuenta/servicios. Esto acredita su inicio personal reportado; no acredita Pixel físico ni entrega de emails. La captura contiene datos personales: no se usa en prompts externos. Continúan Firebase/Google Cloud bajo demanda y la prohibición de Cloud SQL.

## Orden y alcance

A. Panel permanente Inicio, Mis proyectos, Saldo y compras, Mi cuenta y Servicios. Provisionar identidad de negocio real e idempotente con Firebase UID verificado; saldo inicial cero, sin seed o acreditación ficticia. Crear, listar, abrir, revisar y guardar proyectos SRT/texto con revisión optimista, aislamiento y paginación. Mantener marca A3, diez idiomas y botones Google oficiales. Reutilizar el diseño aprobado del panel; adaptar contratos en lugar de exponer el piloto.

B. Conectar carga privada y servicios de transcripción/traducción únicamente con contratos productivos, autorización y cobro acreditados. Los cinco runtimes privados existentes, namespace candidate-v1 y precios/unidades simulados no se abren ni reinterpretan como producción. Mantenerlos intactos durante A. No activar checkout de prueba como pago real ni importar saldos de otros entornos.

C. Voz femenina/masculina según capacidades demostradas y decisión comercial de precio/saldo de Rob. La pregunta sobre voz incluida o aparte está pendiente; no bloquea A. MP4/render, idiomas/pares no demostrados, Drive y calidad humana conservan sus gates. No anunciar una capacidad futura como disponible.

## Arquitectura a contrastar con T3 antes de implementar A

API de cuenta nueva y acotada, identidad administrada dedicada, Cloud Run bajo demanda min0 y máximo acotado, ruta del mismo origen Hosting /api/account/**. La invocación pública en capa Run no sustituye la verificación Firebase Admin del ID token y revocación en cada endpoint; el URL run.app directo tampoco puede eludirla. Sin VPC ni proxy que abra los servicios internos existentes.

Preferir base Firestore productiva nombrada separada, con IAM condicionado exclusivamente a esa base para la identidad nueva. Evaluar mínimamente la alternativa de namespace productivo sin afirmar aislamiento IAM por colección. Proyecto vistavo-prod, región us-central1; ningún servidor SQL. No acceso Firestore directo desde navegador; reglas denegar todo y prueba de denegación anónima/con token de usuario. No archivos de service account JSON.

Cuenta se crea mediante POST explícito y transacción idempotente, no un GET engañosamente readonly. UID sólo del token, nunca del cuerpo. Lecturas de saldo son reales y enteras; no hay endpoint cliente de crédito, reconciliación, proveedor o override. Pagos aún no habilitados deben indicarse sin simular una compra. Historial inicialmente vacío respaldado por datos, sin inventarlo.

Proyectos SRT/texto limitados en tamaño y número, UUID generados/controlados en servidor, idempotencia al crear, cursor ligado a dueño, consultas indexadas acotadas; contenido personal privado y sin logs. Guardar exige expectedRevision; conflicto no destruye edición. Borrado explícito aislado, sin tocar objetos del procesador en esta fase. No se acepta referencia a archivos ajenos ni URLs arbitrarios. Importación SRT local/edición/descarga deben ser funcionales si se muestran habilitadas.

Cliente usa SDK Auth existente y bearer por solicitud, sin guardar tokens manualmente. Peticiones abortadas y datos borrados al salir/cambiar usuario; respuestas tardías nunca reabren datos del usuario anterior. Render de texto inerte, CSP/caché sin debilitar los botones Google ni helpers /__/. El servicio no recibe secretos IA, permisos GCS, capacidad de invocar jobs o acceso a la base candidate.

## Cierre A

1. T3: DeepSeek propone cambio mínimo y pruebas; Kimi audita arquitectura/aislamiento de forma independiente. Codex contrasta fuente oficial, código y evidencia. Gemini final Batch sobre fuente congelada/evidencia; no afirmar ejecución por modelos.
2. Regresiones locales con dos usuarios: token ausente/incorrecto/revocado/no verificado; alta repetida/concurrente una cuenta cero; listado/paginación por dueño, GET/PUT/DELETE ajeno404, conflictos, payload/cursor manipulado, XSS, logout/respuesta tardía; ningún crédito o efecto proveedor.
3. Emulador dedicado, tipos, suite pertinente y dos builds; cierre exacto de assets públicos y cabeceras/negativos. Candidata3001 antes de promoción; datos sintéticos, sin modificar el usuario real de Rob para QA.
4. Infraestructura reproducible dry-run y lectura previa, IAM mínimo y comprobación de separación entre bases con métodos explícitos: la identidad nueva debe demostrar acceso permitido a vistavo-live y PERMISSION_DENIED7 al marcador de (default) mediante SDK real en su runtime administrado. Las cinco identidades antiguas se evalúan con Google Policy Troubleshooter sobre cada base/permisos, exigiendo GRANTED en su base actual y NOT_GRANTED en la nueva, sin condiciones desconocidas ni políticas omitidas. Esto es evaluación IAM real, no una solicitud Firestore impersonada de esas identidades. No se concede TokenCreator ni se crean claves/jobs para conseguir una prueba. Nueva imagen/servicio/base separados de cinco runtimes previos, sin Cloud SQL. Registrar costes observados o no medidos, nunca gratuidad prometida.
5. Publicación acotada del panel autorizado, Hosting/config/hash/HTTPS, navegador desktop/móvil y dos identidades QA con limpieza. Reversión de contenido/API compatible con usuarios y proyectos creados, sin eliminar datos productivos.

Estado inicial: análisis y diseño, sin implementación o recursos nuevos de esta fase. Publicación de servicios con dinero/proveedor requiere además resolver su oferta/capacidad específica; A no equivale a cerrar toda la transición comercial.

## Decisión técnica sobre evidencia IAM inversa

El preflight real native-iam-feasibility confirmó que el operador no tiene permiso de impersonar las cinco identidades candidatas y que Policy Troubleshooter está deshabilitado. No se ampliarán permisos para superar ese límite. Se prepara habilitar únicamente policytroubleshooter.googleapis.com como dependencia diagnóstica del proyecto ya autorizado, con intención/operación y revisión antes de aplicar. El criterio anterior especifica la combinación de SDK real de la identidad nueva y evaluación nativa IAM de las antiguas. UNKNOWN, acceso incompleto a políticas heredadas, condiciones no resueltas o recursos no soportados impiden dar ese gate por aprobado. La limitación de no ejecutar solicitudes impersonadas antiguas permanece explícita; no se fabrica aceptación bilateral SDK. Los cinco runtimes y sus grants anteriores permanecen intactos.

## Contraste de diseño antes de implementar A

[Disposición T3](../../outputs/vistavo-account-services-20261114/design-disposition.md): DeepSeek diseño PASS; Kimi documental INCONCLUYENTE permite implementar A y conserva gates de producción. Unidad inicial video_seconds ya aprobada en LV007; saldo cero sólo por datos reales. Lectura IAM fresca encontró las cinco identidades candidatas ya restringidas a (default), por lo que no se necesita cambiar esas concesiones. Verificar nativamente aislamiento bidireccional; no inferir permisos heredados. Usar constructor estable Firestore con databaseId, no overload preview de initializeFirestore. Implementación local de A autorizada, publicación con gates pendientes.

## Excepción puntual aprobada por Rob · 14nov2026 PST

Las dos consultas Policy Troubleshooter devolvieron HTTP400 antes de evaluar permisos. Se conservan como INCONCLUYENTES. Rob aprobó expresamente [la propuesta concreta](../../outputs/vistavo-account-services-20261114/native-inverse-decision.md), con [recibo de su respuesta](../../outputs/vistavo-account-services-20261114/native-inverse-rob-approval.json). Esta excepción sustituye únicamente el método inverso y la prohibición de ampliar permisos para esa prueba; las restricciones anteriores siguen como historial y para todo alcance restante.

Se autoriza un rol personalizado con sólo iam.serviceAccounts.getAccessToken y cinco concesiones a nivel de las cuentas de servicio exactas, al mismo principal humano verificado de la ADC aislada. Ventana máxima de concesión10minutos, tokens solicitados120segundos, una emisión por cuenta, diez GET de marcadores fijos: acceso a su base actual y denegación403 PERMISSION_DENIED a vistavo-live. No claves JSON, delegación, escrituras de documentos, trabajos, archivos, proveedores o SQL. Código/protocolo debe revisarse independientemente antes de aplicar; intención por mutación, sin reenviar respuestas ambiguas; retirada propia con etags frescos, preservando políticas ajenas y verificando readback.

Rob aceptó que la capacidad permite actuar con permisos existentes, incluidos de escritura; la disciplina de sólo lectura y120s pertenece al operador revisado. Retirar una concesión no revoca tokens emitidos. La política efectiva de extensión no fue legible403 y la exposición potencial de hasta12horas por solicitudes fuera de este operador se comunicó expresamente. No se amplían permisos para consultar esa política.

El gate inverso se cerraría sólo con cinco pares GET nativos reales y retirada verificada, con vida de tokens observada y límites declarados. No se presenta como la matriz anterior de40permisos ni como aislamiento exhaustivo. La identidad nueva conserva su prueba SDK real propia. Esta aprobación no acredita ejecución ni publicación y no habilita dinero, IA o servicios comerciales por inferencia. El snapshot anterior de84entradas no se reescribe; esta enmienda y el ajuste CSS posterior se incluyen explícitamente en la revisión final de Gemini.

## Dirección propuesta para voz y continuación · 15nov2026

Rob propuso ofrecer «agregar voz» durante la configuración de lo que se hará con el video, mostrando un precio por minuto y llevando después a configurar la voz. El ejemplo US$0,25/min es ilustrativo: dijo que el precio se definirá después. No se aprueba por inferencia esa tarifa, una compra real, inclusión en el saldo existente o una regla de redondeo.

Propuesta de recorrido a concretar en B/C: opción de voz adicional con precio unitario e importe estimado según duración; selección posterior de idioma/voz estándar femenina o masculina y muestra; revisión del texto traducido y desglose de servicios/total antes de confirmar el procesamiento. Codex recomienda usar duración del video para que la estimación sea comprensible de antemano. La recomendación no constituye todavía una política de cobro aprobada.

Rob reiteró el orden: terminar prueba inversa autorizada → revisión final Gemini → publicar/comprobar el panel → conectar transcripción, traducción y voz con precios y cobros reales. Continuar el trabajo técnico independiente; no habilitar un importe provisional como precio comercial definitivo.

