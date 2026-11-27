**Diagnóstico**

- **Casos 9, 15 y 21 — causa del fixture.** `LocalAccountTransport` aplica `fencedConfirm`/`fencedReceipt` a cualquier `/unblock`, sin comparar el `incidentId`. `reviewOtherAccountIncident` y la revisión del support usan el mismo endpoint con otro incidente; el fake acaba en `confirmFencedVideoBillingUnblockAttempt` con la tupla del ancla y el incidente ajeno, y el store responde `conflict`. La ruta correcta para un incidente no anclado es la real: `store.unblockVideoBilling` / `store.videoBillingUnblockReceipt`. No parece un fallo del código operativo.
- **Caso 20 — importación.** `AccountFault` se usa en `instanceof` pero no está importado. Hay que importar la clase real del backend de Account; un stub local haría que `instanceof` no probara nada.
- **Caso 14 — semilla incompleta y luego prueba real.** `seedFencedSuccessor` exige que `identities/<identityKey>` exista para tomar su versión. El test pasa una clave aleatoria inexistente, así que la semilla aborta antes de ejercitar el negativo. La corrección no es relajar el assert: es crear una identidad real de otra cuenta y sembrar el ancla con ella. Así el ancla conserva una versión real y una autorización coherente con esa identidad; lo inválido es que esa identidad no pertenece al `ownerAccountId`. Si el store la acepta, es un hallazgo de producción, no del fixture.

**Fragmentos**

1. Importación. Sustituye la línea del import de `AccountStore`:

```js
import {AccountFault,AccountStore} from '../account/backend.ts';
```

Si el compilador indica que `AccountFault` vive en otro módulo, usa ese export real; no declares una clase local.

2. Transporte. Sustituye los dos bloques de `LocalAccountTransport.request`:

```js
    if(pathname==='/api/internal/video/billing-holds/unblock'){
      if(this.fenced&&body.incidentId===this.fenced.incidentId)return guard(()=>this.fencedConfirm(body));
      return guard(()=>this.store.unblockVideoBilling(body.identityKey,{incidentId:body.incidentId,epoch:body.epoch,createdAtMs:body.createdAtMs,reviewRef:body.reviewRef}));
    }
    if(pathname==='/api/internal/video/billing-holds/unblock-receipt'){
      if(this.fenced&&body.incidentId===this.fenced.incidentId)return guard(()=>this.fencedReceipt(body));
      return guard(()=>this.store.videoBillingUnblockReceipt(body.identityKey,body.incidentId,body.reviewRef));
    }
```

El modo fenced queda limitado al incidente ancla. No añadas el filtro por identidad: el negativo de identidad equivocada necesita seguir entrando por la ruta fenced.

3. Semilla. Sustituye la asignación de `c.transport.fenced`:

```js
  c.transport.fenced={accountRoot:c.accountRoot,accountId,identityKey:c.identity,incidentId,
    previousAttemptId,previousEpoch,successorAttemptId,successorEpoch,
    accountCreatedAtMs,authorizationSha256:original.authorizationSha256};
```

`identityKey:c.identity` debe quedarse así: representa la identidad presentada por la petición. El ancla es la que puede llevar la identidad ajena.

4. Identidad equivocada. Sustituye el bloque que empieza por `{ // wrong identity in the anchor`:

```js
  { // wrong identity in the anchor: a REAL identity owned by a different account
    const blocked=await blockedAccount('successor_wrong_identity'),c=blocked.c,body=await request(c,blocked);
    const otherUid='synthetic-wrong-identity-'+randomUUID();
    const otherAccount=await c.store.bootstrap(otherUid),otherIdentity=accountIdentityKey(otherUid);
    assert.notEqual(otherIdentity,c.identity,'the anchor identity must differ from the request identity');
    assert.notEqual(otherAccount.account.id,c.accountOwner,'the anchor identity must belong to another account');
    const seeded=await seedFencedSuccessor(c,blocked,{identityKey:otherIdentity});
    const deps=fencedDeps(c,seeded),videoBefore=await signatures(c.root),accountBefore=await signatures(c.accountRoot);
    await assert.rejects(unblockBillingAccount(deps,c.account,body,'operator-ana',9_350_300_000),
      error=>error instanceof UnblockFault&&error.code==='conflict');
    assert.equal((await c.root.collection(UNBLOCK_SUCCESSOR_COLLECTION).get()).size,0);
    assert.equal((await c.accountRoot.collection('videoBillingUnblocks').get()).size,0,
      'a wrong anchor identity must not write an Account unblock');
    assert.deepEqual(await signatures(c.root),videoBefore);
    assert.deepEqual(await signatures(c.accountRoot),accountBefore);
  }
```

No elimines `assert.equal(identity.exists,true,'the real Account identity is required')` de `seedFencedSuccessor`; ahora el test le da una identidad real. La identidad sembrada es de otra cuenta, pero existe y tiene versión real, así que el negativo sigue siendo de identidad equivocada, no de identidad ausente.

Nota menor: el `return` de `seedFencedSuccessor` todavía devuelve `identityKey:c.identity`. No afecta a estos tests porque nadie consume ese campo, pero si se corrige por consistencia debe devolver la identidad resuelta del ancla (`identityKey`), no la del transporte.

**Qué demuestran**

- El gate por `incidentId` demuestra que el protocolo fenced es una propiedad del intento ancla, no de toda la cuenta. Las revisiones del otro incidente y del support vuelven a usar el `AccountStore` real, con la generación vigente.
- El import hace que el test de guard corrupto compruebe la clase real `AccountFault`, no una referencia rota.
- El bloque de identidad equivocada vuelve a ejercitar el receipt/confirm fenced con una identidad real pero ajena, mantiene la validación de existencia y versión de la semilla, y conserva las comprobaciones de conflicto y de cero escrituras en ambos roots.

**Qué falta ejecutar**

- Aplicar los fragmentos y correr la suite completa en el emulador: 22/22 y limpieza 27/27.
- Caso 14: verificar que el rechazo sea `UnblockFault` con `code:'conflict'`. Si devuelve `'corrupt'` o acepta la identidad ajena, no debilites la aserción: es una decisión/hallazgo del código operativo.
- Caso 9: comprobar que el `bootstrap` de la cuenta ajena no deje trabajo pendiente que altere las firmas o el ledger durante el drenaje. Si ocurre, aísla la línea base del fixture; no relajes las aserciones.
- Confirmar la ruta real del export de `AccountFault`.

=== RESUMEN FINAL ===
RESULTADO: PASS
EVIDENCIA: Revisión estática de los cinco fallos. 9/15/21: el modo fenced interceptaba todo incidente; el gate por incidentId restaura la ruta real de Account. 20: falta el import real de AccountFault. 14: la semilla exigía una identidad existente y el test pasaba una clave inexistente; se crea una identidad real de otra cuenta sin quitar la validación. No se modifican aserciones existentes; se añade una comprobación explícita de no escritura de unblocks.
NEGATIVOS: No ejecutado en este turno (sin herramientas). No verificado estáticamente que AccountFault se exporte desde ../account/backend.ts; es la ruta probable y el compilador debe confirmarla. Caso 14: no verificable estáticamente que el store devuelva exactamente UnblockFault code conflict; si devuelve corrupt o acepta, es un hallazgo de producción/contrato, no motivo para debilitar la prueba. Tampoco se verificó que bootstrap no deje trabajo pendiente que altere las firmas del test de la cuenta ajena.
BLOQUEOS: Aplicar los fragmentos y ejecutar la suite completa en el emulador (22/22) y la limpieza (27/27); revisar en particular el código de error del caso 14 y las aserciones de la cuenta ajena tras el drenaje.
=== FIN RESUMEN ===
