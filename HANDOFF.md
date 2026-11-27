# Continuidad de Vistavo · 27 nov 2026

El estado y orden vigentes están en [MASTERPLAN](MASTERPLAN.md), los criterios en [backlog](backlog.md) y las dependencias en [gantt](gantt.md). Lee también la especificación de saldo antes de cambiar código. El [HANDOFF anterior](docs/history/HANDOFF-before-successor-2026-11-27.md) se conserva como contexto histórico.

La documentación está en la rama `codex/vistavo-finance-diagnostic-handoff-20261127`. La candidata de saldo está en `codex/vistavo-successor-recovery-20261127`, revisión `667b2f0`. Son ramas de trabajo, no una versión aceptada. [Evidencia y resultados](https://github.com/Robcaze1980/video_transcript/blob/667b2f09ac2f75843638bc557d0bfe838ad20787/docs/evidence/lv019-b-successor-integrated-wip-20261127/README.md).

El sucesor está conectado solo en emulador, con autoridad y transporte sintéticos. Un corte pasó **22/22** pruebas enfocadas y **70/70** unitarias de Cuenta. Después se añadió una contraprueba y el resultado fue **22/23**: una incidencia de Cuenta entre su última lectura y el cierre de Video dejó Video abierto. DeepSeek y GLM dieron **FALLA** al código revisado antes de esa contraprueba. La batería financiera completa del corte final aún no se ha ejecutado.

El siguiente paso es corregir y demostrar esa carrera, conservar el historial sin cambios, verificar aislamiento entre cuentas y repetir las dos revisiones T3 y la batería financiera completa. Siguen pendientes la autoridad real, el corte de escritores, el contrato entre servicios, D2 y la admisión por devolución vencida. Un `pending` no autoriza por sí solo un segundo envío. Después continúan el recorrido de video, la voz opcional y las pruebas en teléfonos físicos, según el plan.

No desplegar ni habilitar el procesamiento o saldo real antes de sus gates. No crear Cloud SQL. Al retomar en otra PC, confirma rama y revisión, instala dependencias y regenera los manifiestos locales: `outputs/` se ignora en Git.
