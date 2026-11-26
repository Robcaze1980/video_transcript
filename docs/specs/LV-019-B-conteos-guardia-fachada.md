# LV-019.B · Tipos de referencia en el conteo de guardias

**Corrección local aislada del 26 nov 2026.** Base 4cb0cf091befe85e32db7b86ec7dd546e8c6a547. Esta copia contiene el diagnóstico, el diseño, las pruebas y la corrección de la fachada de conteos. El parche financiero de la otra rama se mantiene separado.

## Tres recorridos

- **A2.** billingSweepSection.ts y billingPendingSweep.ts manejan la raíz cruda. readPendingReport distingue tipo, presencia y ausencia de ambas referencias de guardia. Si alguna está presente e inválida, la fila se clasifica malformed, sin cuenta atribuida. Puede conservar la otra referencia válida para el estado de la alerta. La frontera de importaciones de mantenimiento queda igual.
- **Operador.** billingOperatorHttp.ts lista y consulta documentos de alerta persistidos mediante alertIdentity. La disposición va por su biblioteca auditada. El desbloqueo comprueba la guardia cruda. Esos recorridos no pasan por la fachada de conteos.
- **Conteo 1C.** oneCReadOnlyCounts.mjs usa billingReadOnlyRoot y summarizeQueues. readOnlyFirestoreRoot.ts representa un valor compuesto presente como la cadena [object]. Para lastIncidentId y lastOutboxIncidentId, esa cadena puede ser un ID opaco legítimo. El reporte de la fachada puede contar una guardia dañada como needs_review y alterar el estado calculado. El resultado agregado también usa como clave byState el estado interno completo de la guardia, que contiene época, marca de creación y referencia de incidente. Eso contradice el contrato de salida de solo conteos del ejecutor. El ensayo sintético no determina si ocurrió en un informe real.

## Corte aplicado

1. En la política interna de proyección, asignar un tratamiento explícito de valor compuesto a los dos campos de referencia de billingGuards. Proyectar un compuesto presente como null, sin deserializar ni copiar sus valores. Conservar una ausencia como ausencia y cada cadena real tal cual, incluido el literal [object]. Un null presente ya significa referencia inválida en el reporte. Los escalares inválidos que ya se preservan siguen el mismo camino de validación. La política debe copiarse y congelarse junto a sus listas actuales. Los otros campos y fachadas mantienen la proyección existente.
2. En summarizeQueues, agrupar las filas guard bajo la clave fija blocked. Conservar total, malformed y needsReview como contadores separados. La cadena de estado completa permanece en el reporte interno que la necesita; no se exporta como clave del resumen. Los buckets de otras clases no cambian. El resultado sigue teniendo el mismo esquema de campos. No se encontró un consumidor de repositorio que use las claves dinámicas de guardia; el cambio de contenido debe figurar al aceptar el corte.
3. Mantener las colecciones, campos permitidos, presupuesto de lecturas y consultas existentes. No añadir campos de procedencia a los documentos ni a la salida. La bitácora de lectura sigue incluyendo solo colección, operación, filtros y número de documentos. No se modifican la identidad de alertas, los IDs legados, el operador, el protocolo de desbloqueo ni las decisiones de Cuenta.

Excluir la cadena [object] en la validación general rompería una referencia legítima. Omitir un compuesto también borraría la prueba de que la referencia estaba presente y dañada cuando la compañera es válida. Una segunda lectura o expansión de la proyección sería innecesaria.

## Pruebas preparadas

- billingReadOnlyRoot.test.ts compara la fachada con la raíz cruda para un mapa en lastOutboxIncidentId y un array en lastIncidentId, ambos con una compañera válida. Exige precisión de la clasificación, preservación de la referencia sobreviviente, salida congelada, campos exactos y ausencia de valores internos del compuesto.
- La misma suite conserva el literal [object] como válido y deja ausente la otra referencia.
- billingQueueCounts.test.ts exige conteos separados de una guardia válida y otra dañada que colisionaban en la proyección. Con dos guardias válidas exige un solo bucket blocked y ausencia de IDs, épocas y marcas individuales en el agregado. Un hold sintético conserva su bucket anterior.
- El criterio de aceptación local exige los cinco casos y las suites existentes de fachada, conteos y A2. El colapso de tipos se comprueba con datos sintéticos.

La corrida focal en memoria dio una aprobada, cuatro fallos esperados y 26 omisiones por filtro. Pasó el literal opaco con compañera ausente. Las dos proyecciones fallaron al convertir el tipo en [object]. El conteo reportó cero malformadas donde debía contar una. También exportó claves de guardia con la referencia y la marca. No se usaron el emulador ni la nube.

Los recibos rojos se conservan en outputs/lv019-b-readonly-guard-diagnostic-20261126/. SHA-256 de stdout a70484912002fe4e47fef913a63db2b0fa61ac9cb8b1bb533251a311536fa8f8. SHA-256 de stderr 044f135d743336b366ebbf1544b7a39de3a6c85f644a8c7a4ebd64980c192851.

Con la corrección, pasaron los cinco casos focales. Las siete suites ejecutadas de fachada de Cuenta y Video, conteos, reporte, guardias y límite de importaciones A2 dieron 116/116, sin omisiones. Los recibos verdes se guardan bajo green/ en la misma carpeta. SHA-256 de stdout focal 4319edf44a6c0485252c9ad4ff16e03a520b2ba77b7267779f0bb58596d43bea y de regresión local 35b4aaa5a691ee9e82baad6b63b209d0109ba6468e96f37c7b57da98e286cc58. El resultado sigue aislado y no está integrado al checkpoint.

TypeScript de los cinco archivos con cambios terminó con salida 0 en green/types-focal/. La primera verificación de tipos de todo el workspace agotó los 70 segundos y no produjo un resultado. Se conservaron sus salidas bajo green/types/.
