# Regresión financiera local en puerto 8186 · 25 nov 2026

**Resultado: FALLA, no certifica la versión.** Ejecutó 463 casos: 419 aprobaron, 39 fallaron y 5 omisiones de voz estaban previstas. Los 39 fallos observados son `invalid` en la validación de puerto del modo de prueba de `firestoreBackend.ts:490`: la fuente integrada fija 8185 y el emulador aislado escuchaba en 8186. Esto demuestra una incompatibilidad del arnés; no demuestra 39 defectos de negocio ni autoriza dar por aprobados esos casos. Los dos casos `retry-generation` pasaron bajo su precondición sintética, con limpieza informada de 50/50 contextos.

El lanzador verificó 62 hashes antes y después, Node 24, la lista de omisiones esperadas y la limpieza de las raíces que inventaría. El proceso salió con código 1. Esta ejecución empleó el código de Video y backend con hashes originales `b4909d7b…` y `ee37deb1…`, pero usó copias de instrumentación y fixtures adaptadas al puerto 8186 y una aserción adicional que bloquea 8185. No equivale a una batería aprobada sobre la versión final.

La comprobación de tipos `tsc --noEmit` terminó sin errores en la misma copia. Esta verificación no reemplaza las pruebas financieras ni la revisión de T3.

En una copia separada, con la condición del modo de prueba adaptada a 8186, el archivo afectado pasó **41/41**; esto confirma el diagnóstico del puerto, pero no sustituye la batería completa final. Se conserva también el primer intento del diagnóstico, que falló por una ruta de perfil incorrecta. [Diagnóstico y límites](diagnostico-puerto/README.md).

Archivos: [resultado íntegro](result.json), [TAP con rutas de la PC sustituidas](fixture.sanitizado.tap), [stderr](fixture.stderr.log), [hashes de entradas](frozen-inputs.json). SHA-256 del TAP original: `b001fd9f4e8ab9e5cef252f291f3b079cd73923a9ddb2c6c0aaed08f7017681d`; SHA-256 del TAP con rutas sustituidas: `f45cb3bcfe37fb64bca20c0bae2b6924c683d9f161da6860d2bf64f34bcb5fdd`. Las rutas de la PC se sustituyeron por `<snapshot>` antes de publicar la evidencia.
