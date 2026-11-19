# LV-019.B · Índices de Account · 18 nov 2026

**Resultado: presentes y READY en la lectura de solo consulta.** Se ejecutó `gcloud firestore indexes composite list` para el proyecto `vistavo-prod` y la base `vistavo-live`, sin crear ni modificar recursos. El resultado incluye dos índices; cada uno coincide exactamente en colección, alcance y campos con [el manifiesto de Account](../../deploy/google-cloud/account.indexes.json):

- `projects`: `ownerAccountId` y `deleted` ascendentes, `createdAtMs` y `__name__` descendentes.
- `ledgerEntries`: `ownerAccountId` ascendente, `createdAtMs` y `__name__` descendentes.

La respuesta y el error estándar se conservaron en `outputs/lv019-b-direct-status-design-20261117/account-index-readback-20261118.json` y `account-index-readback-20261118.err`. La consulta terminó con código 0 y los dos índices están `READY`.

La verificación respalda las consultas paginadas actuales de Account. No prueba permisos efectivos de la identidad del gateway, conectividad, latencia bajo carga, otras consultas o índices de la base de video. Tampoco acredita que el código candidato de lecturas transaccionales esté desplegado.
