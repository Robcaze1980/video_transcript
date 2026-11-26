/**
 * LV-019.B step 1.4b: the single identity of one OCCURRENCE of an external billing hold.
 *
 * The same value is the Video `billingHoldOutbox` document id and Account's incident id (the drainer sends `hold.id`
 * verbatim), so a block, its audited unblock and its alert all name one incident instead of two parallel ids.
 * Account refuses to re-block an incident it already reviewed, so a row that diverges again after an unblock must
 * arrive with a NEW id: the generation (the Video guard's `epoch` plus its `createdAtMs`) is exactly what changes
 * between two occurrences of the same row. Rows written before this step have no generation and keep the legacy id.
 */
import {createHash} from 'node:crypto';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export type HoldGeneration={epoch:number;createdAtMs:number};
export type HoldKind='intent'|'outbox';

/** The id of a pre-1.4b hold (and of a legacy row read back by the drainer): no generation is part of the hash. */
export function legacyHoldId(sourceKind:HoldKind,sourceId:string){return hash(['account-hold-v1',sourceKind,sourceId]);}
/** The id of one hold occurrence; a missing generation means the legacy id. */
export function holdId(sourceKind:HoldKind,sourceId:string,generation?:HoldGeneration){
  return generation?hash(['account-hold-v1',sourceKind,sourceId,generation.epoch,generation.createdAtMs]):legacyHoldId(sourceKind,sourceId);
}
/** The generated id of a hold occurrence, named after the guard generation that wrote it. */
export function accountHoldId(sourceKind:HoldKind,sourceId:string,epoch:number,createdAtMs:number){
  return holdId(sourceKind,sourceId,{epoch,createdAtMs});
}
