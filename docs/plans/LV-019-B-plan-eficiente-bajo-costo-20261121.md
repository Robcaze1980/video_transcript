# LV-019.B · Plan eficiente de bajo costo (21 nov 2026)

**Estado: APROBADO por el dueño el 21 nov 2026 (decisiones §E.2, §E.4 y §E.7; no aprobó diferir el operador mínimo ni «solo texto primero»; la recarga de crédito sigue pendiente de su decisión). v2 de Codex (21 nov 2026) sobre el borrador de T3, tras una revisión independiente (GLM respondió FALLA; adjudicación en el [recibo](../evidence/lv019-b-t3-plan-eficiente-20261121/RECIBO.md)).** Lo redactó el rol de planificación (T3), a pedido del dueño, que ve ~US$15/día de gasto en OpenRouter y quiere **bajar costo y tiempo sin romper la calidad ni las 10 reglas de «production ready»**. No ejecuta nada: es un plan. No cambia código, nube ni saldo. **Medición de Codex (21 nov):** con dos hilos de T3 activos el gasto fue de **US$0,53 en 31 minutos (≈US$1 por hora; ≈US$0,5 por hora de hilo activo)**; el costo crece con las **horas de hilo**, no con el número de hilos a la vez. Los demás números de dinero son **estimaciones**, no mediciones; cada rango dice su base.

**Documentos que manda el estado vigente** (si algo difiere, mandan esos): [MASTERPLAN](../../MASTERPLAN.md), [backlog](../../backlog.md), [gantt](../../gantt.md), [plan integral](../specs/LV-019-B-plan-integral-20261120.md), [plan paso a paso](../specs/LV-019-B-plan-paso-a-paso-20261120.md), [HANDOFF](../../HANDOFF.md), [bitácora](../../bitacora.md), [errorlogs](../../errorlogs.md). Este documento solo propone **cómo hacerlo más barato y más rápido**, y marca lo que debe decidir el dueño.

**Punto de partida real (hechos, 21 nov).** Certificado en local: 1.1, 1.6a, 3.4 y 3.1 (script A0, sin ejecutar); guiones de escucha (32) y validador; diseños v2 de 1.2, 1.3 y 1.4 con pruebas en rojo de 1.2 y 1.6b. Sin empezar: 1.7, toda la voz (el 1.5 reducido se certificó después, el mismo día: [recibo](../evidence/lv019-b-codex-legado-1-5-20261121/RECIBO.md)), la nube preparada (3.2, 3.3, 3.5–3.10) y las fases 4 a 7. **T3 se detuvo por falta de crédito (402 en OpenRouter, [errorlogs](../../errorlogs.md)) y volvió a trabajar el 21 nov tras una recarga de ≈US$10**; quedan ≈US$9, que a ≈US$1/h con dos hilos alcanzan para unas 9 horas de trabajo.

---

## A. Camino crítico real hasta el primer despliegue restringido

El «primer despliegue restringido» es la **fase 6**: nada público, **solo cuentas de verificación**, con saldo real, texto y voz, teléfonos reales, interruptor y reversión probados (puerta G0 del dueño + G6). Todo lo de abajo se mide contra *ese* momento, no contra la apertura pública.

### A.1 Imprescindible antes del despliegue restringido (si falta, hay riesgo de dinero o de puerta)

| Bloque | Pasos | Por qué es imprescindible (regla) |
|---|---|---|
| Cierre financiero local | **1.2**, **1.3a**, **1.3b**, **1.4**, **1.6b**, **1.7** | Toca saldo: cancelación y `unknown`, reserva sin trabajo (salida por plazo **y** ACK durable del solicitante), bloqueos y cierres, ejecutor periódico de drenajes, y el cierre con regresión completa (reglas 1, 3, 5, 8, 9). Hoy **ningún planificador drena** las reservas: sin 1.6b una reserva puede quedarse retenida para siempre. **1.3b no se difiere** (corrección de Codex): la reserva de saldo real de un cliente pasa por la ruta externa Video→Cuenta, que sigue **cerrada** hasta que el ensayo llegue a 13/13; sin 1.3b una cuenta de verificación no puede reservar saldo real desde el producto y las seis ventanas rojas (identidad revocada tras la prelectura, ACK sin guardar, etc.) quedan abiertas. |
| Voz que toca dinero | **2.2**, **2.3**, **2.4**, **2.5**, **2.7**, **2.9** | Reserva de voz, llamada por fragmento (una sola en vuelo, jamás reintento automático), recuperación, reapertura de las 5 pruebas pausadas, retención de 90 días con interruptor por cuenta impuesto en el servidor y apagado por defecto, y cierre (reglas 4, 8, 9, 10). **Sin esto no hay voz y G0 no se cumple.** |
| Voz que toca calidad | **2.8** | Escucha nativa de inglés y de español neutro latinoamericano: es decisión del dueño y criterio LV-004 (regla del plan: un idioma no aprueba al otro). |
| Voz que toca uso | **2.6** | Interfaz mínima para que una cuenta de verificación pida voz y vea el precio adicional; sin ella no se puede probar la voz de punta a punta. |
| Nube que protege dinero | **3.2**, **3.3**, **3.5 (operador mínimo)**, **3.6**, **3.7**, **3.8 (mínimo)**, **3.10 (solo el interruptor)** | Índice real, **canal de alerta por correo probado** antes de tocar saldo, límites y cupos de gasto, runbooks con reversión, métricas/alertas mínimas y el **interruptor que apaga todas las llamadas al proveedor** guardado fuera del servicio que vigila (reglas 6, 8, 9). |
| Producto real | **4.1**, **4.2**, **4.3**, **4.3b**, **4.4**, **4.6** | Gateway autenticado, Configuración de Hosting sin aplicar todavía, procesamiento real detrás de interruptores, **una prueba controlada con el proveedor real desde la PC con contenido sintético dentro del tope de US$5**, el flujo completo en la cuenta y la integración de punta a punta (reglas 5, 6, 8, 9, 10). |
| Puertas y acta | **Fase 5** y **G8** (textos legales) | No se abre ni a una cuenta de verificación sin privacidad, términos y consentimiento aprobados, y sin acta firmada por el dueño (regla del plan y G8). |

### A.2 Puede ir DESPUÉS sin riesgo de dinero (no está en el camino crítico)

| Paso | Por qué puede esperar |
|---|---|
| **1.5** reducido | Las bases reales están **vacías**: no hay escritores antiguos que drenar. Basta el «fallar cerrado» ya presente y un inventario de fechas documentado. |
| **3.5 completo** (servicio de operador con todas sus pantallas) | Se conserva un **operador mínimo** (autenticado, en lista permitida, con reloj del servidor) porque el desbloqueo auditado del paso 1.4 lo exige y operar «a mano» no satisface ese protocolo. Diferir incluso el mínimo es **decisión del dueño** (§E.8): dejaría una cuenta bloqueada sin salida hasta construirlo. |
| **3.9** (restauración) y **3.10** (abuso/capacidad) reducidos | G9 pide **una** restauración ensayada, no un programa completo: basta un simulacro sintético de una base + GCS, medido. De 3.10 se conserva **solo el interruptor** (regla 9) y se difieren cupos finos y prueba de carga. |
| **4.5** parcial | 30 s y 1920 px bastan para el contenido sintético y propio del despliegue restringido. MOV, 2–3 min, pestañas (J1/J2) y perfección móvil van después. |
| LV-004 (más pares), Drive, compras/PayPal, render MP4 largo, diagnóstico LV-E55 | Pistas propias con su presupuesto y sus puertas; ninguna toca el saldo del recorrido texto+voz. |

**Regla de oro del camino crítico:** un paso **no** es imprescindible por estar en la lista de fases, sino por (a) mover o retener saldo, (b) ser puerta del dueño/nube, o (c) ser evidencia exigida por las 10 reglas. Todo lo demás puede moverse a la derecha sin tocar el dinero.

---

## B. Palancas de ahorro (con ahorro estimado y riesgo de calidad)

Base de cálculo: el gasto de OpenRouter crece con las **horas de hilo activo** (≈US$0,5 por hora, medido). Sus causas reales son (1) T3 **relee archivos enormes** en cada ronda, (2) **rondas de repetición**: casi todo borrador falla una vez (1.1 necesitó 4 rondas; los diseños 1.3 y 1.4 reprobaron dos revisiones cada uno) y (3) **2 revisores independientes** por entrega. **Corrección de Codex a la propuesta de T3:** correr hilos en paralelo y correr pruebas o la regresión **en local** no cuesta tokens por sí mismo (las ejecuta Codex; T3 solo paga si lee su salida), así que esas dos palancas **ahorran reloj o coordinación, no dinero**.

### B.1 Las palancas

| # | Palanca | Ahorro estimado | Riesgo de calidad | Cómo se mitiga |
|---|---|---|---|---|
| L1 | **Revisores por nivel de riesgo:** 2 (dos modelos) para **código que mueve saldo y diseños**; **1** para lo mecánico/no-dinero (scripts de lectura, guiones, UI, documentación) | 25–35 % del gasto de revisión | **Bajo** (no toca saldo) | Umbral explícito: «mueve saldo» = escribe reservas, capturas, liberaciones, bloqueos, ejecutor, contratos de Cuenta. Ese umbral se escribe en la especificación. |
| L2 | **Tope de hilos en paralelo ≤ 3** (evita choques en los mismos archivos; **no** es una palanca de costo) | **≈0 % de tokens** (mismo trabajo en más o menos tiempo) | **Bajo** | Se paraleliza solo lo verdaderamente independiente (voz ↔ nube solo-lectura ↔ móvil); dos hilos que editan `firestoreBackend.ts` van en worktrees distintos y se fusionan con git |
| L3 | **Mapa de código** para que T3 **no relea** archivos gigantes (§B.2) | 20–30 % de tokens de lectura | **Bajo** si el mapa es correcto | Fragmentos anclados `archivo:línea` verificados por Codex antes de enviarse |
| L4 | **Una sola ronda de pruebas+implementación por paso**: brief congelado + tests en rojo + implementación en el mismo worktree, sin ida y vuelta | 20–30 % | **Medio**: menos iteración = más defectos en la primera entrega | Criterio de salida explícito; si la primera entrega falla, **una** ronda de corrección ya incluida en el presupuesto |
| L5 | **Reutilizar fixtures** (reservas, cuentas, trabajos sintéticos ya escritos) | 5–10 % | **Bajo** | Un único `scripts/fixtures/` compartido, versionado |
| L6 | ~~Regresión completa solo al cerrar cada fase~~ **Rechazada por Codex:** la regresión financiera completa tarda ≈8 minutos y se ejecuta en local sin gasto de OpenRouter; se **mantiene completa al cerrar cada paso de dinero** (regla 3) y focalizada en las rondas intermedias | **≈0 %** (solo reloj) | — | Un defecto cruzado se detecta en el paso que lo introduce, que es más barato que encontrarlo al cerrar la fase |
| L7 | **Modelos baratos para lo mecánico**: `deepseek/deepseek-v4.1-flash` para código mecánico y `~z-ai/glm-flash-latest` como revisor (preferencia vigente), sin usar un modelo premium en tareas triviales | 5–15 % | **Bajo-medio** | Registrar el modelo efectivamente servido; escalar a premium solo si el flash resulta inconcluso |
| L8 | **Fusionar/recortar pasos** (§A.2 y abajo) | 10–20 % | **Medio** | Cada recorte conserva su regla asociada; los pasos que tocan dinero no se recortan |

**Combinadas, y con L2 y L6 sin ahorro de tokens, el ahorro creíble es de ≈35–50 % del gasto** frente a la política actual (L1, L3, L4, L5, L7 y L8), **condicionado** a las decisiones del dueño §E.2 y §E.3: sin el cambio de la regla 4 (revisión por nivel de riesgo) el ahorro baja a ≈25–35 %. El ahorro no sale de aflojar el dinero, sino de **dejar de rehacer y de releer** (menos horas de hilo).

### B.2 Pasos que se recortan y pasos que NO

**Se recortan (sin romper reglas):** 1.5 (a mínimo + inventario), 3.5 (a operador mínimo), 3.9 (un solo simulacro sintético), 3.10 (solo el interruptor), 4.5 (parcial), 2.6 (UI mínima). **No se recorta 1.3b.**

**NO se recortan, con la regla que los ancla:**

- **1.1** (hecha), **1.2**, **1.3a**, **1.3b**, **1.4**, **1.6b**, **1.7** → saldo (reglas 1, 3, 8, 9).
- **2.2, 2.3, 2.4, 2.5, 2.7, 2.9** → saldo de voz y cumplimiento (reglas 4, 8, 9, 10).
- **3.3** (alerta probada), **3.6** (límites de gasto), **3.7** (reversión), **3.10** (interruptor) → reglas 6, 8, 9.
- **4.1, 4.2, 4.3, 4.3b, 4.4, 4.6** → autenticación, límites antes del proveedor, medición real (reglas 5, 6, 10).
- **G8** (textos legales antes de cualquier cuenta real) y la **aprobación escrita** del dueño.

**Reglas que se conservan enteras:** 1 (pruebas primero), 2 (mutaciones), 8 (alertas), 9 (reversible), 10 (impuesto en el servidor).

### B.3 Mapa de código propuesto (contenido que T3 debe recibir, no los archivos)

Con esto T3 no necesita abrir `firestoreBackend.ts` (190 KB) ni `firestoreAi.ts` (51 KB) enteros. Codex verifica los anclajes antes de enviarlos y los refresca cuando cambien.

| Archivo | Tamaño | Qué es | Anclas útiles (verificar antes de usar) |
|---|---|---|---|
| `server/commercial/firestoreBackend.ts` | 190 KB | Libro mayor, colas, bloqueos, liquidación | clase `FirestoreBackend` (L374); `EXTERNAL_BILLING_ATTEMPT_LIMIT` (L49); `validClearIntentAdmissionGuard` (L139); `copyOutboxSnapshot` (L300); `matchesOutboxSnapshot` (L306); `narrationRequiresReview` (L370); `captureDirectObservation` (L455); `recordReservedStatusUncertainty` (L466); `jobAccounting` (L501); `externalJobAdmissionAllowed` (L537); todo `failed`/`cancelled` externo pide `release` (~L1332–1351); `completeNoSpeech` (~L1688–1711) |
| `server/commercial/firestoreAi.ts` | 51 KB | Puerta de admisión de IA | reserva `reserved` sin trabajo solo se reprograma (~L230–237) |
| `server/account/backend.ts` | 41 KB | Cuenta: autoridad de reserva | una sola admisión por reserva (L285); liberación posadmisión rechazada (L309–353, L347) |
| `server/commercial/firestoreReviewedTranslation.ts` | 38 KB | Revisión y traducción | lectura transaccional del texto revisado |
| `server/commercial/jobs.ts` | 35 KB | Trabajos | estados, reintentos, `unknown` |
| `server/commercial/billingDrainLease.ts` | 17 KB | Arriendo del ejecutor (1.6a, hecha) | `holderId`, token creciente, renovación/liberación |
| `server/commercial/billingSweepSection.ts` | — | Barrido apto para nube (3.4, hecha) | latido, presupuesto de tiempo, 2 colecciones |
| `server/commercial/billingPendingAlerts.ts`, `billingPendingAudit.ts` | ~13 y ~6 KB | Alertas y auditoría | colecciones permitidas |
| `server/commercial/firestoreVideoSettlementC2a.emulator.mjs` | 41 KB | **Prueba** de C2a | no es fuente; leer solo si se discute la evidencia |

**Instrucción para T3:** trabajar por **anclas**, con extractos de ≤60 líneas por ancla; pedir el archivo completo solo si el ancla no basta, y decirlo.

---

## C. Plan por hitos (horas de reloj, costo T3, criterio de aceptación)

**Base de cálculo y su incertidumbre.** Base medida el 21 nov: **≈US$0,5 por hora de hilo activo** (US$0,53 en 31 minutos con dos hilos) y ~US$15 por día en los días de mayor actividad (hasta 5 hilos). Costo = horas de hilo × ≈US$0,5; las **horas de reloj** de abajo se convierten a horas de hilo multiplicándolas por 1,5 a 2 (hilos medios activos). Sin medición por paso, los costos son **estimación con ±50 %**; sirven para decidir, no para facturar. **Se mide el gasto real de cada paso (diferencia de `usage` antes y después) y se registra en la bitácora** para corregir estas cifras. La cifra de costo es **solo de T3/OpenRouter**; el proveedor de voz va aparte (tope US$5).

| Hito | Contenido | Duración (reloj) | Costo T3 (rango) | Criterio de aceptación |
|---|---|---|---|---|
| **H1** Cerrar Fase 1 (dinero local) | 1.2, 1.3a, 1.3b, 1.4, 1.5 (mínimo), 1.6b, 1.7 | 28–42 h | US$25–42 | Invariantes I1–I6 con prueba; ningún camino cobra de más ni retiene saldo sin fin; ejecutor con dos instancias simultáneas → una sola pasada; **regresión financiera completa verde**; T3 + Gemini del backend de saldo |
| **H2** Voz local completa | 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.9 (+2.8 escucha) | 22–34 h | US$20–34 | Voz en inglés y español neutro: una llamada en vuelo, sin reintento automático, sin cobro si fallamos, ACK perdido recuperado; **5 pruebas pausadas reabiertas y verdes**; retención 90 días con informe; interruptor por cuenta apagado por defecto; actas de escucha por idioma |
| **H3** Nube preparada | 3.2, 3.3, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10 (interruptor) | 16–26 h | US$14–26 | Índice `READY` con la consulta exacta; correo real de alerta (también en spam); límites y cupos probados; runbooks ensayados en seco; simulacro de restauración medido; interruptor del proveedor externo funcionando |
| **H4** Producto local completo | 4.1, 4.2, 4.3, 4.3b, 4.4, 4.6 (4.5 parcial) | 24–36 h | US$22–36 | Gateway rechaza token caducado/ajeno y ruta no permitida; proveedor real medido con contenido sintético dentro del tope; flujo completo en la cuenta; **integración de punta a punta con 0 fallidas** |
| **H5** Puertas y acta | Fase 5: G0–G10 con evidencia | 6–10 h | US$5–10 | Cada puerta con su evidencia enlazada; **acta aprobada por escrito** por el dueño |
| **H6** Primer despliegue restringido | Fase 6, solo cuentas de verificación | 10–16 h | US$8–16 | Cuenta con saldo completa texto y voz; cuenta sin saldo **no** crea trabajo ni llama al proveedor; aislamiento y revocación; reversión y apagado en seco; gasto del proveedor dentro del tope |
| **Total** | — | **106–164 h** | **US$94–164** (≈US$80–150 con las medidas de ahorro; ±50 %) | — |

---

## D. Comparación honesta: plan actual vs plan eficiente

| Dimensión | Plan actual | Plan eficiente | Comentario |
|---|---|---|---|
| Tiempo hasta el despliegue restringido | ~180–300 h | **~100–150 h** | Menos rondas y menos relecturas; el paralelismo baja de 5 a 2 hilos, lo que **suma** horas de reloj pero resta gasto |
| Costo T3 | ~US$170–320 | **~US$90–160** con las decisiones §E.2 y §E.3; **~US$120–220** sin ellas | Ahorro 35–50 % o 25–35 %; la mayor parte viene de L1, L3 y L4 (menos rondas y menos lecturas) |
| Revisiones independientes | 2 modelos en todo | 2 en dinero/diseño, **1** en lo mecánico | Es el cambio de mayor ahorro y el que exige tocar la regla 4 |
| Regresión | Completa en cada paso de dinero | **Igual** (completa al cerrar cada paso de dinero; focalizada entre rondas) | Rechazado el cambio de la regla 3: es gratis en dinero y detecta antes |
| Riesgo de calidad | Bajo (pero caro) | **Bajo en dinero, medio en lo mecánico** | El riesgo vive donde no hay saldo; por eso la revisión doble se queda en el dinero |
| Riesgo de dinero | Bajo | **Igual de bajo** | Ninguna palanca toca los pasos que mueven saldo |

---

## E. Decisiones que SÍ son del dueño (no las asumo)

1. **Abrir solo texto primero y la voz después** — cambiaría su decisión G0 («no se despliega nada hasta que la voz esté lista»). *Ahorro:* saca del camino crítico las ~30–45 h de H2 y permite desplegar el texto restringido antes. *Riesgo:* la primera salida a la nube deja de ser conjunta; habría **dos** ventanas de despliegue y dos actas, y la voz se estrenaría más tarde con todo lo aprendido en la nube al día siguiente. **No es mi decisión: es del dueño.**
2. **Refinar la regla 4** (revisión por nivel de riesgo: 2 en dinero/diseño, 1 en lo mecánico). Es el cambio que habilita el mayor ahorro. Exige actualizar la especificación y el plan paso a paso **en el mismo cambio**.
3. ~~Leer la regla 3 como «regresión completa al cerrar cada fase».~~ **Retirada por Codex** (§B.1, L6): la regla 3 se mantiene tal cual.
4. **Recortar/diferir** 1.5, 3.9, 3.10 y 4.5 según §A.2 y §B.2 (1.3b **no** se difiere; 3.5 queda como operador mínimo).
5. **Recargar crédito de T3** (hoy ≈US$9, unas 9 horas de trabajo con dos hilos): sin decisión de gasto el trabajo se detiene otra vez. Propuesta: recarga de US$30 para el tramo H1.
6. **Alcance de la moderación de contenido** (paso 3.10, antes de G8) y **aprobación de los textos legales** (G8) y del acta (fase 5).
7. **Aceptar la base de cálculo y el tope** de este plan (≈US$90–160 de T3 hasta el despliegue restringido, ±50 %) como presupuesto de referencia.
8. **Diferir el operador mínimo (3.5)** hasta después del primer despliegue restringido: ahorraría ≈US$4–8 y ≈6–10 h, pero dejaría una cuenta bloqueada sin salida auditada (el desbloqueo del paso 1.4 depende de él). **No recomendado**; solo si el despliegue restringido tiene unas pocas cuentas de verificación y aceptas por escrito esa limitación.

---

## F. Los cinco mayores riesgos del plan eficiente

1. **Interfaz entre lo mecánico y el dinero.** Con un solo revisor en lo mecánico, un defecto puede cruzar al código de saldo. *Mitigación:* todo lo mecánico se revisa con el umbral «¿escribe saldo?»; si la respuesta es sí, vuelve a revisión doble.
2. **Menos rondas, más defectos en la primera entrega.** Una sola ronda de pruebas+implementación puede dejar escapar un fallo. *Mitigación:* el brief incluye el criterio de salida y **una** corrección ya presupuestada.
3. **Regresión tardía.** Detectar un defecto cruzado al cerrar fase cuesta más que al paso. *Mitigación:* regresión focalizada obligatoria por paso, y prohibido cerrar una fase con una focalizada en rojo.
4. **Releer de menos.** Un mapa de código mal anclado hace que T3 trabaje con contexto equivocado. *Mitigación:* Codex verifica cada ancla contra el archivo antes de enviarla y refresca el mapa cuando cambie.
5. **El costo pasa de OpenRouter a otro lado.** Bajar el gasto de T3 no reduce el costo del proveedor de voz ni de Google Cloud, y la tarifa de audio **se duplica el 1 ene 2027**. *Mitigación:* medición real en 4.3b dentro del tope de US$5 y conciliación manual con el informe de facturación.

---

## Qué falta para que esto se vuelva ejecutable

1. **Decisión de recarga de T3** (hoy ≈US$9, unas 9 horas).
2. Confirmar o rechazar las decisiones de §E, en especial la 1 (solo texto primero) y las 2 y 3 (cambios de criterio de aceptación).
3. Al aceptarse, actualizar el **mismo día** el plan paso a paso, la especificación de aceptación y el backlog, y registrar el cambio en la bitácora.

**Estado de este documento:** propuesta de planificación v2 del 21 nov 2026 (T3 + una revisión independiente + adjudicación de Codex). No es evidencia de que nada funcione, no cambia el criterio de aceptación vigente y no autoriza ningún gasto.
