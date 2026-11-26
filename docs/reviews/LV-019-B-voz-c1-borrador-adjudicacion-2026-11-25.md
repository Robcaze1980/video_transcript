# Voz C1 · borrador y siguiente encargo · 25 nov 2026

**Estado: pendiente; no implementar este borrador como está.** GLM recibió una solicitud de planificación por T3 y devolvió [su informe completo](LV-019-B-voz-c1-borrador-GLM-T3-2026-11-25.txt). Su revisión de seguimiento falló con HTTP 402 sin respuesta final. La atribución del informe «No se invocó T3» es incorrecta: el encargo se envió por T3; el modelo efectivamente servido y el costo no se midieron.

El borrador propone una colección nueva `voiceReservations`, registra `reserved` antes del ACK de Cuenta y deja fuera los puntos existentes de entrada. Esas decisiones no se aceptaron. El código ya tiene `voiceBindingInTransaction` para vincular la revisión, además de `beginExternalBillingIntent`, `prepareExternalReserveAttempt` y un ACK durable para el flujo de reserva. Su reutilización y compatibilidad exactas deben contrastarse con el código y las pruebas actuales; no hay una transacción única entre las bases separadas de Cuenta y Video.

## Encargo preparado, todavía no enviado

Cuando se aclare el consumo y se resuelva la cola de T3, continuar C1 en un worktree separado y leer primero `AGENTS.md`, `MASTERPLAN.md`, `HANDOFF.md` y las especificaciones de voz y revisión. Identificar el código y los hashes actuales antes de modificar nada. La propuesta debe vincular la voz a la traducción revisada y a la duración cobrable del video fuente, reutilizar el protocolo de Cuenta y distinguir intención preparada, reserva realmente confirmada y resultado desconocido. La capacidad debe permanecer apagada por defecto, sin proveedores reales ni despliegue.

Preparar pruebas sintéticas para dos cuentas, saldo insuficiente, texto o revisión alterados, confirmación perdida y reintentos sin cargo duplicado. La implementación financiera requiere revisión independiente de GLM y DeepSeek y regresión completa. No integrarla ni abrirla a clientes antes de cerrar las dependencias de saldo del plan; la selección de voz, la presentación de precio y las pruebas en teléfonos físicos conservan sus pasos posteriores. La tarifa decidida es texto US$0.10/min más voz opcional US$0.10/min.

Para evitar otra repetición, el encargo debe ser acotado, llevar archivos y criterio de aceptación y seguir la regla de detección de bucles de `AGENTS.md`. No se debe reenviar automáticamente el seguimiento fallido ni cambiar modelos, credenciales o presupuestos.
