# LV-019.B · Cierre de Video después del ACK directo

Diagnóstico aislado de 5d949a0fcae9858d23a709d9530775afac963878. Añade seis casos unitarios a alertContractReview.test.mjs. Conserva la implementación de Video y Cuenta. Las cuatro expectativas de seguridad deben quedar rojas sobre esta base.

## Alcance y contrato

La especificación de bloqueos §3.3 distingue la autorización auditada de Video, la decisión transaccional en Cuenta y el cierre posterior en Video. La solicitud unblock_requested es inmutable. El camino por recibo recuperado confirmed ya vuelve a cotejar su versión. En la primera llamada con ACK directo y al recibir el ACK del POST posterior a pending, la fase final de billingUnblock.ts:383–390 coteja guardia y alerta y sigue con las filas del plan sin volver a leer la solicitud. La relectura anterior al POST de la rama pending protege otra ventana.

Los casos usan el AccountStore real con un almacenamiento transaccional simulado bajo otra raíz en memoria. La fixture cambia el registro de Video por una escritura directa del doble una vez que Cuenta ha terminado su mutación y antes de entregar el ACK a Video. La variante restaurada hace dos escrituras y vuelve a los valores originales. Los dos stores son independientes. En la reanudación, la primera llamada falla antes de entregar el POST y deja solo la solicitud de Video. El segundo intento obtiene pending del AccountStore y luego entrega el POST condicional.

## Resultados

| Ruta | Solicitud intacta | Evidencia distinta al entregar el ACK | Alterada y restaurada al entregar el ACK |
| --- | --- | --- | --- |
| Primera llamada | Pasa. Video cierra y replay no llama a Cuenta | Falla. Video dispone la alerta, revisa el incidente, quita la guardia y escribe unblocked con la evidencia original, aunque la solicitud conserva otra | Falla. Video cierra con la evidencia original después de dos escrituras a la solicitud |
| Reanudación tras pending | Pasa. Video cierra y replay no llama a Cuenta | Falla con los mismos efectos | Falla con los mismos efectos |

Antes de cada aserción final se verifica que Cuenta ya registró **un solo** recibo para la evidencia original, marcó su incidente como revisado y eliminó su guardia restante. La decisión de Cuenta queda igual después de la fase de Video. El saldo, la reserva y el asiento sintético preexistente quedan intactos. El POST simulado fue único. En la reanudación se contaron además una consulta pending y un fallo local inicial antes de llegar a Cuenta. La prueba intacta confirma también el replay sin otro contacto con Cuenta y sin escrituras en ninguna de las dos raíces.

Se demostró una brecha en la continuidad del registro auditado local bajo la precondición sembrada. La biblioteca escribe unblock_requested con create transaccional. El operador HTTP mostrado permite disposición de alertas, y el POST interno de Cuenta exige el principal de liquidación. La revisión no encontró una vía normal de cliente para alterar la solicitud. La prueba no acreditó una escritura normal de producción, nuevas operaciones de Video atribuibles a la ventana ni una devolución, captura o cambio de dinero.

## Evidencia reproducible y límites

La suite unitaria completa alertContractReview.test.mjs registró 33 aprobadas, 4 fallos esperados y cero omisiones. Se ejecutó con Node 24.13.0, perfil limpio y bloqueo de red Node. El doble no demuestra aislamiento, reintentos Firestore ni atomicidad entre Video y Cuenta. No se ejecutó el emulador, no se hicieron consultas externas y no se usaron datos de cliente.

Los recibos completos se conservan fuera de Git bajo outputs/lv019-b-direct-ack-diagnostic-20261126/. stdout.log SHA-256 1a024124ef8d8ca1482b30055d0a23c7ad40bc93739fe749b5f0589f0168e62f. stderr.log SHA-256 1e5fa9c83bcfd6e65fe67fa171498a24b6aef894b94784cbf90ac463fa8dbebf. El filtro direct unblock ACK permite repetir solo los seis casos.

=== RESUMEN FINAL ===
RESULTADO: FALLA
EVIDENCIA: Las dos rutas de ACK directo cierran Video tras alteración persistente y tras restauración del registro reclamado. Cuenta ya había confirmado su única decisión y no se movió saldo.
NEGATIVOS: Cuatro expectativas incumplidas. Los dos controles intactos pasan y su replay conserva ambos stores. La rama pending solo hace un POST después de su consulta.
BLOQUEOS: Requiere escritor privilegiado en el escenario. No se demostró vía normal ni saldo de cliente. Quedan abiertos Firestore real, concurrencia y toda afirmación de atomicidad entre bases. Costo y uso no medidos.
=== FIN RESUMEN ===
