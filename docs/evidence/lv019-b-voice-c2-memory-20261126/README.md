# LV-019.B · Ensayo en memoria del fragmento C2

Preparación aislada del 26 nov 2026, sobre `c8939327682d88ac737652448743e1068fc359a9`. **No integra ni habilita voz para clientes.** El puente solo se habilita en pruebas, utiliza un lector y una admisión simulados y guarda los bytes en memoria. No ejecuta un proveedor ni guarda audio.

La implementación verificó **216 pruebas en seis archivos** y TypeScript; la coordinación repitió de forma independiente las **15 pruebas** de `reviewedVoiceFragment.memory.test.ts`. Se cubrieron el apagado predeterminado, bytes del canon, dos lecturas, un recibo nuevo, `receiptOnly`, fallos de respuesta, repetición y concurrencia dentro de una sola instancia. La copia de los registros de la segunda ejecución está en `%TEMP%/vistavo-c2-memory-bridge-20261126.log`, fuera de Git.

La autoridad de la lectura C1 es una dependencia simulada: falta un adaptador que demuestre con datos persistidos la versión del marcador original y la reserva. La cerca en memoria no sobrevive a un reinicio ni coordina varias instancias. Faltan emulador integral, recuperación durable, generación de audio, saldo completo, acceso privado y pruebas físicas en teléfono. Ninguno de esos puntos se demuestra por las unitarias.

| Archivo | SHA-256 |
| --- | --- |
| `server/commercial/reviewedVoiceFragment.memory.ts` | `0295824590303bed38b198bd4d584c0f3e599f160e3526a3149d0decf0023f47` |
| `server/commercial/reviewedVoiceFragment.memory.test.ts` | `ae9804ee6711ba50cd76bbdc65f982dfd17ab3556524691a971659f6707d953f` |
