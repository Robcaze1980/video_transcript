# LV-019.B · Comprobación de dueño de una fila aplicada

**26 nov 2026.** La candidata aislada `codex/vistavo-unblock-applied-owner-20261126` (`613ea52`) comprueba el titular antes de omitir una fila de hold que pasó a `applied` durante el desbloqueo. Una contraprueba con datos privilegiados simulados falló en la base y pasó tras el cambio; no se demostró una vía de cliente ni un movimiento del saldo de otra cuenta. El caso legítimo de la misma cuenta sigue pasando.

Codex cotejó los hashes de los logs y la salida: **20/20** de continuidad y **75/75** en cuatro suites relacionadas, más tipos correctos. Son pruebas en memoria, no Firestore ni saldos reales. La corrección sigue aislada y no resuelve por sí misma la recuperación de una respuesta perdida, la generación cambiada, el corte de escritores, migración ni la guarda de admisión.

[GLM](LV-019-B-desbloqueo-fila-aplicada-GLM-20261126.txt) y [DeepSeek](LV-019-B-desbloqueo-fila-aplicada-DeepSeek-20261126.txt) dieron **PASS estático acotado** al traslado de la comprobación, la contraprueba y el control positivo. No ejecutaron el código; les faltaron fragmentos del test y módulos. No certifican el corte completo. Una línea ajena al cambio se resumió en el paquete tras una alerta del escáner sobre una comparación de identificadores; se comprobó localmente y no se enviaron claves.

OpenRouter, respaldo autorizado de T3, reportó **13.972/11.958** tokens de entrada/salida y **US$0,005369661** para GLM (servido `z-ai/glm-5.3-flash`), y **15.326/13.538** y **US$0,020634966** para DeepSeek. Informes completos y límites en los enlaces anteriores. La prueba focal en Firestore Emulator y la regresión integrada permanecen pendientes.
