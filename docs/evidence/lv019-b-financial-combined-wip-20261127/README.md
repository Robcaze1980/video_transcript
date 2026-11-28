# LV-019.B: candidata combinada WIP · 27 nov 2026

Se reunieron en una rama aislada el cargador local de reglas, los casos financieros conservados y el ensayo local de confirmación primera Cuenta↔Video. **Esta combinación no ejecutó la batería completa ni está aceptada.** Los ensayos previos fueron en cortes separados: reglas 3/3, confirmación primera 5/5 y foco financiero 5/8 con tres fallos de recuperación incierta. Los cuerpos originales `retry-generation A/B` se compararon con `61e6407` después de combinar y siguen iguales.

La recuperación del sucesor sigue sin implementar y no se permite reenviar por `pending`. IAM, autoridad/emisor y corte real de escritores no están acreditados. No desplegar, habilitar video ni usar saldo real. El estado vigente del plan y la bitácora se mantienen en la rama documental `codex/vistavo-finance-diagnostic-handoff-20261127`.

Las pruebas y runners aquí son locales y usan Firestore Emulator con datos ficticios. Sus manifiestos fijan una revisión anterior y deben regenerarse/adaptarse a un corte congelado antes de ejecutarse desde esta rama. No reutilizar los manifiestos de otra PC.

Sobre `a6f9c3d`, con cuatro ajustes locales de revisión base en los lanzadores, se repitieron los focos: **5/8** financieros (tres fallos de recuperación) y **5/5** de confirmación primera, ambos sin omisiones, con raíces limpiadas y puertos compartidos sin cambios. `tsc --noEmit` pasó con Node 24.13.0. Esto no equivale a la batería completa ni a una revisión dual de la combinación. Se normalizaron finales de línea y se ocultó una huella de `firebaseAccess.ts` tras comprobarla contra el archivo local; los registros originales están en `outputs/`.
