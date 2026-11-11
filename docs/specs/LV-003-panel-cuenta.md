# LV-003 · Completar datos del panel del cliente

2026-11-11. Ampliación posterior del backend autorizada expresamente por el propietario durante la integración de Claude Design. Pendiente de implementar y probar; no forma parte del código entregado en [esta candidata de diseño](LV-005-integracion-claude-design.md).

## Alcance siguiente

1. Perfil autenticado mínimo: correo, verificación y métodos vinculados obtenidos de la identidad validada; no aceptar UID o cuenta declarados por el cliente ni fusionar por email.
2. Historial de compras de la cuenta: paquete, moneda USD, importe, referencia pública mínima y estado efectivamente informado. No atribuir fechas o estados que no están almacenados; precisar contrato y migración aditiva si faltan datos.
3. Consumo por trabajo: segundos medidos, reserva, consumo y liberación según movimientos reales. Distinguir reintento de doble cargo y mantener la igualdad entre saldo acreditado, disponible, reservado y consumido.
4. Completar el panel con esos datos y estados vacío/error. Consultas limitadas/paginadas y control de titularidad desde la sesión, sin secretos del proveedor ni datos de otras cuentas.

Cotización previa del servidor, idiomas y última edición del proyecto requieren un contrato específico antes de mostrarlos como datos confirmados. No inventar la cotización a partir del metadato del navegador; no modificar automáticamente el precio ni la cobertura del producto.

## Evidencia de cierre

Dos cuentas aisladas en API y navegador; historial y perfil propios; compra duplicada acredita una vez; dos videos reparten saldo por segundos; trabajo fallido libera una sola reserva; reintento y concurrencia no duplican consumo. Cuenta existente de 50 minutos y proyectos previos conservados. Migración reversible/aditiva, pruebas de errores/sesión revocada y nueva candidata privada antes de cualquier promoción. Sin activar pagos reales, producción o publicación por esta autorización.
