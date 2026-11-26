# LV-019.B · D2 · Recibo de la revisión de posimagen de la cerca A-3

**D2 sigue abierto.** Corte de diseño y contrapruebas del 26 de noviembre de 2026 sobre `f78ef9839173b14248ad12d957901b35242b6730`. Los dos positivos pendientes son la admisión con ACK y la cerca de otro drenador. La fase escritora previa pasó cuatro casos de emulador. Este corte añade cinco pruebas unitarias con datos ficticios y conserva el tratamiento vigente de las observaciones inciertas. [Diseño de posimagen](../../specs/LV-019-B-posimagen-cerca-A3.md) · [Recibo de la fase escritora](../lv019-b-d2-writer-20261126/README.md)

| Límite de la evidencia disponible | Qué comprobó la prueba |
|---|---|
| Ausencia interrumpida | Crear y borrar un guard sintético deja intactos los documentos y las 14 versiones visibles al lector. El replay conserva una sola incidencia. |
| Posimagen sin versión certificada | Cambiar y restaurar la planificación de la intención altera su propia versión. El contenido previsto y el recibo del escritor siguen coincidiendo. |
| Continuidad del titular entre bases | Ante una reasignación sintética A→B→A, el método real de lectura de Cuenta devuelve la misma tupla al principio y al final. La lectura intermedia falla. Video carece de la generación de titular de Cuenta. |
| Segundos de la respuesta original | El cliente valida tres segundos. Si la respuesta se pierde antes de registrarse, otro intento puede guardar dos segundos en su propio recibo. La solicitud original conserva únicamente su expectativa de dos. |
| Recuperación tras reinicio | El reintento posterior al commit devuelve `transitioned:false`. Solo existe una cerca y la respuesta del intento tardío sigue ausente. |

**Verificación local.** Pasaron **121/121 pruebas en ocho suites**, así como TypeScript sin emisión y las comprobaciones de sintaxis de la unidad modificada y de la fixture A-3. El log de unidades tuvo SHA-256 `4f60b9b86fc5e8ac1c2cd25ddbe28c73185398075f9e96fdaeb96387973fbcde`. Las nueve pruebas D2 anteriores de emulador conservan sus aserciones; esta fase no las ejecutó. Los ensayos nuevos ejercitan almacenamiento transaccional en memoria. [Contrapruebas](../../../server/commercial/a3FenceReceipt.test.ts#L137)

Para habilitar el reconocimiento faltan la respuesta recuperable por id del intento original, un comprobante protegido de la versión de poscommit, la continuidad de dependencias ausentes y del titular entre Cuenta y Video, las carreras positivas, la regresión financiera y las revisiones independientes. La rama conserva el diseño y las pruebas para esa revisión.
