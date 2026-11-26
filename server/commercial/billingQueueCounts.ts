/**
 * LV-019.B: counts-only summary of the billing queues, computed over a READ-ONLY root (billingReadOnlyRoot.ts): the size of each
 * queue collection, the pending report aggregated by kind and state, and the schedule inventory. It is meant for running against real
 * data, so nothing identifying is returned: no row id, no account id and no timestamp of a specific row; only totals, per-state counts,
 * attention counts, the age of the oldest row of each kind and counts per error code (a fixed set of codes).
 * It never writes: the root it receives has no write surface.
 */
import type {DocumentReference} from 'firebase-admin/firestore';
import {PENDING_SOURCES,readPendingReport,type DefaultPendingKind} from './billingPendingReport';
import {readScheduleInventory,type ScheduleInventory} from './billingScheduleInventory';
import {READABLE_COLLECTIONS,type ReadOnlyRoot} from './billingReadOnlyRoot';

export interface KindCounts{total:number;byState:Record<string,number>;needsReview:number;malformed:number;unknownAge:number;/** Age of the oldest row whose creation time is known; null if none. */oldestAgeMs:number|null}
export interface QueueCounts{
  generatedAtMs:number;
  /** Total documents per queue collection (count aggregation, so not an exact snapshot while writers are active). */sizes:Record<string,number>;
  report:{total:number;byKind:Record<DefaultPendingKind,KindCounts>;oldestAgeMs:number|null;/** `none` = no (or an unrecognised) error code. */byLastErrorCode:Record<string,number>};
  inventory:ScheduleInventory;
}

export async function summarizeQueues(root:ReadOnlyRoot,nowMs:number):Promise<QueueCounts>{
  if(!Number.isSafeInteger(nowMs)||nowMs<0)throw new RangeError('invalid clock');
  const sizes:Record<string,number>={};
  for(const name of READABLE_COLLECTIONS)sizes[name]=await root.collection(name).count();
  // The readers are typed on a Firestore reference; the facade offers exactly the reads they perform.
  const reference=root as unknown as DocumentReference;
  const report=await readPendingReport(reference,nowMs);
  const byKind=Object.fromEntries(PENDING_SOURCES.map(source=>[source.kind,{total:0,byState:{},needsReview:0,malformed:0,unknownAge:0,oldestAgeMs:null}])) as Record<DefaultPendingKind,KindCounts>;
  const byLastErrorCode:Record<string,number>={};
  for(const row of report.rows){
    if(row.kind==='voice_reserve_conflict')continue;
    const kind=byKind[row.kind];kind.total++;kind.byState[row.state]=(kind.byState[row.state]??0)+1;
    if(row.attention==='needs_review')kind.needsReview++;if(row.attention==='malformed')kind.malformed++;if(row.attention==='unknown_age')kind.unknownAge++;
    if(row.ageMs!==null&&(kind.oldestAgeMs===null||row.ageMs>kind.oldestAgeMs))kind.oldestAgeMs=row.ageMs;
    const code=row.lastErrorCode??'none';byLastErrorCode[code]=(byLastErrorCode[code]??0)+1;
  }
  const inventory=await readScheduleInventory(reference,nowMs);
  return {generatedAtMs:nowMs,sizes,report:{total:report.total,byKind,oldestAgeMs:report.oldest?.ageMs??null,byLastErrorCode},inventory};
}
