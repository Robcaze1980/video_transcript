import type {DocumentReference,DocumentSnapshot,Firestore,QueryDocumentSnapshot} from 'firebase-admin/firestore';
import {isLocalVoiceFixtureTarget,isMarkedLocalVoiceRoot,LOCAL_VOICE_CONFLICTS,localVoiceRequestUuid} from './localVoiceFixture';

export const LOCAL_VOICE_CONFLICT_ALERTS = 'localVoiceReserveConflictAlerts';

type Row = Readonly<{id:string;kind:'voice_reserve_conflict';attention:'needs_review';accountId:null}>;
type Report = Readonly<{attention:readonly Row[]}>;
type Source = Readonly<{
  root:DocumentSnapshot;
  incidents:readonly QueryDocumentSnapshot[];
}>;
const sources=new WeakMap<Report,Source>();

function isConflict(incident:DocumentSnapshot):boolean {
  const createdAtMs=incident.get('createdAtMs');
  return incident.exists&&localVoiceRequestUuid.test(incident.id)&&incident.get('protocol')===1&&
    incident.get('state')==='needs_review'&&incident.get('lastErrorCode')==='conflict'&&
    Number.isSafeInteger(createdAtMs)&&createdAtMs>=0;
}

function sameVersion(original:DocumentSnapshot,current:DocumentSnapshot):boolean {
  return original.exists&&current.exists&&!!original.createTime&&!!original.updateTime&&
    !!current.createTime&&!!current.updateTime&&original.createTime.isEqual(current.createTime)&&
    original.updateTime.isEqual(current.updateTime);
}

/** Separate read for the synthetic C1 fixture. The maintenance sweep has no dependency on it. */
export async function readLocalVoiceConflictReport(root:DocumentReference,pageSize=200):Promise<Report> {
  if(!isLocalVoiceFixtureTarget(root.firestore,root))throw new Error('Invalid local voice fixture');
  if(!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>500)throw new RangeError('Invalid page size');
  const markedRoot=await root.get();
  if(!isMarkedLocalVoiceRoot(markedRoot))throw new Error('Invalid local voice fixture');
  const incidents:QueryDocumentSnapshot[]=[];
  const query=root.collection(LOCAL_VOICE_CONFLICTS).where('state','==','needs_review').orderBy('__name__').limit(pageSize);
  let last:QueryDocumentSnapshot|undefined;
  for(;;){
    const page=await (last?query.startAfter(last):query).get();
    incidents.push(...page.docs.filter(isConflict));
    if(page.docs.length<pageSize)break;
    last=page.docs[page.docs.length-1];
  }
  const report:Report=Object.freeze({attention:Object.freeze(incidents.map(({id})=>
    Object.freeze({id,kind:'voice_reserve_conflict' as const,attention:'needs_review' as const,accountId:null})))});
  sources.set(report,{root:markedRoot,incidents});
  return report;
}

/** Create or mark a sighting only for an incident still present in its original root and version. */
export async function raiseLocalVoiceConflictAlerts(db:Firestore,root:DocumentReference,report:Report,nowMs:number) {
  if(!isLocalVoiceFixtureTarget(db,root))throw new Error('Invalid local voice fixture');
  if(!Number.isSafeInteger(nowMs)||nowMs<0)throw new RangeError('Invalid clock');
  const source=sources.get(report);
  if(!source||source.root.ref.firestore!==db||source.root.ref.path!==root.path)throw new Error('Invalid local voice report origin');
  let created=0,seen=0,stale=0;
  for(const incident of source.incidents){
    const result=await db.runTransaction(async tx=>{
      const markedRoot=await tx.get(root);
      if(!isMarkedLocalVoiceRoot(markedRoot)||!sameVersion(source.root,markedRoot))return 'stale';
      const live=await tx.get(root.collection(LOCAL_VOICE_CONFLICTS).doc(incident.id));
      if(!isConflict(live)||!sameVersion(incident,live))return 'stale';
      const alertRef=root.collection(LOCAL_VOICE_CONFLICT_ALERTS).doc(incident.id),alert=await tx.get(alertRef);
      const identity={protocol:1,kind:'voice_reserve_conflict',rowId:incident.id,reason:'needs_review',accountId:null,status:'open'};
      if(!alert.exists){
        tx.create(alertRef,{...identity,seenCount:1,firstSeenAtMs:nowMs,lastSeenAtMs:nowMs});
        return 'created';
      }
      const {seenCount,firstSeenAtMs,lastSeenAtMs}=alert.data()!;
      if(Object.entries(identity).some(([field,value])=>alert.get(field)!==value)||
        !Number.isSafeInteger(seenCount)||seenCount<1||seenCount===Number.MAX_SAFE_INTEGER||
        !Number.isSafeInteger(firstSeenAtMs)||firstSeenAtMs<0||!Number.isSafeInteger(lastSeenAtMs)||lastSeenAtMs<firstSeenAtMs)
        throw new Error('Invalid local voice alert');
      tx.update(alertRef,{seenCount:seenCount+1,lastSeenAtMs:Math.max(lastSeenAtMs,nowMs)});
      return 'seen';
    });
    if(result==='created')created++;
    if(result==='seen')seen++;
    if(result==='stale')stale++;
  }
  return {created,seen,stale};
}
