# LV-019.B · Lectura de la base de Cuenta en producción · 19 nov 2026 (solo lectura, solo recuentos)

**Alcance autorizado.** El dueño respondió «Sí, autorizo Cuenta» en el chat el 19 nov 2026: leer la base de Cuenta del proyecto real y devolver **solo recuentos**, **sin escribir nada**. Se leyó la base `vistavo-live` bajo la raíz `vistavo/production-v1` (comprobada por su documento marcador: servicio `vistavo-account`, entorno `production`, esquema 1, unidad `video_seconds`): `accounts`, `videoReservations`, `videoReservationTombstones`, `videoBillingGuards`, `videoBillingIncidents` y `ledgerEntries`. **No** eran alcanzables `identities`, `projects`, `providerCalls`, `providerCallFences` ni `createRequests`.

**Cómo.** El mismo ejecutor de la lectura 1C, [`scripts/oneCReadOnlyCounts.mjs`](../../scripts/oneCReadOnlyCounts.mjs) con `--scope account` (obligatorio, sin valor por defecto), a través de una fachada de solo lectura con política propia ([`accountReadOnlyRoot.ts`](../../server/commercial/accountReadOnlyRoot.ts) sobre el motor [`readOnlyFirestoreRoot.ts`](../../server/commercial/readOnlyFirestoreRoot.ts)): lista fija de seis colecciones, filtros de igualdad solo con los campos y valores que los recuentos necesitan (los saldos no admiten ningún filtro, para que no se puedan sondear por bisección), sin referencias a documentos ni métodos de escritura, y por documento solo los campos escalares de la política (nunca la clave de identidad, el UID, el id de reserva, las admisiones de proveedor ni el contador de proyectos; de la admisión solo si existe). El resumen ([`accountReconciliationCounts.ts`](../../server/commercial/accountReconciliationCounts.ts)) comprueba los invariantes que el propio código de Cuenta mantiene y devuelve solo totales y recuentos. Se revisó con T3 **antes** de leer nada real ([recibo](../evidence/lv019-b-t3-lectura-cuenta-20261119/RECIBO.md)) y se probó contra el emulador con el ejecutor real como proceso hijo (205 cuentas, 206 reservas abiertas, anomalías sembradas, documentos sensibles en colecciones inalcanzables, ningún documento cambió). Evidencia: [`counts.json`](../evidence/lv019-b-lectura-cuenta-20261119/counts.json).

## Resultado
| Colección | Documentos |
|---|---|
| `accounts` | **0** |
| `videoReservations` | **0** |
| `videoReservationTombstones` | **0** |
| `videoBillingGuards` | **0** |
| `videoBillingIncidents` | **0** |
| `ledgerEntries` | **0** |

Se hicieron 2 consultas y 15 agregaciones de recuento y **no se leyó ningún documento**. El documento marcador existe y coincide: la base está aprovisionada y es la correcta, pero **no tiene ninguna cuenta**. Por tanto no hay reservas abiertas ni cerradas, ningún bloqueo ni incidente, ninguna entrada de libro, ninguna diferencia entre libro y reservas, y ningún saldo que cuadrar.

## Qué significa y qué no
- **Hoy no hay saldo ni reservas en producción**, ni en las colas del vídeo ([lectura 1C](LV-019-B-lectura-1c-2026-11-19.md)) ni en Cuenta. Es coherente con que nadie ha abierto todavía una cuenta de saldo en producción ni se ha conectado el flujo de saldo del vídeo. **No hay nada que conciliar, migrar ni alertar hoy.**
- **Los invariantes que comprueba el resumen no se pudieron ejercitar con datos reales** (no hay datos): se ejercitaron con pruebas unitarias y con el emulador (cuentas con descuadres sembrados: salto de balance, `reserved` y `active` distintos de las reservas abiertas, reservas huérfanas, protocolo heredado, libro y reservas que no coinciden). Su primera ejecución real tendrá sentido cuando existan cuentas.
- **Para cuándo sirve esto:** antes de abrir saldo a clientes, estas dos lecturas (colas y Cuenta) son una comprobación de solo lectura que se puede repetir, a mano, sin escribir nada.

## Límites (qué no se vio)
- Solo se leyeron los recuentos de las seis colecciones listadas; no `identities` (por tanto no se sabe cuántas personas han iniciado sesión), ni `projects`, ni las llamadas a proveedor.
- Los recuentos por agregación no son una instantánea exacta si hubiera escritores activos; con cero documentos no hay nada que se haya podido perder.
- No se leyeron datos de otros proyectos, registros, secretos ni IAM.
