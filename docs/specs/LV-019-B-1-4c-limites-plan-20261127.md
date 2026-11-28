# LV-019.B · Tarea 1.4c · Límites de diseño del desbloqueo: plan por límite (27 nov 2026)

**Estado: PLAN CON DECISIONES DE ROB (27 nov, noche), sin implementar.** Catálogo de los ocho límites abiertos del desbloqueo auditado, con lo que hace hoy el código, lo que falta y la decisión que necesita. El estado de la tarea vive en el [backlog](../../backlog.md#lv-019b--ruta-principal); este documento solo ordena el trabajo. Los límites provienen del análisis de las revisiones finales de GLM y DeepSeek sobre la línea integrada (27 nov) y del recorrido de Codex; **ninguno se reprodujo aún con una prueba nueva**, y cada fila lo indica cuando corresponde. Todos fallan cerrado: ninguno mueve saldo ni libera un bloqueo por error; el costo es que el operador no tiene una salida automática.

| # | Límite | Hoy (comportamiento verificable en el código) | Qué hace falta | Depende de | Decisión de Rob |
| --- | --- | --- | --- | --- | --- |
| 1 | Varios incidentes del mismo tipo sobre una guarda | El desbloqueo resuelve el incidente que la guarda nombra; las demás filas de la cuenta cuentan como rivales y el desbloqueo termina en `unresolved` (`freshRecord`, `unresolvedRows`) | Definir el orden de resolución (uno a uno o todos juntos) y una prueba con dos incidentes del mismo tipo | Diseño 3.3 | Sí: ¿uno a uno o en bloque? |
| 2 | Un incidente que vuelve a divergir con la guarda viva | La guarda conserva la generación; un incidente nuevo sobre una fila ya avanzada queda como rival | Prueba que lo reproduzca y regla de re-bloqueo | 1 | No, salvo que cambie la política de re-bloqueo |
| 3 | Guarda mixta (intento y salida) cuya alerta nombra el incidente más antiguo | `sameGuard` exige que la guarda nombre el incidente por un solo campo (O exclusiva); con los dos campos se rechaza | Decidir cuál incidente nombra la alerta y cómo se desbloquea el otro | 1 | Sí |
| 4 | Filas rivales sin ruta de resolución | `unresolved` sin acción automática posterior | Ruta de resolución por fila (revisar o descartar con auditoría) | 6 | Sí: quién resuelve y con qué evidencia |
| 5 | Holds heredados inalcanzables hasta una migración | El código distingue el identificador de hold del contrato anterior (`legacyHoldId`) del nuevo (`accountHoldId`); un hold creado con el anterior no se alcanza con la ruta nueva (sin reproducir con una prueba) | Inventario de holds existentes y migración (hoy las bases reales están vacías) | Paso 1.5 y migración | No mientras las bases estén vacías |
| 6 | Sin ruta ni autenticación de operador | El desbloqueo es una función interna; la autoría se recibe como texto | Ruta HTTP privada, identidad del operador (solo el dueño) y auditoría | Paso 3.5 | Sí: confirmar «solo el dueño» y el medio de autenticación |
| 7 | La fase 2 convierte todo error de Cuenta en `conflict` | `accountPhase` captura todo y lanza `UnblockFault('conflict')` conservando la causa | Distinguir error transitorio de conflicto real para que el operador sepa si reintentar | 6 | No: es un diseño de errores |
| 8 | Una entrega tardía de un hold ya revisado recibe `invariant` de Cuenta | Sin riesgo de saldo: el desbloqueo ya avanzó la fila a `applied` | Documentar como límite aceptado o absorber el error en el drenaje | Ninguna | No |

## Orden propuesto

1. **Primero 6 y 7** (operador y errores): desbloquean 4 y dan al dueño una salida real; son parte del paso 3.5.
2. **Luego 1, 3 y 2**: un solo diseño de «varios incidentes por guarda» con pruebas de dos incidentes, guarda mixta y divergencia nueva; código que mueve saldo, así que dos revisores y la regresión completa.
3. **5 y 8** quedan como límites aceptados mientras las bases reales estén vacías.

Cada paso sigue el criterio de «production ready» del [plan paso a paso](LV-019-B-plan-paso-a-paso-20261120.md): pruebas primero, mutaciones, regresión completa y revisión de GLM y DeepSeek.

## Decisiones de Rob (27 nov 2026, noche)

1. **Varios incidentes del mismo tipo sobre una guarda (límites 1, 2 y 3): se resuelven uno a uno.** Cada incidente se revisa por separado, con su propia auditoría; el desbloqueo de uno no resuelve a los demás. Implica un diseño en que los otros incidentes de la cuenta no impidan desbloquear el que la guarda nombra, y una guarda que sobrevive hasta que se revisen todos (como ya hace Cuenta con su contador de incidentes revisados).
2. **Operador (límites 4 y 6): solo Rob, con su inicio de sesión.** Ruta privada que acepta únicamente la identidad del dueño y deja auditoría; sin segunda persona. La identidad concreta del dueño se configura fuera del repositorio.
3. **Auditoría completa de arquitectura de Gemini (cierre 1.7): aprobada con tope bajo.** Costo estimado de unos 10 a 30 centavos.

Siguiente trabajo de código: la ruta y la autenticación del operador junto con el manejo de errores (límites 6 y 7), y después el diseño «uno a uno» de varios incidentes por guarda. Ambos mueven saldo o su operación: pruebas primero, mutaciones, regresión completa y dos revisores.
