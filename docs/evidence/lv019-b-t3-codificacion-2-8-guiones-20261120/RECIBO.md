# Recibo · Pasos 2.1 y 2.8 (preparación) · Guiones sintéticos de la escucha nativa · 20 nov 2026

**Veredicto de Codex (certificación final): CERTIFICADO como material de escucha**, con los límites del final. Redactó y programó T3 (hilo «2.8 guiones sintéticos de escucha», tres rondas); revisó de forma independiente T3 con `~z-ai/glm-flash-latest` (FALLA en la versión de la ronda 2; los hallazgos reales se aplicaron en la ronda 3); Codex leyó **todos** los guiones en español y los de inglés, ejecutó el validador y sus pruebas y le lanzó 19 entradas adversarias propias. Nada se generó con un proveedor: son textos; **ninguna muestra de audio existe todavía**.

## Qué se entrega

- `docs/reviews/LV-019-B-voz-guiones-escucha-20261120/guiones.json`: **32 guiones sintéticos**, 16 por idioma (12 cortos, uno por tema del protocolo §2; 2 largos de 60 a 90 s; 1 extendido de unos 3 minutos con listas, párrafos y cambios de tema; 1 control negativo con `referenceText` que difiere del audio en **una sola cifra**, 4,250 frente a 4,258, nombrada en `knownDifference`). Todo es inventado: personas, empresas, marcas y direcciones ficticias; sin datos de clientes. Cada guion lleva `expectedTokens` (cifras, fechas, importes, porcentajes y horas) para la prueba mecánica de fidelidad.
- Español **neutro latinoamericano** (decisión del dueño del 20 nov): trato de usted, sin voseo ni «vosotros», sin modismos de un país, dinero en dólares, léxico del oficio sin calcos. Los guiones en español **no son traducciones literales**.
- `scripts/validateListeningScripts.mjs` y `scripts/validateListeningScripts.test.ts` (46 pruebas): esquema, conteos, ventanas de palabras, ids únicos, tokens esperados presentes, control negativo con exactamente una cifra distinta, voseo y regionalismos (lista cerrada), monedas locales, datos personales (correo, teléfono, URL, tarjeta), marcas reales, `a. m.` con espacio y texto dañado (mojibake). El validador nunca imprime el contenido de un guion.

## Evidencia

| Prueba | Resultado |
|---|---|
| `npx tsc --noEmit` (T3) | exit 0 |
| `npx vitest run scripts/validateListeningScripts.test.ts` (copia en el árbol principal) | **46/46** |
| `node scripts/validateListeningScripts.mjs guiones.json` | `ok: true`, 0 violaciones, 16 + 16 guiones |
| Mutaciones de T3 sobre el validador | 14/14 detectadas, archivo restaurado idéntico |
| **Entradas adversarias propias de Codex (caja negra, 19)** | **19/19 detectadas, sin filtrar contenido**: voseo con y sin tilde, «vosotros», regionalismo, moneda local, correo, teléfono, URL, marca real, tarjeta, guion demasiado corto, token esperado ausente, control negativo con dos cifras distintas y sin diferencia, id duplicado, campo faltante, 11 cortos en español, mojibake, `a. m.` con espacio |
| Lectura de Codex de los 16 guiones en español y los 16 de inglés | Calcos hallados y corregidos (ver abajo); escaneo propio de voseo, regionalismos y monedas limpio |

## Adjudicación

**Lectura de Codex (ronda 2):** «calendario» como cronograma, «patio» como almacén del proveedor, «sostener el precio», «hojas de madera», «otra historia», «condado», «retiro» como *tear-off* (puede entenderse como jubilación), «cuadrado» como unidad, y en inglés `a. m.` con espacio y nombres españoles sin diacríticos (el guion de nombres existe para probar su pronunciación). **Todo adoptado.**

**Revisión GLM (13 hallazgos, FALLA):** adoptados los calcos reales (cumple con el código, clasificación contra incendios, imán para recoger clavos, gotera, fecha, oxidado por completo, sujeta a las condiciones, aun así, fue causado por, `R-38`, `UV-rated`, `the date`). **No adoptados, por decisión de Codex:** «remate» para el *flashing* y «vertiente» para la cara del techo (términos de oficio usados en la región; ambos quedan marcados en `notes` para confirmarlos en la escucha) y «campana suelta» (introduce una palabra más ambigua).

## Límites declarados

- Los guiones son textos: **no verifican pronunciación ni prosodia**. El juicio final es la escucha nativa (rúbrica §3 del protocolo), y la neutralidad del español la confirma el oyente nativo; la lectura de Codex y el validador solo la filtran.
- El separador decimal (punto) y de millares (coma) sigue la convención de EE. UU. y México; en otros países se usa lo contrario. El texto de escucha lo fija así a propósito: **cómo lee la voz «4.5» y «12,500» es parte de lo que se evalúa** y puede obligar a normalizar cifras en palabras (protocolo §4).
- `desmontaje` (*tear-off*), `remate`, `vertiente` y `claraboya` son elecciones de oficio revisables en una línea por guion.
- El validador compara texto, no audio; la prueba mecánica de fidelidad con transcripción automática llega con las primeras muestras (paso 4.3b, dentro del tope de US$5, previo permiso del dueño en la prueba controlada).
