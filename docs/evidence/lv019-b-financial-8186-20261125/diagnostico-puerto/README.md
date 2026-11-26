# Diagnóstico del puerto local · 25 nov 2026

La batería completa anterior falló en 39 pruebas porque el modo de prueba de `firestoreBackend.ts` exigía `127.0.0.1:8185` y se utilizó un emulador independiente en `127.0.0.1:8186`.

Un primer diagnóstico en una copia adaptada terminó FALLA: 2 aprobadas y 39 fallidas antes de crear las raíces, porque el lanzador no colocó el perfil en la ruta de prueba exigida. Una consulta posterior encontró cero raíces en las tres colecciones sintéticas controladas. Se conservaron el [TAP](fallo-perfil.sanitizado.tap) y el [resultado](fallo-perfil.result.json); SHA-256 del TAP original: `8edef1791a32f002287e949bb2f1c53a1beb0d6860964286daf1e027cc4fc199`.

Tras corregir el lanzador de diagnóstico, el mismo archivo completó **41/41, sin omisiones ni fallos**, con hashes congelados, guardas activas y limpieza informada. [TAP](pase-puerto.sanitizado.tap) · [resultado](pase-puerto.result.json) · [entradas](frozen-inputs.json). SHA-256 del TAP original: `37d883863d1283560b3cd766487b98b8077e32a728303d511abfdec918aedacc`.

**Límite:** esta copia sustituyó **solo en la condición del modo de prueba** `8185` por `8186` en `firestoreBackend.ts`; su hash cambió de `ee37deb1…` a `c7d98de4…`. El lanzador se acotó a ese archivo y a cero omisiones. No se modificó el código del repositorio ni se publicó nada. Este 41/41 confirma el diagnóstico del puerto, pero **no sustituye una batería completa aprobada sobre la versión final**. Las rutas personales se sustituyeron por `<copia>` en los TAP publicados.

Al finalizar, una lectura local encontró cero raíces en las seis colecciones sintéticas comprobadas. Se detuvo únicamente el emulador aislado del puerto 8186; el emulador que ya utilizaba la otra sesión en 8185 permaneció activo.
