# LV-007 · Prototipo local de ledger Firestore · 13nov2026

La comparación y el informe de Techos aportado por Rob justifican un ensayo local reversible dentro del avanza de construcción/revisión del backend. No equivale a aprobar migración remota: PostgreSQL y la web actual permanecen intactos; Rob conserva la elección de arquitectura/cutover y publicación. Las propuestas de aprobación de cada experimento de los revisores no sustituyen la autorización vigente ni crean un permiso adicional para tareas locales reversibles.

Alcance: módulo experimental sin conectar a la aplicación, SDK Admin existente y emulador oficial Firestore ligado a127.0.0.1:8185, proyecto demo-vistavo-ledger sin recursos reales. Guardas impiden ejecución sin ese host y proyecto. Sin claves nuevas, ADC, Cloud SQL, base Firestore alojada ni cambios en Techos.app.

Criterios: compra verificada repetida no duplica saldo; mismo recibo con cuenta/datos distintos rechaza; reserva concurrente no excede saldo; request key estable con payload distinto rechaza; una resolución terminal captura o libera una vez; callback repetido no duplica dinero; UNKNOWN conserva reserva y bloquea repetición; reconciliación con evidencia una vez; TTL/reconciliación tardía devuelve reserva; fencing de intento/lease; cancel queued libera/running cuarentena; métodos de trabajo rechazan cuenta ajena. Conservar credited=available+reserved+consumed y enteros seguros no negativos.

El prototipo no demuestra autorización HTTP/Firebase, reglas de cliente para datos reales, provider idempotency, workers, outbox/dispatch, archivos GCS, TTL físico, restore ni costos reales. No usa proveedores/pagos/red externos dentro de transacciones. El emulador comprueba semántica local, no factura ni contención equivalente a producción. Las325pruebas PostgreSQL no se cuentan como cobertura Firestore.

Evidencia nueva separada: Node test driver sin skip, emulador oficial, recibos/logs y contraste DeepSeek/Kimi; Gemini Batch revisa integración y recomendación para decisión posterior. No modificar precios comerciales, saldo real ni cuenta de facturación. Si falta emulador, falla cerrado; no cae a proyecto real.


## Ejecución y límites declarados

Node usado24.13.0 con loader tsx existente, no Node18. Java24 y CLI15.19.1 arrancan emulador oficial1.21.0. El máximo3trabajos activos es el límite técnico del piloto heredado, no un tope monetario. El constructor experimental sólo se alcanza mediante factory que fija proyecto demo y host loopback; el SDK instalado no expone projectId público tipado y no se usa ese getter sugerido por DeepSeek. Los campos de cuarentena/conciliación están declarados en Job.

Desde la raíz, con el emulador ya en marcha:

```powershell
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8185'
& "$env:LOCALAPPDATA/LinguistVision/tools/node-v24.13.0-win-x64/node.exe" --import tsx --test outputs/vistavo-firestore-prototype/ledger-check.mjs
```

Para arrancar sólo el emulador (sin deploy ni recursos alojados), usar la CLI existente con emulators:start --only firestore --project demo-vistavo-ledger --config outputs/vistavo-firestore-prototype/firebase.json --non-interactive. RequiereJava21o superior. Los19tests se ejecutan sin skips; ausencia de host/emulador falla, nunca recurre a producción. No se equiparan sus tiempos de ejecución a latencia productiva.
