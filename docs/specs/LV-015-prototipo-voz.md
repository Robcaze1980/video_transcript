# LV-015 · Primer prototipo de voz AI

**Estado:** Verificada técnicamente; ambas muestras españolas aprobadas por escucha del propietario.  
**Responsable:** Codex integra/ejecuta; DeepSeek y Kimi revisan independientemente.  
**Depende de:** autorización del propietario, Gemini propio y FFmpeg local; independiente de Drive.  
**Revisión base:** c435068 con cambios locales anteriores preservados.

Fecha:12 de noviembre de2026. Estado: implementación del ensayo privado autorizada por el propietario. Base main c435068, repositorio Robcaze1980/video_transcript y cambios locales anteriores preservados. Complementa LV-007 costes/editor y no amplía la oferta comercial.

## Alcance y aceptación

Ampliación autorizada el12noviembre: el propietario aprueba por escucha la muestra femenina Kore y pide comparar ahora una masculina con el mismo texto. Charon es la voz masculina estándar según [catálogo oficial](https://docs.cloud.google.com/text-to-speech/docs/gemini-tts). Se conserva modelo/texto/estilo y pipeline; nueva carpeta de intento independiente, sin sobrescribir Kore. Objetivo de producto aprobado: al menos una voz femenina y una masculina por idioma; validar cada muestra/idioma antes de declarar cobertura. Esta actividad genera únicamente la comparación española, no20muestras ni integración comercial.

1. Texto sintético en español, un hablante y voz estándar; objetivo20–30segundos. Sin clonación, muestras personales, lipsync ni promesa de doblaje sincronizado.
2. Generar audio mediante la clave Gemini propia ya configurada; no activar facturación, crear cuentas ni contratar recursos. Modelo comprobado en listado de API:gemini-3.8-flash-tts. Voz predefinida Kore. REST evita actualizar el SDK del producto.
3. Verificar nombres, medidas y términos. Entregar audio para escucha y contrastar una transcripción del audio sin suministrar el texto esperado al reconocedor; distinguir evaluación automática de aprobación humana. Si falta escucha verificable, registrarlo sin inventarla.
4. Medir duración, latencia, formato, niveles/clipping y uso de tokens. Estimar coste con tarifa oficial y conservar respuesta/uso por intento; factura real permanece pendiente si API no informa cargo. Contabilizar revisiones aparte.
5. Incorporar la narración a un video sintético corto, como pista de reemplazo sin música ni voces originales; comprobar imagen preservada, duración, pista de audio y reproducción/decodificación. Sin recortar palabras ni alterar velocidad para forzar duración. Audio descargable y MP4 de demostración son artefactos de ensayo, no integración en la web.

## Texto de prueba

Elena Robles revisa la membrana impermeable junto al bajante. La unión está levantada cinco centímetros y debe quedar sellada antes de la lluvia. Mantén el andamio a seis pies de distancia y comprueba los tornillos de la cubierta. Esta es una demostración con datos inventados: revisa siempre nombres, medidas y materiales antes de compartir el video.

## Dependencias y límites

DeepSeek propone mínimo y controles; Kimi audita independientemente; Codex contrasta y ejecuta. Respaldo OpenRouter autorizado mientras T3 no tenga aislamiento efectivo, sin herramientas ni límites locales. Sólo texto sintético y contexto técnico mínimo.

Fuentes oficiales consultadas el12noviembre: [API TTS](https://ai.google.dev/gemini-api/docs/generate-content/speech-generation), [precios](https://ai.google.dev/gemini-api/docs/pricing). Precio Standard anunciado hasta31diciembre2026:US$0.50/Mtokens texto yUS$9/Mtokens audio; cambia después. Una muestra no fija precio comercial ni acredita diez idiomas. Drive permanece pendiente y no condiciona este ensayo.

## Revisión y verificación · resultado del ensayo

Entregables locales (outputs excluido de Git): `outputs/voice-prototype-20261112/narracion.wav`, `narracion.mp3`, `voice-over-demo.mp4`, `poster.png`, `texto.txt` e `informe.json`. Script reproducible `scripts/prototypeVoiceover.mjs` con comandos explícitos `generate`, `render`, `qa`, `report`; texto sintético versionado en `scripts/fixtures/voice-prototype-es.txt`. Generación y QA conservan un marcador exclusivo de intento para evitar llamadas duplicadas accidentales; sin reintentos automáticos ni topes locales de tokens/gasto. No es un endpoint del producto.

| Criterio | Resultado observado |
|---|---|
| Voz | Gemini3.8FlashTTS, Kore predefinida, español;1llamada HTTP200. WAV PCM16LE,24kHz,mono,499200muestras,20.8s. Latencia7.184s. Sin clonación ni audio personal. |
| Pronunciación automática | Gemini3.8Flash recibe sólo audio/instrucción genérica, sin texto esperado; transcripción conserva Elena Robles, membrana impermeable, bajante,5cm,seis pies,tornillos,cubierta. Modelo da inteligibilidad5/5 y sin problemas audibles. No equivale a aprobación humana. |
| Medida crítica | Comparador inicial marcó falso porque esperaba centimetros y ASR escribió5cm. Se conserva resultado anterior y transcripción; informe acepta cantidad/unidad equivalentes sin nueva llamada. No prueba pronunciación literal por sí solo. |
| Niveles | Original0muestras saturadas,pico−1.30dBFS. Copia normalizada:−16.37LUFS/−2.41dBTP. WAV de entrega y AAC decodificado0muestras saturadas y499200muestras cada uno. |
| Video |20.8s,H.2641280×720/25fps,520frames; AACmono24kHz. Mux copia video sin recorte/atempo, hashes de todos los frames coinciden. Decodificación completa sin errores. Cartela/poster inspeccionada visualmente por Codex, legible y con aviso sintético. |
| Copias con pérdida | MP3 y AAC preservan número de muestras. SNR respecto a WAV normalizado:21.54dBMP3/35.14dBAAC, diagnóstico local posterior a revisión; no sustituyen escucha perceptual. |

Muestras/frames/duraciones están medidas; la bandera inicial `noSpeedChangeOrTruncation` del JSON de render era declarativa, no prueba independiente. El informe final incorpora comparación de muestras y duración; comandos no aplican filtros temporales y se conservan originales/hashesSHA256. Tolerancia contenedor:1frame video+1frameAAC≈0.08267s; diferencia observada0s. No se acelera, trunca ni rellena voz para cumplir duración.

## Costes observados y estimados

| Operación | Uso devuelto | Coste USD |
|---|---|---:|
| TTS, BNb1atblLeKRjrEP9KnWoAY |75tokens texto entrada/520audio salida|0.0047175 estimado|
| QA, Hdb1ape2H7yd9MoPzPrwyQM |579entrada(59texto+520audio),145salida+252razonamiento|0.001923 estimado|
| Total generación+QA |1llamada de cada tipo|0.0066405 estimado|
| Revisiones OpenRouter |4respuestas,67589tokens|0.30533371605 usage.cost devuelto|

La tarifa Standard vigente de Gemini3.8Flash anunciaUS$0.75/Mentrada yUS$3.75/Msalida incluido razonamiento; se aplica al QA multimodal según la página oficial consultada. No inferir tarifa de otro modelo. API no devuelve cargo de factura: estimación y factura separadas, tampoco equivale a margen/precio del servicio. CPU/render locales no medidos monetariamente. Codex tokens/coste no medidos. No se activó facturación ni se creó servicio nuevo.

## Revisores y límites de cierre

T3 no se relanzó por aislamiento pendiente; se utilizó el respaldo OpenRouter explícitamente autorizado, sin herramientas. Plan: DeepSeek PASS limitado al plan; Kimi INCONCLUYENTE por esquema/rest, costeASR y controles incompletos. Codex contrastó API3.8oficial (campos speech_metadata.style y speechConfig.voiceConfig.voice válidos), fijó ASR/modelo/tarifa, tolerancias y controles antes de las llamadas. No se aceptó el esquema anterior de2.5 como sustituto del3.8actual.

Revisión final: DeepSeek y Kimi PASS técnico documental; ambos informes completos leídos. No escucharon ni ejecutaron herramientas. Disponibilidad previa tiene evidencia independiente `validation/voice-prototype-20261112/models-check.json`; no estaba incluida como artefacto en su snapshot final. Ajustes posteriores sólo al informe/diagnósticos de muestras/SNR, sin regenerar audio ni video. Escucha humana y valoración de naturalidad pendientes: la herramienta de relay devolvió audio-input no soportado y no se inventa audición. El usuario recibe WAV/MP4 para escuchar.

| Ronda/modelo | Generación | usage.cost USD |
|---|---|---:|
| Plan DeepSeekV4.1Flash |gen-1794495777-4ImN1QHpmRGuY1F8M7cO|0.00719442405|
| Plan KimiK3.1Pro |gen-1794495776-vEkGgAD7CmpB1w4WjumP|0.11874178800|
| Final DeepSeekV4.1Flash |gen-1794496142-MqPpK2uIe3GdPgwQzI3T|0.01502582400|
| Final KimiK3.1Pro |gen-1794496142-snopTjzjfqctBaxaBCRh|0.16437168000|

Respuestas/contextos/contabilidad privados en `%LOCALAPPDATA%/LinguistVision/t3-review/voice-prototype-20261112/`. Geminirequest/response sanitizados (sin clave/base64), modelos/uso/IDs en `%LOCALAPPDATA%/LinguistVision/validation/voice-prototype-20261112/`. WAV original/copia/video y hashes en outputs. Clave exclusiva externa, no impresa. Datos enviados a Google son sintéticos; privado no significa procesamiento exclusivamente local.

Comprobaciones pertinentes: `node --check`, ejecución real generate/render/qa/report, ffprobe, métricas PCM, hashes de frames, decodificación y poster visual. No cambiaron dependencias ni código de la aplicación: no se reatribuyen168tests/builds de la fase anterior a este script. No hubo compras/saldo usuario, Drive, migración, publicación ni modificación de candidata3001. Próximo paso: escuchar la muestra; después decidir idiomas/variantes e integración como fase separada, con calidad y coste propios.

## Comparación masculina con el mismo texto

El propietario manifestó «Me gustó mucho esa voz» sobre Kore. Se registra la aprobación de esta muestra femenina española en `outputs/voice-prototype-20261112/escucha-propietario.json`; los JSON previos a ese comentario permanecen como evidencia histórica. Objetivo registrado: una opción femenina y una masculina por idioma. No acredita las demás lenguas ni habilita un selector en la aplicación.

El script admite voz en allowlist(Kore/Charon), nombre de toma validado y ritmo solicitado, con carpetas y marcadores separados. Se mantuvieron texto/modelo y se preservaron todos los artefactos anteriores. La primera toma Charon a ritmo solicitado140duró18.48s y no cumplió20–30s. La segunda solicitó120y produjo20.24s(aprox166palabras/minuto reales): ese parámetro orienta al modelo, no garantiza velocidad exacta. No se aceleró ni estiró audio. Las dos voces tienen exactamente el mismo hash de texto.

| Muestra | Duración | Tokens texto/audio | Generación estimada USD |
|---|---:|---:|---:|
| Kore femenina aprobada |20.80s|75/520|0.0047175|
| Charon masculina seleccionada |20.24s|75/506|0.0045915|
| Suma de las dos muestras finales | | |0.0093090|
| Charon primera toma descartada |18.48s|75/462|0.0041955|
| Todas las generaciones del ensayo | | |0.0135045|

QA femenina estimadaUS$0.001923; QA masculinaUS$0.00163875, sumaUS$0.00356175. Generaciones(incluida descartada)+ambos controles:US$0.01706625 estimados, sin revisiones externas/CPU. La tarifa TTS es la misma para ambas voces de este modelo; la diferencia observada viene de tokens/duración. No hay cargo de factura devuelto por la API ni precio comercial aprobado.

La muestra seleccionada está en `outputs/voice-prototype-20261112-male-r2/narracion.wav` y `voice-over-demo.mp4`; la primera queda en carpeta `voice-prototype-20261112-male`. CLI usada: `generate|render|qa|report Charon r2 120`. Informe comparativo: `outputs/voice-comparison-20261112.json`. Generación seleccionada HTTP200responseId`_dv1aoPrA9mqjrEP447ziQM`; QAHTTP200`Jdz1ao3mBJzD1MkPhYCT0Ag`,565entrada/133salida/191razonamiento, sin texto de referencia. FórmulaQA vigente: `(565×0.75+(133+191)×3.75)/1e6`.

Controles:20.24s,WAV24kHzmono,485760muestras; videoH264/AAC506frames preservados; hashes y decodificación correctos, sin clipping. Se conservan nombre/materiales/5cm/6pies y demás términos según ASR, inteligibilidad5/5 automática. No hay aprobación humana masculina todavía. El resultado sólo es un prototipo español sin integración, Drive, nuevas cuentas ni activación de facturación.

Revisión comparativa por respaldo autorizado: DeepSeek y Kimi INCONCLUYENTE para aceptación perceptual final y factura real; ambos documentos completos leídos. No se reclasifican como PASS. Sus snapshots no incluían `voice-comparison-20261112.json`, el hash femenino, la confirmación posterior `escucha-propietario.json`, ni coste de QA femenina; Codex contrasta estos artefactos locales y las tarifas ya documentadas. El subtotalUS$0.01514325 indicado por ellos excluyeUS$0.001923 de QA femenina, por lo que no se adopta como total de todo el ensayo: total generación+QA de ambos sexos y descarteUS$0.01706625. Se mantiene escucha masculina pendiente, sin afirmar comparación controlada por velocidad ni calidad universal de20idiomas (objetivo real:2opciones en10idiomas).

| Revisor comparativo | Generación | Tokens | usage.cost USD |
|---|---|---:|---:|
| DeepSeekV4.1Flash |gen-1794497654-a91tH74h0v2RKnjvkbPi|21581|0.0154234377|
| KimiK3.1Pro |gen-1794497654-i0CwEkUaAGbRGhBSP54U|15626|0.1369011600|
| Total ronda masculina | |37207|0.1523245977|

Revisiones de ambas fases juntasUS$0.45765831375 usage.cost, siempre aparte de la estimación de audio/QA. Factura pendiente y CPU/Codex no medidos. Contexto/respuestas/accounting: `%LOCALAPPDATA%/LinguistVision/t3-review/voice-male-20261112/`; evidencia Gemini masculina en `validation/voice-prototype-20261112-male/` y `validation/voice-prototype-20261112-male-r2/`. No hubo nuevas llamadas de generación para completar documentación.

## Aprobación y proyección de costes

El propietario aprueba ambas muestras españolas. Se conserva su confirmación en los archivos `escucha-propietario.json` de cada carpeta de salida. No acredita otras lenguas ni autoriza publicación o precio comercial.

Proyección local: `coste_TTS_muestra / segundos_muestra × 60 × minutos`, suponiendo densidad de texto similar. Tarifa Standard reconsultada el12noviembre:US$0.50/Mtexto yUS$9/Maudio hasta31dic2026; ambas se duplican el1ene2027. Se refiere a duración de voz generada, no duración nominal del video.

| Audio | Kore USD | Charon USD | Dos versiones completas USD |
|---|---:|---:|---:|
|1min|0.013608|0.013611|0.027219|
|5min|0.068041|0.068056|0.136097|
|10min|0.136082|0.136112|0.272193|

Archivo de cálculo: `outputs/voice-cost-projection-20261112.json`. Proyección, no ensayo largo ni factura. Excluye transcripción/traducción, QA, revisores, regeneraciones, render, almacenamiento, transferencia e impuestos. Cálculo sencillo verificable realizado localmente sin llamadas nuevas de generación o revisores; no cambia precio comercial.
