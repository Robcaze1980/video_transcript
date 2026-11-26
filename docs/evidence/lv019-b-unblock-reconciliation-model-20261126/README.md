# Recibo de modelo · LV-019.B · Conciliación del intento de desbloqueo

**Recibo histórico del commit `35460dd`.** La evidencia más reciente se describe en el [seguimiento](../../reviews/LV-019-B-desbloqueo-conciliacion-seguimiento-35460dd-20261126.md). Para reproducir los 14 casos de abajo, usar el modelo de `35460dd`. El enlace al borrador abre la versión que tenga el árbol consultado.

El modelo ensaya el [borrador de conciliación](../../specs/LV-019-B-desbloqueo-conciliacion-intento.md), sobre la auditoría `2bbcbd13194bf83478ce165ea747906bdea6d8de` de la candidata `708c414`. Node 24.22.3. Fecha local 26 de noviembre de 2026.

**14/14 pruebas sintéticas.** Consignan ambos órdenes de la carrera, llegada tardía del intento anterior antes y después del sucesor, y replay exacto con un único efecto. También cubren cero POST tras el commit local, ACK perdido del registro inicial o de la conciliación, avance de época antes y después del cerco, guard de otra creación con la misma época, intento o recibo perdido, recibo corrupto, titulares y evidencias discordantes, cambio y restauración de identidad y un ancla ausente o legada. Cada rechazo comparado conserva el inventario sintético previo. Las decisiones del desbloqueo conservan saldo, reserva y asiento.

```powershell
node --check docs/evidence/lv019-b-unblock-reconciliation-model-20261126/contract.model.mjs
node --test --test-reporter=tap docs/evidence/lv019-b-unblock-reconciliation-model-20261126/contract.model.mjs
```

La [prueba del contrato](contract.model.mjs) enumera órdenes con un modelo serial en memoria. La autoridad se representa mediante datos sintéticos ya acreditados. El TAP completo se conserva localmente en `outputs/lv019-b-unblock-reconciliation-model-20261126/model-contract.tap`, SHA-256 `9645d5a7123a233ce848e019350b4f2af81cd85dc0cd3a067e93b1ae75b76c87`. El resultado no prueba serialización de Firestore, autenticación real, despacho único de Video, ni una transacción entre bases. No se ejecutaron emuladores, servicios ni revisión externa.

=== RESUMEN FINAL ===
RESULTADO: PASS
EVIDENCIA: 14/14 casos del modelo serial y sintaxis local. Si gana el intento anterior, Cuenta devuelve su único recibo. Si gana la conciliación, cerca el anterior y un intento sucesor puede progresar.
NEGATIVOS: Los intentos tardíos, las generaciones discordantes, los replays que cambian de carga, y la pérdida o corrupción de registros obligatorios quedan sin nueva autorización ni cambio de saldo.
BLOQUEOS: Para integrar faltan el contrato, escritor y lectores de Cuenta, la acreditación de operador y emisor, el traspaso de Video, el corte y migración del legado, pruebas en Firestore y revisión dual. El PASS se limita al modelo. Costo y tokens no medidos.
=== FIN RESUMEN ===
