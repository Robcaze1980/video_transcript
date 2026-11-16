=== RESUMEN FINAL ===
RESULTADO: PASS

EVIDENCIA:
- (1) `server/commercial/isolatedCandidateLocal.ts:63` (`apiService` valida `x-serverless-authorization: Bearer <token>` → 403 `gateway_identity_required`; `/healthz` exento para readiness), `:75` y `:81` (validación `/^[a-f0-9]{64}$/`, falla cerrado sin token); `server/commercial/startIsolatedCandidate.mjs:34-38` (`randomBytes(32).toString('hex')`, inyectado solo a roles `gateway` y `cloud`).
- (2) `rg VISTAVO_LOCAL_PRIVATE_API_URL` sin coincidencias en server/docs/package.json; `isolatedCloudRunBridge.ts:11` fija `privateAudience='http://127.0.0.1:3005'`, `:53` rechaza destino distinto y `:82` rechaza audiencia distinta.
- (3) `server/commercial/isolatedCandidateProxy.ts:17-23` (`allowedVideoQuery`: solo `offset` ≤20 chars en chunks, solo `download=1` en TXT/SRT, resto 404); el gateway replica la allowlist en `isolatedCloudRunBridge.ts:19-43` (defensa en profundidad).
- (4) `isolatedCloudRunBridge.ts:14,48-49`: drenaje acotado a `16*1024*1024` B o 10 s; si incompleto → `Connection: close` + `socket.destroy()` tras `finish`. Tests en `server/commercial/isolatedCandidateLocal.emulator.mjs`: revocación con espera de 2100 ms (:48), POST chunked sin Content-Length → 411 (:63), JSON 400001 B → 413 (:64), `download=2` y `unexpected=1` → 404 (:76-77). Log `outputs/lv019-b-cloudrun-local-bridge-20261116/test-candidate-isolated.log`: pass 1, fail 0, skipped 0.

NEGATIVOS: Sí rechaza — llamadas directas a 3005 sin assertion (403, :60/:91), assertion inyectada por navegador descartada y sustituida (:42), token revocado (401), chunk >8 MiB (413), `offset=bad` (400), JSON sin longitud (411) y >400 kB (413), queries no documentadas y rutas no mapeadas (404), origen ajeno (403), lecturas/borrados entre cuentas (404). No se probó — la rama de corte de drenaje por 16 MiB/10 s (los cuerpos rechazados de prueba son pequeños y drenan completos), `offset` >20 chars en el proxy, y el arranque real de `startIsolatedCandidate.mjs` (el test usa `createIsolatedCloudServer`/`createIsolatedCloudRunBridge` directamente); la validación de token en `startIsolatedCloudApi` se verificó por código, no por ejecución. Lint reportado por Codex, no reejecutado en esta revisión.

BLOQUEOS: ninguno para el prototipo LOCAL. Los cuatro hallazgos están corregidos; las ramas no ejercitadas anteriores son brechas de cobertura menores, no bloqueantes en alcance local.
=== FIN RESUMEN ===
