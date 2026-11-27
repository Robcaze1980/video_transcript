# LV-019.B: titular de bloqueo aplicado en Firestore Emulator

Fecha: 26 de noviembre de 2026. Esta es evidencia focal de la candidata basada en
`613ea52cc3b67ffb520ead9b0530d0ee6b066dcf`, no una batería financiera final ni
una aprobación de producción. La ejecución se hizo una sola vez, después de
que la coordinación revisara el manifiesto y autorizara su inicio.

## Qué se comprobó

La prueba recupera los 27 casos de `fc1fee553646a551ad9a3c5799d9ea81280c65a5`
en la candidata anterior y añade dos casos con cuentas ficticias. El bloqueo
programado para una cuenta pasa de pendiente a aplicado después de que Cuenta
confirma el desbloqueo:

- Si sigue perteneciendo al mismo titular, Video cierra el desbloqueo y una
  consulta posterior obtiene el resultado sin otro cambio.
- Si aparece con otro titular, Video detecta el conflicto y conserva su bloqueo
  y la alerta para revisión. El cambio de titular es una inconsistencia
  introducida por la fixture con privilegios, no un acceso de cliente demostrado.

En ambos controles se verifica una sola llamada mutante a Cuenta, una decisión
registrada, saldo y reserva sin cambios y la segunda cuenta intacta. Cuenta ya
ha confirmado el desbloqueo antes de introducir la inconsistencia; el caso
negativo no prueba una reversión de esa decisión. La salida completa registra
**29/29 pruebas aprobadas**, cero omitidas y **29/29 limpiezas**
([fixture.stdout.tap](fixture.stdout.tap)); el [resultado](result.json)
registra `complete: true`, `pass: true`, raíces iguales y huellas sin cambios.

## Aislamiento y limpieza

Se usaron el proyecto sintético `demo-vistavo-applied-owner`, dos colecciones
exclusivas y una JVM nueva. Antes de iniciar la fixture, el lanzador comprobó
que sus cuatro listeners pertenecían a su PID y a `127.0.0.1`: 8195, 9195,
9295 y el puerto interno efímero 51088. Las dos colecciones estaban vacías
antes y después ([antes](roots-before.json), [después](roots-after.json)). Los
puertos ajenos 8185, 8186 y 8187 mantuvieron sus respectivos PID 33264, 32800 y
22004; al terminar no quedaron los procesos ni los cuatro puertos propios.
Detalles y comprobaciones en [isolation-run.json](isolation-run.json).

La JVM recibió la señal de cierre por nonce y registró el inicio de parada del
servidor WebSocket, pero no salió dentro de 6,5 segundos. El lanzador terminó
por su propio handle únicamente esa JVM (código `-1`); la causa de la demora
no quedó determinada. El emulador también emitió avisos de Java 24 sobre un
método obsoleto usado por Netty ([emulator.stderr.log](emulator.stderr.log)).
No se afirma que la parada haya sido limpia, aunque los listeners propios sí
quedaron libres y los ajenos no cambiaron.

El guard de Node pasó 21 controles negativos, con cero conexiones reales en su
autocomprobación ([guard-green.log](guard-green.log)). Se conserva el
[rojo previo](guard-red.log): se habían añadido tres negativos sin actualizar
el número esperado; se corrigió el contador de 18 a 21 antes de congelar el
manifiesto. Un primer intento de preparar el manifiesto usó Node 22 del PATH y
falló antes de iniciar emulador o fixture; luego se preparó con Node 24 explícito
([resumen](prepare-node22-summary.log)).

Gitleaks 8.30.1 señaló tres coincidencias de `generic-api-key` en el primer
escaneo del staging ([informe redactado](scan-first-redacted.json)). Las tres
son la misma huella SHA-256 de `server/commercial/firebaseAccess.ts` en el
manifiesto y en los registros antes/después; se compararon con el hash calculado
del archivo y coincidieron. Se repitió el escaneo con exclusiones limitadas a
esas tres huellas de hallazgo y líneas concretas
([lista](scan-reviewed-fingerprints.txt)), sin excluir archivos o reglas
completas; el resto del staging quedó incluido.

## Entradas y límites

El manifiesto congelado [manifest.json](manifest.json) tiene SHA-256
`791296696cb688ac1497e3a4eec13b56f0b7ec16fca835f6563212314a4d8a48`.
Node 24.22.3 tiene SHA-256
`66e43517e90be6151a17e2e739f001501a582214938477886281dd31113ffe54`;
el JAR Firestore Emulator 1.21.0 tiene SHA-256
`c3d3680a89d946a90a027365ea14c26c6472a162bcf37f099bbb1ebd66d25e8e`.
El manifiesto incluye las huellas de 68 archivos; el comprobador confirmó las
mismas huellas antes y después. [SHA256SUMS.txt](SHA256SUMS.txt) enumera las
huellas de las copias de evidencia conservadas aquí, sin normalizar sus bytes.

El guard es una precarga de Node, **no un firewall del sistema**; no cubre
esbuild, procesos o módulos nativos ni todas las API. No se fijan con hash todas
las dependencias transitivas ni las comprobaciones anterior/posterior son una
instantánea inmutable. Algunas rutas de proveedor se sustituyen por objetos en
memoria. No se usaron clientes, saldo ni datos reales. La prueba no acredita
todo el comportamiento de la candidata `708c414`, no resuelve los casos de
respuesta incierta o cambio legítimo de generación, y no sustituye la batería
financiera integral, la revisión independiente ni pruebas en la nube.
