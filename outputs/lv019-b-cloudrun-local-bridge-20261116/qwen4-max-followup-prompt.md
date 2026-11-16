LV-019.B-LOCAL-GATEWAY-01 follow-up. Revisa SOLO estos cuatro hallazgos no bloqueantes de tu PASS previo y confirma si están corregidos en el estado de trabajo actual; no edites archivos.

1. `server/commercial/isolatedCandidateLocal.ts`: el Cloud API ahora exige un token gateway efímero de 64 hex y falla cerrado si falta; `startIsolatedCandidate.mjs` lo genera e inyecta solo a gateway y cloud.
2. Se retiró la variable sin uso `VISTAVO_LOCAL_PRIVATE_API_URL`; destino y audiencia siguen fijados a loopback.
3. `isolatedCandidateProxy.ts` allowlist de query: solo `offset` en chunks y `download=1` en TXT/SRT.
4. `isolatedCloudRunBridge.ts` limita el drenaje de cuerpos rechazados a 16 MiB o 10 s; conexión se cierra si no termina. Tests añadidos en `isolatedCandidateLocal.emulator.mjs`: revocación con separación temporal, POST chunked sin Content-Length (411), JSON de 400001 B (413), y queries no permitidas (404).

Codex informa `npm run test:candidate:isolated` PASS 1/1 sin omisiones y `npm run lint` PASS. El log está en `outputs/lv019-b-cloudrun-local-bridge-20261116/test-candidate-isolated.log`. Contrasta las rutas citadas, y señala únicamente bloqueos actuales o brechas que aún impidan aceptar este prototipo LOCAL. No evalúes ni apruebes IAM, VPC, producción, costos o despliegue. Salida máxima breve.

=== RESUMEN FINAL ===
RESULTADO: PASS|FALLA|INCONCLUYENTE
EVIDENCIA: (rutas exactas)
NEGATIVOS: (qué sí rechaza y qué no se probó)
BLOQUEOS: (lista concreta o ninguno)
=== FIN RESUMEN ===
