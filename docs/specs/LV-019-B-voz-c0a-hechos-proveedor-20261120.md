# LV-019.B · Voz · C0a · Hechos del proveedor, coste, idiomas, guardado y términos (20 nov 2026)

**Estado: hechos recogidos el 20 nov 2026; la voz sigue cerrada a clientes.** Esta nota responde las decisiones de voz del [plan integral](LV-019-B-plan-integral-20261120.md) y alimenta C2 (admisión y llamada) y C6 (retención y cumplimiento). No cambia código, nube ni saldo.

**Cómo se obtuvieron las cifras.** Las páginas oficiales de Google se leyeron el 20 nov mediante lectores web delegados (no con una descarga propia de Codex) y cada cifra clave se contrastó con otra fuente: la propia página da el precio por 10 s de audio y coincide con 25 tokens/s × tarifa; las dos llamadas reales del 14 nov midieron exactamente 25,0 tokens/s (480 tokens en 19,2 s y 441 en 17,64 s; `outputs/vistavo-ai-cloud/provider-measurements.json`). **No se vio ninguna factura:** el coste es «tokens observados × tarifa publicada», no un cargo medido. La página de precios de Cloud Storage no se pudo leer desde aquí (devuelve solo el título); para el almacenamiento se usa la cifra del propio proyecto (13 nov) y se marca como no reconfirmada.

## 1. Modelo y coste de generar la voz

El proyecto fija `gemini-3.8-flash-tts` (voces Kore y Charon). Tarifas del nivel de pago, USD por millón de tokens, según la [página de precios](https://aistudio.google.com/docs/pricing) (no muestra fecha de publicación; sí fechas de entrada en vigor):

| Modelo | Texto de entrada | Audio de salida hasta el 31 dic 2026 | Audio de salida desde el 1 ene 2027 |
|---|---|---|---|
| `gemini-3.8-flash-tts` (el del proyecto) | 0,50 → 1,00 | **9,00** | **18,00** |
| `gemini-3.8-flash-lite-tts` | 0,50 → 1,00 | 6,00 | 12,00 |

Con 25 tokens por segundo, **un minuto de voz son 1.500 tokens de audio**:

| Por minuto de voz | Hasta 31 dic 2026 | Desde 1 ene 2027 |
|---|---|---|
| Flash TTS (el del proyecto) | **US$0,0135** | **US$0,0270** |
| Flash-Lite TTS | US$0,0090 | US$0,0180 |

El texto de entrada añade del orden de una centésima de centavo por minuto (estimación de unos 200 tokens por minuto de habla; no medida). Frente al precio acordado de **US$0,10/min**, el proveedor de voz se llevaría ≈13,5 % hasta fin de año y ≈27 % desde enero (Flash), **antes** de la traducción de texto, el almacenamiento, el cómputo y las comisiones de cobro, que no están en estas cifras (tampoco impuestos). **La tarifa de audio se duplica el 1 de enero de 2027**: el precio de US$0.10/min está decidido, pero el margen baja; conviene re-medir y revisarlo con datos entonces. Existe además una tarifa por lotes a la mitad (asíncrona) que no se adopta ahora. Cambiar a Flash-Lite exigiría cambiar la lista de modelos válidos del código y de Cuenta (hoy solo admiten `gemini-3.8-flash-tts`) y volver a validar calidad.

## 2. Idiomas: ¿sirven los mismos pares que el texto?

La voz solo depende del **idioma destino** (se genera desde la traducción revisada). Los diez idiomas de la primera versión ([LV-001](LV-001-propuesta-comercial.md)) aparecen por nombre en la [documentación de generación de voz](https://aistudio.google.com/docs/speech-generation) para ambos modelos (la documentación indica que detectan el idioma del texto automáticamente):

| Idioma destino | En el proveedor | Falta decidir o escuchar |
|---|---|---|
| Inglés | Sí | Kore/Charon ya se ensayaron (LV-016-C); falta revisión nativa |
| Español | «Spanish», sin variante | Qué español (México, EE. UU., neutro) |
| Portugués de Brasil | «Portuguese», sin variante | Escuchar pt-BR frente a pt-PT |
| Francés, alemán, japonés, coreano | Sí | Revisión nativa |
| Árabe | «Standard Arabic» y «Egyptian Arabic» | Qué variedad; el dialecto saudí no se nombra |
| Mandarín | «Chinese (Hans script)»; no dice «Mandarin» | Confirmar que habla mandarín; el cantonés figura aparte |
| Vietnamita | Sí | Revisión nativa |

**Decisión pendiente del dueño: idioma destino con el que se abre la voz primero.** Opciones: (A) **inglés** (recomendado: es el primer recorrido técnico ES→EN y Kore/Charon ya se ensayaron en inglés; falta la escucha humana), (B) inglés y español a la vez (exige elegir variante del español), (C) otro. Cada idioma adicional necesita su variante, sus voces y una persona nativa que lo apruebe (LV-004); se abren de uno en uno.

**Conclusión:** en teoría **sí**, los 90 pares tienen un idioma destino con voz del proveedor. «Figura en la lista» no es calidad: la página no da calidad por idioma. Cada idioma destino necesita escucha y aprobación según LV-004, y la voz de un par solo se habilita cuando su texto ya está aceptado. Los modelos publican 30 voces predefinidas con nombre (Kore y Charon entre ellas); la documentación no dice qué voces rinden mejor en qué idioma.

## 3. Formato, tamaño y límites

Salida: WAV de 24 kHz, mono, 16 bits (48.000 bytes/s ≈ **2,88 MB por minuto**; 28,8 MB por 10 minutos). La documentación no indica el máximo de texto ni de audio por solicitud, así que el diseño sigue troceando el texto en fragmentos (ya existente).

## 4. Guardado del audio: opciones y coste

El coste de guardar es casi nulo; lo que decide es privacidad y comodidad. Tarifa de referencia: Cloud Storage Standard regional ≈ US$0,020 por GiB-mes (estimación del proyecto del 13 nov, coherente con una copia archivada de 2022; **no reconfirmada en la página actual**). Almacenar 10 minutos de voz (28,8 MB):

| Opción | Cuánto tiempo | Coste de guardar 10 min | Ventajas | Inconvenientes |
|---|---|---|---|---|
| 24 horas | 1 día | ≈ US$0,00002 | Mínima exposición | El cliente debe bajarlo ya; si pierde el archivo, hay que regenerar (y volver a cobrar o absorber el coste) |
| 7 días | una semana | ≈ US$0,00013 | Poca exposición, margen razonable | Se pierde al cabo de una semana |
| **30 días** | un mes | ≈ US$0,00054 | Cómodo, cubre revisiones y reenvíos | Más datos privados guardados |
| 90 días | tres meses | ≈ US$0,0016 | Seguimiento de proyectos largos | Más exposición sin ventaja clara |
| Hasta que el cliente lo borre (o 12 meses) | un año | ≈ US$0,0065 | Máxima comodidad | La mayor exposición y obligación de borrado |

Cada descarga cuesta salida de red (tarifa no verificada aquí; con una referencia de ≈US$0,12/GB serían ≈US$0,003 por descargar 10 min). Incluso 100.000 minutos guardados cuestan del orden de US$5 al mes. **Decisión del dueño (20 nov): 90 días.** Recomendación técnica previa, no adoptada: 30 días por defecto, con borrado inmediato a petición del cliente y borrado automático al eliminar el proyecto; 7 días si se prefiere menos exposición. El plazo se aplicaría con la purga por lotes con marcadores que ya usa el pipeline de IA (`DEPLOYMENT.md`, LV-007.AI), no con una regla de ciclo de vida que permitiría resucitar escrituras tardías. Sea cual sea, hay que poder borrar a petición y no borrar la evidencia financiera.

## 5. Términos del proveedor (resumen; no es asesoría legal)

Según los [términos adicionales de la API de Gemini](https://aistudio.google.com/docs/terms) (vigentes desde el 23 mar 2026):

- **Servicios de pago:** Google dice que no usa los mensajes ni las respuestas para mejorar sus productos; los registra durante un periodo limitado solo para detectar usos prohibidos y obligaciones legales. **No indica cuánto dura ese periodo**, y los datos pueden almacenarse o procesarse en cualquier país donde Google opere.
- **Servicios sin pago:** usa el contenido para mejorar productos y personas pueden leerlo; pide no enviar información personal ni confidencial.
- «De pago» significa que las llamadas pasan por un proyecto de Cloud con facturación activa. **Confirmado por el dueño el 20 nov:** la clave de producción (`vistavo-gemini-provider`) pertenece a un proyecto con facturación; Codex no puede verificarlo porque no debe leer el secreto.
- **Borrado:** los términos no ofrecen un mecanismo para pedir el borrado de esos registros. **No se puede prometer al cliente que el proveedor borre lo enviado;** sí que Vistavo borra sus propias copias.
- Quedan por leer los documentos que gobiernan el tratamiento de datos de pago (adenda de tratamiento de datos) antes de activar la voz.

## 6. Medición real del coste (autorizada por el dueño el 20 nov)

No se hicieron llamadas nuevas: **no hay clave de Gemini disponible en esta PC** (no existe `%LOCALAPPDATA%\LinguistVision\.env`) y la clave de producción vive solo en Secret Manager para el worker, que no se toca (no hay despliegue). Como medida real se usan las dos llamadas de voz del 14 nov (25,0 tokens/s) y la tarifa publicada. La autorización de gasto queda vigente (tope de US$5 para la prueba online con saldo real) para medir cuando exista una vía legítima (clave local colocada por el dueño en el archivo privado, o la prueba en línea) y el efecto en factura solo se confirma mirando el informe de facturación de Google Cloud.
