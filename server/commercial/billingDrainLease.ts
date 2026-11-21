/**
 * LV-019.B phase 1 (plan step 1.6, first part): the LEASE that serializes the periodic drain executor.
 * It is a single document under the Video root, `billingDrainLease/current`, with a strictly growing fencing token.
 * The lease is an OPTIMIZATION, never the safety guarantee: the Account side is idempotent per action and reservation,
 * so a second or late pass cannot move balance twice. What the lease buys is less redundant work and fewer false
 * positives. That is why a corrupt lease document is treated as takeable instead of blocking the executor: the token,
 * not the lease, is what stops a stale holder from renewing, releasing or writing a cursor.
 * Every write is transactional and the clock is always the caller's `now`: no wall clock is read inside a transaction,
 * so a test can place an expiry exactly. The two pure reads (`assertDrainLeaseHeld`, `getDrainCursor`) write nothing.
 * No billing row, balance or Account call is touched, and no write path is imported: the module can be wired into the
 * maintenance pass without dragging in the drain or the billing mode.
 * Design: docs/specs/LV-019-B-ejecutor-periodico-drenajes.md (3.2, 3.3, 3.5)
 */
import type {DocumentReference,Firestore} from 'firebase-admin/firestore';

/** The lease document is fixed: one executor per root, so no per-holder document is needed. */
export const DRAIN_LEASE_COLLECTION='billingDrainLease';
export const DRAIN_LEASE_DOC_ID='current';
/**
 * Monotonic token source. It lives outside the lease document so the token also grows after a release (the lease is
 * deleted). A stored token that is not a positive safe integer is IGNORED (it counts as 0): renew, release and the
 * cursor are fenced by EQUALITY of holderId AND token, never by order, so a token that is reset or corrupted can never
 * let a stale holder keep or take over someone else's lease. The only way to reach EXHAUSTED is a counter already at
 * Number.MAX_SAFE_INTEGER, which one acquisition every 5 minutes would take on the order of 1e11 years to reach; the
 * operational recovery would be to delete `billingDrainLease/counter` with the owner's notice, never silently.
 */
export const DRAIN_LEASE_COUNTER_DOC_ID='counter';
/** One document holding the rotation cursor per kind. */
export const DRAIN_LEASE_CURSOR_DOC_ID='cursors';
/** The kinds the rotation cursor is defined for. */
export const DRAIN_CURSOR_KINDS=Object.freeze(['intents','outbox','holds','unknown'] as const);
export type DrainCursorKind=typeof DRAIN_CURSOR_KINDS[number];
/** A pass holds the lease for 90 s and renews every 10 s; the margin checked before each row is 15 s. */
export const DEFAULT_DRAIN_LEASE_TTL_MS=90_000;
export const DEFAULT_DRAIN_LEASE_MARGIN_MS=15_000;
/** Renewal cadence of the design (3.2): the executor renews every 10 s during a pass. */
export const DEFAULT_DRAIN_LEASE_RENEW_EVERY_MS=10_000;
/** Tenure ceiling: twice the 60 s pass budget, so a renewal loop with a defect can never hold the lease forever. */
export const DEFAULT_DRAIN_LEASE_MAX_TENURE_MS=120_000;
export const MIN_DRAIN_LEASE_TTL_MS=1_000;
export const MAX_DRAIN_LEASE_TTL_MS=600_000;
/** The tenure shares the ttl bounds; a limit outside them is a bad parameter, not an omitted one. */
export const MIN_DRAIN_LEASE_MAX_TENURE_MS=MIN_DRAIN_LEASE_TTL_MS;
export const MAX_DRAIN_LEASE_MAX_TENURE_MS=MAX_DRAIN_LEASE_TTL_MS;

export interface DrainLeaseDoc{holderId:string;token:number;expiresAtMs:number;acquiredAtMs:number;renewedAtMs:number}
export interface DrainLeaseTarget{db:Firestore;root:DocumentReference}
export interface AcquireDrainLeaseOptions extends DrainLeaseTarget{holderId:string;now:number;ttlMs?:number}
export interface RenewDrainLeaseOptions extends DrainLeaseTarget{holderId:string;token:number;now:number;ttlMs?:number;maxTenureMs?:number}
export interface ReleaseDrainLeaseOptions extends DrainLeaseTarget{holderId:string;token:number}
export interface AssertDrainLeaseHeldOptions extends DrainLeaseTarget{holderId:string;token:number;now:number;minRemainingMs?:number}
export interface GetDrainCursorOptions extends DrainLeaseTarget{kind:DrainCursorKind}
export interface SetDrainCursorOptions extends DrainLeaseTarget{kind:DrainCursorKind;holderId:string;token:number;cursor:string|null;now:number}
export type AcquireDrainLeaseResult={acquired:true;token:number;expiresAtMs:number}|{acquired:false;reason:'held'};

/** Fixed messages: a value is never echoed, so a rejected parameter cannot leak into a log through its error. */
const INVALID_HOLDER='invalid holder id',INVALID_CLOCK='invalid clock',INVALID_TTL='invalid lease ttl',INVALID_TOKEN='invalid lease token',INVALID_MARGIN='invalid remaining margin',INVALID_KIND='invalid cursor kind',INVALID_CURSOR='invalid cursor id',INVALID_TENURE='invalid max tenure',EXHAUSTED='lease token exhausted';
/** A holder id is a label, not a path: bounded, no separator and no control character. */
const MAX_HOLDER_BYTES=200;
/**
 * A cursor is a document id read back into a path, so it must be a plain document id: bounded, no separator, no control
 * character, no `.`/`..`, and not a Firestore reserved id of the form `__...__` (which Firestore refuses or treats
 * specially). This is a validity rule for the value, not a proof that the document exists.
 */
const MAX_CURSOR_BYTES=1500;
/** Firestore reserves ids wrapped in double underscores; a cursor naming one is refused. */
const RESERVED_DOC_ID=/^__.*__$/;

const isSafeInteger=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value);
const nonNegative=(value:unknown):value is number=>isSafeInteger(value)&&value>=0;
const positive=(value:unknown):value is number=>isSafeInteger(value)&&value>=1;
const boundedLabel=(value:unknown,max:number):value is string=>typeof value==='string'&&value.length>=1&&Buffer.byteLength(value,'utf8')<=max&&!/[\/\u0000-\u001f\u007f]/.test(value);
const plainDocId=(value:unknown):value is string=>boundedLabel(value,MAX_CURSOR_BYTES)&&value!=='.'&&value!=='..'&&!RESERVED_DOC_ID.test(value);
const isKind=(value:unknown):value is DrainCursorKind=>typeof value==='string'&&(DRAIN_CURSOR_KINDS as readonly string[]).includes(value);
const asRecord=(value:unknown):Record<string,unknown>|undefined=>value!==null&&typeof value==='object'?value as Record<string,unknown>:undefined;
/** Only `undefined` selects a default: a `null` ttl or margin is a bad parameter, not an omitted one. */
const orDefault=(value:number|undefined,fallback:number):number=>value===undefined?fallback:value;

function validHolder(holderId:unknown):asserts holderId is string{if(!boundedLabel(holderId,MAX_HOLDER_BYTES))throw new Error(INVALID_HOLDER);}
function validClock(now:unknown):asserts now is number{if(!nonNegative(now))throw new Error(INVALID_CLOCK);}
function validTtl(ttlMs:unknown):asserts ttlMs is number{if(!isSafeInteger(ttlMs)||ttlMs<MIN_DRAIN_LEASE_TTL_MS||ttlMs>MAX_DRAIN_LEASE_TTL_MS)throw new Error(INVALID_TTL);}
function validTenure(maxTenureMs:unknown):asserts maxTenureMs is number{if(!isSafeInteger(maxTenureMs)||maxTenureMs<MIN_DRAIN_LEASE_MAX_TENURE_MS||maxTenureMs>MAX_DRAIN_LEASE_MAX_TENURE_MS)throw new Error(INVALID_TENURE);}
function validToken(token:unknown):asserts token is number{if(!positive(token))throw new Error(INVALID_TOKEN);}
function validMargin(minRemainingMs:unknown):asserts minRemainingMs is number{if(!nonNegative(minRemainingMs))throw new Error(INVALID_MARGIN);}
function validKind(kind:unknown):asserts kind is DrainCursorKind{if(!isKind(kind))throw new Error(INVALID_KIND);}
function validCursor(cursor:unknown):asserts cursor is string|null{if(cursor!==null&&!plainDocId(cursor))throw new Error(INVALID_CURSOR);}

/** Reads a stored lease. A document that does not match the exact shape is `null`: it cannot name a live owner. */
function readLease(data:unknown):DrainLeaseDoc|null{
  const record=asRecord(data);
  if(record===undefined)return null;
  const {holderId,token,expiresAtMs,acquiredAtMs,renewedAtMs}=record;
  if(!boundedLabel(holderId,MAX_HOLDER_BYTES)||!positive(token)||!nonNegative(expiresAtMs)||!nonNegative(acquiredAtMs)||!nonNegative(renewedAtMs))return null;
  if(acquiredAtMs>expiresAtMs||renewedAtMs>expiresAtMs||renewedAtMs<acquiredAtMs)return null;
  // A window wider than the maximum ttl could not have been written by an honest holder of this contract, so the
  // document is not a lease we trust: it reads as malformed and becomes takeable (liveness, never security).
  if(expiresAtMs-renewedAtMs>MAX_DRAIN_LEASE_TTL_MS)return null;
  return {holderId,token,expiresAtMs,acquiredAtMs,renewedAtMs};
}
/**
 * A lease is held only while it is well formed, its expiry is in the future (`expiresAtMs === now` is already expired),
 * and that expiry is no more than the maximum ttl ahead of the caller's clock. An expiry further ahead than an honest
 * clock could have written within the allowed skew is not trusted, so the lease reads as takeable. This is a liveness
 * bound only: the safety guarantee never depended on the lease.
 */
const isHeld=(lease:DrainLeaseDoc|null,now:number):lease is DrainLeaseDoc=>lease!==null&&lease.expiresAtMs>now&&lease.expiresAtMs-now<=MAX_DRAIN_LEASE_TTL_MS;
/** The lease document, the counter and the cursors live in the same fixed collection under the root. */
const leaseRef=(root:DocumentReference)=>root.collection(DRAIN_LEASE_COLLECTION).doc(DRAIN_LEASE_DOC_ID);
const counterRef=(root:DocumentReference)=>root.collection(DRAIN_LEASE_COLLECTION).doc(DRAIN_LEASE_COUNTER_DOC_ID);
const cursorsRef=(root:DocumentReference)=>root.collection(DRAIN_LEASE_COLLECTION).doc(DRAIN_LEASE_CURSOR_DOC_ID);
const storedToken=(data:unknown):number=>{const token=asRecord(data)?.token;return positive(token)?token:0;};
/**
 * The next token is one past the highest token ever observed: in the counter, in a live lease document, or even in a
 * corrupt one. A malformed document is takeable (the token, not the document, fences the holder), but its numeric token
 * was still issued once, so the new token must be strictly greater than it: a stale holder is never out-fenced by a token
 * that was already handed out and then lost to corruption.
 * A stored token that is not a positive safe integer (a string, a fraction, an oversized number, a missing field) is
 * IGNORED here and counts as 0. That is safe because renew, release and the cursor are fenced by EQUALITY of holderId
 * AND token, not by order: a token that is reset or corrupted cannot let a stale holder keep or take over a lease.
 */
function nextToken(counter:unknown,lease:unknown):number{
  const base=Math.max(storedToken(counter),storedToken(lease));
  if(base>=Number.MAX_SAFE_INTEGER)throw new Error(EXHAUSTED);
  return base+1;
}

/**
 * Takes the lease when it is free or expired. `expiresAtMs` is `now + ttlMs` and the token is strictly greater than any
 * token ever issued for this root. Returns `held` (never an error) when a live lease belongs to someone else or to us.
 */
export async function acquireDrainLease(options:AcquireDrainLeaseOptions):Promise<AcquireDrainLeaseResult>{
  const {db,root,holderId,now}=options,ttlMs=orDefault(options.ttlMs,DEFAULT_DRAIN_LEASE_TTL_MS);
  validHolder(holderId);validClock(now);validTtl(ttlMs);
  const ref=leaseRef(root),counter=counterRef(root);
  return db.runTransaction(async tx=>{
    const observed=await tx.get(ref),current=readLease(observed.data());
    if(isHeld(current,now))return {acquired:false,reason:'held'} as const;
    const token=nextToken((await tx.get(counter)).data(),observed.data()),expiresAtMs=now+ttlMs;
    // A full replacement, not a merge: no field of a previous holder can survive into the new lease.
    tx.set(ref,{holderId,token,expiresAtMs,acquiredAtMs:now,renewedAtMs:now});
    tx.set(counter,{token});
    return {acquired:true,token,expiresAtMs} as const;
  });
}

/** Shared gate for renew, release and the cursor: the caller must own the live lease with exactly its own token. */
function ownsLease(lease:DrainLeaseDoc|null,holderId:string,token:number,now:number):boolean{
  return lease!==null&&lease.holderId===holderId&&lease.token===token&&isHeld(lease,now);
}

/**
 * Extends the lease, but only for the holder that owns it, with its own token, while it is still live for the caller's
 * clock, and only while it has not already reached the maximum tenure. Anything else (another holder, another token, an
 * expired lease, an exhausted tenure) returns `false` and writes nothing.
 *
 * The renewal is MONOTONIC: a clock that steps back (an NTP correction, a replica behind) must never shorten the
 * expiry or move the renewal time behind the stored one, because that would produce a document whose `renewedAtMs` is
 * before `acquiredAtMs`, which `readLease` rejects, making the holder lose its OWN live lease after being told
 * `true`. So the renewal point is the later of the caller's clock and the stored renewal, and the expiry only ever
 * moves forward. The tenure is measured from the ORIGINAL acquisition, so a defective renewal loop cannot retain the
 * lease forever.
 */
export async function renewDrainLease(options:RenewDrainLeaseOptions):Promise<boolean>{
  const {db,root,holderId,token,now}=options,ttlMs=orDefault(options.ttlMs,DEFAULT_DRAIN_LEASE_TTL_MS),maxTenureMs=orDefault(options.maxTenureMs,DEFAULT_DRAIN_LEASE_MAX_TENURE_MS);
  validHolder(holderId);validToken(token);validClock(now);validTtl(ttlMs);validTenure(maxTenureMs);
  const ref=leaseRef(root);
  return db.runTransaction(async tx=>{
    const lease=readLease((await tx.get(ref)).data());
    // Ownership is decided by the caller's clock: a lease expired for that now is not renewed, even if a stored renewal
    // would still look live.
    if(!ownsLease(lease,holderId,token,now))return false;
    if(now-lease!.acquiredAtMs>=maxTenureMs)return false;
    const at=Math.max(now,lease!.renewedAtMs),expiresAtMs=Math.max(lease!.expiresAtMs,at+ttlMs);
    // The identity is preserved exactly; only the expiry and the renewal time move, and only forward.
    tx.set(ref,{holderId,token,expiresAtMs,acquiredAtMs:lease!.acquiredAtMs,renewedAtMs:at});
    return true;
  });
}

/**
 * Drops the lease, but only for the holder that owns it with its own token. It never deletes the lease of another
 * holder, and it deliberately does NOT require the lease to still be live: a stalled pass whose lease already expired
 * must be able to clean up after itself, and if someone else took over meanwhile the holder/token check refuses.
 */
export async function releaseDrainLease(options:ReleaseDrainLeaseOptions):Promise<boolean>{
  const {db,root,holderId,token}=options;
  validHolder(holderId);validToken(token);
  const ref=leaseRef(root);
  return db.runTransaction(async tx=>{
    const lease=readLease((await tx.get(ref)).data());
    if(lease===null||lease.holderId!==holderId||lease.token!==token)return false;
    tx.delete(ref);
    return true;
  });
}

/**
 * Pure check, used before each row: is this holder still the owner with at least `minRemainingMs` of margin?
 * It writes nothing, so it is a plain read and not a transaction: the point is to notice a lease lost earlier, and no
 * transaction could make this decision atomic with the row write that follows it anyway.
 */
export async function assertDrainLeaseHeld(options:AssertDrainLeaseHeldOptions):Promise<boolean>{
  const {db,root,holderId,token,now}=options,minRemainingMs=orDefault(options.minRemainingMs,DEFAULT_DRAIN_LEASE_MARGIN_MS);
  validHolder(holderId);validToken(token);validClock(now);validMargin(minRemainingMs);
  const lease=readLease((await leaseRef(root).get()).data());
  if(!ownsLease(lease,holderId,token,now))return false;
  return lease!.expiresAtMs-now>=minRemainingMs;
}

/** Reads one rotation cursor. A missing, null or malformed value reads as `null`. It writes nothing, so it is a plain read. */
export async function getDrainCursor(options:GetDrainCursorOptions):Promise<string|null>{
  const {db,root,kind}=options;
  validKind(kind);
  const stored=asRecord((await cursorsRef(root).get()).data())?.[kind];
  return plainDocId(stored)?stored:null;
}

/**
 * Writes one rotation cursor, but only while the caller still owns a live lease (the same gate as `renewDrainLease`).
 * The cursor document is merged, so the three kinds never overwrite each other. Returns `false` and writes nothing when
 * the caller is not the owner, the token does not match, or the lease has expired.
 */
export async function setDrainCursor(options:SetDrainCursorOptions):Promise<boolean>{
  const {db,root,kind,holderId,token,cursor,now}=options;
  validKind(kind);validHolder(holderId);validToken(token);validCursor(cursor);validClock(now);
  const ref=leaseRef(root),cursors=cursorsRef(root);
  return db.runTransaction(async tx=>{
    const current=readLease((await tx.get(ref)).data());
    if(!ownsLease(current,holderId,token,now))return false;
    tx.set(cursors,{[kind]:cursor},{merge:true});
    return true;
  });
}
