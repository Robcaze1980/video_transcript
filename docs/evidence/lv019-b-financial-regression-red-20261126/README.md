# Regresión financiera interrumpida: evidencia y diagnóstico provisional

Estado: **INCOMPLETA / FALLAS observadas**. Una única ejecución local de la candidata de `0244bfc591368524a4b980312c20c9b53952a532` se interrumpió al repetirse fallos del desbloqueo. No se repitió ni se probó nube o datos reales. El desbloqueo de dos devoluciones sigue sin validarse.

## Evidencia preservada

- `interrupted.tap`: SHA-256 `c4de79f55032b60f8612b92d5f3391e4fbe7982682ed6437883efac6c77da85f`. Contiene 49 líneas `ok`, 34 `not ok`, 0 skips registrados y carece del plan y resumen finales. No equivale a una batería terminada.
- `launcher-receipt.json`: SHA-256 `bef7ed821b0e47e755d290dd2eea3b21e16ad0c78338125dfa87e03562473d59`.
- `roots-before.json`: SHA-256 `5203bfba25237cfe76b139103b63c6975c9786d35b1a368b6354d4d0719f8864`; el inventario previo cubrió las 22 raíces sintéticas previstas y las encontró vacías.
- `fixture.stderr.log`: SHA-256 `cee9b83c4d8e30e3f71ee921f337a604341a8663cb7049c8b1aaf90dc0ff56a2`; el preload de red Node indicó su autocomprobación. No es un firewall de sistema: no cubre esbuild, procesos nativos ni todas las APIs.
- Manifiesto candidato revisado, SHA-256 `0e61f0d7f62d588a77f1315eba69834899d6c37ac1e0cd8ec1728deeb24c2023`; manifiesto del sistema, SHA-256 `a4ca23ed0656e6fd794db7884a440364a0329e44e47d48747c80a1f52a9d0867`. Los originales y demás logs permanecen en `outputs/lv019-b-financial-manifests/`, `outputs/lv019-b-financial-isolation-manifests/` y los dos directorios de corrida nombrados en el recibo.

La JVM propia y el árbol Node fueron terminados mediante sus handles. El cierre por nonce de la JVM no terminó a tiempo y se forzó el proceso propio: `javaStoppedByNonce=false`. El recibo muestra sin listeners los puertos dedicados 8198/9198/9298 y el cuarto puerto 53005; los listeners compartidos 8185–8187 conservaron sus PID. La interrupción impidió el inventario posterior y el `result.json`; **no se puede afirmar limpieza interna de todas las fixtures ni comparar las 22 raíces al terminar**. El almacenamiento del emulador propio ya no está activo.

## Clasificación inicial

1. **26 fallos directos:** `error: conflict` con origen en `billingUnblock.ts:405`. La función exige que el guard tenga una creación posterior al documento inmutable `billingUnblockContinuity/verified-writer-cut-v1`. En la fixture histórica de desbloqueo no se encontró la creación de este documento, mientras que la candidata lo exige desde `708c414`. Esa diferencia es una hipótesis fuerte para esos rechazos; aún no demuestra que todos los casos pasen tras reparar la preparación de la fixture.
2. **8 fallos de aserción:** casos 48, 50, 55, 56, 58, 64, 77 y 78 del TAP. Los casos 48 y 50 esperaban observar mutaciones posteriores; 55 y 56 esperaban una solicitud auditada; 58 contaba llamadas; 64 esperaba una generación auditada; 77 esperaba una auditoría de solicitud y 78 esperaba una caída sintética posterior a la confirmación. El caso 78 contiene internamente el mismo `conflict`, pero su fallo externo es una aserción. No se asigna una causa única a los ocho sin pruebas.
3. Las pruebas históricas 55/56, 64 y 77 emplean mocks sin `unblockReceipt`; algunas esperan además continuar después de un envío cuya respuesta fue incierta. La candidata conserva el reclamo y no autoriza un segundo POST sin conciliación. Se deben actualizar los escenarios al contrato vigente, preservando los controles de saldo, aislamiento y seguridad; no cambiar expectativas solo para obtener verde.

## Foco adicional y límites

En un worktree separado basado en `0244bfc`, se contrastó en memoria el comportamiento con datos sintéticos y una implementación de Cuenta simulada: corte ausente, tardío o recreado no envía POST; corte previo permite una solicitud. **4/4** en ese foco; salida SHA-256 `76839150d386e6b3a6c81ac5f9aa4ca038aec178be45e41b45fbe6d135861a7d`. La red Node estaba restringida. Es una comprobación de lógica simulada: no acredita metadatos reales de Firestore ni sustituye la regresión o pruebas de dinero integradas. Se preservan copias exactas como `memory-focus-source.txt`, `memory-focus-output.tap`, `memory-focus-stderr.log` y `memory-focus-offline-guard.txt`; el script se ejecutó desde `outputs/cut-focus-20261126/` en el worktree de foco, por lo que las rutas relativas de la copia son solo para inspección.

La fixture C1 de voz revisada no está entre las 14; las cinco omisiones previstas son otros casos de worker/recibos de voz y no prueban C1. La condición de C1 ya estaba desactivada en el ambiente de la batería histórica. La presente interrupción no valida voz.

Siguiente paso: preparar en otro worktree un testigo de corte previo y escenarios explícitos de envío incierto sin segundo POST y recuperación por recibo confirmado; pedir revisión de los cambios antes de otra ejecución. No publicar ni declarar la transición financiera terminada con este resultado.
Los archivos de recibos y TAP se guardan sin conversión de fin de línea mediante .gitattributes, para conservar sus hashes. Se examinaron con Gitleaks por separado del diff preparado, además de escanear el staging; los dos reportes redactados no encontraron claves y se conservaron localmente en outputs/lv019-b-financial-isolated-preflight-20261126/. Ningún resultado de seguridad se infiere solo de ese escaneo.
