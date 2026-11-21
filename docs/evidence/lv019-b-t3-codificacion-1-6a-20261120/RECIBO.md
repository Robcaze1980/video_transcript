# Recibo · Paso 1.6a · Candado con arriendo del ejecutor periódico (20 nov 2026)

**Veredicto de Codex (certificación final): CERTIFICADO**, con los límites del final. Programó T3 (hilo «1.6a candado con arriendo», rondas 1 y 2); revisó de forma independiente T3 con `deepseek/deepseek-v4.1-flash`; Codex ejecutó, mutó y contrastó con el código. Todo local; no se desplegó nada ni se tocó una base real.

## Qué se entrega

`server/commercial/billingDrainLease.ts` (módulo nuevo, sin importar `firestoreBackend`, `firestoreAi`, `accountBillingClient` ni el modo billing), su prueba vitest (43) y su prueba de emulador (10). Contrato: documento `billingDrainLease/current` `{holderId, token, expiresAtMs, acquiredAtMs, renewedAtMs}`; contador de tokens `billingDrainLease/counter` (el token crece también tras liberar); cursores por tipo en `billingDrainLease/cursors`; adquirir, renovar y liberar en transacción con `now` inyectado y condicionados a `holderId` **y** token; `assertDrainLeaseHeld` y `getDrainCursor` son lecturas puras; `setDrainCursor` exige ser el titular vigente. El candado es una **optimización de vivacidad**: la seguridad (un solo movimiento de saldo) sigue siendo la idempotencia de Cuenta y las comparaciones atómicas de Video.

## Evidencia

| Prueba | Resultado |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| vitest `billingDrainLease.test.ts` (copia en el árbol principal) | **43/43** |
| Emulador real (8185), `billingDrainLease.emulator.mjs` | **10/10** (8 adquisiciones concurrentes → exactamente una; token estrictamente creciente en 20 ciclos; vencimiento con reloj inyectado; renovar/liberar condicionados; titular antiguo tras vencer; cursor condicionado; limpieza) |
| Mutaciones de T3 | 13/13 detectadas, 0 supervivientes |
| Mutaciones propias de Codex sobre el archivo final | **15/15 detectadas** (unit; el emulador detecta 14: `acquire-merge` solo lo detecta el doble, equivalente por diseño porque los cinco campos se reescriben siempre); archivo restaurado idéntico |

Mutantes propios: renovar con `at=now`, expiración que se acorta, tenencia (`>=`→`>` y eliminada), cota de ventana en lectura y cota hacia adelante, `expiresAtMs===now`, ids reservados, liberar sin exigir token, propiedad sin `holderId`, token no estricto, contador sin escribir, fusión en vez de reemplazo, cursor sin comprobación, margen de `assertDrainLeaseHeld`.

## Revisión independiente (T3, DeepSeek) y adjudicación

La primera ronda respondió **FALLA** (se conserva en `review-1-6a-deepseek.txt`). Codex contrastó cada hallazgo contra el código y adoptó:

| # | Hallazgo | Adjudicación |
|---|---|---|
| 1 ALTA | `renew` sin monotonía: un reloj que retrocede deja `renewedAtMs < acquiredAtMs`, `readLease` lo rechaza y el titular pierde su propio arriendo habiendo recibido `true` | **Real, adoptado** (ronda 2: `at = max(now, renewedAtMs)`, `expiresAtMs = max(expiración vigente, at + ttl)`) |
| 2 ALTA | Un documento con `expiresAtMs` enorme se considera bien formado y mantiene vivo el arriendo para siempre | **Real (vivacidad), adoptado**: ventana `expiresAtMs − renewedAtMs ≤ MAX` en lectura y `expiresAtMs − now ≤ MAX` en `isHeld` |
| 3 MEDIA | Token ilegible reinicia la numeración; `EXHAUSTED` sin recuperación | **Parcialmente adoptado**: sin cambio de comportamiento porque la barrera es la **igualdad** de `holderId` y token (no el orden), así que un token reiniciado no puede dar un arriendo ajeno; comentario corregido, recuperación documentada (borrar `counter` con aviso del dueño), pruebas con `MAX_SAFE_INTEGER+1` y token no numérico |
| 4 MEDIA | Falta lo que exigirá el cableado | **Adoptado en parte**: `DEFAULT_DRAIN_LEASE_RENEW_EVERY_MS` (10 s) y tope de tenencia `maxTenureMs` (120 s, doble del presupuesto de 60 s; la renovación se corta con `now − acquiredAtMs ≥ maxTenureMs`). El helper de sesión y la política «sin progreso no se renueva» son del cableado (1.6b) |
| 5 MEDIA | El doble de Firestore no serializa transacciones | **Aceptado como límite del doble**: la exclusión mutua y el único ganador se prueban en el emulador (8 concurrentes) |
| 6 BAJA | `plainDocId` admite ids reservados | **Adoptado** (`/^__.*__$/` rechazado) |

## Límites declarados

- La tenencia máxima corta la **renovación**; un arriendo ya concedido puede vivir hasta `tenencia + ttl` (≤ 210 s con los valores por defecto). Es vivacidad, no seguridad.
- Con un reloj que retrocede más de `MAX_DRAIN_LEASE_TTL_MS` el titular pierde su arriendo (se vuelve tomable): seguro por diseño, solo puede costar una pasada.
- Hasta el paso 1.6b nada llama a este módulo; no hay efecto en producción. El kind `unknown` del cursor (resolvedor de `unknown` del paso 1.2) se añade en ese paso.
- No se ejecutó la regresión financiera completa: el módulo no toca filas, saldos ni Cuenta y su prueba estática de frontera lo impide.
