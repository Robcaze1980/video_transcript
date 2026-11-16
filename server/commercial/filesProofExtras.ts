import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {cloudFilesRuntime} from './cloudFilesRuntime';
import {readyPrivateInput} from './privateObjectPlan';

type Runtime=Awaited<ReturnType<typeof cloudFilesRuntime>>;
type Check=(name:string)=>void;

/** Synthetic proof only: no payment/provider is called, and only a fresh proof identity may be credited. */
export async function proofLedger(runtime:Runtime,accountId:string,inputId:string,check:Check):Promise<()=>Promise<void>>{
 if(runtime.root.path!=='vistavo/candidate-v1'||process.env.VISTAVO_PROJECT_ID!=='vistavo-prod'||process.env.VISTAVO_FILES_MODE!=='proof')throw Error('Synthetic proof boundary');
 const identities=await runtime.root.collection('identities').where('accountId','==',accountId).limit(2).get();
 assert.equal(identities.size,1);
 assert.match(identities.docs[0].get('uid'),/^vistavo-gcs-proof-[a-z0-9-]{1,100}$/);
 const inputRef=runtime.root.collection('inputs').doc(inputId),uploadRef=runtime.root.collection('uploads').doc(inputId);
 const input=(await inputRef.get()).data(),upload=(await uploadRef.get()).data();
 assert.equal(input?.accountId,accountId);assert.equal(input?.deleted,false);assert.ok(readyPrivateInput(input,inputId));
 assert.equal(upload?.accountId,accountId);assert.equal(upload?.name,'synthetic-145s.mp4');assert.equal(upload?.state,'ready');
 const before=await runtime.backend.readBalance(accountId);
 assert.deepEqual({credited:before.credited,available:before.available,reserved:before.reserved,consumed:before.consumed,active:before.active},{credited:0,available:0,reserved:0,consumed:0,active:0});

 const proof=randomUUID(),capture='synthetic-cloud-proof:'+proof,merchant='synthetic-cloud-proof-no-payment';
 // These are fixture credits, deliberately confined to the candidate namespace and fresh synthetic UID.
 assert.equal(await runtime.backend.creditVerifiedPurchase(accountId,capture,10,1,merchant,'sandbox'),true);
 assert.equal(await runtime.backend.creditVerifiedPurchase(accountId,capture,10,1,merchant,'sandbox'),false);
 await runtime.root.collection('accounts').doc(accountId).update({syntheticProof:{id:proof,kind:'no-real-payment-or-provider'}});
 const balance=await runtime.backend.readBalance(accountId);assert.equal(balance.credited,10);assert.equal(balance.available,10);
 check('syntheticLedgerDuplicateCreditExactlyOnce');

 const project=await runtime.backend.saveProject(accountId,inputId,0,'Synthetic cloud proof fixture. No customer transcript.');
 const requestKey='synthetic-cloud-proof:'+proof,operation='synthetic-no-provider',price=4;
 const jobId=await runtime.backend.reserve(accountId,inputId,requestKey,price,operation,project.revision);
 assert.equal(await runtime.backend.reserve(accountId,inputId,requestKey,999,operation,project.revision),jobId);
 await runtime.root.collection('jobs').doc(jobId).update({syntheticProof:{id:proof,providerInvoked:false}});
 const initial=await runtime.backend.job(accountId,jobId);
 assert.equal(initial.price,price);assert.equal(initial.inputStorage?.generation,input!.storage.generation);assert.equal(initial.snapshot?.draft,project.draft);
 const claim=await runtime.backend.claim(accountId,jobId);assert.ok(claim);
 assert.equal(await runtime.backend.beginInvocation(accountId,jobId,claim.attemptId),true);
 // The durable invocation fence is tested without sending any request to an AI provider.
 assert.equal(await runtime.backend.beginInvocation(accountId,jobId,claim.attemptId),false);
 assert.equal(await runtime.backend.quarantine(accountId,jobId,claim.attemptId),true);
 assert.equal(await runtime.backend.quarantine(accountId,jobId,claim.attemptId),false);
 assert.equal(await runtime.backend.claim(accountId,jobId),null);
 assert.equal(await runtime.backend.beginInvocation(accountId,jobId,claim.attemptId),false);
 assert.equal(await runtime.backend.finish(accountId,jobId,claim.attemptId,true),false);
 const unknown=await runtime.backend.job(accountId,jobId),held=await runtime.backend.readBalance(accountId);
 assert.equal(unknown.state,'unknown');assert.equal(unknown.unknownAttemptId,claim.attemptId);
 assert.equal((await inputRef.get()).get('unknownCount'),1);assert.equal(held.available,6);assert.equal(held.reserved,4);assert.equal(held.consumed,0);assert.equal(held.active,1);
 assert.equal((await runtime.root.collection('movements').doc('terminal:'+jobId).get()).exists,false);
 check('syntheticLedgerUnknownNoReplay-priceAndGenerationFrozen');

 let completed=false;
 return async()=>{
  if(completed)throw Error('Proof afterDelete callback already completed');
  const tombstone=(await inputRef.get()).data(),deleted=(await uploadRef.get()).data();
  assert.equal(deleted?.state,'deleted');assert.equal(tombstone?.deleted,true);assert.equal(tombstone?.ready,false);assert.equal(tombstone?.unknownCount,1);
  const pending=await runtime.backend.job(accountId,jobId),stillHeld=await runtime.backend.readBalance(accountId);
  assert.equal(pending.state,'unknown');assert.equal(pending.snapshot,null);assert.equal(pending.price,4);
  assert.equal((await runtime.root.collection('projects').doc(inputId).get()).exists,false);
  assert.equal(stillHeld.available,6);assert.equal(stillHeld.reserved,4);assert.equal(stillHeld.consumed,0);assert.equal(stillHeld.active,1);
  const quota=await runtime.root.collection('accounts').doc(accountId).get();
  assert.equal(quota.get('storageCommittedBytes'),0);assert.equal(quota.get('storageReservedBytes'),0);
  assert.equal(await runtime.backend.cancel(accountId,jobId),false);assert.equal(await runtime.backend.claim(accountId,jobId),null);
  assert.equal((await runtime.root.collection('movements').doc('terminal:'+jobId).get()).exists,false);
  check('syntheticLedgerDeleteErasesTextRetainsUnknownAndMoney');

  const evidence='synthetic-cloud-proof-no-provider-called:'+proof;
  assert.equal(await runtime.backend.reconcile(accountId,jobId,'failed',evidence),true);
  assert.equal(await runtime.backend.reconcile(accountId,jobId,'failed',evidence),false);
  const settled=await runtime.backend.readBalance(accountId),terminal=await runtime.backend.job(accountId,jobId);
  assert.equal(settled.credited,10);assert.equal(settled.available,10);assert.equal(settled.reserved,0);assert.equal(settled.consumed,0);assert.equal(settled.active,0);
  assert.equal(terminal.state,'failed');assert.equal(terminal.reconciliationRef,evidence);assert.equal((await inputRef.get()).get('unknownCount'),0);
  const movement=(await runtime.root.collection('movements').doc('terminal:'+jobId).get()).data();
  assert.equal(movement?.kind,'release');assert.equal(movement?.credits,4);assert.equal(movement?.accountId,accountId);
  completed=true;check('syntheticLedgerTrustedFailureReleasesExactlyOnce');
 };
}
