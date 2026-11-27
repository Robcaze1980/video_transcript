# LV-019.B — Candidata local: guarda de Cuenta leída dentro de la transacción que libera Video

## 1. Confirmación por código: `admitVideoCall` sí consulta la guarda de Cuenta

En `admitVideoCall` (Cuenta) la lectura es:

```ts
const [stored,reservation,tomb,guard,call,fence]=await tx.getAll(
  this.root.collection('accounts').doc(accountId),
  reservationRef,
  this.root.collection('videoReservationTombstones').doc(reservationKey),
  this.root.collection('videoBillingGuards').doc(accountId),   // <-- guarda de CUENTA
  callRef,fenceRef);
accountRecord(stored,identityKey);
const blocked=billingHold(guard,accountId,identityKey), ...
...
if(state!=='reserved'||blocked)throw new AccountFault('conflict');
```

- El documento es `AccountStore.root/videoBillingGuards/{accountId}`, es decir la guarda del **lado Cuenta**, no la de Video.
- La guarda de Video es otra: en `unblockBillingAccount` es `root.collection('billingGuards').doc(accountId)` (colección `billingGuards`, raíz de Video). El revisor que la llamó "guarda de Video" confundió la colección homónima `videoBillingGuards` (Cuenta) con `billingGuards` (Video).
- Conclusión: `admitVideoCall` **sí** usa la defensa de Cuenta. Pero eso sólo cubre el camino de **admisión**; no hay evidencia de que `reserveVideo`, `sealVideoReservation`, `settleVideo` ni el propio `unblockBillingAccount` la consulten. Por eso la candidata **no** puede apoyarse en `admitVideoCall`.

## 2. Diagnóstico de la carrera

Secuencia actual del camino fenced (`seam`):

1. `seam.receipt(...)` — snapshot (lectura #1).
2. `seam.confirm`/`seam.reconcile` — Cuenta confirma y, si no quedan incidencias, borra su guarda.
3. Revalidación `seam.receipt(...)` — lectura #2, **fuera** de la transacción.
4. `db.runTransaction(...)` — borra `billingGuards/{accountId}` (Video) y crea `video_released`.

Ventana real: entre (3) y el commit de (4) puede entrar una incidencia nueva en Cuenta. La lectura #2 no la ve, y **una tercera lectura tampoco la cerraría**: siempre queda un intervalo entre la última lectura y el commit. La única forma de cerrarla localmente es leer la guarda de Cuenta **dentro de la misma transacción** que borra la guarda de Video (misma Firestore ⇒ aislamiento serializable de Firestore). El test actual inyecta la incidencia **antes** de la lectura #2 (dentro de `receipt` call #1), por eso pasa sin tocar la carrera.

## 3. Contrato de producción faltante (por qué online es INCONCLUYENTE)

En producción Video y Cuenta son bases y credenciales separadas: una transacción de Video **no** puede leer documentos de Cuenta. Por tanto:

- La lectura in-transaction cruzada es **sólo** un experimento local atestado (`attestLocalEmulatorPair` + misma `Firestore`). **No** se puede afirmar que sirva online.
- El cierre real exige un contrato versionado/condicional de Cuenta que hoy **no existe** (p. ej. que Cuenta ejecute el cierre de Video en su propia transacción con compare-and-swap sobre la versión de su guarda, o que exponga una operación de liberación condicionada a `guardVersion` que Video no pueda saltarse). No se inventa endpoint, IAM ni corte.
- Mientras ese contrato no exista, en producción **Video debe permanecer bloqueado** ante duda. Por eso el resultado global es INCONCLUYENTE (ver §10), aunque la candidata local sea verificable.

## 4. Candidata local — cambios con anclas

### Ancla A — `UnblockDeps` (Video)

```ts
export interface UnblockDeps{
  db:Firestore;root:DocumentReference;
  accountBilling:Pick<AccountBillingClient,'unblock'|'unblockReceipt'>;
  successor?:SuccessorBilling;
  // SOLO experimento local atestado: raíz de Cuenta en la MISMA Firestore.
  // Nunca se define en producción (bases y credenciales separadas).
  localAccountRoot?:DocumentReference;
}
```

### Ancla B — helper de resolución (junto a `successorOf`)

```ts
// Devuelve la guarda autoritativa de Cuenta para `accountId` SÓLO si el seam
// atestigua un par de emulador local sobre la MISMA Firestore. Si no, null
// (sin acceso cruzado) o falla cerrado. No inventa endpoint ni IAM.
function localAccountGuardRef(deps:UnblockDeps,accountId:string):DocumentReference|null{
  const accountRoot=deps.localAccountRoot;
  if(!accountRoot)return null;
  const seam=deps.successor;
  if(!seam)throw new UnblockFault('invalid');                 // sin seam no hay par atestado
  if(!attestedLocalEmulatorPair(deps.db,seam.attestation))throw new UnblockFault('invalid');
  if(accountRoot.firestore!==deps.db)throw new UnblockFault('invalid'); // debe ser la MISMA Firestore
  return accountRoot.collection('videoBillingGuards').doc(accountId);
}
```

### Ancla C — resolver temprano (tras `const seam=successorOf(deps);`)

```ts
const seam=successorOf(deps);
const localGuardRef=localAccountGuardRef(deps,accountId);   // falla cerrado antes de tocar Cuenta
```

### Ancla D — lectura in-transaction en la liberación final

Dentro del `return db.runTransaction(async tx=>{ ... })` final, **después** de `await recheck(tx,observed,pin??undefined);` y **antes** de cualquier escritura:

```ts
await recheck(tx,observed,pin??undefined);

// Lectura autoritativa de Cuenta EN LA MISMA transacción que borra la guarda de Video.
// Si la guarda de Cuenta existe (bloqueo vigente o incidencia nueva) NO se libera Video.
let localAccountBlocked=false;
if(localGuardRef){
  const localGuard=await tx.get(localGuardRef);
  if(localGuard.exists){
    if(localGuard.get('accountId')!==accountId)throw new UnblockFault('conflict'); // referencia falsa
    localAccountBlocked=true;
  }
}
```

Y ajustar el cálculo de `clear` (una sola línea):

```ts
const clear=!account.blocked&&rivals.length===0&&!localAccountBlocked;
```

El `done` sigue creándose con `videoBlocked:!clear`; añadir `localAccountBlocked` al registro `done` como evidencia (campo aditivo, no rompe aserciones existentes).

### Ancla E — lectura in-transaction en el replay parcial

Dentro del `if('partial' in opened){ ... return db.runTransaction(async tx=>{ ... }) }`, tras `await recheck(tx,observed,releasePin??undefined);`:

```ts
await recheck(tx,observed,releasePin??undefined);

if(localGuardRef){
  const localGuard=await tx.get(localGuardRef);
  if(localGuard.exists){
    if(localGuard.get('accountId')!==accountId)throw new UnblockFault('conflict');
    return {unblocked:true as const,replayed:true as const,accountBlocked:true,videoBlocked:true,
      advanced:Array.isArray(record.advanced)?record.advanced.map(String):[],auditId:String(record.auditId)};
  }
}
```

Nota de coherencia: la lectura es **sólo lectura** y ocurre antes de cualquier escritura de la transacción (requisito de Firestore). No se elimina ni debilita ninguna comprobación previa (`recheck`, `rivals`, `account.blocked`, generación, `pin`).

## 5. Fixture — `fencedDeps`

```ts
return {db:c.db,root:c.root,accountBilling:c.accountBilling,successor:seam,localAccountRoot:c.accountRoot};
```

`attestation` ya se crea con `attestLocalEmulatorPair(c.db,c.db)` y `c.accountRoot` vive en la misma `c.db`. Sin este campo, `localAccountGuardRef` devuelve `null` y el comportamiento previo queda intacto (control negativo natural).

## 6. Pruebas

### Test 1 — primera finalización, incidencia DESPUÉS de la última lectura y ANTES de la transacción Video

```ts
test('successor stale Account clear: an incident AFTER the last receipt and BEFORE the release keeps the Video guard',{timeout:180000},async()=>{
  const blocked=await blockedAccount('successor_post_receipt_clear'),c=blocked.c,body=await request(c,blocked);
  const seeded=await seedFencedSuccessor(c,blocked);
  const base=fencedDeps(c,seeded);
  let receiptCalls=0;
  const stale={...base,successor:{...base.successor,async receipt(input){
    const value=await base.successor.receipt(input);receiptCalls++;
    if(receiptCalls===2){
      // La ÚLTIMA lectura de recibo ya devolvió blocked:false. Una incidencia NUEVA
      // de Cuenta entra después de esa lectura y antes de la transacción de Video.
      assert.equal((await c.accountBilling.block(c.identity,accountHoldId('outbox',randomUUID(),1,1))).created,true);
    }
    return value;
  }}};
  const before=await c.store.videoBalance(c.identity);
  const result=await unblockBillingAccount(stale,c.account,body,'operator-ana',9_500_002_000);
  assert.equal(receiptCalls,2,'one snapshot and one pre-release revalidation');
  assert.equal(result.videoBlocked,true,'the post-receipt incident never releases Video');
  assert.equal((await guardOf(c).get()).get('blocked'),true,'the Video guard survives');
  assert.equal((await c.root.collection(UNBLOCK_AUDIT_COLLECTION).where('action','==','video_released').get()).size,0);
  const done=await c.root.collection(UNBLOCK_AUDIT_COLLECTION).where('action','==','unblocked').get();
  assert.equal(done.size,1);assert.equal(done.docs[0].get('videoBlocked'),true);
  assert.deepEqual(await c.store.videoBalance(c.identity),before,'no balance moved');
});
```

Sin la candidata, esta prueba **falla** (`videoBlocked:false`, aparece `video_released`): es el control que demuestra que la carrera existe y que la lectura in-transaction la cierra.

### Test 2 — replay parcial, incidencia DESPUÉS de la última lectura

```ts
test('successor partial replay: an incident AFTER the last receipt and BEFORE the release keeps the Video guard',{timeout:180000},async()=>{
  const blocked=await blockedAccount('successor_partial_post_receipt'),c=blocked.c,body=await request(c,blocked);
  const seeded=await seedFencedSuccessor(c,blocked);
  const base=fencedDeps(c,seeded);
  // Primera llamada: Cuenta confirma pero se pierde el ACK -> done(videoBlocked:true), guarda sobrevive.
  let confirms=0;
  const lossy={...base,successor:{...base.successor,confirm:async input=>{
    const value=await base.successor.confirm(input);
    if(input.attempt==='previous'&&++confirms===1)
      throw Object.assign(new Error('lost ACK after Account commit'),{code:'unavailable'});
    return value;}}};
  await assert.rejects(unblockBillingAccount(lossy,c.account,body,'operator-ana',9_500_003_000),
    error=>error instanceof UnblockFault&&error.code==='unresolved');
  assert.equal((await guardOf(c).get()).get('blocked'),true,'partial: Video guard survives');
  // Replay: la ÚLTIMA lectura devuelve clear y luego entra una incidencia nueva antes de la transacción parcial.
  let receiptCalls=0;
  const stale={...base,successor:{...base.successor,async receipt(input){
    const value=await base.successor.receipt(input);receiptCalls++;
    if(receiptCalls===2)
      assert.equal((await c.accountBilling.block(c.identity,accountHoldId('outbox',randomUUID(),1,1))).created,true);
    return value;
  }}};
  const before=await c.store.videoBalance(c.identity);
  const result=await unblockBillingAccount(stale,c.account,body,'operator-ana',9_500_003_500);
  assert.equal(receiptCalls,2);
  assert.equal(result.replayed,true);
  assert.equal(result.videoBlocked,true,'the post-receipt incident never releases Video on replay');
  assert.equal((await guardOf(c).get()).get('blocked'),true);
  assert.equal((await c.root.collection(UNBLOCK_AUDIT_COLLECTION).where('action','==','video_released').get()).size,0);
  assert.deepEqual(await c.store.videoBalance(c.identity),before,'no balance moved');
});
```

### Test 3 — aislamiento: otra cuenta no cambia

Dentro del wrapper, tras inyectar la incidencia, capturar la guarda de Cuenta; al final comparar:

```ts
// tras c.accountBilling.block(...) en el wrapper:
const accountGuardsAtInjection=await c.accountRoot.collection('videoBillingGuards').get();
// tras la corrida:
const accountGuardsAfter=await c.accountRoot.collection('videoBillingGuards').get();
const ids=s=>[...s.docs].map(d=>d.id).sort();
assert.deepEqual(ids(accountGuardsAfter),ids(accountGuardsAtInjection),'no other Account guard appears/disappears');
for(const d of accountGuardsAfter.docs)
  assert.deepEqual(d.data(),accountGuardsAtInjection.docs.find(x=>x.id===d.id).data(),'no other Account guard changes');
```

Si el fixture permite aprovisionar una **segunda cuenta** en el mismo contexto `c`, sustituir esto por: capturar la guarda y el saldo de la segunda cuenta antes/después y afirmar igualdad estricta. El punto es el mismo: la liberación de `c.account` no toca ninguna otra cuenta.

## 7. Controles negativos

- **Carrera real:** correr Test 1/2 contra la función **sin** la lectura in-transaction (o `localAccountRoot:undefined`) y verificar que fallan (`videoBlocked:false`, existe `video_released`). Documenta que la ventana existe.
- **Referencia falsa:** con `localAccountRoot` apuntando a una guarda cuyo `accountId` no coincide, la transacción debe abortar con `UnblockFault('conflict')` y **no** liberar.
- **Seam falso/ausente:** con `localAccountRoot` definido y `successor` ausente, `localAccountGuardRef` lanza `UnblockFault('invalid')` **antes** de llamar a Cuenta (sin efectos).
- **Firestore distinta:** si `accountRoot.firestore!==deps.db`, `UnblockFault('invalid')` (no se finge atomicidad).
- **Regresión:** los tests previos (incluido `successor stale Account clear` actual) deben seguir pasando; no se quita ni debilita ninguna aserción.

## 8. Camino legacy sin seam

`deps.accountBilling.unblockReceipt`/`unblock` no tiene `seam`, luego no hay par atestado y `localAccountRoot` **no** debe definirse (si se define sin seam ⇒ `invalid`). Consecuencia: el camino legacy **no** recibe la lectura in-transaction y **mantiene la carrera**. Debe evaluarse y declararse: queda **bloqueado/INCONCLUYENTE** hasta que exista el mismo contrato versionado de Cuenta. No se le aplica la técnica cruzada porque no hay attestation que la autorice.

## 9. Pasos de prueba

1. Aplicar Anclas A–F.
2. Añadir Test 1, Test 2 y Test 3.
3. Ejecutar el runner del repo filtrando por `successor` (p. ej. `npm test -- --test-name-pattern "successor"`, o `node --test <archivo>`), con `NODE_ENV=test` y `FIRESTORE_EMULATOR_HOST` apuntando al emulador local.
4. Verificar: Test 1 y 2 pasan; Test 3 pasa; el test stale previo sigue pasando; sin `video_released` en los casos con incidencia post-lectura.
5. Control negativo: repetir Test 1 con `localAccountRoot:undefined` y confirmar el fallo (carrera) antes de restaurar.

## 10. Bloque final

=== RESUMEN FINAL ===
RESULTADO: INCONCLUYENTE
EVIDENCIA: Confirmado por código que `admitVideoCall` lee `AccountStore.root/videoBillingGuards/{accountId}` (`billingHold(guard,...)`), guarda de Cuenta, no de Video (`billingGuards`). Diagnóstico: la revalidación `seam.receipt` fuera de la transacción no cierra la ventana entre la última lectura y el commit que borra `billingGuards/{accountId}`. Candidata local propuesta con anclas: `UnblockDeps.localAccountRoot` (sólo par atestado), helper `localAccountGuardRef` (rechaza seam ausente, Firestore distinta y `accountId` falso), lectura in-transaction de la guarda de Cuenta en la liberación final (Ancla D, `clear=!account.blocked&&rivals.length===0&&!localAccountBlocked`) y en el replay parcial (Ancla E); fixture `fencedDeps` añade `localAccountRoot:c.accountRoot`. Tests propuestos: incidencia DESPUÉS de la última lectura de recibo y ANTES de la transacción Video (primera finalización y replay parcial), con Video cerrado, guarda superviviente, `video_released`=0, saldo intacto y aislamiento de otra cuenta. No medido: no ejecuté pruebas (sin herramientas); Codex debe correrlas. La técnica cruzada es sólo experimento local atestado (misma Firestore, raíces separadas); no se afirma validez online.
NEGATIVOS: No verificado en ejecución (sin herramientas). No demostrado que todos los caminos productivos (`reserveVideo`, `sealVideoReservation`, `settleVideo`) consulten la guarda de Cuenta; `admitVideoCall` sólo cubre admisión. No probado el caso concurrente durante la transacción (la prueba inyecta antes de la transacción; Firestore daría aislamiento/retry, pero no se midió). Camino legacy sin seam queda sin la defensa y con la carrera abierta. No se puede afirmar que la lectura cruzada funcione en producción.
BLOQUEOS: Falta el contrato de producción versionado/condicional de Cuenta (p. ej. cierre de Video ejecutado por Cuenta con compare-and-swap sobre la versión de su guarda, o liberación condicionada a `guardVersion`) que haga atómico el borrado de la guarda de Video respecto de la guarda de Cuenta; hoy no existe y no se inventa endpoint/IAM/corte. Sin ese contrato, en producción Video debe permanecer bloqueado y el resultado sigue INCONCLUYENTE. El camino legacy sin seam requiere el mismo contrato.
=== FIN RESUMEN ===
