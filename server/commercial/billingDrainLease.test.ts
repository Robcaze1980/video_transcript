// LV-019.B phase 1 (plan step 1.6, first part): the drain-executor LEASE with a fencing token.
// Tests first: they pin the contract (document shape, strictly growing token, injected clock, conditional renew and
// release, the stale holder after an expiry, the margin check, the conditional rotation cursor, parameter validation,
// error hygiene, the import fence and the absence of a wall clock) before the module exists.
import {describe,expect,it} from 'vitest';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join,relative} from 'node:path';
import {preProcessFile,createSourceFile,isCallExpression,isIdentifier,isStringLiteralLike,forEachChild,SyntaxKind,ScriptTarget,type Node} from 'typescript';
import {DEFAULT_DRAIN_LEASE_TTL_MS,DEFAULT_DRAIN_LEASE_MARGIN_MS,DEFAULT_DRAIN_LEASE_MAX_TENURE_MS,DEFAULT_DRAIN_LEASE_RENEW_EVERY_MS,MAX_DRAIN_LEASE_TTL_MS,DRAIN_CURSOR_KINDS,acquireDrainLease,renewDrainLease,releaseDrainLease,assertDrainLeaseHeld,getDrainCursor,setDrainCursor} from './billingDrainLease';

const NOW=1_000_000;
const TTL=DEFAULT_DRAIN_LEASE_TTL_MS;
const MARGIN=DEFAULT_DRAIN_LEASE_MARGIN_MS;
const LEASE='billingDrainLease/current',COUNTER='billingDrainLease/counter',CURSORS='billingDrainLease/cursors';

type Row=Record<string,unknown>;
/** Minimal in-memory stand-in for the Firestore surface this module uses: ref.get plus transactional get/set/update/delete. */
function firestoreDouble(initial:Record<string,Row>={}){
  const store=new Map<string,Row>(Object.entries(initial).map(([path,data])=>[path,structuredClone(data)]));
  const writes:string[]=[];
  const reference=(path:string)=>({path,get:async()=>({exists:store.has(path),data:()=>store.has(path)?structuredClone(store.get(path)):undefined})});
  const db={
    async runTransaction<T>(work:(tx:unknown)=>Promise<T>):Promise<T>{
      const staged:Array<()=>void>=[];
      const tx={
        async get(ref:{path:string}){return {exists:store.has(ref.path),data:()=>store.has(ref.path)?structuredClone(store.get(ref.path)):undefined};},
        set(ref:{path:string},data:Row,options?:{merge?:boolean}){staged.push(()=>{writes.push('set:'+ref.path);store.set(ref.path,options?.merge?{...(store.get(ref.path)??{}),...structuredClone(data)}:structuredClone(data));});},
        update(ref:{path:string},data:Row){if(!store.has(ref.path))throw new Error('NOT_FOUND');staged.push(()=>{writes.push('update:'+ref.path);store.set(ref.path,{...store.get(ref.path),...structuredClone(data)});});},
        delete(ref:{path:string}){if(!store.has(ref.path))return;staged.push(()=>{writes.push('delete:'+ref.path);store.delete(ref.path);});},
      };
      const result=await work(tx);for(const apply of staged)apply();return result;
    },
  };
  const root={path:'operator-local/drain-lease-root',collection:(name:string)=>({doc:(id:string)=>reference(name+'/'+id)})};
  return {db,root,store,writes};
}
type Double=ReturnType<typeof firestoreDouble>;
const acquire=(d:Double,holderId:string,now:number,ttlMs?:number)=>acquireDrainLease({db:d.db as never,root:d.root as never,holderId,now,...(ttlMs===undefined?{}:{ttlMs})});
const renew=(d:Double,holderId:string,token:number,now:number,ttlMs?:number,maxTenureMs?:number)=>renewDrainLease({db:d.db as never,root:d.root as never,holderId,token,now,...(ttlMs===undefined?{}:{ttlMs}),...(maxTenureMs===undefined?{}:{maxTenureMs})});
const release=(d:Double,holderId:string,token:number)=>releaseDrainLease({db:d.db as never,root:d.root as never,holderId,token});
const held=(d:Double,holderId:string,token:number,now:number,minRemainingMs?:number)=>assertDrainLeaseHeld({db:d.db as never,root:d.root as never,holderId,token,now,...(minRemainingMs===undefined?{}:{minRemainingMs})});
const cursor=(d:Double,kind:string)=>getDrainCursor({db:d.db as never,root:d.root as never,kind:kind as never});
const setCursor=(d:Double,kind:string,holderId:string,token:number,value:string|null,now:number)=>setDrainCursor({db:d.db as never,root:d.root as never,kind:kind as never,holderId,token,cursor:value,now});

describe('acquireDrainLease',()=>{
  it('takes a free lease and writes exactly the contract document plus the monotonic counter',async()=>{
    const d=firestoreDouble();
    expect(await acquire(d,'run-a',NOW)).toEqual({acquired:true,token:1,expiresAtMs:NOW+TTL});
    expect(d.store.get(LEASE)).toEqual({holderId:'run-a',token:1,expiresAtMs:NOW+TTL,acquiredAtMs:NOW,renewedAtMs:NOW});
    expect(d.store.get(COUNTER)).toEqual({token:1});
  });
  it('refuses while a live lease is held, by the same or by another holder, and writes nothing',async()=>{
    const d=firestoreDouble();
    await acquire(d,'run-a',NOW);
    d.writes.length=0;
    expect(await acquire(d,'run-b',NOW+1)).toEqual({acquired:false,reason:'held'});
    expect(await acquire(d,'run-a',NOW+2)).toEqual({acquired:false,reason:'held'});
    expect(d.writes).toEqual([]);
  });
  it('is decided by the injected clock: live one millisecond before the expiry, takeable at it',async()=>{
    const d=firestoreDouble();
    await acquire(d,'run-a',NOW,10_000);
    expect(await acquire(d,'run-b',NOW+9_999,10_000)).toEqual({acquired:false,reason:'held'});
    expect(await acquire(d,'run-b',NOW+10_000,10_000)).toEqual({acquired:true,token:2,expiresAtMs:NOW+20_000});
  });
  it('grows the token strictly after an expiry and after a release, and never reuses one',async()=>{
    const d=firestoreDouble();
    const first=await acquire(d,'run-a',NOW,10_000);
    const second=await acquire(d,'run-b',NOW+10_000,10_000);
    expect([first,second]).toEqual([{acquired:true,token:1,expiresAtMs:NOW+10_000},{acquired:true,token:2,expiresAtMs:NOW+20_000}]);
    expect(await release(d,'run-b',2)).toBe(true);
    expect(d.store.has(LEASE)).toBe(false);
    expect(await acquire(d,'run-c',NOW+20_000)).toEqual({acquired:true,token:3,expiresAtMs:NOW+20_000+TTL});
  });
  it('replaces the whole document: nothing of a previous holder is left behind',async()=>{
    const d=firestoreDouble({[LEASE]:{holderId:'run-a',token:4,expiresAtMs:NOW-1,acquiredAtMs:1,renewedAtMs:1,stray:'leftover'}});
    expect(await acquire(d,'run-b',NOW)).toEqual({acquired:true,token:5,expiresAtMs:NOW+TTL});
    expect(Object.keys(d.store.get(LEASE)!).sort()).toEqual(['acquiredAtMs','expiresAtMs','holderId','renewedAtMs','token']);
  });
  it('treats a malformed lease document as takeable, but never hands out a token at or below its numeric one',async()=>{
    for(const broken of [{holderId:'run-a',token:7,expiresAtMs:'soon'},{holderId:'run-a',token:7},{token:7,expiresAtMs:NOW+TTL},{holderId:'',token:7,expiresAtMs:NOW+TTL},{holderId:'run-a',token:7,expiresAtMs:NOW+TTL,acquiredAtMs:NOW+TTL+1,renewedAtMs:NOW+TTL+1}])
      expect(await acquire(firestoreDouble({[LEASE]:broken}),'run-b',NOW)).toEqual({acquired:true,token:8,expiresAtMs:NOW+TTL});
  });
  it('keeps the counter if only the lease document is lost',async()=>{
    expect(await acquire(firestoreDouble({[COUNTER]:{token:5}}),'run-a',NOW)).toEqual({acquired:true,token:6,expiresAtMs:NOW+TTL});
  });
  it('refuses to hand out a token past the safe integer range',async()=>{
    await expect(acquire(firestoreDouble({[COUNTER]:{token:Number.MAX_SAFE_INTEGER}}),'run-a',NOW)).rejects.toThrow('lease token exhausted');
  });
});

describe('renewDrainLease',()=>{
  it('extends only for the holder that owns a live lease with its own token',async()=>{
    const d=firestoreDouble();
    await acquire(d,'run-a',NOW);
    expect(await renew(d,'run-a',1,NOW+1,30_000)).toBe(true);
    // A shorter ttl never shortens the stored expiry: the renewal only moves forward, so the 90 s expiry is kept.
    expect(d.store.get(LEASE)).toEqual({holderId:'run-a',token:1,expiresAtMs:NOW+TTL,acquiredAtMs:NOW,renewedAtMs:NOW+1});
  });
  it('is refused, and writes nothing, for another holder, another token or an expired lease',async()=>{
    const d=firestoreDouble();
    await acquire(d,'run-a',NOW,10_000);
    const before=structuredClone(d.store.get(LEASE));
    d.writes.length=0;
    expect(await renew(d,'run-b',1,NOW+1)).toBe(false);
    expect(await renew(d,'run-a',2,NOW+1)).toBe(false);
    expect(await renew(d,'run-a',1,NOW+10_000)).toBe(false);
    expect(d.writes).toEqual([]);
    expect(d.store.get(LEASE)).toEqual(before);
  });
  it('refuses a token that is not a positive safe integer',async()=>{
    const d=firestoreDouble();
    await acquire(d,'run-a',NOW);
    for(const token of [0,-1,1.5,Number.NaN,Number.MAX_SAFE_INTEGER+1,'1',null])await expect(renew(d,'run-a',token as never,NOW)).rejects.toThrow('invalid lease token');
  });
});

describe('releaseDrainLease',()=>{
  it('removes the lease of the holder that owns it and keeps the counter for the next acquisition',async()=>{
    const d=firestoreDouble();
    await acquire(d,'run-a',NOW);
    expect(await release(d,'run-a',1)).toBe(true);
    expect(d.store.has(LEASE)).toBe(false);
    expect(d.store.get(COUNTER)).toEqual({token:1});
  });
  it('never deletes the lease of another holder or of another token',async()=>{
    const d=firestoreDouble();
    await acquire(d,'run-a',NOW);
    const before=structuredClone(d.store.get(LEASE));
    d.writes.length=0;
    expect(await release(d,'run-b',1)).toBe(false);
    expect(await release(d,'run-a',2)).toBe(false);
    expect(d.writes).toEqual([]);
    expect(d.store.get(LEASE)).toEqual(before);
  });
  it('releases an expired lease that still names the holder, so a stalled pass can clean up after itself',async()=>{
    const d=firestoreDouble();
    await acquire(d,'run-a',NOW,10_000);
    expect(await release(d,'run-a',1)).toBe(true);
    expect(d.store.has(LEASE)).toBe(false);
  });
});

describe('assertDrainLeaseHeld',()=>{
  it('accepts the holder with the required margin and refuses one millisecond short of it',async()=>{
    const d=firestoreDouble();
    await acquire(d,'run-a',NOW,20_000);
    expect(await held(d,'run-a',1,NOW,20_000)).toBe(true);
    expect(await held(d,'run-a',1,NOW,20_001)).toBe(false);
    expect(await held(d,'run-a',1,NOW+5_000)).toBe(true);
    expect(await held(d,'run-a',1,NOW+5_001)).toBe(false);
  });
  it('refuses another holder, another token, an expired lease and a missing lease, without ever writing',async()=>{
    const d=firestoreDouble();
    expect(await held(d,'run-a',1,NOW)).toBe(false);
    await acquire(d,'run-a',NOW,30_000);
    const before=structuredClone(d.store.get(LEASE));
    d.writes.length=0;
    expect(await held(d,'run-b',1,NOW)).toBe(false);
    expect(await held(d,'run-a',2,NOW)).toBe(false);
    expect(await held(d,'run-a',1,NOW+30_000)).toBe(false);
    expect(await held(d,'run-a',1,NOW+14_999)).toBe(true);
    expect(await held(d,'run-a',1,NOW+15_001)).toBe(false);
    expect(d.writes).toEqual([]);
    expect(d.store.get(LEASE)).toEqual(before);
  });
  it('uses the documented default margin when none is given',async()=>{
    const d=firestoreDouble();
    await acquire(d,'run-a',NOW,TTL);
    expect(await held(d,'run-a',1,NOW+TTL-MARGIN)).toBe(true);
    expect(await held(d,'run-a',1,NOW+TTL-MARGIN+1)).toBe(false);
  });
  it('accepts any non-negative safe margin, including one larger than the lease',async()=>{
    const d=firestoreDouble();
    await acquire(d,'run-a',NOW,10_000);
    expect(await held(d,'run-a',1,NOW,10_000)).toBe(true);
    expect(await held(d,'run-a',1,NOW,10_001)).toBe(false);
    expect(await held(d,'run-a',1,NOW,Number.MAX_SAFE_INTEGER)).toBe(false);
  });
  it('refuses a margin that is not a non-negative safe integer',async()=>{
    const d=firestoreDouble();
    await acquire(d,'run-a',NOW);
    for(const margin of [-1,1.5,Number.NaN,Number.POSITIVE_INFINITY,'5',2**60,null])await expect(held(d,'run-a',1,NOW,margin as never)).rejects.toThrow('invalid remaining margin');
  });
});

describe('the rotation cursor',()=>{
  it('is written only while the caller holds a live lease, and survives a change of holder',async()=>{
    const d=firestoreDouble();
    expect(await cursor(d,'intents')).toBeNull();
    await acquire(d,'run-a',NOW,10_000);
    expect(await setCursor(d,'intents','run-a',1,'doc-7',NOW)).toBe(true);
    expect(await setCursor(d,'holds','run-a',1,'hold-9',NOW)).toBe(true);
    // The three kinds share one document, so a write must merge: a plain replace would drop the other kinds.
    expect(d.store.get(CURSORS)).toEqual({intents:'doc-7',holds:'hold-9'});
    expect(await cursor(d,'intents')).toBe('doc-7');
    expect(await cursor(d,'holds')).toBe('hold-9');
    expect(await cursor(d,'outbox')).toBeNull();
    expect(await setCursor(d,'intents','run-a',1,null,NOW+1)).toBe(true);
    expect(await cursor(d,'intents')).toBeNull();
    expect(await cursor(d,'holds'),'clearing one kind must not drop another').toBe('hold-9');
    await acquire(d,'run-b',NOW+10_000,10_000);
    expect(await setCursor(d,'holds','run-b',2,'hold-3',NOW+10_000)).toBe(true);
    expect(await cursor(d,'holds')).toBe('hold-3');
    expect(await cursor(d,'intents')).toBeNull();
  });
  it('is refused, and left untouched, for another holder, another token or an expired lease',async()=>{
    const d=firestoreDouble();
    await acquire(d,'run-a',NOW,10_000);
    await setCursor(d,'outbox','run-a',1,'keep-me',NOW);
    const before=structuredClone(d.store.get(CURSORS));
    d.writes.length=0;
    expect(await setCursor(d,'outbox','run-b',1,'other',NOW)).toBe(false);
    expect(await setCursor(d,'outbox','run-a',2,'other',NOW)).toBe(false);
    expect(await setCursor(d,'outbox','run-a',1,'other',NOW+10_000)).toBe(false);
    expect(d.writes).toEqual([]);
    expect(d.store.get(CURSORS)).toEqual(before);
  });
  it('refuses an unknown kind and a cursor that is not a plain document id',async()=>{
    const d=firestoreDouble();
    await acquire(d,'run-a',NOW);
    for(const kind of ['','intent','intents ','jobs',null,5])await expect(cursor(d,kind as never)).rejects.toThrow('invalid cursor kind');
    for(const value of ['a/b','.','..','x'.repeat(1501),'bad\u0000id',''])
      await expect(setCursor(d,'intents','run-a',1,value,NOW)).rejects.toThrow('invalid cursor id');
  });
});

describe('parameter validation and error hygiene',()=>{
  const marker='S3CR3T';
  it('refuses an unusable holder id, clock or ttl with a fixed message that never carries the value',async()=>{
    const d=firestoreDouble();
    const rejects=async(work:()=>Promise<unknown>,message:string)=>{
      let caught:unknown=null;
      try{await work();}catch(error){caught=error;}
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toBe(message);
      expect((caught as Error).message.includes(marker)).toBe(false);
    };
    for(const holderId of ['',`${marker}\u0000tail`,`${marker}.${'x'.repeat(400)}`,'a/b',null,7,{}])await rejects(()=>acquire(d,holderId as never,NOW),'invalid holder id');
    for(const now of [-1,1.5,Number.NaN,Number.POSITIVE_INFINITY,2**60,'0',null])await rejects(()=>acquire(d,'run-a',now as never),'invalid clock');
    for(const ttl of [0,-1,999,600_001,1.5,Number.NaN,'90000',null])await rejects(()=>acquire(d,'run-a',NOW,ttl as never),'invalid lease ttl');
    expect(d.writes).toEqual([]);
  });
  it('does not touch the store when a parameter is refused',async()=>{
    const d=firestoreDouble();
    await expect(acquire(d,'',NOW)).rejects.toThrow('invalid holder id');
    expect(d.store.size).toBe(0);
  });
});

describe('renewDrainLease is monotonic under a clock that steps back',()=>{
  it('keeps the expiry from shrinking and the document readable when now is behind the stored renewal',async()=>{
    const d=firestoreDouble();
    await acquire(d,'run-a',NOW,30_000);
    // A renewal with the same clock sets renewedAtMs to NOW and the expiry to NOW+ttl.
    expect(await renew(d,'run-a',1,NOW,30_000)).toBe(true);
    expect(d.store.get(LEASE)).toEqual({holderId:'run-a',token:1,expiresAtMs:NOW+30_000,acquiredAtMs:NOW,renewedAtMs:NOW});
    // The clock now steps BACK (an NTP correction): the document must never move backwards.
    expect(await renew(d,'run-a',1,NOW-5_000,30_000)).toBe(true);
    const stored=d.store.get(LEASE)!;
    expect(stored.renewedAtMs,'renewedAtMs is pinned to the stored value, never behind it').toBe(NOW);
    expect(stored.acquiredAtMs).toBe(NOW);
    expect(stored.expiresAtMs,'the expiry is never shortened by a backwards clock').toBe(NOW+30_000);
    // The lease is still well formed and still renewable: the holder must not lose its own lease.
    expect(await held(d,'run-a',1,NOW)).toBe(true);
    expect(await renew(d,'run-a',1,NOW+1_000,30_000)).toBe(true);
    expect(d.store.get(LEASE)).toEqual({holderId:'run-a',token:1,expiresAtMs:NOW+31_000,acquiredAtMs:NOW,renewedAtMs:NOW+1_000});
  });
  it('still refuses a lease that is already expired for the caller clock, even with a live stored renewal',async()=>{
    const d=firestoreDouble();
    await acquire(d,'run-a',NOW,10_000);
    expect(await renew(d,'run-a',1,NOW+10_000),'the ownership gate uses the caller now').toBe(false);
    expect(d.store.get(LEASE)).toEqual({holderId:'run-a',token:1,expiresAtMs:NOW+10_000,acquiredAtMs:NOW,renewedAtMs:NOW});
  });
  it('extends from the stored renewal when the caller clock is ahead, so the ttl is measured from the last renewal',async()=>{
    const d=firestoreDouble();
    await acquire(d,'run-a',NOW,30_000);
    expect(await renew(d,'run-a',1,NOW+1_000,30_000)).toBe(true);
    expect(d.store.get(LEASE)).toEqual({holderId:'run-a',token:1,expiresAtMs:NOW+31_000,acquiredAtMs:NOW,renewedAtMs:NOW+1_000});
  });
});

describe('renewDrainLease respects a maximum tenure',()=>{
  it('refuses, and writes nothing, at exactly the tenure limit and accepts one millisecond short of it',async()=>{
    const d=firestoreDouble();
    await acquire(d,'run-a',NOW,MAX_DRAIN_LEASE_TTL_MS);
    const before=structuredClone(d.store.get(LEASE));
    d.writes.length=0;
    expect(await renew(d,'run-a',1,NOW+DEFAULT_DRAIN_LEASE_MAX_TENURE_MS,MAX_DRAIN_LEASE_TTL_MS,DEFAULT_DRAIN_LEASE_MAX_TENURE_MS),'now - acquired === limit refuses').toBe(false);
    expect(d.writes).toEqual([]);
    expect(d.store.get(LEASE)).toEqual(before);
    expect(await renew(d,'run-a',1,NOW+DEFAULT_DRAIN_LEASE_MAX_TENURE_MS-1,MAX_DRAIN_LEASE_TTL_MS,DEFAULT_DRAIN_LEASE_MAX_TENURE_MS),'one millisecond short accepts').toBe(true);
    expect(d.store.get(LEASE)!.renewedAtMs).toBe(NOW+DEFAULT_DRAIN_LEASE_MAX_TENURE_MS-1);
  });
  it('honours a caller-supplied tenure and uses the documented default of twice the pass budget',async()=>{
    const d=firestoreDouble();
    await acquire(d,'run-a',NOW,TTL);
    expect(DEFAULT_DRAIN_LEASE_MAX_TENURE_MS).toBe(120_000);
    expect(DEFAULT_DRAIN_LEASE_RENEW_EVERY_MS).toBe(10_000);
    expect(await renew(d,'run-a',1,NOW+10_000,TTL,10_000),'a custom limit of 10 s is reached').toBe(false);
    expect(await renew(d,'run-a',1,NOW+9_999,TTL,10_000)).toBe(true);
  });
  it('refuses a tenure that is not a safe integer inside the allowed range',async()=>{
    const d=firestoreDouble();
    await acquire(d,'run-a',NOW);
    for(const maxTenureMs of [0,-1,999,600_001,1.5,Number.NaN,'120000',null])await expect(renew(d,'run-a',1,NOW,TTL,maxTenureMs as never)).rejects.toThrow('invalid max tenure');
  });
});

describe('a lease whose expiry window is unbounded is not trusted',()=>{
  it('treats a document whose stored window exceeds the maximum ttl as malformed',async()=>{
    const d=firestoreDouble({[LEASE]:{holderId:'run-a',token:4,expiresAtMs:NOW+MAX_DRAIN_LEASE_TTL_MS+1,acquiredAtMs:NOW,renewedAtMs:NOW}});
    expect(await acquire(d,'run-b',NOW),'an oversized window is takeable').toEqual({acquired:true,token:5,expiresAtMs:NOW+TTL});
  });
  it('accepts exactly the maximum window and refuses one millisecond past it',async()=>{
    const within=firestoreDouble({[LEASE]:{holderId:'run-a',token:4,expiresAtMs:NOW+MAX_DRAIN_LEASE_TTL_MS,acquiredAtMs:NOW,renewedAtMs:NOW}});
    expect(await acquire(within,'run-b',NOW),'exactly MAX is still a live lease').toEqual({acquired:false,reason:'held'});
    const beyond=firestoreDouble({[LEASE]:{holderId:'run-a',token:4,expiresAtMs:NOW+MAX_DRAIN_LEASE_TTL_MS+1,acquiredAtMs:NOW,renewedAtMs:NOW}});
    expect(await acquire(beyond,'run-b',NOW),'MAX+1 is not').toEqual({acquired:true,token:5,expiresAtMs:NOW+TTL});
  });
  it('rejects an oversized stored window even when the expiry is not far ahead of now',async()=>{
    // The stored window (expiresAtMs - renewedAtMs) exceeds MAX, but the expiry is only 500 s ahead of now: only the
    // window bound in readLease can reject this document, so it isolates that bound from the forward-window bound.
    const d=firestoreDouble({[LEASE]:{holderId:'run-a',token:4,expiresAtMs:NOW+500_001,acquiredAtMs:NOW-100_000,renewedAtMs:NOW-100_000}});
    expect(await acquire(d,'run-b',NOW),'an oversized window is takeable').toEqual({acquired:true,token:5,expiresAtMs:NOW+TTL});
    expect(await held(d,'run-a',4,NOW),'and it never reads as a live lease').toBe(false);
  });
  it('ignores a stored expiry too far ahead of the caller clock, so a clock-skewed writer cannot pin the lease',async()=>{
    const d=firestoreDouble({[LEASE]:{holderId:'run-a',token:4,expiresAtMs:NOW+MAX_DRAIN_LEASE_TTL_MS,acquiredAtMs:NOW,renewedAtMs:NOW}});
    // The document itself is well formed, but it is more than the maximum window in the future of this clock.
    expect(await held(d,'run-a',4,NOW-1),'an expiry more than MAX ahead of now is not a live lease').toBe(false);
    expect(await renew(d,'run-a',4,NOW-1)).toBe(false);
    expect(await acquire(d,'run-b',NOW-1)).toEqual({acquired:true,token:5,expiresAtMs:NOW-1+TTL});
  });
});

describe('a stored token that is not a positive safe integer is ignored',()=>{
  it('treats an oversized counter token as absent and hands out token 1',async()=>{
    const d=firestoreDouble({[COUNTER]:{token:Number.MAX_SAFE_INTEGER+1}});
    expect(await acquire(d,'run-a',NOW)).toEqual({acquired:true,token:1,expiresAtMs:NOW+TTL});
    expect(d.store.get(COUNTER)).toEqual({token:1});
  });
  it('treats a non-numeric counter token as absent and hands out token 1',async()=>{
    for(const stored of ['7',null,{},[],Number.NaN,1.5,0,-3]){
      const d=firestoreDouble({[COUNTER]:{token:stored}});
      expect(await acquire(d,'run-a',NOW)).toEqual({acquired:true,token:1,expiresAtMs:NOW+TTL});
    }
  });
  it('fences by equality of holder and token, so a reset token cannot keep a stale holder in',async()=>{
    const d=firestoreDouble({[COUNTER]:{token:Number.MAX_SAFE_INTEGER+1}});
    const got=await acquire(d,'run-a',NOW,10_000);
    expect(got).toEqual({acquired:true,token:1,expiresAtMs:NOW+10_000});
    // The stale holder presents the token it believes it holds; it is not equal to the stored one, so it is fenced out.
    expect(await renew(d,'run-a',99,NOW+1)).toBe(false);
    expect(await release(d,'run-a',99)).toBe(false);
    expect(await renew(d,'run-a',1,NOW+1)).toBe(true);
  });
});

describe('the rotation cursor rejects reserved document ids',()=>{
  it('refuses the Firestore reserved ids of the form __...__ and keeps accepting plain ids',async()=>{
    const d=firestoreDouble();
    await acquire(d,'run-a',NOW);
    for(const value of ['__name__','__id__','__x__','__a_b__'])await expect(setCursor(d,'intents','run-a',1,value,NOW)).rejects.toThrow('invalid cursor id');
    // The reserved form needs at least four characters (__x__); a bare "__" is an ordinary, valid document id.
    expect(await setCursor(d,'intents','run-a',1,'__',NOW)).toBe(true);
    expect(await setCursor(d,'intents','run-a',1,'_not_reserved',NOW)).toBe(true);
    expect(await setCursor(d,'intents','run-a',1,'doc__7',NOW)).toBe(true);
    expect(await getDrainCursor({db:d.db as never,root:d.root as never,kind:'intents'})).toBe('doc__7');
  });
  it('also refuses a reserved id already stored, so a poisoned cursor reads as null',async()=>{
    const d=firestoreDouble({[CURSORS]:{intents:'__name__'}});
    expect(await cursor(d,'intents')).toBeNull();
  });
});
describe('the drain lease keeps its import fence',()=>{
  const commercialRoot=dirname(fileURLToPath(import.meta.url));
  const entry=join(commercialRoot,'billingDrainLease.ts');
  // Fed from parts so this test file itself does not name the operator modules (another fence forbids that mention).
  const FORBIDDEN=new Set(['firestore'+'Backend','firestore'+'Ai','accountBilling'+'Client','billingFairQueue','billingNextAttemptMigration','billing'+'SweepSection','cloudFiles'+'Runtime',...['Http','Config','Local'].map(s=>'billing'+'Operator'+s)]);
  const ALLOWED_BARE=/^(node:|firebase-admin($|\/))/;
  const EXT=['.ts','.tsx','.mts','.cts','.js','.mjs','.cjs','.jsx'];
  const scan=(text:string)=>{
    const specifiers=preProcessFile(text,true,false).importedFiles.map(f=>f.fileName);
    const sf=createSourceFile('scan.ts',text,ScriptTarget.Latest,true);
    let nonLiteralDynamic=false;
    const visit=(node:Node)=>{
      if(isCallExpression(node)){
        const isRequire=isIdentifier(node.expression)&&node.expression.text==='require';
        const isImportCall=node.expression.kind===SyntaxKind.ImportKeyword;
        if((isRequire||isImportCall)&&!(node.arguments.length>0&&isStringLiteralLike(node.arguments[0])))nonLiteralDynamic=true;
      }
      forEachChild(node,visit);
    };
    forEachChild(sf,visit);
    return {specifiers,nonLiteralDynamic};
  };
  const canonical=(fromFile:string,spec:string)=>{
    const base=join(dirname(fromFile),spec);
    if(EXT.some(e=>base.endsWith(e)))return base;
    for(const e of EXT)if(existsSync(base+e))return base+e;
    if(existsSync(base))return base;
    return base+'.ts';
  };
  const closure=()=>{
    const seen=new Set<string>(),queue=[entry],nonLiteral:string[]=[];
    while(queue.length){
      const file=queue.shift()!;
      if(seen.has(file))continue;
      seen.add(file);
      const {specifiers,nonLiteralDynamic}=scan(readFileSync(file,'utf8'));
      if(nonLiteralDynamic)nonLiteral.push(relative(commercialRoot,file));
      for(const spec of specifiers)if(spec.startsWith('./')||spec.startsWith('../'))queue.push(canonical(file,spec));
    }
    return {seen,nonLiteral};
  };
  it('walks every transitive import and stays inside server/commercial with an exact, frozen set',()=>{
    expect(existsSync(entry)).toBe(true);
    const names=[...closure().seen].map(f=>relative(commercialRoot,f).split('\\').join('/')).sort();
    expect(names).toEqual(['billingDrainLease.ts']);
  });
  it('imports no write path, no billing mode and nothing outside its fence',()=>{
    for(const file of closure().seen){
      const {specifiers}=scan(readFileSync(file,'utf8'));
      for(const spec of specifiers){
        if(spec.startsWith('./')||spec.startsWith('../')){
          const name=relative(commercialRoot,canonical(file,spec)).split('\\').join('/').replace(/\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/,'');
          expect(FORBIDDEN.has(name),spec+' from '+relative(commercialRoot,file)+' resolves to '+name).toBe(false);
        }else{
          expect(ALLOWED_BARE.test(spec),'unexpected bare specifier '+spec+' in '+relative(commercialRoot,file)).toBe(true);
        }
      }
    }
  });
  it('never calls the wall clock and never logs',()=>{
    const source=readFileSync(entry,'utf8');
    expect(source).not.toMatch(/Date\.now/);
    expect(source).not.toMatch(/new Date\b/);
    expect(source).not.toMatch(/console\./);
  });
  it('exports exactly the contract surface and the documented cursor kinds',async()=>{
    const module=await import('./billingDrainLease');
    expect(Object.keys(module).sort()).toEqual(['DEFAULT_DRAIN_LEASE_MARGIN_MS','DEFAULT_DRAIN_LEASE_MAX_TENURE_MS','DEFAULT_DRAIN_LEASE_RENEW_EVERY_MS','DEFAULT_DRAIN_LEASE_TTL_MS','DRAIN_CURSOR_KINDS','DRAIN_LEASE_COLLECTION','DRAIN_LEASE_COUNTER_DOC_ID','DRAIN_LEASE_CURSOR_DOC_ID','DRAIN_LEASE_DOC_ID','MAX_DRAIN_LEASE_MAX_TENURE_MS','MAX_DRAIN_LEASE_TTL_MS','MIN_DRAIN_LEASE_MAX_TENURE_MS','MIN_DRAIN_LEASE_TTL_MS','acquireDrainLease','assertDrainLeaseHeld','getDrainCursor','releaseDrainLease','renewDrainLease','setDrainCursor']);
    // LV-019.B step 1.2 adds the unknown rotation cursor used by the expired-unknown resolver alongside the three drain kinds.
    expect(DRAIN_CURSOR_KINDS).toEqual(['intents','outbox','holds','unknown','age']);
    expect(TTL).toBe(90_000);expect(MARGIN).toBe(15_000);
  });
});
