# Desbloqueo de Video y recuperación de la confirmación de Cuenta

LV-019.B, paso 1.4b, pieza 2. Base de trabajo `81a41e5`, rama `codex/vistavo-checkpoint-20261125`. Las pruebas usan cuentas ficticias en Firestore Emulator. La segunda sesión conserva su propio árbol de trabajo.

## Pruebas del cambio

- La prueba `retry-generation B` reprodujo el fallo sobre la base. Cuenta registró el desbloqueo con la segunda generación y Video perdió la respuesta. Con otro incidente de Cuenta abierto, el reintento con los datos originales falló en la fase de Cuenta. El TAP de esa ejecución tiene SHA-256 `d7c93209a17f2ccd141e3035db9bde6261ffd9e1fa37a8c6bc9742017dfc4eca`.
- Con la corrección, el mismo caso recuperó la segunda generación del recibo en una lectura y registró una sola conclusión para Video. Las mutaciones con las otras generaciones y la lectura de otra evidencia fueron rechazadas. Con la ruta de lectura inaccesible no hubo mutación. Los documentos de Cuenta conservaron sus versiones durante la recuperación.
- **47/47** en el archivo de desbloqueo, con **50/50** contextos limpiados. SHA-256 del TAP `f63de3cdebe02650cf4f8de4b470cb1063e9c55ffc1ee499b661a6d9862bbe6f`. Los casos con un desbloqueo parcial preparan incidentes confirmados por AccountStore y comprueban el bloqueo de Video hasta que Cuenta y Video queden libres de incidentes pendientes.
- **33/33** en las dos suites de transporte HTTP y cliente de Cuenta. Comprueban el principal de liquidación, los campos del recibo y las respuestas que se rechazan.
- `tsc --noEmit` y ambas compilaciones de backend completados con Node 24.13.0. La compilación de Cuenta exigió incluir `settlementContract.ts`, una dependencia interna preexistente, en la lista exacta de fuentes. El manifiesto compilado contiene cinco archivos de `server/account`.

## Alcance y evidencia

El incidente posterior de Cuenta se construye mediante su API real de prueba sin añadir otro incidente de Video. Un caso separado verifica que un bloqueo nuevo de Video evita que el anterior elimine el guard. El estado de Cuenta en el recibo describe lo observado durante su lectura, y Cuenta vuelve a aplicar sus condiciones al reservar y liquidar.

Se usó el emulador aislado en `127.0.0.1:8186`, con la condición del modo de prueba ajustada en la copia del arnés. El guard de red de la copia afirma que `8185` está denegado. La suite no usa credenciales, datos de clientes ni servicios de producción.

Los TAP originales quedan en la copia local `vistavo-guard-8186`. El caso que reproduce el fallo está en `outputs/lv019-b-financial-runs/run-92eca631-b246-42c9-9a17-0393ec68f2ca`. El conjunto de 47 pruebas está en `outputs/lv019-b-financial-runs/run-b6b719ac-22b8-4bd0-a2dc-92171362625f`.

## Regresión financiera y controles negativos

La batería completa terminó con **458 aprobadas, 0 fallos, 0 canceladas y 5 omisiones previstas de voz**, de 463 casos. Comprobó 62 entradas congeladas, 15 instancias del guard de red, conteos consistentes y limpieza de las raíces verificadas. El manifiesto conservó su SHA-256 antes y después.

- Manifiesto SHA-256 `779019a5f4eab4cced45e818b4535c53cbd1fcae145f706feabcd78cd3c554f4`.
- TAP SHA-256 `58eeabc75519eb2f2fee2cbf551dbe5a42922d1a70a01ede523fb186b90e473f`.
- Resultado JSON SHA-256 `32eeb05644fa029d4f93aab648178b0d2d63a23f9d879299928eed6180b49608`.
- Evidencia local en `vistavo-guard-8186/outputs/lv019-b-financial-runs/run-924c78dc-8c84-408d-b9a6-b1e007d15002`.

Tres variantes deliberadamente incorrectas, ejecutadas después en la copia de prueba, provocaron el fallo del caso B: usar la generación original en el cierre, borrar el bloqueo pese a otro incidente y aceptar una referencia de evidencia diferente. Se restauraron los dos archivos en la copia y se verificó su SHA-256. Evidencia en `outputs/lv019-b-financial-runs/run-d6f3e3ef-a348-4e95-a5b4-8a5ff26d2a16`.

## Revisiones independientes

Revisiones estáticas sobre el diff `67a1214604cf7cd5ea911397d5a7525b6560bc075b32ea088b1ce5494dfbbe59`, por el respaldo autorizado de OpenRouter. Cada paquete se envió una vez, sin historial ni herramientas. Las respuestas completas, los comprobantes de uso y los encargos están en los directorios locales `outputs/openrouter-reviews` y `outputs/lv019-b-receipt-review-20261125`.

| Modelo servido | Dictamen | Generación | Entrada | Salida | USD |
| --- | --- | --- | ---: | ---: | ---: |
| `z-ai/glm-5.3-flash` | PASS estático | `gen-1795673193-vM1UVDiCFlTl9p3Wjc3m` | 6.240 | 18.230 | 0,00169081011 |
| `deepseek/deepseek-v4.1-flash` | FALLA inicial | `gen-1795673193-ioJpyeTaFOf0OPqkSftB` | 7.072 | 17.585 | 0,00919654560 |
| `deepseek/deepseek-v4.1-flash` | INCONCLUYENTE, primer seguimiento | `gen-1795673469-2v52FaiVxgi1awuJ6NrU` | 4.174 | 17.610 | 0,01231216470 |
| `deepseek/deepseek-v4.1-flash` | PASS, seguimiento con flujo completo | `gen-1795673626-ynuMavgFb1YQjGvJjqaF` | 11.077 | 24.227 | 0,01415861964 |
| **Total reportado** | | | **28.563** | **77.652** | **0,03735814005** |

El primer paquete omitía código sin cambios que resultó necesario para resolver dudas de ambos revisores. El primer seguimiento aclaró la condición de liberación. El segundo incluyó el recorrido del identificador y la fase inicial. Codex verificó los fragmentos y la prueba en emulador.

- **Bloqueo vigente.** Con otro incidente en Cuenta, `clear = !account.blocked && rivals.length === 0` impide que Video borre su bloqueo. El caso B lo comprueba con un recibo anterior y un incidente nuevo.
- **Marcadores de Video.** La fase inicial comprueba que exactamente uno de los campos nombra el incidente. La reanudación exige esa misma condición, además del dueño, la alerta y la generación.
- **Identificador y época.** Video preserva `holdId` de la solicitud auditada. Cuenta validó su propia generación al ejecutar la mutación y guardó esa generación en el recibo. La lectura valida el incidente, la evidencia y su fecha de revisión. El registro final de Video usa la generación confirmada del recibo.
- **Compilación de Cuenta.** El manifiesto confirma que `settlementContract.ts` se importa en el backend y pertenece al conjunto de fuentes exactas de Cuenta.

Los revisores examinaron el código y los controles negativos adjuntos. La ejecución de las pruebas, el estado online y la herramienta de operador quedan fuera de las revisiones estáticas.
