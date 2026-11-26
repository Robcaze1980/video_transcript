# LV-019.B · C5a · prototipo local de estimación de voz

Fecha: 26 de noviembre de 2026 (PST). Base: `255aa5e`. Esta pieza es un prototipo aislado de solo lectura; no es una cotización confirmada, no consulta ni reserva saldo y no está conectada a la web pública.

- La duración de ejemplo se redondea hacia arriba al segundo. Texto cuesta US$0.10/min y voz opcional añade US$0.10/min; el importe de cada servicio se redondea al centavo antes de sumarlo. Para 2:10, el ejemplo muestra US$0.22 por texto y US$0.44 por ambos.
- La voz empieza desmarcada y no puede elegirse sin texto. La pantalla identifica el importe como estimación y no ofrece una acción de compra o procesamiento.
- `node --test server/commercial/web/voiceQuotePreview.test.mjs`: 6/6 pruebas aprobadas, sin omisiones. Incluyen límites, entradas inválidas, segundos fraccionarios y mitades de centavo.
- `node server/commercial/web/voiceQuotePreview.browser.mjs`: Chromium Headless Shell aprobó el recorrido a 320 y 390 px; comprobó ausencia de desbordamiento, controles de al menos 44 px, teclado/foco, estado accesible del total, ausencia de persistencia y seis solicitudes estáticas de loopback. No prueba el tacto ni un teléfono físico.
- Revisión estática de GLM Flash por el respaldo OpenRouter: [informe íntegro](../../reviews/LV-019-B-voz-c5a-GLM-20261126.txt). Acepta el prototipo con límites; el modelo no ejecutó las pruebas ni recibió el helper CDP. Costo observado: US$0.004513311.

La cotización del servidor, la integración C5b, la reproducción real de voz, la prueba en dispositivos y la publicación siguen pendientes. La demo solo inicia un servidor local cuando se ejecuta explícitamente su lanzador con `--serve`.
