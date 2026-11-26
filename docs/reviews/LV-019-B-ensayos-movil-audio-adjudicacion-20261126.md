# LV-019.B · Contraste de los ensayos sintéticos de móvil y audio

**26 nov 2026.** [GLM](LV-019-B-ensayos-movil-audio-GLM-20261126.txt) devolvió **PASS acotado a los guiones de prueba** `78d3753` y `a351846`; no ejecutó sus dependencias ni revisó el producto financiero. Sirvió `z-ai/glm-5.3-flash` a través de OpenRouter y registró 13.801 tokens de entrada, 20 de caché, 83.546 de salida y US$0,0420379245. El resultado de la auditoría C2 interrumpida no cambia.

Codex contrastó los puntos señalados con los recibos y las ramas:

- El guion móvil exige `document <= viewport`. El recibo `ef433f...`, que no se incluyó en el paquete del revisor, muestra **320/320, 390/390 y 428/428**; la igualdad observada corresponde a esa corrida, no a una garantía general.
- El archivo de audio se llama `browser-result.json`, no `result.json` como decía el encargo abreviado; su SHA-256 `9679de3453c8be1f000a34cfbeacfa9da037eeadb39eec0bbc0e6617a1bcfd84` se cotejó directamente.
- `a14eb93` sí es ancestro de `78d3753`; se comprobó con Git. El guion móvil valida el navegador fijado, pero el resultado JSON no guarda su identidad/hash. El audio sí la registra. La alteración del WAV solo se ejercitó en Kore; no se contó como prueba de alteración independiente para Charon.
- En `a351846` la espera de cierre de Chromium no tiene plazo. Es una limitación real del arnés, no un PASS falso del resultado. El ajuste posterior `1cd4f2d` espera un máximo de cinco segundos, devuelve error sin PASS si vence y conserva el perfil si el proceso aún podría usarlo. Se comprobó con cierre ausente simulado y una nueva corrida de reproducción PASS. La revisión de GLM cubre el corte anterior; el ajuste se contrastó localmente.

Las pruebas usan respuestas ficticias, tonos y Chrome de escritorio. No prueban narración real, móvil físico, compra, saldo, IAM, integración financiera ni activación. [Recibo y límites](../evidence/lv019-b-mobile-voice-synthetic-20261126/README.md).
