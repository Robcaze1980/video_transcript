# LV-019.B · Recuperación de saldo: candidata local en curso

**No aceptada para producción.** Esta rama reúne el prototipo de recibos y sucesores, con autorización y emisores simulados. El procesamiento en línea sigue apagado. No se modificaron recursos de nube ni saldos reales.

El foco original pasó de 5/8 a **8/8** y el foco ampliado pasó de **17/22**, después **21/22**, a **22/22** en Firestore Emulator, con cuentas ficticias y sin omisiones ni cancelaciones. El TAP final está en `FOCO-22.tap`. La ejecución terminó con limpieza 27/27 de raíces sintéticas; los puertos compartidos no cambiaron. La causa del último fallo era un campo extra en el objeto de prueba: el diagnóstico observó `AccountFault invalid`; al retirar solamente ese campo se observó `AccountFault invariant` y pasó la comprobación de corrupción. Los casos conservan los controles de identidad, escrituras y saldos.

En un corte anterior de la misma integración pasaron **5/5** casos de recibo inicial. Después de los cambios del fixture pasaron **70/70** pruebas unitarias de `server/account`. La comprobación TypeScript pasó sobre el código de implementación; las modificaciones posteriores fueron del fixture y del selector de pruebas. Estas cifras no equivalen a la batería financiera completa, que sigue pendiente para la candidata final.

## Riesgos abiertos y revisión independiente

DeepSeek y GLM revisaron una versión anterior del fixture con el mismo código de recuperación y devolvieron **FALLA**: existe una ventana entre la última lectura de Cuenta y el cierre de Video en la que puede aparecer otra incidencia. La segunda lectura por sí sola no resuelve la carrera. Ambos informes completos se conservan aquí; deben volver a revisar el cambio final. El primer borrador de solución `PROPUESTA-INICIAL-CARRERA.md` es histórico y **no se aplicó**: usaba el identificador de Video para buscar la cuenta en Cuenta. La propuesta posterior también requiere correcciones y no se ha aceptado.

Aclaración verificada por Codex: `AccountStore.admitVideoCall` sí consulta `AccountStore.root/videoBillingGuards`, la guarda de Cuenta; no la guarda `billingGuards` de Video. `FirestoreAi` rechaza un recibo de admisión marcado `receiptOnly` antes de un nuevo envío, pero falta comprobar la cobertura del recorrido completo y el caso posterior a la última lectura. El dictamen de GLM sobre conflicto de la ruta legacy necesita reproducirse con sus precondiciones, no se da por demostrado de forma general.

La reconciliación, el ancla, los grants y el acceso entre raíces de esta candidata son de prueba; no acreditan la autoridad real, los permisos, el corte de escritores ni la consistencia entre servicios. La posibilidad de un claim huérfano y la recuperación con clientes legacy siguen abiertas. No iniciar una nueva operación pagada por un recibo `pending`.

## Siguiente paso

Añadir una prueba que inserte una nueva incidencia **después** de la última lectura de Cuenta; resolver el bloqueo de forma verificable en el alcance local; repetir las revisiones independientes y la batería financiera completa, conservando sus cinco omisiones de voz declaradas hasta cerrar esa fase. Los manifiestos y los ejecutores se fijan a una revisión base y deben regenerarse para cada corte.

La prueba nueva que inserta una incidencia después de la última lectura de Cuenta se ejecutó contra el código anterior: **22/23** pasaron y esa prueba falló porque Video quedó abierto. Se conserva `FOCO-23-ROJO.tap`; es una contraprueba real del riesgo, no un fallo de privacidad de producción. La corrección sigue en desarrollo.
