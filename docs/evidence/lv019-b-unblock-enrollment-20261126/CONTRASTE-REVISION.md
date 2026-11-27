# LV-019.B · Contraste dual de la inscripción desde Video

26 nov 2026 · Seguimiento documental de `fca7bd3370e2094ae3cff85b1dc05555737b5c55`. Los dos informes revisaron ese corte y conservan su **INCONCLUYENTE**. Las copias íntegras están en el checkpoint. Los SHA-256 corresponden a los archivos `report.txt` originales.

| Revisor | Copia en el checkpoint | Solicitud en `outputs/openrouter-reviews/` y SHA-256 de respuesta |
|---|---|---|
| GLM | `docs/reviews/LV-019-B-inscripcion-fca7bd3-GLM-20261126.txt` | `a9c6750550f1bda1305878fe2694782986331f615fb335e3c42e8940dd08757f` · `a61c9dbe7f0b4f6a7b12bab4171b8a2320264c42f80a55c126f88a2c0da9ad88` |
| DeepSeek | `docs/reviews/LV-019-B-inscripcion-fca7bd3-DeepSeek-20261126.txt` | `ec53a3a565b518f8dba469cecf531e7df4440bcdaa952477faf3809f6ec10cc9` · `06d78aaf049f00b3ef198cc2e3c1fca32fe5d49c212f0afe2b28433c3bdd71e7` |

## Omisiones de contrato precisadas

- **Paso de claims al router.** El borrador ya pedía `sub` y una política por acción, pero faltaba el cambio explícito de interfaz y emisor. `trustedServiceClaims` devuelve correo y su verificación, y `ServiceIdentityVerifier` carece de `sub` e `iss`. El SDK ya aplica su lista de emisores de Google. Falta devolver los claims verificados y cotejarlos con una política de inscripción distinta de los dos servicios legados. Se agregó un negativo de `iss` que pasa la verificación general y se rechaza por la política de acción. [Runtime](../../../server/account/runtime.ts#L14) · [Interfaz actual](../../../server/account/http.ts#L4)
- **Índice, replay y sucesor.** El contrato original decía «misma clave» sin fórmula. Se fijaron la clave por ámbito y ocurrencia, la de inscripción/replay y la del ancla de Cuenta. Cambiar el corte, dueño, incidente o intento no crea una segunda inscripción de la misma ocurrencia. El sucesor queda registrado en el ancla original tras conciliar su `reconcileId` y carga exacta. Un A→B→A conserva revisión con generación nueva.
- **`pending`.** El borrador ya advertía sobre POST tardío y separaba inscripción de envío. Le faltaba una regla explícita en la máquina de estados. `pending` queda prohibido como señal de ausencia de envío, autorización de POST o reasignación del intento. Solo el recibo exacto o la decisión transaccional de cerco pueden resolver sus ramas respectivas.
- **JSON y privacidad.** El `json()` actual usa `JSON.parse` y sus claves observables ya perdieron duplicados. El protocolo nuevo define detección previa a materializar el objeto, incluida la equivalencia tras escapes, y un límite de 8 KiB. `reviewRef` se restringe a una referencia aleatoria generada en Video, con prefijo y formato exactos y vínculo durable al acto. El texto imprimible del legado no satisface ese contrato. No se altera el legado. [Parser actual](../../../server/account/http.ts#L7) · [Lector legado](../../../server/commercial/accountBillingClient.ts#L85)

## Dependencias ya abiertas

- **Autoridad de operador, vínculo y origen.** El acto humano autenticado y la procedencia de hold ya estaban señalados como ausentes. El coordinador valida la forma de `authorizedBy` y lo persiste. La ruta existente de operador llama a `recordDisposition`. El hold actual se da de alta con `identityKey` e incidente y carece de registro de origen de la ocurrencia. Se especificó quién debe producir y cotejar cada constancia. Un cuerpo válido, el digest o el token de servicio no suplen esas autoridades. [Coordinador](../../../server/commercial/billingUnblock.ts#L266) · [Operador actual](../../../server/commercial/billingOperatorHttp.ts#L128) · [Alta actual de hold](../../../server/account/http.ts#L56)
- **Implementación y entorno.** El cliente actual usa credenciales del proceso, un destino fijo y un 409 genérico. La implementación del cliente versionado y su validación de respuestas estaban pendientes y se detallaron. Tampoco se verificaron IAM efectivo, protecciones de la raíz, migración, retención ni restauración. La necesidad de evidencia independiente ante escritores privilegiados es una decisión abierta. Los controles del paquete no prueban una configuración habilitada ni el alta transaccional propuesta.
- **Límite del paquete.** El cuerpo completo de `accountHttp` sí termina la rama interna sin coincidencia con `404 not_found`. La ruta de inscripción carece de registro. El paquete omitió ese final, además de helpers y suites. El `404` para ambos servicios legados y el `401` para ausente o token de usuario se comprobaron con el control existente y cero llamadas al store. El cuerpo del control corresponde al borrador original y el verificador es sintético. [Caída del router](../../../server/account/http.ts#L84) · [Control existente](../../../server/account/http.test.ts#L8)

El [diseño actualizado](../../specs/LV-019-B-desbloqueo-inscripcion-video-20261126.md) cambia solo documentación. Se repitió su comando focal original y pasaron **130/130 en seis suites** sin omisiones, con tipos aprobados. Log `outputs/unblock-enrollment-review-20261126/focal.log`, SHA-256 `0fbcf2b0f202533eb13d677e25f6470b4182a2a8a7006e681f8bcfd58bcd29f8`. Costo y tokens de este contraste no medidos. Sin cambios de runtime, permisos o recursos cloud.

=== RESUMEN FINAL ===
RESULTADO: INCONCLUYENTE
EVIDENCIA: Contrato actualizado y 130/130 controles existentes reproducidos. Ambos INCONCLUYENTE originales se conservan.
NEGATIVOS: Verificado el rechazo del router actual sin escritura. El diseño fija alcance de claims, duplicados JSON, referencia opaca, claves, sucesor y prohibición de tratar pending como no enviado. Los controles de la ruta propuesta aún son criterios de prueba.
BLOQUEOS: Faltan emisor, operador autenticado conectado, alta acreditada del hold, vínculo durable y prueba de IAM, corte, restauración e integración. No hay endpoint instalado ni revisión dual del diseño actualizado.
=== FIN RESUMEN ===
