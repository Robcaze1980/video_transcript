LV-019.B-LOCAL-GATEWAY-01. Revisión independiente estática de la candidata local final del puente a Cloud Run. Repositorio Robcaze1980/video_transcript, base 60375e5; revisa solo los cambios de esta tarea en:
- server/commercial/isolatedCloudRunBridge.ts
- server/commercial/isolatedCandidateProxy.ts
- server/commercial/isolatedCandidateLocal.ts
- server/commercial/startIsolatedCandidate.mjs
- server/commercial/isolatedCandidateLocal.emulator.mjs
- server/commercial/web/isolatedCandidate.tsx
- docs/specs/LV-019-B-puente-cloud-run-privado.md

Alcance deliberadamente local: Firebase Auth/Firestore Emulator + backend simulado en 127.0.0.1. La identidad X-Serverless-Authorization es un secreto efímero local, NO un JWT de Google. No revises ni apruebes IAM, VPC, producción, despliegue, costos o publicación.

Busca bloqueos de seguridad o errores funcionales en: verificación del Firebase ID token (revocación y email verificado); identidad separada de gateway y usuario; header de identidad inyectado por navegador; backend que rechace bypass; tabla fija de rutas, métodos y queries; tamaños y streaming/backpressure; no-store/Vary en descargas; que el gateway no sea proxy abierto; aislamiento que impida credenciales o destinos productivos; y si las pruebas negativas realmente cubren esos límites. No edites archivos. Respuesta de salida corta, accionable y basada solo en evidencia de esos archivos.

=== RESUMEN FINAL ===
RESULTADO: PASS|FALLA|INCONCLUYENTE
EVIDENCIA: (rutas y hallazgos comprobables)
NEGATIVOS: (controles rechazados y casos que no cubre)
BLOQUEOS: (lista concreta o ninguno)
=== FIN RESUMEN ===
