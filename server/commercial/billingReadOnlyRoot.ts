/**
 * LV-019.B: the read-only facade for the BILLING QUEUES of the Video database (the candidate namespace document, e.g.
 * `vistavo/candidate-v1`), used by the pending report and the schedule inventory against REAL data. The engine and its guarantees are in
 * readOnlyFirestoreRoot.ts; this file only fixes the policy: five collections, `state` equality filters limited to the states the readers
 * query, `select('state','nextAttemptAt')`, and six exposed scalar fields (`state`, `createdAtMs`, `nextAttemptAt`, `attempts`,
 * `lastErrorCode`, `accountId`; a non-scalar `state` is omitted, any other non-scalar becomes the string `[object]`).
 */
import type {DocumentReference} from 'firebase-admin/firestore';
import {PENDING_SOURCES} from './billingPendingReport';
import {createReadOnlyRoot,type CollectionPolicy,type ReadOnlyOptions,type ReadOnlyRoot} from './readOnlyFirestoreRoot';

export type {ReadOnlyDoc,ReadOnlyOptions,ReadOnlyQuery,ReadOnlyRoot} from './readOnlyFirestoreRoot';
export const READABLE_COLLECTIONS:readonly string[]=Object.freeze(['billingIntents','billingIntentTerminalRecovery','billingHoldOutbox','billingOutbox','jobs','billingGuards']);
/** The only states the readers filter by (listed non-terminal states of the pending sources). */
const STATES=PENDING_SOURCES.flatMap(source=>source.states);
const queue:CollectionPolicy={select:['state','nextAttemptAt'],expose:['state','createdAtMs','nextAttemptAt','attempts','lastErrorCode','accountId'],dropIfNotScalar:['state'],where:{state:STATES}};
// LV-019.B D-4: the guard collection is read by `blocked == true` only, so it declares its own single-field filter and exposes the incident refs.
const guard:CollectionPolicy={select:['blocked','accountId','epoch','createdAtMs','lastIncidentId','lastOutboxIncidentId','updatedAtMs'],expose:['blocked','accountId','epoch','createdAtMs','lastIncidentId','lastOutboxIncidentId','updatedAtMs'],where:{blocked:[true]}};
const BILLING_POLICY={collections:Object.fromEntries(READABLE_COLLECTIONS.map(name=>[name,name==='billingGuards'?guard:queue]))};

export function readOnlyRoot(root:DocumentReference,options:ReadOnlyOptions={}):ReadOnlyRoot{return createReadOnlyRoot(root,BILLING_POLICY,options);}
