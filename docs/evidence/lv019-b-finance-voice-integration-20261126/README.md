# LV-019.B · Integración aislada de alertas financieras y voz C1

**26 nov 2026 · Candidata local sobre `1b122ce`.** Esta rama combina el sondeo neutral y el reloj de limpieza de `vistavo-poll-clock-clear-20261126` con C1 `3c081ad`. La segunda integración añadió la alerta de generación agotada y la corrección local de atribución de `fed814e`. Se conserva el diagnóstico anterior **1/2** de marca restaurada y ACK tardío junto con el focal corregido **2/2**. Falta probar esa clasificación en el corte combinado. La voz permanece apagada.

## Comparación de entradas

- **Backend compartido.** Se aplicó primero el diff financiero sobre `1b122ce` y después únicamente los hunks C1 seleccionados entre `1b122ce` y `3c081ad`. El backend resultante conserva las funciones financieras de prueba de origen, guarda, preparación, despacho, pausa de edad y doble sondeo. Los cambios de voz quedan en la prueba de reserva, el marcador local y su ancla, los recibos C1 y la ruta de revisión sintética.
- **Reporte y alertadores.** `billingPendingReport.ts`, `billingPendingAlerts.ts` y `billingPendingAudit.ts` provienen de la candidata financiera. Conservan `terminal_poll`, la alerta neutral, su verificación y el reloj de retirada. El inventario y alertador sin dueño de voz conservan su raíz marcada y su colección separada en `localVoiceConflictReview.ts`, con revalidación del incidente y rechazo de informes de otra raíz.
- **Clausura A2 y auxiliares.** `billingSweepSection.test.ts`, el set `FORBIDDEN`, el conjunto original de cuatro módulos y `firestoreAi.ts` se conservaron. También se conservaron los archivos base del guard, la preparación del doble sondeo que usa el drenador y el soporte de la fecha y las esperas. La configuración comprometida del ejecutor financiero mantiene los casos de su candidata e incluye ahora `localVoiceFixture.ts` entre los archivos cuyos hashes congela, porque el backend integrado lo importa.
- **Generación agotada.** Se aplicó el parche UTF-8 con SHA-256 `eda2f71fd876985d23bcac5410748fdbd7beed8ba1fa600dac5307d3a53b5e0c`. Se contrastaron las huellas LF de sus cuatro entradas y salidas. El cambio del inventario hace visible un sondeo sin generación representable. El ejecutor financiero ya rechazaba ese avance y sus métodos quedaron intactos. El focal aislado anterior pasó **6/6**.
- **Evidencia C1.** La fixture y el ejecutor de revisión coinciden con `fed814e`, con **74 casos C1 y 28 de base**. El alertador de voz solo se usa en la fixture. Se cotejó el método de atribución C1 con `fed814e` y nueve métodos financieros del backend con la candidata combinada anterior. El contraste conserva el guard, la pausa por edad y las funciones de prueba y despacho del doble sondeo. [Informe del focal C1](../../reviews/LV-019-B-voz-c1-atribucion-marcador-20261126.md)

Los parches de entrada, las comparaciones de métodos, el diff combinado y los SHA-256 de la segunda integración están en `outputs/lv019-b-finance-voice-integration-20261126/round2/`. El directorio superior conserva el primer corte. Estos registros locales quedan fuera de Git.

## Comprobación local

| Verificación | Resultado |
| --- | --- |
| A2, prueba original `billingSweepSection.test.ts` | **28/28**, con los cuatro módulos exactos y `FORBIDDEN` intacto |
| Unitarias financieras, voz, guardas y alertador sintético | **618/618**, 24 archivos en serie con `--maxWorkers=1` |
| TypeScript, sintaxis y `git diff --check` | PASS |
| Emulador combinado | Pendiente en este corte. El trabajo financiero de emulador corre en una copia aparte. |

La primera corrida paralela observó un timeout en la prueba de renovación de `billingDrainSection.test.ts` y 14 fallas posteriores en el mismo archivo. Se conserva como **603 aprobadas y 15 fallidas**. El archivo y la implementación del drenador quedaron intactos respecto de `1b122ce`. Repetir ese archivo solo dio **38/38**. Los recibos transcritos de ambas ejecuciones quedan en los registros locales.

Se usó `tsc --noEmit`, Vitest con hilos y `node --check` para los ejecutores, fixtures y puntos de entrada de este corte. No hubo emulador, proveedor ni cambios al checkpoint durante esta integración. El diario D2 y C2 quedan fuera de esta combinación.
