/**
 * LV-019.B phase 2, piece D: audited human disposition of a pending-billing alert, exactly once.
 *
 * What it is NOT: it never moves balance, never calls the Account service and never edits a billing row, hold or
 * reservation. A "resolve" records that a named person, citing evidence, dealt with the situation outside this code
 * (the commercial refund/correction route is the owner's decision and is not implemented here).
 * What it IS: one immutable audit record plus the alert update, created in a single transaction.
 * - `acknowledge` keeps the alert open (attention is not hidden) and records who saw it.
 * - `resolve` closes the alert as `dispositioned`; a later sighting of the same condition only counts, never re-alerts.
 * - An identical repeat is a replay (no writes); any different payload for the same alert and action is a conflict.
 * PRECONDITIONS for any future endpoint (this module is a library, wired to no route): `authorizedBy` must come from an
 * authenticated principal on an allowlist, never from the request body, and `nowMs` must be the server clock; nothing here
 * can verify either. One disposition per alert and action: a second, different person gets a conflict and can read the
 * existing record. Input limits below are validation bounds, not business policy.
 * Design: docs/specs/LV-019-B-conciliacion-fase2-barrido-diseno.md
 */
import {createHash} from 'node:crypto';
import type {DocumentReference,Firestore} from 'firebase-admin/firestore';
import {ALERT_COLLECTION,alertIdentity} from './billingPendingAlerts';
import {PENDING_SOURCES} from './billingPendingReport';

export const AUDIT_COLLECTION='billingPendingAudit';
export type AuditAction='acknowledge'|'resolve';
export interface Disposition{authorizedBy:string;evidenceRef?:string;note?:string}
export class AuditFault extends Error{constructor(readonly code:'invalid'|'not_found'|'conflict'|'corrupt'){super(code);}}

const alertKeyPattern=/^[a-f0-9]{64}$/,actorPattern=/^[a-z0-9][a-z0-9._:-]{0,63}$/i,evidencePattern=/^[^\u0000-\u001f\u007f]{1,200}$/,notePattern=/^[^\u0000-\u001f\u007f]{1,500}$/;
export function auditId(alertKeyValue:string,action:AuditAction):string{
  return createHash('sha256').update(JSON.stringify(['billing-pending-audit-v1',alertKeyValue,action])).digest('hex');
}
function clean(alertKeyValue:unknown,action:unknown,disposition:unknown){
  if(typeof alertKeyValue!=='string'||!alertKeyPattern.test(alertKeyValue)||(action!=='acknowledge'&&action!=='resolve')||!disposition||typeof disposition!=='object')throw new AuditFault('invalid');
  const d=disposition as Record<string,unknown>;
  if(Object.keys(d).some(k=>!['authorizedBy','evidenceRef','note'].includes(k)))throw new AuditFault('invalid');
  const authorizedBy=d.authorizedBy,evidenceRef=d.evidenceRef??null,note=d.note??null;
  if(typeof authorizedBy!=='string'||!actorPattern.test(authorizedBy))throw new AuditFault('invalid');
  if(evidenceRef!==null&&(typeof evidenceRef!=='string'||!evidencePattern.test(evidenceRef)))throw new AuditFault('invalid');
  if(action==='resolve'&&evidenceRef===null)throw new AuditFault('invalid');
  if(note!==null&&(typeof note!=='string'||!notePattern.test(note)))throw new AuditFault('invalid');
  return {alertKey:alertKeyValue,action:action as AuditAction,authorizedBy,evidenceRef:evidenceRef as string|null,note:note as string|null};
}
/** Creates the audit record and updates the alert atomically; see the module comment for the exact contract. */
export async function recordDisposition(db:Firestore,root:DocumentReference,alertKeyValue:string,action:AuditAction,disposition:Disposition,nowMs:number):Promise<{replayed:boolean}>{
  if(!Number.isSafeInteger(nowMs)||nowMs<0)throw new RangeError('invalid clock');
  const payload=clean(alertKeyValue,action,disposition),id=auditId(payload.alertKey,payload.action);
  const alertRef=root.collection(ALERT_COLLECTION).doc(payload.alertKey),auditRef=root.collection(AUDIT_COLLECTION).doc(id);
  return db.runTransaction(async tx=>{
    const alert=await tx.get(alertRef),existing=await tx.get(auditRef);
    if(!alert.exists)throw new AuditFault('not_found');
    const identity=alertIdentity(alert);if(!identity)throw new AuditFault('corrupt');
    if(existing.exists){
      const e=existing.data() as Record<string,unknown>|undefined;
      if(e&&e.alertKey===payload.alertKey&&e.action===payload.action&&e.authorizedBy===payload.authorizedBy&&e.evidenceRef===payload.evidenceRef&&e.note===payload.note)return {replayed:true};
      throw new AuditFault('conflict');
    }
    if(identity.status!=='open')throw new AuditFault('conflict');
    // The row is only OBSERVED, to give the audit record context; it is never written.
    let observedRowState:string|null=null;
    if(identity.kind!=='sweep'){
      const source=PENDING_SOURCES.find(s=>s.kind===identity.kind);if(!source)throw new AuditFault('corrupt');
      const row=await tx.get(root.collection(source.collection).doc(identity.rowId));
      const state=row.exists?(row.data() as Record<string,unknown>|undefined)?.state:undefined;
      observedRowState=!row.exists?'missing':typeof state==='string'?state:'unreadable';
    }
    tx.create(auditRef,{auditId:id,...payload,createdAtMs:nowMs,kind:identity.kind,rowId:identity.rowId,state:identity.state,reason:identity.reason,accountId:identity.accountId,observedRowState});
    tx.update(alertRef,payload.action==='acknowledge'?{acknowledgedAtMs:nowMs,acknowledgedBy:payload.authorizedBy,acknowledgeAuditId:id}:{status:'dispositioned',dispositionedAtMs:nowMs,dispositionedBy:payload.authorizedBy,dispositionAuditId:id});
    return {replayed:false};
  });
}
