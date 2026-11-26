# Mutaciones de Codex · Paso 1.4b, pieza 2 (desbloqueo auditado, lado Video)

**Arnés:** [mutate_video_unblock.py](mutate_video_unblock.py) (cada mutante se aplica a `billingUnblock.ts` o `firestoreBackend.ts`, corre las pruebas de emulador repartidas en tres procesos, se corta en la primera prueba que falla y restaura el archivo con verificación byte a byte; el hash final se compara con la copia de respaldo). Registros: [ronda 1](resultado-pieza-2-ronda-1.log) · [ronda 2](resultado-pieza-2-ronda-2.log) · [ronda 3](resultado-pieza-2-ronda-3.log) · [ronda 4](resultado-pieza-2-ronda-4.log) · [ronda 5](resultado-pieza-2-ronda-5.log) · [ronda 6](resultado-pieza-2-ronda-6.log).

**Resultado final: 116 mutantes distintos, 100 detectados, 16 equivalentes, 0 sobrevivientes sin explicar.**

| Ronda | Qué se hizo | Resultado |
|---|---|---|
| 1 | 101 mutantes sobre fases 0 a 3, repeticiones, selección de filas, validación y escritores de la guarda | 50 detectados, 48 sobrevivieron, 2 con ancla vieja (omitidos) y 1 sin terminar (el proceso murió con la sesión) |
| 2 | Se escribieron pruebas para los 37 huecos reales y se corrigieron 2 anclas (39 mutantes) | **39 de 39 detectados** |
| 3 | El mutante que había quedado sin terminar (comprobación de generación del escritor), contra las cuatro suites | Sobrevivió: equivalente |
| 4 | 10 mutantes sobre las líneas nuevas de la corrección 3 (ids de auditoría por ocurrencia y guarda de admisión) | 7 detectados, 3 equivalentes |
| 5 | 4 mutantes sobre la función `pendingHoldRow` de la corrección 4 (marca de generación del hold) | 3 detectados, 1 equivalente |
| 6 | 1 mutante: lecturas de filas de la cuenta fuera de la transacción (tras la prueba estructural de la revisión final 3) | **detectado** |

## Equivalentes (16) y por qué no se pueden detectar

| Mutante | Razón |
|---|---|
| `p0-epoch-dropped`, `p0-createdAt-dropped` | La fase 0 ya compara el estado de la alerta, que lleva `epoch` y `createdAtMs`; una petición con otro valor falla antes por `alert_state`. La fase 3 sí se prueba sola y sus mutantes fueron detectados. |
| `p0-incident-null-ignored` | El estado de la alerta incluye la clave del incidente: un incidente que la guarda no nombra no puede pasar la comprobación anterior. |
| `released-flag-dropped` | El registro `video_released` no tiene campo `videoBlocked`; con o sin la bandera el recibo es el mismo. |
| `partial-alert-state-dropped`, `p3-alert-state-dropped` | El estado de la alerta queda atado a su clave (`alertIdentity` valida clave y contenido) y la clave va en la petición: no puede cambiar entre fases. |
| `legacy-hold-epoch-dropped`, `hold-owned-legacy-dropped` | Ramas de holds sin generación: inalcanzables hasta que exista una migración (las bases reales están vacías; una guarda legada atribuible sin `createdAtMs` es `invariant` por diseño). |
| `F-preview-blocked-type-dropped` | La atribución exige una guarda válida; con `blocked` no booleano el cálculo previo da una generación que nunca se escribe ni nombra un hold que se cree. |
| `F-hold-generation-partial-allowed` | Una fila con generación parcial se trata como legada y su id no coincide con el esperado: el resultado es el mismo `needs_review` por `invalid_event`. |
| `F-oldHold-exists-check-dropped-direct` | Código redundante: cuando el hold ya existe, la creación se omite igual. |
| `F-preview-written-mismatch-dropped` | Comprobación defensiva entre dos funciones que calculan lo mismo desde la misma lectura y el mismo reloj: nunca puede diferir sin cambiar el código. |
| `adm-state-not-checked` | Una guarda de admisión limpia no tiene `incidentId`, y esa comprobación ya la descarta. |
| `adm-also-for-outbox` | Para un incidente de salida no existe un documento de admisión con esa clave: la lectura no encuentra nada. |
| `adm-owned-dropped` | `owned` solo filtra filas de `accountRows`, y la guarda de admisión no lleva `accountId`: no aparece ahí. |
| `F-holdrow-legacy-not-stamped` | La rama de una fila de hold sin generación es inalcanzable: los cuatro escritores siempre pasan una generación. |

## Huecos de pruebas que las mutaciones destaparon y cerré (solo pruebas, sin tocar producción)

Filas rivales por cada colección y filas de otra cuenta; reanudación con otro operador, otra evidencia, otra nota o una guarda que cambió (época, marca, incidente, cuenta); repetición parcial con Cuenta todavía bloqueada o con una fila rival de Video; relectura de la fase 3 (alerta ya no abierta, fila con otro estado, fila que apunta a otro incidente, fila en un estado que solo un hold puede tener); alerta de otro tipo o de otra cuenta; identidad ambigua; hold que ya necesitaba revisión al auditarse; hold con generación corrupta; salida de la intención (`release_pending` o `reserve_pending`); incidente de tipo intención completo; validación de los argumentos; y los campos exactos que el desbloqueo escribe (punteros de revisión, reintento, marcas de auditoría, operador de la alerta).

## Defectos de producción que encontraron las pruebas y los revisores (corregidos por T3 con pruebas rojas previas)

1. Repetir tras un desbloqueo parcial se rompía (`planned is not iterable`).
2. Una guarda de otra cuenta perdía la evidencia (`invariant` antes de saber si había dueño verificado).
3. Un hold con generación parcial detenía el listado de todos los demás.
4. Repetir la petición vieja tras `video_released` aparentaba éxito sobre un bloqueo nuevo.
5. Un hold que cambiaba de estado entre la lectura auditada y la liberación atascaba el desbloqueo para siempre.
6. Los registros de auditoría de una intención no eran por ocurrencia: la segunda divergencia quedaba en `conflict` permanente.
7. El desbloqueo de un incidente de intención no reabría la admisión de esa intención.
8. La fila de un hold de un SEGUNDO incidente sobre una guarda viva se creaba con `createdAtMs:now`, que pisaba la marca de la guarda que el id del hold nombra: el drenador recomponía otro id y mandaba la fila a `needs_review`, así que la Cuenta nunca recibía ese incidente (hallazgo ALTA de DeepSeek en la segunda revisión final; lo confirmaron dos pruebas rojas). Ahora una sola función, `pendingHoldRow`, conserva `epoch` y `createdAtMs` de la guarda.
9. Endurecimiento: las lecturas de filas de la cuenta son ahora transaccionales; el emulador no puede inyectar una escritura entre la lectura y el commit, así que el contrato se fija de forma estructural (una prueba cuenta las 12 lecturas por consulta dentro de las transacciones) y un mutante que las saca de la transacción es detectado.
