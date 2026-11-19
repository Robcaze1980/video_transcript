import {it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {reserveWithRecovery} from './cloudEnqueueRecovery';
import {AI_CATALOG_VERSION} from './aiContracts';
import {LedgerFault} from './firestoreBackend';
import type {FirestoreAi} from './firestoreAi';

it('a caller missing classified prior verification cannot recover an uncertain enqueue',async()=>{
 const account=randomUUID(),inputId=randomUUID(),jobId=randomUUID(),requestKey=randomUUID(),operation='translation:en';
 const priorRequest=vi.fn(async()=>jobId),job=vi.fn(async()=>({accountId:account,inputId,operation,revision:1,requestKey,aiProfile:AI_CATALOG_VERSION}));
 const ai={backend:{priorRequest,job},enabled:vi.fn(async()=>undefined)} as unknown as FirestoreAi;
 const original=Error('synthetic lost acknowledgement'),reserve=vi.fn(async()=>{throw original;});
 // JavaScript callers can omit required TypeScript parameters; they must fail closed too.
 const call=reserveWithRecovery as unknown as (...args:unknown[])=>Promise<string>;
 await expect(call(ai,account,{inputId,operation,expectedRevision:1,requestKey},reserve,()=>false)).rejects.toMatchObject({code:'invariant'});
 expect(reserve).not.toHaveBeenCalled();expect(priorRequest).not.toHaveBeenCalled();expect(job).not.toHaveBeenCalled();
});

it('a changed verification between reads cannot turn uncertainty into a normal acknowledgement',async()=>{
 const account=randomUUID(),inputId=randomUUID(),jobId=randomUUID(),requestKey=randomUUID(),operation='translation:en';
 const job=vi.fn(async()=>({accountId:account,inputId,operation,revision:1,requestKey,aiProfile:AI_CATALOG_VERSION}));
 const ai={backend:{job},enabled:vi.fn(async()=>undefined)} as unknown as FirestoreAi;
 const original=Error('synthetic lost acknowledgement'),reserve=vi.fn(async()=>{throw original;});
 const verifiedPrior=vi.fn<()=>Promise<string|null>>().mockResolvedValueOnce(jobId).mockResolvedValueOnce(null);
 await expect(reserveWithRecovery(ai,account,{inputId,operation,expectedRevision:1,requestKey},reserve,error=>error instanceof LedgerFault,verifiedPrior)).rejects.toMatchObject({code:'conflict'});
 expect(reserve).toHaveBeenCalledTimes(1);expect(job).toHaveBeenCalledTimes(1);expect(verifiedPrior).toHaveBeenCalledTimes(2);
});
