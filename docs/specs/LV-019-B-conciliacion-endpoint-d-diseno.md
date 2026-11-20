# LV-019.B · Conciliación de saldo · Endpoint autenticado de la pieza D (DISEÑO, BORRADOR)

**Estado:** diseño del 19 nov 2026, escrito por Codex por delegación del dueño. **Implementado el mismo día como módulo desactivado y NO cableado** (`server/commercial/billingOperatorHttp.ts`; nada lo importa fuera de sus pruebas; ver [recibo del código](../evidence/lv019-b-t3-endpoint-d-codigo-20261119/RECIBO.md)). **Sin ruta publicada, sin cambios de nube.** Cambios respecto al diseño original: la lista admite un único parámetro `?after=<64 hex>` (cursor de páginas de 200, con `truncated` y `next` exactos); un reloj ausente, inválido o que lanza equivale a «desactivado» (404); la frescura de `auth_time` se comprueba en forma positiva (falta, `NaN`, fraccionario, futuro o vencido = `401 reauth_required`); solo `conflict` se traduce a 409. Parte de [fase 2](LV-019-B-conciliacion-fase2-barrido-diseno.md) y de la biblioteca `server/commercial/billingPendingAudit.ts`, que declara estas precondiciones: **autor autenticado en lista permitida (nunca del cuerpo de la petición) y reloj del servidor**. La voz sigue cerrada. Este documento no autoriza activar nada: la ruta solo se implementaría tras revisión T3 y aprobación expresa del dueño.

## 1. Qué problema resuelve
Hoy una persona no puede registrar «yo revisé esta alerta» ni «lo resolví, con esta evidencia» sin tocar la base a mano. La biblioteca ya impone «una sola vez» y deja un registro inmutable, pero **cualquiera con acceso a la base podría atribuir la decisión a otra persona**. El endpoint existe para que el autor lo ponga el servidor, a partir de una identidad verificada.

## 2. Qué existe y qué se reutiliza (evidencia)
- Rutas de usuario: token de Firebase verificado con `checkRevoked` (`server/account/http.ts:3`).
- Rutas internas de servicio: token de Google firmado, audiencia fija y correo verificado en lista permitida (`http.ts:4`, `:35–38`); cuerpos JSON con claves permitidas, límite de tamaño y sin parámetros de consulta (`http.ts:6–14`); origen fijo; respuestas `no-store`.
- Las alertas viven en la base de **Video** (colección `billingPendingAlerts`), así que la ruta pertenece al servicio de Video, no al de Cuenta.

## 3. Diseño propuesto
**Ruta (futura, desactivada por defecto):** `POST /api/operator/billing-alerts/{alertKey}/{acknowledge|resolve}` y `GET /api/operator/billing-alerts` (lista de abiertas) y `GET /api/operator/billing-alerts/{alertKey}`. Sin cookies: solo cabecera `Authorization: Bearer`, lo que elimina la falsificación entre sitios.

**Identidad:** token de Firebase verificado con `checkRevoked`, correo verificado y UID presente en una **lista de operadores que vive en configuración o secreto del servidor, no en el código ni en el cuerpo**. Lista vacía o ausente = la ruta responde 404 (falla cerrado). El dueño decide quién entra; por defecto, solo la cuenta del dueño.

**Autor:** `authorizedBy = 'op-' + primeros 16 hex de HMAC-SHA256(secreto del servidor, 'operator-v1:' + uid)`. Es un seudónimo estable que cumple el patrón de la biblioteca, no expone el UID ni el correo y **no se puede calcular ni verificar sin el secreto** (un hash simple de un UID conocido sí). Si el secreto falta, la ruta responde 404. El secreto debe mantenerse estable: rotarlo cambiaría los autores de registros futuros y rompería la continuidad de la traza (la rotación exige un procedimiento aparte). El cuerpo **no puede** traer autor (la biblioteca ya rechaza claves desconocidas; la ruta además las prohíbe antes de llamarla).

**Reloj:** `nowMs = Date.now()` del servidor; el cuerpo no lo acepta.

**Reautenticación (solo escrituras):** una disposición exige `auth_time` presente y reciente: se acepta solo si `auth_time <= ahora` y `ahora - auth_time <=` la ventana. La ventana es un valor de **configuración obligatorio sin valor por defecto** (si falta, las escrituras responden 404; no se fija un número aquí). Un token sin `auth_time`, con `auth_time` futuro o fuera de ventana responde `401 reauth_required`, y eso solo se revela a quien ya es operador verificado. Las lecturas (GET) exigen operador en lista pero no la ventana, y también fallan cerrado (404) con la lista vacía.

**Cuerpo:** JSON, claves permitidas `evidenceRef` y `note` (y nada más), mismos límites que la biblioteca; `alertKey` solo en la ruta y validado (64 hex). Sin parámetros de consulta.

**Tabla condición → código (sin filtrar estado a quien no es operador):**

| Condición | Código |
|---|---|
| Ruta desactivada, lista de operadores vacía, secreto o ventana (escrituras) sin configurar | `404` |
| Sin token, token mal formado, inválido, revocado o con correo sin verificar | `401` (cuerpo genérico único) |
| Token válido pero UID fuera de la lista | `404` (indistinguible de «ruta desactivada») |
| Operador sin `auth_time`, con `auth_time` futuro o fuera de ventana | `401 reauth_required` |
| `Content-Type` distinto de JSON | `415` |
| Cuerpo con claves desconocidas, `evidenceRef`/`note`/`alertKey` fuera del formato de la biblioteca, o cualquier parámetro de consulta | `400` |
| Límite de frecuencia del operador | `429` |
| Alerta inexistente | `404` (uniforme con lo anterior) |
| Alerta almacenada corrupta | `422` |
| Conflicto (misma alerta y acción, carga o autor distintos; alerta ya cerrada) | `409`, devolviendo el registro existente |
| Creada | `201`; repetición idéntica del mismo autor: `200` con el mismo recurso y autor (seudónimo) |

Ninguna respuesta devuelve UID, correo ni datos de cuenta.

**Registro de acceso:** cada intento (permitido o **rechazado**, incluidos 401/403/404/429) deja una línea estructurada con autor seudónimo cuando existe, acción, `alertKey` ya validada (64 hex) y código; **nunca** el token, el cuerpo, `evidenceRef` ni `note` (pueden contener datos personales), y ningún dato de entrada sin validar se escribe tal cual (se valida o se omite).

**Límite de frecuencia y tamaño:** se reutilizan los mecanismos y valores existentes del servicio, sin inventar números aquí. La clave del límite de escritura es **el operador verificado (hash de su UID)**, no la IP ni el token: rotar tokens no lo elude y una red compartida no lo bloquea. Antes de verificar identidad aplica el límite general del servicio. **Contenido:** `Content-Type: application/json` obligatorio, sin credenciales en la consulta.

## 4. Qué NO hace
No mueve saldo, no edita filas, no llama a Cuenta, no reembolsa y no reabre bloqueos (esa ruta comercial sigue sin existir). `resolve` sigue siendo una **atestación humana** con evidencia, no una corrección.

## 5. Pruebas exigidas a la implementación
1. Sin token, token revocado, correo sin verificar o UID fuera de la lista: ningún efecto.
2. Un `authorizedBy`/`nowMs` en el cuerpo, o cualquier clave desconocida, o `evidenceRef`/`note` con caracteres de control o longitud excesiva, o `alertKey` con saltos de línea o metacaracteres: `400` sin efecto y sin romper el registro de acceso.
3. Dos operadores simultáneos sobre la misma alerta: uno gana, el otro recibe 409 con el registro existente. Envíos idénticos simultáneos del mismo operador: un `201` y el resto `200`.
4. Repetición idéntica = 200 sin escribir; mismo operador con carga distinta = 409.
5. Lista vacía, secreto o ventana sin configurar: 404; token sin `auth_time`, con `auth_time` futuro o fuera de ventana: `401 reauth_required` solo para operadores; el GET también falla cerrado.
5b. El autor derivado no se puede recalcular sin el secreto; el límite de frecuencia se comparte entre tokens distintos del mismo operador.
6. Sin `Origin` de navegador aceptado y sin cookies; respuestas `no-store`.
7. El registro de acceso (incluidas las denegaciones) no contiene token, cuerpo, `evidenceRef`, `note`, UID ni correo.
8. Cuentas, filas y libros intactos tras cualquier llamada; toda rama negativa deja **cero** registros de auditoría nuevos y cero mutaciones (diff antes/después).
9. Toda la tabla condición → código se valida con una prueba por fila.

## 6. Decisiones del dueño (no técnicas)
Quién es operador (por defecto, solo el dueño) y si algún día habrá una segunda persona; y si se autoriza implementar la ruta tras la revisión.

## 7. Gate de salida
Revisión T3 con criterio observable (cada riesgo de §3 traza a una prueba de §5; **criterio adoptado de la revisión:** la tabla condición → código completa se valida con pruebas automatizadas, cero mutaciones en toda rama negativa, exactamente una disposición por alerta y acción bajo concurrencia, y registros sin token, cuerpo ni datos de cuenta), más la aprobación del dueño. Sin código antes.

**Revisión T3 (19 nov):** GLM y DeepSeek ([recibo](../evidence/lv019-b-t3-endpoint-d-20261119/RECIBO.md)); sus huecos están incorporados arriba.
