# Suite de 61 pruebas del desbloqueo (contrato previo al cerco) · archivada 27 nov 2026

**No vigente. Las cinco pruebas por portar se portaron el 27 nov 2026 (tarea 1.4d); ver el [resultado](../../evidence/lv019-b-t3-saldo-integracion-20261127/verificacion-1-4d/README.md).** Esta carpeta conserva la suite de la línea principal del desbloqueo auditado de Video, escrita antes de integrar la candidata del cerco. La suite vigente es `server/commercial/billingUnblock.emulator.mjs` (91 pruebas). Contexto de la decisión: [integración](../../evidence/lv019-b-t3-saldo-integracion-20261127/INTEGRACION.md).

## Por qué se archiva y no se borra

- Con el código integrado falla en bloque (87 comprobaciones con `conflict` en `billingUnblock.ts`, `guardBornAfterWriterCut`): el cerco exige un «corte de escritores» que estas pruebas no preparan. Es un cambio de contrato, no un defecto de producción.
- Contiene el resultado de la verificación por mutación (36 mutantes propios de la línea: 34 detectados y 2 equivalentes, más huecos cerrados con pruebas nuevas). Las dos revisiones de T3 sobre la integración (GLM y DeepSeek, ambas PASS) pidieron **conservarla** y portar sus casos únicos antes de dar la cobertura por cerrada.

## Pruebas por portar a la suite vigente (tarea inmediata, ver backlog)

Prioridad alta, sin nombre equivalente en la suite vigente (DeepSeek: «antes»; GLM: parcial o sin cobertura aparente):

1. Fase 3: una guarda que deja de estar bloqueada, o que nombra el incidente por los dos campos, aborta la liberación.
2. Una alerta que se cierra durante la repetición parcial conserva la guarda de Video y no escribe liberación.
3. Una alerta que ya no está abierta frena la repetición parcial antes de llegar a la Cuenta.
4. Una alerta que ya no está abierta frena la reanudación antes de llegar a la Cuenta.
5. Fase 0 rechaza una alerta abierta de otra generación, o una guarda que nombra otra cuenta, antes de preguntar a la Cuenta.

Cubiertas por nombre en la suite vigente (revisar al portar): recibo no confirmado o de otra generación; reanudación solo sobre la misma generación, operador y carga; épocas obsoletas; lectura de filas dentro de la transacción.

Al portar, preparar el corte de escritores del contrato nuevo y repetir la verificación por mutación de cada prueba portada.
