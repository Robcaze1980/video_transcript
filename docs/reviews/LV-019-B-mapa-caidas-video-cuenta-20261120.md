# LV-019.B · Mapa de caídas entre Video y Cuenta (20 nov 2026)

**Origen y fiabilidad.** Informe de un agente de solo lectura (sin ejecutar pruebas ni red) que recorrió `firestoreBackend.ts` (FB), `firestoreAi.ts` (FA), `accountBillingClient.ts`, `cloudFilesRuntime.ts` (CFR), `server/account/backend.ts` (AB) y `http.ts`. **Codex verificó personalmente** estos puntos: AB:285 (una sola admisión por reserva), AB:309–353 y AB:347 (liberar tras admisión rechazado), FB:1332–1351 (todo `failed`/`cancelled` externo pide `release`), FB:1688–1711 (`completeNoSpeech`), FA:230–237 (una reserva `reserved` sin trabajo solo se reprograma), `cloudAiWorker.ts:58–62`, FB:1730–1743 (cancelar con `invoking` deja `unknown`). **El resto de las filas no se ha verificado de forma independiente**: son pistas con `archivo:línea` que hay que comprobar antes de apoyarse en ellas. Los números de línea pueden variar con el tiempo. Alcance: lectura de código; no prueba comportamiento.

Todos los drenajes (DI intenciones, DO salidas, DH bloqueos) dependen de un planificador que **no existe** (el modo `billing` no está configurado en `deploy/`; solo se ejecutan tras una pasada del worker de IA, y se omiten si esa pasada falla).

## Ventanas por flujo

**A · Reserva** (A1 Video crea la intención → A2 Cuenta reserva → A3 Video crea trabajo).

| ID | Ventana | Estado | Recuperación | Hueco |
|---|---|---|---|---|
| A-2 | A1→A2 | Video: intención; Cuenta: nada | DI sella (404 → tombstone) y cierra; una reserva tardía se rechaza | No |
| **A-3** | A2 hecho, A3 no | Video: `reserve_pending`; Cuenta: `reserved`, active+1 | DI solo reprograma; nada crea el trabajo ni libera; el módulo de evidencia de ACK no lo importa ningún código no-test | **Sí: sin convergencia** (las pruebas afirman la no-recuperación) |
| A-4 | A3 hecho, respuesta perdida | Consistente | El replay da `unknown` y el trabajo corre | No |
| **A-5** | Un bloqueo llega tras el recheck y antes de A2 | Video: bloqueado; Cuenta: `reserved` | Ninguna (la captura de evidencia devuelve null si está bloqueada) | **Sí** (solo se prueba antes del recheck) |

**B · Admisión por llamada** (B1 Video registra `intent` → B2 Cuenta admite → B3 proveedor → B4 Video registra `received`).

| ID | Ventana | Hueco |
|---|---|---|
| B-0 | claim → `beginInvocation` | `unknown` sin salida: `reconcile` solo lo llama un script de prueba |
| B-1 | B1 → B2 | Igual |
| **B-2** | Admisión hecha, ACK perdido o caída antes del envío | Reserva retenida (Cuenta rechaza liberar) |
| **B-3** | Enviado, sin recibo | `unknown`; el proveedor pudo cobrar; sin salida |
| B-4 | `received`, sin stage/finish | `recover` → `unknown`; sin salida |

**C · Liquidación** (C1 Video termina y crea la fila → C2 Cuenta liquida → C3 Video marca `settled`).

| ID | Ventana | Recuperación | Hueco |
|---|---|---|---|
| C-1 | C1 → drenaje | DO la recoge | No |
| C-2 | C2 hecho, ACK perdido | DO repite; Cuenta es idempotente | No |
| **C-3** | ACK recibido, falla el marcado local | Cuarentena, `needs_review` y bloqueo del dueño; sin salida | **Sí:** un fallo transitorio se vuelve bloqueo permanente (las pruebas lo afirman) |
| C-4 | Marcado hecho, respuesta perdida | `already_settled` | No (corregido el 20 nov) |
| **C-5** | Liberar tras admisión (sin habla tras responder el proveedor) | Ninguna: Cuenta rechaza y Video reintenta sin tope | **Sí, el más grave** |

**D · Bloqueo** (D1 Video escribe incidencia, bloqueo y fila → D2 Cuenta bloquea → D3 Video marca `applied`): D-1 a D-3 cubiertos por DH; **D-4** (`needs_review` del bloqueo, sin bloqueo en Cuenta, sin alerta): **hueco**.

**E · Liberación** (E1 `release_pending` → E2 sellado/liberación → E3 cierre): E-1 y E-2 cubiertos; **E-3** (cierre local hecho con respuesta perdida → bloqueo por «cierre no verificado»): **hueco**, falso positivo permanente; **E-4** (liberación debida con un bloqueo): **hueco** sin prueba.

## Estados que pueden quedarse para siempre (invariante I5 «no garantizado»)

Intención `reserve_pending` con Cuenta `reserved` (A-3); intenciones de una cuenta bloqueada (A-5, E-4); `release_pending` contra un bloqueo; todo `needs_review`; trabajo `unknown`; reserva con admisión (B-2 a B-4, C-5); reserva bajo bloqueo; reservas legadas; filas `retry_wait` sin tope de intentos; el bloqueo permanente (no hay escritura de desbloqueo en código no-test). El reporte, las alertas y el barrido locales detectan parte de esto pero nada los invoca.

## Límites y datos útiles

- Máximo **600 s** por reserva; un trabajo de texto tiene como mucho 20 ventanas. No hay caducidad de reservas.
- **3 reservas activas** por cuenta (`quota` al llegar; HTTP 429). Video también aplica `active>=3` y decrementa al terminar el trabajo, antes que Cuenta, así que los contadores pueden divergir.
- Tiempos: cliente de Cuenta 10 s; lease de trabajo 30 s; latido 4 s; proveedor 180 s.
- La admisión por Cuenta de clientes está desactivada (FA:130): estos flujos solo los alcanzan llamadores internos de confianza.

## Las cinco ventanas más peligrosas (orden del agente)

1. **C-5**, sin habla tras admisión: ocurre sin caída; retiene saldo y cupo, y tres de estas bloquean nuevas reservas. Ninguna prueba lo ejecuta contra `AccountStore` real.
2. **A-3**, reserva sin trabajo.
3. **B-1 a B-4**, trabajos `unknown` sin salida ni visibilidad de la admisión para el operador (ningún endpoint de Cuenta la expone).
4. **A-5 y E-4**, congelación de una cuenta bloqueada.
5. **C-3 y E-3**, fallo transitorio tras un ACK que acaba en bloqueo permanente.

Trazabilidad: C-5, B-1 a B-4 y la política del dueño se cierran con el paso C2a ([especificación](../specs/LV-019-B-liquidacion-parcial-y-liberacion-posadmision.md)) y C3; A-3 es puerta de la reserva externa; A-5, E-4, C-3, E-3, D-4 y el desbloqueo auditado quedan para B2 y el diseño de bloqueos.
