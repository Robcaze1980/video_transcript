# LV-019.B · Titular de una entrega aplicada durante el desbloqueo

**Candidata local, no integrada.** Base `708c41482ec6672263d549b1cf3c45b9d02b817d`. Una auditoría del diseño advirtió que la fase final de Video omitía comprobar el titular de una fila de `billingHoldOutbox` si esta cambiaba a `applied` mientras se esperaba la respuesta de Cuenta. El ajuste comprueba la pertenencia antes de omitir esa fila ya aplicada; no cambia su tratamiento cuando sigue perteneciendo a la cuenta correcta.

## Contraprueba y controles

El escenario usa datos y servicios en memoria. Una fila de A se incluye como pendiente en la decisión; después de que Cuenta confirma el desbloqueo, la prueba simula que un escritor privilegiado cambia la fila a `applied` y a titular B antes de que Video termine. **Antes del ajuste la prueba falló**: Video no rechazó el cierre. No se afirma que un cliente pueda provocar ese cambio ni que se haya movido el saldo de B.

Con el ajuste, Video devuelve `conflict`, mantiene su bloqueo y su incidente en revisión, no hace una segunda llamada de desbloqueo y no escribe sobre el estado Video posterior a la alteración. Se verifica que la decisión de Cuenta ya confirmada y el saldo de la segunda cuenta sintética no cambian. La prueba contigua conserva el control positivo: una entrega `applied` para A permite completar el flujo. Ambas verificaciones usan dobles de Firestore y Cuenta, no Firestore real.

- Suite de continuidad: **20/20** con Node 24.13.0 y Vitest sin caché.
- Suite relacionada de continuidad, bloqueos, cliente de Cuenta y auditoría: **75/75** en cuatro archivos.
- Tipos: `tsc --noEmit`, salida cero.
- El diagnóstico previo `red.log` y las salidas `green.log` y `related.log` se guardaron en `outputs/lv019-b-applied-owner-20261126/` de esta copia, fuera de Git. SHA-256: rojo `386b267f7b427c079fa22c4f1dfb4d4704d4cd3a19199aa1823b09d87a05357d`; continuidad `89323d852cfc0fe257feaf901b7bac7d26cfbe05a0eb897914ac217422bda3a1`; relacionados `d0440bfbdbd746e8a943490f1247a04c4b7ad6998aac186ce37295de86d4d791`.

```powershell
node node_modules/vitest/vitest.mjs run server/commercial/unblockContinuityIndependent.test.mjs server/commercial/firestoreBlocksA.test.ts server/commercial/accountBillingClient.test.ts server/commercial/billingPendingAudit.test.ts --maxWorkers=1 --no-cache
```

## Límites

La revisión dual de GLM/DeepSeek, la prueba en Firestore Emulator y la regresión financiera completa de la integración final quedan pendientes. **Este ajuste no resuelve** los dos casos de recuperación de `708c414` cuando se pierde la confirmación de la escritura local sin haber enviado el POST o cuando cambia legítimamente la generación de Cuenta. Tampoco implementa el corte de escritores, conciliación, migración ni la guardia para nuevas operaciones de una cuenta afectada. No se usaron recursos de nube, cuentas reales ni se movió saldo real.
