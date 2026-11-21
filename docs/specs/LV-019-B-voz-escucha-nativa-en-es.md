# LV-019.B · Voz en inglés y español neutro latinoamericano · Protocolo y rúbrica de escucha nativa

**Estado (20 nov 2026): PROTOCOLO v2 tras la revisión T3 (ambos FALLA, hallazgos incorporados; [recibo](../evidence/lv019-b-t3-escucha-20261120/RECIBO.md)).** Se congela antes de escuchar; cualquier cambio posterior se registra en el acta. Pasos 2.1 y 2.8 del [plan paso a paso](LV-019-B-plan-paso-a-paso-20261120.md). Define cómo se decide si la voz sintética de un idioma es aceptable antes de abrirla. **Cada idioma se aprueba por separado** (la aprobación del inglés no aprueba el español). No se ha generado ni escuchado ninguna muestra de este protocolo.

## 1. Alcance

- **Idiomas destino:** inglés (EE. UU.) y **español neutro latinoamericano** (decisión del dueño del 20 nov): sin voseo, sin regionalismos ni vocabulario propio de un país, comprensible para México, Centroamérica, el Caribe, los Andes y EE. UU.
- **Qué se evalúa:** el audio generado desde una traducción **ya revisada**, con el modelo y las voces que se piensan abrir (`gemini-3.8-flash-tts`; Kore y Charon como candidatas, a confirmar en la escucha). Se prueban al menos **dos voces por idioma** (una femenina y una masculina).
- **Qué no se evalúa:** sincronía con el video, mezcla con la pista original ni otros idiomas.

## 2. Muestras

Doce guiones **sintéticos propios por idioma** (nunca contenido de clientes), de 20 a 40 s, que cubran: vocabulario del oficio (techos, tejas, presupuesto, garantía), números y cifras con decimales, moneda y porcentajes, fechas y horas, direcciones, siglas y marcas, nombres propios en el otro idioma (inglés dentro del español y al revés), preguntas y exclamaciones, listas, frases largas con subordinadas, puntuación y pausas, y un texto con tildes, ñ, ¿ y ¡ (español). **Además:** dos guiones largos de 60 a 90 s y uno de unos 3 minutos con listas, párrafos y cambios de tema, para detectar problemas de fragmentación (el producto parte los textos largos), y **un guion con un error conocido** (una cifra distinta de la del texto) como control negativo para comprobar que quien escucha lo detecta. **Cada guion se genera dos veces por voz** para medir estabilidad (misma voz, ritmo, cifras y sin cortes) y la tasa de fallos. Se generan en la prueba controlada con el proveedor real del paso 4.3b, dentro del tope de US$5, y se guardan **fuera del repositorio**; en el repositorio quedan los guiones y los hashes de los audios.

## 3. Rúbrica (1 a 5; 5 = excelente)

1. **Comprensibilidad:** se entiende todo a la primera.
2. **Pronunciación:** palabras, nombres y términos técnicos bien dichos.
3. **Naturalidad y entonación:** no suena robótica; las preguntas suben y las frases terminan bien.
4. **Ritmo y pausas:** velocidad estable, pausas donde manda la puntuación.
5. **Fidelidad al texto:** no omite, no añade, no repite.
6. **Números, fechas y unidades:** leídos correctamente.
7. **Variante:** inglés estadounidense neutro / español neutro latinoamericano (marcar cualquier voseo, ceceo, giro o léxico regional).
8. **Calidad técnica del audio:** sin cortes, clics, ruido, saltos de volumen ni cambio de voz a mitad.

**Falla crítica** (no admite promedio; lista cerrada): omitir o inventar contenido, leer mal un número, fecha o cifra, cambio de voz o de idioma a mitad, audio cortado, y diferencia de contenido entre las dos generaciones del mismo guion. Quien la anota apunta el instante y la causa probable.

**Prueba mecánica de fidelidad (no sustituye al oído):** cada audio se transcribe automáticamente y se compara con el guion; se exige que **todas las cifras, fechas y monedas coincidan** y una diferencia de palabras de como máximo el 3 %. Los desvíos se escuchan a mano.

## 4. Criterio de aprobación (por idioma y por voz)

Una voz queda **aprobada** si: media ≥ 4,0 en cada criterio; ninguna muestra por debajo de 3 en comprensibilidad, pronunciación o fidelidad; y como máximo 1 de 12 muestras con falla crítica que se explique y corrija (no repetible en la repetición). Si falla, se ajusta (otra voz, estilo, normalización del texto: cifras y monedas escritas en palabras, siglas deletreadas) y se vuelve a escuchar solo lo corregido más una muestra nueva; **máximo tres iteraciones** y dentro del tope de gasto; si cambia la normalización o el estilo se reevalúan **todos** los guiones afectados, no solo el corregido. **Si el presupuesto se agota sin voz aprobada, el resultado es «no aprobado»**, nunca una aprobación por omisión. Un idioma se abre cuando **al menos una voz** está aprobada; ofrecer una voz femenina y una masculina es deseable, no obligatorio.

## 5. Quién escucha y cómo

El dueño escucha ambos idiomas; si no es hablante nativo de alguno, ese idioma necesita otra persona nativa (decisión del dueño). **Escucha ciega:** las voces se presentan como A/B sin etiquetas y en orden aleatorio, en teléfono y en auriculares. Cada persona puntúa por separado antes de comparar. Quien conoce el guion «corrige» mentalmente lo que oye, así que la escucha del dueño no es ciega en fidelidad: la compensan la prueba mecánica de fidelidad y, cuando exista, un **oyente adicional que transcribe sin ver el guion** (aprueba si hay como máximo una palabra distinta por muestra y ninguna cifra errónea). Una sola persona es un límite declarado: sirve para abrir la verificación, no equivale a una validación comercial a gran escala. Se escucha también con el altavoz del teléfono y con el formato final que recibirá el cliente (WAV de 24 kHz). Con **una sola voz aprobada** se declara el límite y se anota el plan de sustitución.

## 6. Evidencia

Un acta en `docs/reviews/` por idioma con: fecha, modelo y versión, voces, guiones y hashes de audio, tabla de puntuaciones por persona y criterio, fallas críticas, iteraciones, decisión (aprobada, aprobada con límites, rechazada) y firmante. Sin audio ni contenido de clientes en el repositorio; **los audios aprobados se conservan en almacenamiento privado fuera del repositorio** (el contenido es sintético) con la transcripción exacta, el modelo, la versión, la fecha y los parámetros, para poder reauditar. Los criterios y umbrales se fijan antes de escuchar y los desacuerdos entre oyentes se registran.

## 7. Límites

La escucha es subjetiva y depende del dispositivo; doce muestras más los guiones largos son un filtro mínimo, no una garantía, y los umbrales de 4,0 y 3 son un criterio de partida que se puede ajustar con la primera escucha (registrando el cambio); el proveedor puede cambiar el modelo (la tarifa de audio se duplica el 1 de enero de 2027 y el comportamiento puede variar), por lo que una aprobación vale para el modelo y la fecha del acta y se repite si cambian; no se prueba sincronía.
