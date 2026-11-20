/**
 * LV-019.B: the read-only facade for the ACCOUNT database (`vistavo-live`, root document `vistavo/production-v1`), used by the reconciliation
 * counts against REAL data. The engine and its guarantees are in readOnlyFirestoreRoot.ts; this file only fixes the policy: six collections
 * (balances, reservations, tombstones, guards, incidents, ledger), the equality filters the counts need, and the few scalar fields they read.
 * Never reachable: identities, projects, provider calls and fences, create requests, and inside the readable documents the identity key, the
 * UID, the reservation id, the provider and capture admissions (only whether a provider admission is present) and the project counter.
 * Balances cannot be probed with filters: `accounts` accepts none.
 */
import type {DocumentReference} from 'firebase-admin/firestore';
import {createReadOnlyRoot,type CollectionPolicy,type ReadOnlyOptions,type ReadOnlyRoot} from './readOnlyFirestoreRoot';

export type {ReadOnlyDoc,ReadOnlyOptions,ReadOnlyQuery,ReadOnlyRoot} from './readOnlyFirestoreRoot';
const policies:Record<string,CollectionPolicy>={
  accounts:{select:['credited','available','reserved','consumed','active'],expose:['credited','available','reserved','consumed','active'],where:{}},
  videoReservations:{select:['ownerAccountId','seconds','state','createdAtMs','admissionProtocol','providerAdmission'],expose:['ownerAccountId','seconds','state','createdAtMs','admissionProtocol'],dropIfNotScalar:['state'],presence:{providerAdmission:'hasProviderAdmission'},where:{state:['reserved','captured','released']}},
  videoReservationTombstones:{select:['state'],expose:['state'],dropIfNotScalar:['state'],where:{state:['sealed']}},
  videoBillingGuards:{select:['blocked','incidentCount'],expose:['blocked','incidentCount'],where:{blocked:[true]}},
  videoBillingIncidents:{select:['state'],expose:['state'],dropIfNotScalar:['state'],where:{state:['active']}},
  ledgerEntries:{select:['kind','seconds'],expose:['kind','seconds'],dropIfNotScalar:['kind'],where:{kind:['video_reserve','video_capture','video_release']}},
};
export const ACCOUNT_READABLE_COLLECTIONS:readonly string[]=Object.freeze(Object.keys(policies));
export function accountReadOnlyRoot(root:DocumentReference,options:ReadOnlyOptions={}):ReadOnlyRoot{return createReadOnlyRoot(root,{collections:policies},options);}
