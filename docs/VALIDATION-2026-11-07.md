# Validación local — 2026-11-07

- Repositorio: Robcaze1980/video_transcript; main y origin/main coinciden en afe2d4caefd53b8576b066c0f20129095fbcc172 tras fetch. Árbol inicialmente limpio.
- Leída docs/DEPLOYMENT.md. Node 24.13.0.
- Candidata preparada en %LOCALAPPDATA%\LinguistVision\releases\afe2d4caefd53b8576b066c0f20129095fbcc172 mediante worktree separado.
- npm ci --include=dev, npm run lint, npm test (28/28) y npm run build: correctos.
- npm informó 6 vulnerabilidades (1 moderada, 5 altas); build avisó de un chunk superior a 500 kB. No se modificaron dependencias por estos avisos.
- Arranque de candidata sin credenciales: escucha exclusiva en 127.0.0.1:3001, página HTTP 200, /api/health con ok=true, configured=false, provider=null y model=gemini-3.8-flash.
- Candidata detenida después del ensayo; carpeta conservada. No se cambió la versión activa.
- El puerto 3000 estaba ocupado por node.exe (PID 25940), cuya línea de arranque referencia LinguistVision. Escucha en 0.0.0.0, discrepancia con el uso local previsto. No se detuvo ni reconfiguró ese proceso.
- No existe %LOCALAPPDATA%\LinguistVision\.env. No se encontraron clips mp4/webm/mov en el repositorio (excluidos node_modules y dist).
- Pendiente: usuario configura GEMINI_API_KEY localmente en el archivo indicado y facilita la ruta de un clip corto con voz, autorizado para enviar a Gemini. Después: transcripción real, descarga de subtítulos y apertura/verificación del contenido y tiempos.
- No se probó la aceptación de clave, transcripción real, descarga ni apertura de subtítulos; no deben considerarse validadas.
- Sin cambios de código: no se demostró un fallo funcional que justifique corregirlo. Sin consultas externas a T3/DeepSeek/Kimi; sin cargos de consulta generados por este trabajo.

## Seguimiento de coordinación y prueba local

- T3 registró LinguistVision con la carpeta de Robcaze1980/video_transcript y recibió la misión de solo lectura para afe2d4c. Tarea: mcp:7b68843f-4c35-4c49-b45d-710c777e75ad. El proveedor predeterminado, codex/gpt-6.1-sol, cerró la tarea por el límite de uso compartido de ChatGPT. T3 no devolvió revisiones de DeepSeek o Kimi. El intento no reportó coste. No se enviaron consultas directas: queda pendiente identificar el canal autorizado de LinguistVision.
- Se generó localmente un clip sintético de 5,204 s, con video H.264 y audio AAC, en %LOCALAPPDATA%\LinguistVision\validation\linguistvision-test.mp4. Frase de referencia: “This is a subtitle test. The blue bicycle has three wheels.”
- La candidata escuchó solo en 127.0.0.1:3001. Con el clip sintético, POST /api/video devolvió HTTP 503 desde requireAi antes de llamar a Gemini. GET /api/health devolvió ok=true y configured=false. Se detuvo la candidata tras la prueba.
- Para cerrar la prueba real, comprobar POST /api/video con respuesta 200 (archivo ACTIVE según el servidor), POST /api/transcribe con respuesta 200 y segmentos con voz, y descarga desde la interfaz. Abrir el SRT, verificar texto frente a la frase conocida y comprobar tiempos crecientes dentro de la duración del clip. Distinguir validación local, errores de transporte, respuesta de Gemini y fallos de exportación usando la etapa y el mensaje, sin registrar claves ni URI de archivos.

## Intento con la clave del proyecto

- Node 24.13.0 cargó `GEMINI_API_KEY` desde el archivo local. La candidata `afe2d4c` escuchó exclusivamente en `127.0.0.1:3001`. Página HTTP 200 y salud con `ok: true` y `configured: true`.
- Chrome abrió la candidata, cargó el clip sintético y solicitó subtítulos de inglés a español. La carga devolvió HTTP 500 local. El diagnóstico del servidor confirmó que Gemini Files devolvió HTTP 402 por agotamiento de los créditos prepagados del proyecto.
- Se hicieron tres intentos para identificar la causa. El flujo se detuvo en la carga, antes de transcribir. No se generó ni se descargó un SRT. No se confirmó un importe de facturación. Se detuvo la candidata y no se cambió el servicio de 3000.
- Para reanudar, el usuario revisa el saldo del proyecto Gemini de LinguistVision. Codex repite la prueba completa cuando el proyecto pueda procesar la carga.

## Validación tras la recarga

- La candidata local con los cambios de LV-008 se probó en Chrome en `127.0.0.1:3001`, con Node 24.13.0. La clave se cargó desde el archivo local del proyecto.
- Con el clip sintético vertical de 5,2 s, la carga en Gemini Files y la transcripción de inglés a español respondieron HTTP 200. Se descargó y abrió el SRT original. Sus dos segmentos cubrieron 0,080–1,700 s y 2,150–4,550 s. El texto conservó las dos frases de referencia y el dato de tres ruedas. LV-002 queda cerrada.
- Se completó la prueba de escritorio de LV-008 con esa transcripción. Se descargaron el SRT revisado y el MP4. [Resultados de revisión y renderizado](specs/LV-008-revision-y-exportacion-del-piloto.md#evidencia-con-transcripción-real).
- Evidencia local en `%LOCALAPPDATA%\LinguistVision\validation\lv008-real-MiN1TZ`. El servicio de prueba se detuvo. El cargo exacto de Gemini no se confirmó.
