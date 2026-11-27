# Contraste de las revisiones · 27 nov 2026

DeepSeek por T3 y GLM por el respaldo autorizado dieron PASS limitado a las cinco pruebas locales. Codex comprobó el TAP y los informes, sin extender ese dictamen a producción ni a la recuperación del sucesor.

GLM señaló una aparente diferencia entre dos avisos de protección en el TAP y tres en el resultado. El runner suma stdout y stderr: hay **dos** en `fixture.stdout.tap` y **uno** en `fixture.stderr.log`, para tres en total. Los originales están en `outputs/` local.

GLM sugirió que un replay con guarda ausente y solicitud ausente podría usar `record` indefinido. En el código leído, el replay requiere un documento `unblocked` o `video_released` existente y `samePayload`/`sameOperator` lo valida antes de devolver `record`; esa afirmación no queda demostrada. La alteración de testigos, el reingreso parcial y otras generaciones no forman parte del nuevo foco de cinco casos y conservan sus propios criterios y pruebas pendientes o existentes.

Ambos reconocieron que el transporte es ficticio, el ancla/grant son hipótesis y faltan endpoint, autorización y corte reales; el recibo ajeno se probó directamente en el cliente. La revisión GLM consumió 14.685 tokens de entrada y 24.583 de salida, con costo reportado **US$0.0086095845**; el uso/costo individual de T3 no fue observable.
