# LV-019.B · Contraste de revisiones de conciliación · seguimiento de 35460dd

La revisión de GLM fue **PASS acotado** al diseño y al modelo serial. DeepSeek dio **INCONCLUYENTE** en seguridad y disponibilidad. Ambos dictámenes se refieren a `35460dd6948ebbc31c425e9d72bc18061e733210`; se conservan completos en el checkpoint bajo `docs/reviews/LV-019-B-desbloqueo-conciliacion-diseno-GLM-20261126.txt` y `docs/reviews/LV-019-B-desbloqueo-conciliacion-diseno-DeepSeek-20261126.txt`. Las copias del checkpoint tienen SHA-256 `6fc31057c706ca87956426ea0f25b0f9c0865fa2577f9bf570716c9950ee3a3d` y `794d3f3ed66fda7547494e0b09272e30fae9cec998d29e02c26e1a93a688e88d`, respectivamente. El seguimiento no cambia esos resultados.

## Adjudicación

- El modelo anterior validaba una prueba constante y el ID del intento. DeepSeek acertó en que el ancla vacía carecía de prueba ejecutable de enrolamiento y que un contador de rivales no verificaba dos incidentes independientes. Ahora un productor de Video acredita la ocurrencia desde guardia, origen y salida enlazados. Cuenta exige el ámbito, vínculo y corte y crea incidente, índice de origen y ancla solo desde el alta autorizada. El emisor posterior coteja la historia auditada y al operador original. Cuenta verifica el propósito y la carga de esa atestación en el mismo incidente preexistente. Un ID propuesto o una fila `v:2` aislada no acreditan autoridad. [Diseño](../specs/LV-019-B-desbloqueo-conciliacion-intento.md) · [Modelo](../evidence/lv019-b-unblock-reconciliation-model-20261126/contract.model.mjs#L19)
- La prueba anterior de ABA cambiaba el ID simbólico del guard. Ahora el control restaura todos los campos visibles y cambia la versión física que aporta el doble. También se prueba la reasignación A→B→A con una generación de vínculo nueva. Son pruebas de las comparaciones propuestas. No establecen qué metadata de Firestore provee un testigo durable ni cómo se emiten, autentican o revocan las pruebas realmente. [Guard y ancla](../evidence/lv019-b-unblock-reconciliation-model-20261126/contract.model.mjs#L95) · [Vínculo](../evidence/lv019-b-unblock-reconciliation-model-20261126/contract.model.mjs#L395)
- La secuencia de inscripción con ACK perdido estaba caracterizada indirectamente en el modelo original. Ahora se separa un commit confirmado de la pérdida de su respuesta, se recupera la inscripción sin cambiar estado ni efectuar un POST, y el sucesor aún exige un cerco. También se probaron el replay exacto del POST que confirmó primero, aparición de rivales con anclas separadas, ambos órdenes del POST tardío, un recibo antiguo frente a una guardia nueva, pérdida del ACK de conciliación y pérdida selectiva de ancla, intento, decisión, recibo y otro incidente. [Recuperación y 409](../evidence/lv019-b-unblock-reconciliation-model-20261126/contract.model.mjs#L407)
- El material de la revisión omitió parte de la fase 3. En el archivo íntegro sí se relee continuidad, guardia, alerta y filas dentro de la transacción antes de avanzar. El estado `applied` permite un salto antes de probar `accountId` en esa fila. El nuevo borrador exige acreditar pertenencia incluso en ese progreso. La alteración de dueño requeriría un escritor fuera del recorrido demostrado y no se reprodujo contra runtime. La conclusión de GLM sobre replay legado se aplica al cierre ya completo. El parcial con guardia viva vuelve a `recheck` y requiere constancias, aunque Cuenta ya confirme. [Fase 3](../../server/commercial/billingUnblock.ts#L444) · [Parcial](../../server/commercial/billingUnblock.ts#L337)
- La divergencia de disponibilidad con §3.3 sigue vigente en el software base. Un 409 genérico y `pending` carecen de autoridad para repetir. El 409 del modelo se representa mediante rechazo de generación después de una incidencia real del modelo. El contrato estructurado HTTP y la aprobación de reemplazar la reanudación vigente por la conciliación siguen abiertos. El escritor anterior ignora el cerco y debe retirarse o quedar sujeto al mismo protocolo antes del corte. [Software vigente](../../server/commercial/billingUnblock.ts#L396) · [Escritor de Cuenta](../../server/account/backend.ts#L263)

## Verificación local

Node 24.22.3. Sintaxis comprobada y **25/25** en el modelo ampliado. La primera corrida obtuvo **24/25**. Compartía una referencia de JavaScript entre ancla y recibo, por lo que el negativo de corrupción aislada alteraba dos documentos del doble. La corrección modela copias persistidas distintas y el negativo pasa. Ambos TAP quedan locales, bajo `outputs/lv019-b-unblock-reconciliation-model-20261126/`.

| Artefacto | SHA-256 de los bytes locales |
| --- | --- |
| `followup-first.tap` | `c5bf130c53c2d030e56d9d83f94244574279053bd11a3fb09c03c710f424b0fa` |
| `followup-final.tap` | `05c7f08937fbc25fa1b746352604e6c1881a26dc80e3c09b4fc0079907508361` |
| `contract.model.mjs` | `873aa0c38cee8a25ea26bba629189727ea90dbe85cf783a091e6ea47886085a1` |

```powershell
node --check docs/evidence/lv019-b-unblock-reconciliation-model-20261126/contract.model.mjs
node --test --test-reporter=tap docs/evidence/lv019-b-unblock-reconciliation-model-20261126/contract.model.mjs
```

Los servicios, atestaciones y commits son dobles. El modelo no ejecuta Firestore, AccountStore, HTTP o IAM. La serialización real, el despachador y cierre de Video, la adopción de pendientes/parciales legados, el inventario y corte de escritores y la retención ante restauración o pérdida coordinada siguen pendientes. Tampoco hay garantía de que una atestación inmovilice el otro sistema o de que exista recuperación con historia insuficiente. No se modificó runtime ni se hicieron llamadas externas.

=== RESUMEN FINAL ===
RESULTADO: INCONCLUYENTE
EVIDENCIA: Los dos dictámenes históricos se preservan. Se precisa la procedencia de alta y de desbloqueo. 25/25 en el modelo serial ampliado, con recuperaciones y dos incidentes independientes sobre una guardia.
NEGATIVOS: Copia de una prueba, rol o propósito incorrecto, corte o ancla ausente, actor distinto, ABA de vínculo o creación, intento o recibo perdido, POST viejo, generación vencida y segundo cierre indebido.
BLOQUEOS: Definir y acreditar emisor, IAM, contrato, operador, corte, migración y retención. Probar serialización, metadata y reconciliación de las dos bases. Los dos dictámenes externos no cubren este seguimiento. Costo y tokens no medidos.
=== FIN RESUMEN ===
