Thread mcp:6f3e65c5-4237-4662-9df5-0db3da29d0fe
# Revisión independiente del plan general · LV-019.B · 16 nov 2026

## 1. Vigencia y contradicciones de MASTERPLAN

El checkpoint del 16 nov (`MASTERPLAN.md:1-16`) sí refleja los hechos dados: solo Hosting cambió en la última publicación, local/sintético PASS, compras apagadas, tarifa 0,10/0,10 confirmada, E55 abierto. **El cuerpo del plan no está vigente** y contradice ese checkpoint:

| # | Evidencia | Contradicción con |
|---|---|---|
| C1 | `MASTERPLAN.md:3` "Siguiente: paquete de costos… para aprobación explícita antes de implementación real" | Ya cumplido: paquete preparado (`backlog.md:7`), estimado aceptado como base (`HANDOFF.md:15`), readback hecho (`gantt.md:242`), y autorización "conecta todo… solo con saldo real" registrada en `docs/specs/LV-019-B-video-text.md:41` y `docs/specs/LV-019-B-puente-cloud-run-privado.md:3`. El "siguiente" real es conciliar invocadores y cablear el saldo. |
| C2 | `MASTERPLAN.md:95` "# Actualización vigente · 13nov2026" y `MASTERPLAN.md:101` "Estado vigente… 13 de noviembre" | Coexisten tres bloques "vigentes". Además `MASTERPLAN.md:103` afirma "el login… no están conectados todavía": falso desde LV-018/LV-019.A (`MASTERPLAN.md:10`, `MASTERPLAN.md:35`). |
| C3 | `MASTERPLAN.md:129-135` "Orden de ejecución": editor LV-009–014 y PayPal Sandbox como ruta crítica previa a LV-004/publicar | Ruta abandonada por LV-007 Firestore → LV-019; hoy compras/PayPal están explícitamente prohibidos en esta fase (`backlog.md:5`, spec video-text:11). El orden induce a habilitar pagos antes de conectar video: invierte el mandato actual. |
| C4 | `MASTERPLAN.md:161,163,165` "voz… no incluida en la oferta comercial / precio de voz… reservados a Rob" | Decisión del 16 nov cerrada (`gantt.md:244-245`, `backlog.md:3`). Son history-stale dentro del cuerpo "vigente". |
| C5 | `docs/specs/LV-019-B-puente-cloud-run-privado.md:52` "`vistavo-files-api` hoy solo permite… `vistavo-bootstrap` invocarlo… Rob debe autorizar en concreto" | Desmentido por el propio readback (`gantt.md:242`: política IAM del servicio vacía; invocador efectivo sin conciliar). El header :3 dice que las frases de aprobación pendientes quedan superadas, pero :52 y :64-65 ("Desplegar… solo después de aprobación explícita") siguen en imperativo: riesgo de re-pedir una autorización ya dada. |
| C6 | `gantt.md:93` "Actualización vigente · 13nov2026" y `gantt.md:135` "Evaluar el Droplet de DigitalOcean en paralelo" | DigitalOcean sustituido (`MASTERPLAN.md:117`); la tabla de fases del gantt (:121-135) sigue siendo la pre-Firestore con PayPal como gate de LV-014. |
| C7 | `backlog.md:54-56` LV-017.PUBLIC-LOGIN abierto con `[ ]` "enlaces… terminan en disponibilidad" | Cerrado por LV-018 según el propio `backlog.md:47` ("Sustituye el estado pendiente de LV-017.PUBLIC-LOGIN"). |
| C8 | `HANDOFF.md:9` "Rob debe aprobar esos cambios cuando vea el paquete" vs `HANDOFF.md:15` "ejecución no autorizada… ninguna conexión… queda aprobada" | Ambos posteriores a la autorización citada en spec video-text:41 y puente:3. Lectura conjunta posible (costo-base ≠ ejecución), pero el HANDOFF no cita la autorización nueva: quien lea solo HANDOFF concluirá que falta un "avanza" que ya existe. |
| C9 | `docs/specs/LV-001-plataforma-multilingue.md:36-38` sección "Decisiones pendientes" contiene decisiones ya tomadas (precios, voz +0,10) y omite el selector de pares/redondeo por segundo del 16 nov | Etiquetado obsoleto; el contenido monetario sí es coherente con la decisión confirmada (no la contradice). |
| C10 | `backlog.md:119-121` SILENT_VIDEO_CONTRACT "BLOQUEO COMERCIAL", STATUS_INPUT_REVALIDATION / DOWNLOAD_REVOCATION_TOCTOU abiertos vs `backlog.md:82-84` "CERRADO privado" (D9/V3) | Matiz real: silencio digital cero cerrado con prueba; semántica no-nula (ruido/música) y hardening comercial siguen abiertos (:82, :86). Dos tablas con estados distintos sin reconciliar. |

Verificado con código (mínimo, solo lectura): el puente de saldo existe y es sólido en local — `server/account/backend.ts:117` (`reserveVideo` transaccional con invariante `credited = available+reserved+consumed`), `server/account/backend.ts:147` (`settleVideo` captura/libera una vez, UNKNOWN permanece reservado), rutas `/api/internal/video/reservations…` con token de servicio, audiencia y callers separados en `server/account/http.ts:23-38`. Confirma el hecho "código/tests locales sin cablear": ningún worker/UI lo invoca aún; `services.transcription/translation/narration/payments` siguen `false` (`server/account/backend.ts:26`).

## 2. Orden de fases y dependencias

La secuencia real ejecutada (identidad pública → panel/ledger → candidata aislada → carga sintética → fixture texto → puente loopback → paquete costo/IAM → readback) es sensata: cada eslabón tiene evidencia y negativos, y el aislamiento Auth/Firestore por servicio es correcto. Dos observaciones estructurales:

- El plan formal (MASTERPLAN §Orden de ejecución, gantt tabla :121-135) describe **otra ruta** (editor → pagos móviles → 10 idiomas → publicar). No es que esté desordenada: está desconectada de la ruta Firestore/LV-019 que realmente se sigue. Debe declararse superseded, no editarse en paralelo.
- Dependencia bien puesta: la conexión cloud está correctamente frenada por el readback fallido de esta sesión (puente:3 "si un readback no puede verificarse, no desplegar con estado incierto"). El cableado local reserva↔worker↔UI **no depende** de ese readback y hoy es el frente desbloqueado más grande.

## 3. Índice propuesto para MASTERPLAN (compacto, ~1 página + anexo histórico)

```
0. Estado vigente (único bloque fechado; todo lo demás pasa a ANEXO HISTÓRICO inmutable)
1. Hechos publicados (HECHO): login/perfil LV-018 + panel LV-019.A en Hosting
   c5bb31bab5c215e3; solo Hosting; servicios/compras OFF. Hito: readback+QA online.
2. Decisiones cerradas (HECHO): Firestore sin Cloud SQL; tarifa 0,10 texto /
   +0,10 voz desde texto revisado (0,20 ambos), segundos fuente redondeados arriba;
   selector solo pares LV-004; autorización "conectar todo, solo con saldo real";
   estimado gateway = base presupuestaria, no autorización por cambio.
3. Track VIDEO (LV-019.B) — ruta crítica:
   3a. EN CURSO local: reserva/captura/liberación ↔ worker/pipeline + UI selector/voz
       + base/prefijo GCS producción aislados. Hito: E2E emulado con saldo sintético
       de test, cero-saldo rechaza, UNKNOWN retiene, idempotencia; suites+lint+builds+Qwen.
   3b. BLOQUEADO cloud: readback fresco (IAM efectivo/invocador, ingress, VPC, cuotas)
       → diff exacto gateway/invoker/egress/rewrite CSP → despliegue. Hito: positivos
       y negativos reales (token Google firmado, bypass 403, ruta VPC interna).
   3c. PENDIENTE publicación: Hosting con /api/video/** + QA online con saldo real.
4. Track LV-004 idiomas/calidad (PENDIENTE, paralelo a 3a): ES→EN primero con
   muestras+rúbrica+revisión bilingüe; cada par/voz se habilita solo con evidencia.
   Voz comercial requiere calidad aceptada, no solo precio decidido.
5. Track DRIVE (PENDIENTE, independiente; no bloquea 3).
6. Cierre operativo/comercial (BLOQUEADO por sus gates): E55 diagnóstico+estabilidad,
   semántica audio no-nulo, humano Google/correo/Pixel, video largo/MP4, pagos/restore
   (fase propia, apagados hoy), coste por resultado medido, publicación indexable.
7. ANEXO HISTÓRICO: checkpoints actuales 1→219 sin reescritura, marcados superseded.
```

Estados propuestos por hito: 1-2 HECHO (evidencia citada arriba); 3a EN CURSO; 3b BLOQUEADO (readback); 3c, 4, 5 PENDIENTE; 6 BLOQUEADO por gates propios. accompanying: cerrar LV-017.PUBLIC-LOGIN en backlog (C7), reconciliar tabla :119-121 con :82-84 (C10), mover decisiones de LV-001:36 fuera de "pendientes" (C9), y actualizar HANDOFF :9/:15 y puente :52/:64 para citar la autorización del 16 nov con su condición de saldo (C5, C8).

## 4. Riesgos/gates que sí bloquean la conexión real (máx. 5)

1. **IAM/invocador efectivo sin conciliar + readback que no responde.** Política del backend vacía contradice la premisa del diseño (puente:52 vs gantt:242). Sin estado fresco verificado no se puede conceder `run.invoker` ni desplegar (regla explícita puente:3). Es el bloqueo duro cloud.
2. **Ruta de red efectiva no probada.** VPC existe, pero Direct VPC egress + Private Google Access + token IAM con audiencia exacta hacia `ingress=internal` no se han ejercitado con identidad Google firmada (puente:36, :62). El PASS loopback no lo cubre.
3. **Saldo no cableado = condición de la autorización incumplible hoy.** El gate estricto "no procesar sin saldo real" exige reserva previa al despacho, captura única, liberación solo confirmada y UNKNOWN retenido a través de worker+UI. Existe en `server/account/*` pero nada lo llama: conectar sin esto violaría la autorización (spec video-text:7, :11, :41).
4. **Exposición pública nueva del gateway + CSP/rewrites.** Hosting no tiene `/api/video/**` y la CSP pública lo bloquea; abrir el gateway sin allowlist/guards/`no-store`/negativos reproducidos online amplía superficie con dinero real detrás (puente:42-43, :51). Requiere el diff exacto y pruebas negativas online antes del flag.
5. **Fiabilidad del despacho bajo carga real (E55/E56 y UNKNOWN).** Causa del 500 histórico inconclusa (`errorlogs.md:89-97`); E56 documenta despacho dentro de HTTP con riesgo de timeout (`errorlogs.md:99-101`, corrección probada solo en privado). Con saldo real, un 500/UNKNOWN retiene dinero del cliente: se exige jobs asíncronos + reconciliación probada antes de exposición comercial; no hace falta resolver la causa histórica para conectar en modo acotado, pero sí el plan de diagnóstico/estabilidad y la semántica de silencio/audio no-nulo con reserva real.

No bloquean la conexión: Drive, los otros 8 idiomas (el selector puede abrir solo con pares validados), pagos/compras (explícitamente fuera), MP4 largo.

**Siguiente paso único más útil:** reintentar el readback de solo lectura de Cloud Run/IAM (proyecto explícito `vistavo-prod`, timeout acotado) para conciliar el invocador efectivo de `vistavo-files-api` y congelar el diff exacto de IAM/egress/rewrite. Es el único bloqueo que no tiene workaround local y la regla "sin readback no se despliega" lo pone primero; en paralelo e independientemente, cablear reserva/captura/liberación al worker y UI en la candidata emulada (paso 3a), que la autorización ya cubre.

=== RESUMEN FINAL ===
RESULTADO: FALLA
EVIDENCIA: MASTERPLAN.md:1-16 vigente pero :3 desactualizado (paquete/autorización ya ocurrieron), :95/:101-103 segundo "vigente" falso (login ya publicado), :129-135 orden superseded con PayPal como gate, :161-165 voz "no comercial" contra decisión 16 nov; gantt.md:93/:135 vigentes falsos (DigitalOcean); backlog.md:54-56 LV-017 abierto pese a :47, :82-84 vs :119-121 estados de gates sin reconciliar; HANDOFF.md:9/:15 y puente:52/:64-65 no citan la autorización "conecta todo con saldo real" de spec video-text:41/puente:3; LV-001:36 decisiones tomadas bajo "pendientes". Código confirma puente de saldo local sin cablear (server/account/backend.ts:117,147; http.ts:23-38; services en false backend.ts:26). Decisión comercial 0,10/0,20 y redondeo por segundo coherentes en todos los docs vigentes; checkpoint 16 nov no la contradice.
NEGATIVOS: No se revisaron informes históricos extensos, evidencia JSON de outputs, código de worker/UI/gateway, ni configuración cloud; no se ejecutaron pruebas ni consultas gcloud; no se editó ningún archivo; no se verificó despliegue alguno ni la causa de E55; los PASS citados se tomaron de la documentación, no se re-ejecutaron.
BLOQUEOS: (1) readback Cloud Run/IAM efectivo sin conciliar y consulta que no responde; (2) ruta VPC/ingress internal y token Google firmado sin probar; (3) reserva/captura/liberación sin cablear a worker/UI (condición de saldo real incumplible hoy); (4) rewrite/CSP /api/video/** y exposición del gateway sin diff exacto ni negativos online; (5) despacho/UNKNOWN con saldo real sin reconciliación probada comercialmente (E55 abierto, semántica audio no-nulo pendiente).
=== FIN RESUMEN ===
