/**
 * LV-019.B: counts-only reconciliation of the ACCOUNT database, computed over a READ-ONLY root (accountReadOnlyRoot.ts), for running against REAL data.
 * It checks the invariants the Account code itself maintains (server/account/backend.ts):
 *  - per account: credited = available + reserved + consumed (a `reserve` moves seconds from available to reserved, a capture from reserved
 *    to consumed, a release from reserved back to available);
 *  - per account: `reserved` and `active` equal what its open (`reserved`) reservations add up to;
 *  - one ledger entry per reservation (`video_reserve`) and per capture / release; a partial capture (C2a) adds one `video_release_remainder` entry that
 *    returns the unconsumed seconds, so remainder entries must equal the partially captured reservations.
 * It returns only totals and counts: no account id, reservation id or per-row value. Account ids are used in memory to join reservations to
 * balances and are never emitted. It never writes: the root it receives has no write surface.
 */
import type {ReadOnlyRoot} from './accountReadOnlyRoot';

export interface AccountCounts{
  generatedAtMs:number;
  /** Documents per collection (count aggregation, so not an exact snapshot while writers are active). */sizes:Record<string,number>;
  reservations:{total:number;byState:{reserved:number;captured:number;released:number;/** total minus the three listed: negative only if the counts were read at different instants (writers active). */other:number};/** Captured reservations that settled only part of their seconds (C2a); a boolean marker, nothing about the seconds. */partiallyCaptured:number};
  ledger:{total:number;byKind:{video_reserve:number;video_capture:number;video_release:number;video_release_remainder:number;other:number}};
  tombstonesSealed:number;guardsBlocked:number;incidentsActive:number;
  /** Ledger entries minus reservations in the matching state: 0 = consistent. `reserve` is compared with ALL reservations. */
  ledgerMinusReservations:{reserve:number;capture:number;release:number;/** `video_release_remainder` entries minus partially captured reservations. */remainder:number};
  accounts:{scanned:number;/** Accounts whose balance fields are not non-negative safe integers; they are EXCLUDED from `totals` and from every other figure below. */invalid:number;/** credited != available + reserved + consumed. */balanceBreaks:number;withReservedBalance:number;
    totals:{credited:number;available:number;reserved:number;consumed:number;active:number};/** `reserved` differs from the seconds of the account's open reservations. */reservedMismatch:number;/** `active` differs from the number of its open reservations. */activeMismatch:number};
  openReservations:{count:number;secondsTotal:number;/** Age of the oldest open reservation with a known creation time (malformed ones included); null if none. */oldestAgeMs:number|null;withProviderAdmission:number;/** `admissionProtocol` other than 2: cannot prove the absence of earlier provider calls. */legacyProtocol:number;/** Owner is not among the scanned accounts (or that account is malformed). */orphan:number;invalid:number};
}
const COLLECTIONS=['accounts','videoReservations','videoReservationTombstones','videoBillingGuards','videoBillingIncidents','ledgerEntries'] as const;
const natural=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;

export async function summarizeAccounts(root:ReadOnlyRoot,nowMs:number):Promise<AccountCounts>{
  if(!Number.isSafeInteger(nowMs)||nowMs<0)throw new RangeError('invalid clock');
  const sizes:Record<string,number>={};
  for(const name of COLLECTIONS)sizes[name]=await root.collection(name).count();
  const reservationCount=async(state:string)=>root.collection('videoReservations').where('state','==',state).count();
  const reserved=await reservationCount('reserved'),captured=await reservationCount('captured'),released=await reservationCount('released');
  const kindCount=async(kind:string)=>root.collection('ledgerEntries').where('kind','==',kind).count();
  const lReserve=await kindCount('video_reserve'),lCapture=await kindCount('video_capture'),lRelease=await kindCount('video_release'),lRemainder=await kindCount('video_release_remainder');
  const partiallyCaptured=await root.collection('videoReservations').where('partialSettlement','==',true).count();
  const tombstonesSealed=await root.collection('videoReservationTombstones').where('state','==','sealed').count();
  const guardsBlocked=await root.collection('videoBillingGuards').where('blocked','==',true).count();
  const incidentsActive=await root.collection('videoBillingIncidents').where('state','==','active').count();

  // Every account, once, by document id (the id is only used to join; it is never returned).
  const balances=new Map<string,{reserved:number;active:number}>();
  const accounts={scanned:0,invalid:0,balanceBreaks:0,withReservedBalance:0,totals:{credited:0,available:0,reserved:0,consumed:0,active:0},reservedMismatch:0,activeMismatch:0};
  for(let last:Awaited<ReturnType<ReturnType<ReadOnlyRoot['collection']>['get']>>['docs'][number]|undefined;;){
    let query=root.collection('accounts').select('credited','available','reserved','consumed','active').orderBy('__name__');
    if(last)query=query.startAfter(last);
    const page=await query.limit(200).get();
    for(const doc of page.docs){
      accounts.scanned++;const d=doc.data()??{};
      const {credited,available,reserved:held,consumed,active}=d as Record<string,unknown>;
      if(![credited,available,held,consumed,active].every(natural)){accounts.invalid++;continue;}
      const [c,a,r,u,n]=[credited,available,held,consumed,active] as number[];
      accounts.totals.credited+=c;accounts.totals.available+=a;accounts.totals.reserved+=r;accounts.totals.consumed+=u;accounts.totals.active+=n;
      if(c!==a+r+u)accounts.balanceBreaks++;
      if(r>0)accounts.withReservedBalance++;
      balances.set(doc.id,{reserved:r,active:n});
    }
    if(page.docs.length<200)break;
    last=page.docs[page.docs.length-1];
  }

  // Every open reservation (the only non-terminal state), once; per owner, the seconds and the number that the account should show.
  const open={count:0,secondsTotal:0,oldestAgeMs:null as number|null,withProviderAdmission:0,legacyProtocol:0,orphan:0,invalid:0};
  const perOwner=new Map<string,{seconds:number;count:number}>();
  for(let last:Awaited<ReturnType<ReturnType<ReadOnlyRoot['collection']>['get']>>['docs'][number]|undefined;;){
    let query=root.collection('videoReservations').where('state','==','reserved').orderBy('__name__');
    if(last)query=query.startAfter(last);
    const page=await query.limit(200).get();
    for(const doc of page.docs){
      open.count++;const d=(doc.data()??{}) as Record<string,unknown>;
      if(d.hasProviderAdmission===true)open.withProviderAdmission++;
      if(d.admissionProtocol!==2)open.legacyProtocol++;
      if(natural(d.createdAtMs)){const age=Math.max(0,nowMs-d.createdAtMs);if(open.oldestAgeMs===null||age>open.oldestAgeMs)open.oldestAgeMs=age;}
      if(typeof d.ownerAccountId!=='string'||!d.ownerAccountId||!natural(d.seconds)||d.seconds<1){open.invalid++;continue;}
      open.secondsTotal+=d.seconds;
      if(!balances.has(d.ownerAccountId))open.orphan++;
      const own=perOwner.get(d.ownerAccountId)??{seconds:0,count:0};own.seconds+=d.seconds;own.count++;perOwner.set(d.ownerAccountId,own);
    }
    if(page.docs.length<200)break;
    last=page.docs[page.docs.length-1];
  }
  // Sums must stay exact integers; otherwise the totals would be silently wrong.
  for(const value of [...Object.values(accounts.totals),open.secondsTotal])if(!Number.isSafeInteger(value))throw new RangeError('totals overflow');
  for(const [id,balance] of balances){
    const own=perOwner.get(id)??{seconds:0,count:0};
    if(balance.reserved!==own.seconds)accounts.reservedMismatch++;
    if(balance.active!==own.count)accounts.activeMismatch++;
  }
  const total=sizes.videoReservations,ledgerTotal=sizes.ledgerEntries;
  return {
    generatedAtMs:nowMs,sizes,
    reservations:{total,byState:{reserved,captured,released,other:total-reserved-captured-released},partiallyCaptured},
    ledger:{total:ledgerTotal,byKind:{video_reserve:lReserve,video_capture:lCapture,video_release:lRelease,video_release_remainder:lRemainder,other:ledgerTotal-lReserve-lCapture-lRelease-lRemainder}},
    tombstonesSealed,guardsBlocked,incidentsActive,
    ledgerMinusReservations:{reserve:lReserve-total,capture:lCapture-captured,release:lRelease-released,remainder:lRemainder-partiallyCaptured},
    accounts,openReservations:open,
  };
}
