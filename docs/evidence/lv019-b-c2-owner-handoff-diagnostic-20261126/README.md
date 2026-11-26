# LV-019.B C2 · Diagnóstico local de cambio de titular antes de admitir

Base 975ce3edb894239efacd00ca53ea20d532093574. Solo se agregó una prueba de dos variantes a reviewedVoiceFragment.memory.test.ts. El receptor y AccountStore son los originales. El puerto de lectura C1 usa una proyección sintética y el almacenamiento de Cuenta es un doble en memoria con forma transaccional.

## Precondición y resultado

La prueba parte de una lectura válida de A. Una barrera detiene el puerto justo antes de invocar la transacción de admisión de Cuenta. En ese punto una escritura de fixture reasigna al mismo UID de A hacia B. Ambas cuentas se sembraron con ese mismo identityKey. La variante roja presupone además una reserva B en su propio espacio con el mismo UUID, segundos y estado reservado. Esa precondición requiere un escritor privilegiado que cambie el vínculo o un protocolo futuro que permita el remapeo. El proyecto no muestra una ruta de cliente para producirla. La lectura que sigue a la respuesta devuelve null porque cambió el vínculo.

- Sin una reserva B compatible, el control termina en unknown sin recibo ni escrituras de Cuenta.
- Con ambas reservas compatibles, falló la última aserción. Cuenta escribió la admisión, el recibo y la cerca de B. Antes del fallo se comprobó unknown, ausencia de bytes, ningún reintento de admisión, saldo de A y B intacto, ningún asiento y reserva de A intacta. No se alcanzó un proveedor ni se ejecutó la fixture de emulador.

El ensayo confirma la frontera en memoria. No acredita una explotación por clientes, concurrencia real ni un movimiento de saldo. El contrato que se conecte a producción debe vincular la admisión al titular y vínculo verificados en la transacción que escribe el recibo. La relectura posterior puede impedir entrega y no retira una admisión ya escrita.

## Semántica de la puerta

El contrato de fragmento exige bloquear efectos cuando falla la puerta. No prescribe la misma etiqueta para todas las condiciones. NODE_ENV y LV_VOICE_C2_MEMORY_TEST son la puerta del puente y producen disabled antes de leer. El adaptador amplía la puerta con LV_VOICE_C2_FIXTURE, C1, contrato, destino y vínculo de objetos. Al cerrar esa puerta, el puerto devuelve null sin leer. Un receptor sin entrada devuelve rejected y el mismo receptor con solicitud pendiente exacta puede devolver unknown. La prueba de puerta del adaptador contempla rejected en un receptor nuevo. La frase del recibo de 975ce3e sobre disabled debe referirse a la puerta del puente.

## Prueba y recibos

La corrida focal con el guard de Node activo registró 1 aprobada, 1 falla deliberada y 37 omitidas por el filtro. stdout SHA-256 33fe2f6373302d8c498a0b06c890ea2f5c3356d82f60f5652a4388f7bbbd8ad9. stderr SHA-256 df9c85f8fde3a4de00581718d117014a296136fe76a7d42c7c6c4e10d857ea58.

Los recibos completos quedaron en outputs/lv019-b-c2-owner-handoff-diagnostic-20261126/focal-ip/. Dos intentos anteriores del arnés no arrancaron ninguna prueba. Uno no resolvió la ruta de preload de Windows y el otro bloqueó la resolución de localhost durante el arranque de Vite. Los dos se conservaron por separado. La ejecución focal usó el literal de loopback para que Vite no intentara DNS y mantuvo el guard que bloquea red.
