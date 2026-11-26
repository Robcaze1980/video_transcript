# LV-019.B · Atribución de alertas de guard

**26 nov 2026. Candidata local, sin desplegar.** GLM detectó que una guardia almacenada bajo el ID de una cuenta podía incluir el ID de otra y generar una alerta atribuida a esa otra cuenta. El reporte conserva ahora la fila como malformada sin atribuirle dueño si los dos identificadores no coinciden. Una alerta malformada anterior puede retirar su pista obsoleta sin modificar disposición ni recibos de auditoría.

- La unidad reprodujo el error antes del cambio. La prueba en emulador con dos cuentas sintéticas también quedó en rojo: `vistavo-finance-diagnostic-20261126/outputs/lv019-b-financial-runs/run-5b14a010-b5e8-466a-971b-8ebe8f87b78b/fixture.stdout.tap`.
- La corrección y los controles de regresión D3 pasaron **3/3** en emulador: `vistavo-finance-diagnostic-20261126/outputs/lv019-b-financial-runs/run-abee5529-026f-4b7e-b17c-c29bdfa30aff/fixture.stdout.tap`. El puerto adaptado fue 8187 y el proyecto era sintético.
- En el checkpoint pasaron **75/75** pruebas unitarias relacionadas y tipos. La prueba conserva la alerta previa auditada y comprueba que la cuenta ajena no recibe guard, hold ni movimiento.
- Falta la regresión financiera integral y la revisión externa de la combinación final. Coincidir ID y campo en la guardia es una comprobación de consistencia; por sí sola no demuestra toda la historia de propiedad.

Los archivos bajo `outputs/` son locales e ignorados por Git; no viajan a otra PC. [Informe original de GLM](../../reviews/LV-019-B-saldo-sondeo-GLM-20261126.txt) · [Adjudicación local](../../reviews/LV-019-B-sondeo-adjudicacion-local-20261126.md).
