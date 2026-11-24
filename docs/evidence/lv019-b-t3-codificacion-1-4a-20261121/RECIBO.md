# Recibo del paso 1.4a: fallos transitorios tras un ACK (C-3, E-3), ACK divergente nunca silenciado (3b) y alerta de cuenta bloqueada (D-4)

**Estado: certificado en local el 22 de noviembre de 2026 (sin desplegar).** Programó T3 (DeepSeek v4.1 Flash, instancia aislada `linguistvision-openrouter`) en tres rondas; revisaron GLM Flash Latest y DeepSeek; certifica Codex. **Queda para el paso 1.4b** el desbloqueo auditado (con operador) y la salida para reservas de una cuenta bloqueada (A-5/E-4). Contrato: [diseño v2](../../specs/LV-019-B-bloqueos-y-cierres-diseno.md) (secciones 3.1, 3.2 y 3.4).

## Qué hace

1. **C-3, fallo transitorio tras un ACK** (`quarantineExternalBillingOutbox`, fase `after_ack`): cuando el ACK corresponde a la acción de la fila, la fila sigue `pending|retry_wait` con la tupla esperada, **es el mismo documento** (mismo `createTime`), no tiene arriendo de un turno más nuevo y los otros 13 documentos conservan su versión, solo falló el marcado local: **no hay incidencia, hold ni bloqueo**; se cuenta un intento con espera creciente y, al octavo, `needs_review` con alerta y sin bloquear. La versión de la propia fila (`updateTime`) no forma parte del discriminador: una carrera inocua entre dos drenadores no bloquea al dueño. Una divergencia real (otro documento movido, tupla distinta, fila recreada, arriendo ajeno o ACK que no corresponde) conserva incidencia + hold + bloqueo.
2. **3b, ACK divergente:** un ACK que no corresponde a la acción de la fila deja de lanzar un error que se silenciaba con la fila `pending`: se registra como divergencia demostrada (`needs_review` + hold + guard); si la propia cuarentena falla, el drenaje cae a la incidencia de revisión del trabajo. Solo un ACK que corresponde puede tomar el atajo `already_settled`.
3. **E-3, cierre directo ya escrito:** el reintento idéntico de un cierre directo con instantánea que lo prueba (misma tupla y confirmación, intención del mismo documento, demás documentos con su versión previa) devuelve `already_closed` sin bloquear. Sin instantánea no hay línea base: el reintento cuenta un intento en la propia intención (`closure_unverified`, espera creciente) y **al tope de 8 la intención pasa a `needs_review` con alerta, sin incidencia, hold ni guard**; un reintento posterior idéntico no escribe nada. Con instantánea y un documento movido, o con tupla distinta o sin confirmación, sigue el bloqueo.
4. **D-4, alerta de cuenta bloqueada:** nueva fuente `guard` en el reporte de pendientes (`blocked == true`, un solo campo, sin índice compuesto, paginada por documento): una alerta por cuenta y época, deduplicada por el barrido; un guard sin incidencia ni hold, o con `epoch` presente pero inválido, es `malformed`. El guard de Video aún no lleva `epoch` (estado `blocked:1`): el desbloqueo y rebloqueo de 1.4b lo introducirán.

## Revisiones independientes (se conservan todas)

| Ronda | Revisor | Resultado | Archivo |
|---|---|---|---|
| 1 | DeepSeek | **FALLA** (E-3 al tope bloqueaba, epoch inexistente, rama sin prueba, paginación sin prueba) | [review-1-4a-deepseek.txt](review-1-4a-deepseek.txt) |
| 1 | GLM | **FALLA** (rama E-3 sin instantánea sin prueba, respaldo del catch, alerta imposible de limpiar, epoch inválido) | [review-1-4a-glm.txt](review-1-4a-glm.txt) |
| 2 (versión corregida) | DeepSeek | **FALLA** (cuenta ya bloqueada, `createTime` de la fila en C-3, planificador) | [review-1-4a-v3-deepseek.txt](review-1-4a-v3-deepseek.txt) |
| 2 | GLM | Resultado «PASS» al inicio con tres puntos (uno ALTA que confunde el arriendo de la propia fila con el documento del ejecutor) | [review-1-4a-v3-glm.txt](review-1-4a-v3-glm.txt) |

**Adjudicación de Codex (verificada contra el diseño y el código):**
- **Aceptado y corregido:** E-3 al tope bloqueaba (ALTA, diseño 3.2); la versión de la propia fila en C-3 convertía una carrera inocua en bloqueo (diseño 3.1; prueba roja escrita por Codex); `epoch` inválido; paginación y rama E-3 sin pruebas; ACK divergente sobre fila ya `settled`; reenvío tras ACK; **la fila de salida recreada** en C-3 (ronda 3, una línea y una prueba).
- **Rechazado con evidencia:** exigir `historyMatched` sin instantánea (no hay línea base; diseño 3.2); un planificador para una intención `closed` (no hay nada atascado); GLM ALTA sobre el arriendo (`hasIntentLease` mira los campos de la propia fila, no `billingDrainLease/current`).
- **Límites declarados:** el respaldo del catch depende de poder leer el trabajo (acotado por la edad máxima de 48 h de 1.6c); limpiar la alerta de guard al desbloquear es 1.4b; el guard de Video no lleva `epoch` hasta 1.4b; E-3 sin instantánea sobre una cuenta **ya bloqueada** por otro incidente sigue por el camino de incidencia anterior (más ruido, sin movimiento de saldo).
- No se hizo una tercera revisión completa tras la ronda 3: el cambio es de una condición, con prueba roja, mutación detectada y regresión completa.

## Evidencia

- `tsc --noEmit` limpio; unitarias focalizadas en verde (incluye `firestoreBlocksA.test.ts`).
- Emulador con **Cuenta real**: `firestoreBlocksA` 27/27, ACK persistente 3/3, instantánea 22/22, propiedad durante el ACK 5/5, liquidación C2a 21/21, resolvedor de `unknown` 22/22, control de drenaje 11/11, edad 20/20, sección 9/9, `firestoreAi` 166/166.
- **Regresión financiera completa: 337 pruebas, 332 aprobadas, 5 pausadas de voz, 0 fallidas** ([resultado](../../../outputs/lv019-b-financial-runs/run-dcc7e04a-1dd9-4423-b6ba-e44610ff9dca/result.json)); el ejecutor de la regresión incluye ahora la fixture de bloqueos.
- Regresión protegida de Cuenta **PASS** ([resultado](../../../outputs/lv019-b-account-full-runs/run-d15a3aa0-765d-4756-96df-2243809b4b12)); suite completa `npm test`: **1659 aprobadas, 113 omitidas (PostgreSQL histórico), 0 fallidas**.
- **Mutaciones propias de Codex: 15 + 19 + 7 ejecutadas en tres rondas, todas detectadas al final**; las supervivientes de cada ronda eran huecos reales de pruebas (la versión de la fila, el atajo `already_settled`, la rama E-3 al tope, el «no hacer nada» tras el tope) y se cerraron con pruebas, no con cambios del código bajo prueba ([arnés ronda 2](mutaciones/mutate_14a_r2.py), [ronda 3](mutaciones/mutate_14a_r3.py), [resultados](mutaciones/)). T3 añadió además 13 mutaciones propias en sus tres rondas (6 + 6 + 1), todas detectadas.

## Gasto

Saldo de OpenRouter medido: US$24,95 tras la recarga del 21 nov; US$9,26 a las 13:55 del 22 nov, con hasta tres hilos de T3 a la vez y las revisiones de 1.6c y 1.4a incluidas. El costo propio de 1.4a no se puede aislar con la API del proveedor.
