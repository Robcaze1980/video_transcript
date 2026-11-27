# Cerco de desbloqueo de Cuenta: prototipo con Firestore local · 27 nov 2026

Candidata local sobre `61e64070c2ac6245caaee8eaad620feb68d9e246`. Se portaron exactamente los blobs de `server/account/backend.ts` y `server/account/unblockFence.test.ts` de `61c54b1`, y se añadieron una fixture de emulador y un arnés enfocado. **No está integrado en Video ni autorizado para producción.** Los tres métodos nuevos exigen `NODE_ENV=test`; dos comprobaciones de marcador de las rutas legadas se aplican también fuera de test.

- **127/127** pruebas de siete archivos y `tsc --noEmit` con Node 24.13.0.
- **3/3** en Firestore Emulator, sin omisiones: recibo anterior antes del cerco; cerco antes de intento anterior tardío; inicio concurrente sin asumir ganador. Las dos primeras pruebas descartan una respuesta ya obtenida; no provocan una pérdida real de red. La tercera se ejecutó una vez, acepta cualquiera de los órdenes y no acredita que se hayan observado ambos.
- Cada cuenta ficticia hizo una reserva de tres segundos mediante `reserveVideo`; se compararon saldos, reservas y asientos de las dos cuentas. Los grants y el ancla se sembraron en el test y no prueban una autoridad real.
- La ejecución comprobó 70 inputs antes y después, guardia de red de Node y raíces sintéticas vacías. El emulador propio no salió a tiempo tras stop por nonce y terminó por su handle (exit -1); los servicios compartidos permanecieron iguales. El guard no es firewall de sistema y los hashes no forman una instantánea inmutable.
- GLM y DeepSeek dieron PASS **solo al prototipo** después de conservar el dictamen INCONCLUYENTE inicial de DeepSeek. GLM revisó además el diff mecánico del arnés. Su primera respuesta degeneró en texto repetitivo y no es una revisión; se conserva completa. Costo y uso por revisión: no medidos.

Siguen pendientes la autoridad real de inscripción y conciliación, permisos/IAM, corte de escritores antiguos, migración/restauración, integración Cuenta↔Video, D2, la guarda de admisión por devolución vencida y la batería financiera aprobada de una candidata completa. El backend no se desplegó. La respuesta de un primer autor del arnés fue cancelada tras anunciar una búsqueda no solicitada; no presentó informe ni cambió archivos de su worktree.

El primer escaneo de secretos identificó tres huellas del archivo `server/commercial/firebaseAccess.ts` dentro del manifiesto y el resultado. Se comparó cada coincidencia con el SHA-256 local y el reescaneo usa solo esas tres excepciones exactas; informe redactado conservado.
