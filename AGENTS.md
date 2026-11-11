# Instrucciones para trabajar en LinguistVision

Este proyecto corresponde a `Robcaze1980/video_transcript`. Mantén repositorio, credenciales, entornos, decisiones y gastos separados de ROBATO.

## Antes de empezar

1. Lee [el plan maestro](MASTERPLAN.md), [el backlog](backlog.md), [el cronograma](gantt.md) y la [especificación vigente](docs/specs/LV-001-plataforma-multilingue.md). Revisa la última entrada de [bitácora](bitacora.md) y los incidentes relacionados de [errorlogs](errorlogs.md).
2. Confirma repositorio, revisión y estado de trabajo. Identifica el ID de la tarea, su criterio de aceptación y las dependencias. Si el alcance cambia, actualiza primero la especificación y las tareas afectadas.
3. Para descubrir código, usa codebase-memory-mcp. Indexa primero si falta el proyecto. Prioriza `search_graph`, `trace_path`, `get_code_snippet`, `query_graph` y `get_architecture`. Usa `rg` para literales, archivos de configuración o resultados insuficientes del grafo.

## Coordinación y entrega

- Ejecuta las actividades del plan en orden, encadenando coordinación, revisión, integración y verificación. El «avanza» vigente autoriza los pasos siguientes del plan. Codex recoge las respuestas de T3 o del respaldo autorizado, registra evidencia y cargos y pasa a la siguiente actividad lista sin pedir otro «avanza». Resuelve las decisiones técnicas y consulta al usuario solo por decisiones no técnicas que condicionen el trabajo, como alcance comercial, presupuesto o publicación. Mientras llega esa decisión, continúa los frentes independientes.

- **T3** coordina las revisiones que requieren contraste de arquitectura, alcance, SEO/GEO, calidad lingüística o costo. Pásale el ID, objetivo, repositorio, revisión, archivos relevantes, dependencias y evidencia de cierre. Ejecuta en paralelo las revisiones independientes.
- En este equipo, T3 puede asignar ambos revisores por la instancia `linguistvision-openrouter`, habilitada solo en el proyecto LinguistVision. Selecciona `openrouter/deepseek/deepseek-v4.1-flash` y `openrouter/moonshotai/kimi-k3.1-pro`. Kimi se limita a `moonshotai/kimi-k3.1-pro` también en el respaldo directo. Pasa los fragmentos necesarios en cada mensaje, pues la instancia se configuró para revisión sin herramientas. [Configuración de Kimi](bitacora.md#2026-11-08--t3--kimi-k31-pro).
- **DeepSeek** propone el cambio mínimo y sus pruebas. **Kimi** audita riesgos y criterios de cierre de forma independiente. **Codex** contrasta contra código, fuentes oficiales y pruebas, integra y decide qué adoptar. El usuario decide alcance comercial, lanzamiento y cambios de presupuesto.
- Si T3 falla, registra el error y usa el OpenRouter autorizado para LinguistVision con su clave de proyecto. Comparte solo contexto técnico mínimo. Registra modelo, vía, generación, resultado y costo real por intento. Sin tope local de tokens ni de gasto acumulado. Para tareas sencillas y verificables localmente, Codex actúa directamente.
- Mantén claves, archivos de clientes y transcripciones fuera de prompts, bitácoras y repositorio. Lee [despliegue](docs/DEPLOYMENT.md) para preparar una candidata y probarla en 3001 antes de promoverla a 3000.
- Cada entrega que cambie alcance, estado, fechas o decisiones incluye en el mismo cambio los registros que correspondan. Actualiza backlog y bitácora al cerrar. Actualiza Gantt cuando cambien hitos o dependencias, errorlogs cuando se reproduzca o resuelva un incidente y la especificación cuando cambie un criterio. Enlaza evidencia y marca bloqueos explícitos. No declares aceptado un trabajo que carezca de la evidencia exigida.
- Si cambia código, ejecuta las verificaciones pertinentes. Para cada candidata, sigue la guía de instalación, tipos, pruebas y compilación.
