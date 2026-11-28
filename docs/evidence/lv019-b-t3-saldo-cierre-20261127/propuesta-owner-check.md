**SustituciÃ³n exacta â€” `resolveAccountGuard` con validaciÃ³n del documento de cuenta**

Reemplazar el cuerpo actual de `resolveAccountGuard` por:

```ts
async function resolveAccountGuard(tx:Transaction,deps:UnblockDeps,videoAccountId:string):Promise<GuardResolution>{
  const seam=deps.successor;
  if(!seam)return {kind:'legacy'};
  const accountRoot=deps.localAccountRoot;
  if(!accountRoot)throw Object.assign(new UnblockFault('unresolved'),{stage:'account_root_unaccredited'});
  if(accountRoot.firestore!==deps.db)throw Object.assign(new UnblockFault('invalid'),{stage:'account_root_firestore'});
  if(!attestedLocalEmulatorPair(deps.db,seam.attestation))throw new UnblockFault('invalid');
  if(!attestedAccountRoot(seam.attestation,accountRoot))throw Object.assign(new UnblockFault('invalid'),{stage:'account_root_substituted'});
  const video=await videoIdentityOf(tx,deps.root,videoAccountId);
  const accountIdentity=await tx.get(accountRoot.collection('identities').doc(video.identityKey));
  if(!accountIdentity.exists)throw Object.assign(new UnblockFault('conflict'),{stage:'account_identity_missing'});
  if(accountIdentity.get('uid')!==video.uid)throw Object.assign(new UnblockFault('conflict'),{stage:'account_identity_uid'});
  const accountIdCuenta=accountIdentity.get('accountId');
  if(typeof accountIdCuenta!=='string'||!uuid.test(accountIdCuenta))throw Object.assign(new UnblockFault('conflict'),{stage:'account_identity_account'});
  // Bind the derived account to THIS identity in the SAME transaction: the account document
  // must exist and name the identity, with the AccountStore schema/unit. A swapped accountId
  // (identity A pointing at account B) is rejected here, before B's guard is ever read.
  const account=await tx.get(accountRoot.collection('accounts').doc(accountIdCuenta));
  if(!account.exists)throw Object.assign(new UnblockFault('conflict'),{stage:'account_missing'});
  if(account.get('identityKey')!==video.identityKey)throw Object.assign(new UnblockFault('conflict'),{stage:'account_identity_key'});
  if(account.get('schemaVersion')!==1)throw Object.assign(new UnblockFault('conflict'),{stage:'account_schema'});
  if(account.get('unit')!=='video_seconds')throw Object.assign(new UnblockFault('conflict'),{stage:'account_unit'});
  return {kind:'resolved',guardRef:accountRoot.collection('videoBillingGuards').doc(accountIdCuenta),identityKey:video.identityKey,accountIdCuenta};
}
```

QuÃ© cambia y quÃ© no:

- Se aÃ±ade **una** lectura `tx.get(accountRoot/accounts/<accountIdCuenta>)` en la misma transacciÃ³n; queda en el read set, asÃ­ que un cambio concurrente del documento de cuenta aborta.
- Rechaza si falta el documento o si `identityKey`/`schemaVersion`/`unit` no coinciden con la identidad Video; nunca se lee la guarda de B ni se escribe.
- No se confÃ­a en ningÃºn UUID aportado por el fixture: el `accountId` se deriva de la identidad Cuenta y se **verifica** contra el documento de cuenta.
- Sin logging de uid; los `stage` no incluyen el uid.
- Ruta legacy intacta: con `seam` ausente se retorna `{kind:'legacy'}` antes de cualquier lectura cruzada.

**Test 1 â€” mezcla de cuentas: identidad A apuntada a la cuenta B tras la Ãºltima lectura**

```ts
test('successor: swapping identity A to account B after the last receipt rejects, keeps Video blocked and leaves B untouched',{timeout:180000},async()=>{
  const blocked=await blockedAccount('successor_account_swap'),c=blocked.c,body=await request(c,blocked);
  const seeded=await seedFencedSuccessor(c,blocked);
  const base=fencedDeps(c,seeded);

  // B lives in the SAME AccountStore.
  const uidOtro='synthetic-swap-other-uid';
  const boot=await c.store.bootstrap(uidOtro);
  const accountIdOtro=boot.account.id;
  await ref(c.accountRoot,'accounts',accountIdOtro).update({credited:120,available:120});
  const identityKeyOtro=accountIdentityKey(uidOtro);
  const reservationOtro=await c.store.reserveVideo(identityKeyOtro,randomUUID(),60);
  assert.ok(reservationOtro,'B reserves 60s before the sabotage');

  const bBalanceBefore=await c.store.videoBalance(identityKeyOtro);
  const bReservationsBefore=(await c.accountRoot.collection('videoReservations').where('ownerAccountId','==',accountIdOtro).get())
    .docs.map(d=>[d.id,d.data()]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
  const bLedgerBefore=(await c.accountRoot.collection('ledgerEntries').where('ownerAccountId','==',accountIdOtro).get())
    .docs.map(d=>[d.id,d.data()]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);

  let receiptCalls=0,confirms=0;
  const swap={...base,successor:{...base.successor,
    async receipt(input){
      const value=await base.successor.receipt(input);receiptCalls++;
      if(receiptCalls===2){
        // Sabotage AFTER the last receipt and BEFORE the Video transaction:
        // point identity A at account B, keeping A's uid.
        await c.accountRoot.collection('identities').doc(c.identity).update({accountId:accountIdOtro});
      }
      return value;
    },
    async confirm(input){confirms++;return base.successor.confirm(input);}}};

  // Mutations of A that already happened BEFORE the sabotage (documented, not asserted as unchanged):
  //   - Phase 0 may have created the `unblock_requested` audit and continuity rows;
  //   - the Account receipt/confirm path may have advanced Account A's incident/guard bookkeeping.
  // Only the outcome AFTER the sabotage is asserted.
  const videoGuardBefore=await guardOf(c).get();
  const videoBefore=await rootSignature(c.root,VIDEO_ROOT_COLLECTIONS);

  await assert.rejects(unblockBillingAccount(swap,c.account,body,'operator-ana',9_500_010_000),
    error=>error instanceof UnblockFault&&error.code==='conflict');

  assert.equal(receiptCalls,2,'one snapshot and one pre-release revalidation');
  assert.equal(confirms,1,'no second confirm is sent');
  assert.equal((await guardOf(c).get()).get('blocked'),true,'Video A stays blocked');
  assert.equal((await guardOf(c).get()).get('blocked'),videoGuardBefore.get('blocked'));
  assert.equal((await c.root.collection(UNBLOCK_AUDIT_COLLECTION).where('action','==','video_released').get()).size,0,'no release');
  assert.deepEqual(await rootSignature(c.root,VIDEO_ROOT_COLLECTIONS),videoBefore,'no Video write after the sabotage');

  assert.deepEqual(await c.store.videoBalance(identityKeyOtro),bBalanceBefore,'B balance untouched');
  assert.deepEqual((await c.accountRoot.collection('videoReservations').where('ownerAccountId','==',accountIdOtro).get())
    .docs.map(d=>[d.id,d.data()]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0),bReservationsBefore,'B reservations untouched');
  assert.deepEqual((await c.accountRoot.collection('ledgerEntries').where('ownerAccountId','==',accountIdOtro).get())
    .docs.map(d=>[d.id,d.data()]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0),bLedgerBefore,'B ledger untouched');
});
```

**Test 2 â€” negativa: identidad ya alterada antes del inicio, sin escrituras**

```ts
test('successor: an identity already pointing at another account rejects before any write',{timeout:180000},async()=>{
  const blocked=await blockedAccount('successor_pre_swap'),c=blocked.c,body=await request(c,blocked);
  const seeded=await seedFencedSuccessor(c,blocked);
  const base=fencedDeps(c,seeded);
  const uidOtro='synthetic-pre-swap-other-uid';
  const boot=await c.store.bootstrap(uidOtro);
  await ref(c.accountRoot,'accounts',boot.account.id).update({credited:120,available:120});
  // Alter identity A BEFORE the call: it now points at account B while keeping A's uid.
  await c.accountRoot.collection('identities').doc(c.identity).update({accountId:boot.account.id});
  const videoBefore=await rootSignature(c.root,VIDEO_ROOT_COLLECTIONS);
  const accountBefore=await rootSignature(c.accountRoot,ACCOUNT_ROOT_COLLECTIONS);
  await assert.rejects(unblockBillingAccount(base,c.account,body,'operator-ana',9_500_011_000),
    error=>error instanceof UnblockFault&&error.code==='conflict');
  assert.deepEqual(await rootSignature(c.root,VIDEO_ROOT_COLLECTIONS),videoBefore,'no Video write');
  assert.deepEqual(await rootSignature(c.accountRoot,ACCOUNT_ROOT_COLLECTIONS),accountBefore,'no Account write');
  assert.equal((await guardOf(c).get()).get('blocked'),true,'Video stays blocked');
});
```

Notas de encaje:

- El sabotaje de Test 1 ocurre en `receiptCalls===2` (la revalidaciÃ³n), que corre **despuÃ©s** del `confirm` y **antes** de la transacciÃ³n final; por eso `confirms===1` y el rechazo nace en la transacciÃ³n de liberaciÃ³n, sin `video_released`.
- En Test 2 la preflight (S1) detecta la identidad ya alterada **antes** de Phase 0, por eso no hay escrituras y las firmas completas de `c.root` y `c.accountRoot` son vÃ¡lidas.
- No se compara el estado de Cuenta A antes de la inyecciÃ³n (puede haber avanzado); sÃ³lo se comparan B y el lado Video despuÃ©s del sabotaje.
- Se conservan los 30 casos anteriores; no se toca la ruta legacy.

=== RESUMEN FINAL ===
RESULTADO: INCONCLUYENTE
EVIDENCIA: SustituciÃ³n propuesta de `resolveAccountGuard`: tras derivar `accountIdCuenta` de la identidad Cuenta, se lee en la MISMA transacciÃ³n `accountRoot/accounts/<accountIdCuenta>` y se rechaza con `UnblockFault('conflict')` si falta o si `identityKey!==video.identityKey`, `schemaVersion!==1` o `unit!=='video_seconds'`; la lectura queda en el read set (cambio concurrente aborta) y nunca se lee la guarda de B ni se escribe. Sin logging de uid; legacy intacto (`seam` ausente â‡’ `legacy` antes de cualquier lectura cruzada). Test 1: crea B en el mismo AccountStore (`bootstrap` + `update({credited:120,available:120})` + `reserveVideo(...,randomUUID(),60)`), documenta las mutaciones de A previas al sabotaje (Phase 0 y bookkeeping de Cuenta), cambia SOLO `accountId` de la identidad A a la cuenta B en `receiptCalls===2` (tras la Ãºltima lectura, antes de la transacciÃ³n Video) y exige `conflict`, `receiptCalls===2`, `confirms===1`, Video bloqueado, `video_released`=0, firmas de `c.root` sin cambios tras el sabotaje, y saldo/reserva/libro de B idÃ©nticos (por `where('ownerAccountId','==',accountIdOtro)`). Test 2: identidad A ya alterada antes del inicio â‡’ `conflict` sin escrituras (firmas completas de `c.root` y `c.accountRoot`). Se conservan los 30 casos anteriores. No medido: no ejecutÃ© pruebas ni `tsc` (sin herramientas).
NEGATIVOS: No verificado en ejecuciÃ³n. No comprobado que los nombres de campo `schemaVersion` y `unit` (`video_seconds`) coincidan exactamente con `accountRecord`; si difieren, la validaciÃ³n debe ajustarse o rechazar (falla cerrado). No confirmado que `bootstrap(uid)` cree la identidad con clave `accountIdentityKey(uid)` ni que `reserveVideo` acepte `randomUUID()`; si difieren, la parte operativa de Test 1 queda INCONCLUYENTE. No probada la concurrencia durante la transacciÃ³n (Firestore darÃ­a aislamiento/retry, pero no se midiÃ³). El camino legacy sin seam conserva la carrera y no recibe la defensa. La atestaciÃ³n certifica clientes de Firestore, no la identidad fÃ­sica de la base ni autoridad productiva.
BLOQUEOS: Falta el contrato de producciÃ³n para un cierre atÃ³mico entre servicios (p. ej. liberaciÃ³n de Video ejecutada por Cuenta con compare-and-swap sobre la versiÃ³n de su guarda, o protocolo de dos fases con token de versiÃ³n); un CAS en un servicio no vuelve atÃ³micas por sÃ­ solo escrituras entre bases independientes, y no estÃ¡ verificado si las bases fÃ­sicas reales son distintas. Sin ese contrato, en producciÃ³n Video debe permanecer bloqueado y el resultado sigue INCONCLUYENTE. El camino legacy sin seam requiere el mismo contrato y el despliegue estÃ¡ bloqueado.
=== FIN RESUMEN ===