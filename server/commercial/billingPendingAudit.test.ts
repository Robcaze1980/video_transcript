// LV-019.B phase 2, piece D: audited human disposition of an alert, exactly once. It never moves balance and never
// edits a billing row; it only creates an immutable audit record and updates the alert in the same transaction.
import {describe,expect,it} from 'vitest';
import {buildPendingReport,readPendingReport,type PendingRow} from './billingPendingReport';
import {ALERT_COLLECTION,alertIdentity,alertKey,clearResolvedAlerts,raisePendingAlerts,raiseSweepAlert} from './billingPendingAlerts';
import {AUDIT_COLLECTION,AuditFault,auditId,recordDisposition} from './billingPendingAudit';
import {stub} from './billingFirestoreStub';

const NOW=7_000_000;
const row=(over:Partial<PendingRow>):PendingRow=>({kind:'hold',id:'h1',state:'needs_review',createdAtMs:1000,nextAttemptAt:null,attempts:0,lastErrorCode:null,accountId:'11111111-1111-4111-8111-111111111111',malformed:false,...over});
const KEY=alertKey('hold','h1','needs_review','needs_review');
const who={authorizedBy:'owner-1',evidenceRef:'ticket-42',note:'checked with the provider statement'};
async function seeded(){
  const s=stub({billingHoldOutbox:{h1:{state:'needs_review',createdAtMs:1000}},accounts:{x:{available:5,reserved:2}},ledgerEntries:{l1:{kind:'video_reserve'}}});
  await raisePendingAlerts(s.db as never,s.root as never,buildPendingReport([row({})],NOW),NOW);
  s.writes.length=0;return s;
}
const audits=(s:ReturnType<typeof stub>)=>[...s.store.entries()].filter(([k])=>k.startsWith(AUDIT_COLLECTION+'/'));
const alertDoc=(s:ReturnType<typeof stub>)=>s.store.get(`${ALERT_COLLECTION}/${KEY}`)!;
const fault=async(p:Promise<unknown>)=>{try{await p;}catch(e){return e instanceof AuditFault?e.code:'other:'+String(e);}return 'none';};

describe('input validation (bounds on the input, not business policy)',()=>{
  it('rejects bad keys, actions, actors, evidence and notes without writing anything',async()=>{
    const s=await seeded();const go=(k:string,a:string,d:Record<string,unknown>)=>fault(recordDisposition(s.db as never,s.root as never,k,a as never,d as never,NOW));
    expect(await go('nope','resolve',who)).toBe('invalid');
    expect(await go(KEY,'delete',who)).toBe('invalid');
    expect(await go(KEY,'resolve',{...who,authorizedBy:'Robert Carrillo <a@b.c>'})).toBe('invalid');
    expect(await go(KEY,'resolve',{...who,authorizedBy:''})).toBe('invalid');
    expect(await go(KEY,'resolve',{...who,evidenceRef:''})).toBe('invalid');
    expect(await go(KEY,'resolve',{...who,evidenceRef:'x\nINJECT'})).toBe('invalid');
    expect(await go(KEY,'resolve',{...who,note:'y'.repeat(2000)})).toBe('invalid');
    expect(await go(KEY,'resolve',{...who,note:'ctrl\u0007char'})).toBe('invalid');
    await expect(recordDisposition(s.db as never,s.root as never,KEY,'resolve',who,-1)).rejects.toThrow();
    expect(s.writes).toEqual([]);
  });
  it('treats an alert with inverted timestamps or an over-long multibyte row id as corrupt',async()=>{
    const s=await seeded();
    s.store.set(`${ALERT_COLLECTION}/${KEY}`,{...alertDoc(s),firstSeenAtMs:100,lastSeenAtMs:50});
    expect(await fault(recordDisposition(s.db as never,s.root as never,KEY,'resolve',who,NOW))).toBe('corrupt');
    const big='\u00e9'.repeat(800),bk=alertKey('hold',big,'needs_review','needs_review');
    s.store.set(`${ALERT_COLLECTION}/${bk}`,{alertKey:bk,kind:'hold',rowId:big,state:'needs_review',reason:'needs_review',accountId:null,status:'open',seenCount:1,firstSeenAtMs:1,lastSeenAtMs:1});
    expect(await fault(recordDisposition(s.db as never,s.root as never,bk,'resolve',who,NOW))).toBe('corrupt');
    expect(s.writes).toEqual([]);
  });
  it('rejects unknown properties instead of silently ignoring them',async()=>{
    const s=await seeded();
    expect(await fault(recordDisposition(s.db as never,s.root as never,KEY,'resolve',{...who,approvedBy:'someone'} as never,NOW))).toBe('invalid');
    expect(s.writes).toEqual([]);
  });
  it('treats an alert whose row id is a path as corrupt, even when its key was computed consistently',async()=>{
    const s=await seeded();const evil=alertKey('hold','a/b','needs_review','needs_review');
    s.store.set(`${ALERT_COLLECTION}/${evil}`,{alertKey:evil,kind:'hold',rowId:'a/b',state:'needs_review',reason:'needs_review',accountId:null,status:'open',seenCount:1,firstSeenAtMs:1,lastSeenAtMs:1});
    expect(await fault(recordDisposition(s.db as never,s.root as never,evil,'resolve',who,NOW))).toBe('corrupt');
    expect(await clearResolvedAlerts(s.db as never,s.root as never,buildPendingReport([],NOW),NOW)).toMatchObject({corrupt:1});
    expect(s.writes).toEqual([]);
  });
  it('a resolution needs evidence; an acknowledgement does not',async()=>{
    const s=await seeded();
    expect(await fault(recordDisposition(s.db as never,s.root as never,KEY,'resolve',{authorizedBy:'owner-1'} as never,NOW))).toBe('invalid');
    expect(await recordDisposition(s.db as never,s.root as never,KEY,'acknowledge',{authorizedBy:'owner-1'},NOW)).toEqual({replayed:false});
  });
});

describe('acknowledge',()=>{
  it('keeps the alert OPEN (attention is not hidden), records who and when, and writes an immutable audit record',async()=>{
    const s=await seeded();
    expect(await recordDisposition(s.db as never,s.root as never,KEY,'acknowledge',who,NOW+1)).toEqual({replayed:false});
    expect(alertDoc(s)).toMatchObject({status:'open',acknowledgedAtMs:NOW+1,acknowledgedBy:'owner-1',acknowledgeAuditId:auditId(KEY,'acknowledge')});
    const [[,a]]=audits(s);
    expect(a).toMatchObject({auditId:auditId(KEY,'acknowledge'),alertKey:KEY,action:'acknowledge',authorizedBy:'owner-1',evidenceRef:'ticket-42',createdAtMs:NOW+1,kind:'hold',rowId:'h1',state:'needs_review',reason:'needs_review'});
    expect(JSON.stringify(a)).not.toMatch(/identityKey|uid|email/);
  });
});

describe('resolve',()=>{
  it('closes the alert as dispositioned with the observed row state, and never edits the row or any balance data',async()=>{
    const s=await seeded();
    await recordDisposition(s.db as never,s.root as never,KEY,'resolve',who,NOW+2);
    expect(alertDoc(s)).toMatchObject({status:'dispositioned',dispositionedAtMs:NOW+2,dispositionedBy:'owner-1',dispositionAuditId:auditId(KEY,'resolve')});
    expect(audits(s)[0][1]).toMatchObject({action:'resolve',observedRowState:'needs_review'});
    expect(s.store.get('billingHoldOutbox/h1')).toEqual({state:'needs_review',createdAtMs:1000});
    expect(s.store.get('accounts/x')).toEqual({available:5,reserved:2});expect(s.store.get('ledgerEntries/l1')).toEqual({kind:'video_reserve'});
    expect(s.writes.sort()).toEqual([`create:${AUDIT_COLLECTION}/${auditId(KEY,'resolve')}`,`update:${ALERT_COLLECTION}/${KEY}`].sort());
  });
  it('a missing row is recorded as such; a sweep alert has no row to observe',async()=>{
    const s=await seeded();s.store.delete('billingHoldOutbox/h1');
    await recordDisposition(s.db as never,s.root as never,KEY,'resolve',who,NOW+2);
    expect(audits(s)[0][1].observedRowState).toBe('missing');
    const t=stub();await raiseSweepAlert(t.db as never,t.root as never,'sweep_failed',NOW);
    const sk=alertKey('sweep','sweep','sweep_failed','sweep_failed');
    await recordDisposition(t.db as never,t.root as never,sk,'resolve',who,NOW+1);
    expect([...t.store.values()].find(d=>d.action==='resolve')).toMatchObject({observedRowState:null,kind:'sweep'});
  });
  it('can follow an acknowledgement',async()=>{
    const s=await seeded();
    await recordDisposition(s.db as never,s.root as never,KEY,'acknowledge',who,NOW+1);
    await recordDisposition(s.db as never,s.root as never,KEY,'resolve',{...who,evidenceRef:'ticket-43'},NOW+2);
    expect(alertDoc(s).status).toBe('dispositioned');expect(audits(s)).toHaveLength(2);
  });
});

describe('exactly once',()=>{
  it('an identical repeat is a replay that writes nothing; a different payload is a conflict that changes nothing',async()=>{
    const s=await seeded();
    await recordDisposition(s.db as never,s.root as never,KEY,'resolve',who,NOW+1);s.writes.length=0;
    expect(await recordDisposition(s.db as never,s.root as never,KEY,'resolve',who,NOW+500)).toEqual({replayed:true});
    expect(s.writes).toEqual([]);
    for(const other of [{...who,authorizedBy:'someone-else'},{...who,evidenceRef:'other'},{...who,note:'changed'}])
      expect(await fault(recordDisposition(s.db as never,s.root as never,KEY,'resolve',other,NOW+2))).toBe('conflict');
    expect(s.writes).toEqual([]);expect(audits(s)).toHaveLength(1);expect(alertDoc(s).dispositionedAtMs).toBe(NOW+1);
  });
  it('two people resolving at once: the second sees the first audit record and gets a conflict',async()=>{
    const s=await seeded();const original=s.db.runTransaction.bind(s.db);let once=false;
    (s.db as {runTransaction:unknown}).runTransaction=(fn:(tx:unknown)=>Promise<unknown>)=>{
      if(!once){once=true;s.store.set(`${AUDIT_COLLECTION}/${auditId(KEY,'resolve')}`,{auditId:auditId(KEY,'resolve'),alertKey:KEY,action:'resolve',authorizedBy:'first-person',evidenceRef:'ev-1',note:null,createdAtMs:NOW});
        s.store.set(`${ALERT_COLLECTION}/${KEY}`,{...alertDoc(s),status:'dispositioned'});}
      return original(fn);};
    expect(await fault(recordDisposition(s.db as never,s.root as never,KEY,'resolve',{...who,authorizedBy:'second-person'},NOW+1))).toBe('conflict');
    expect(s.writes).toEqual([]);
  });
});

describe('refusals',()=>{
  it('does nothing for a missing, corrupt, cleared, superseded or already dispositioned alert',async()=>{
    const s=await seeded();
    expect(await fault(recordDisposition(s.db as never,s.root as never,alertKey('hold','zz','needs_review','needs_review'),'resolve',who,NOW))).toBe('not_found');
    for(const status of ['cleared','superseded','dispositioned']){
      s.store.set(`${ALERT_COLLECTION}/${KEY}`,{...alertDoc(s),status});
      expect(await fault(recordDisposition(s.db as never,s.root as never,KEY,'resolve',who,NOW))).toBe('conflict');
    }
    s.store.set(`${ALERT_COLLECTION}/${KEY}`,{...alertDoc(s),status:'open',rowId:'tampered'});
    expect(await fault(recordDisposition(s.db as never,s.root as never,KEY,'resolve',who,NOW))).toBe('corrupt');
    expect(s.writes).toEqual([]);
  });
});

describe('interaction with the alert module',()=>{
  it('a dispositioned alert is never reopened or re-alerted by a later sighting, and the system never clears it',async()=>{
    const s=await seeded();await recordDisposition(s.db as never,s.root as never,KEY,'resolve',who,NOW+1);
    const out=await raisePendingAlerts(s.db as never,s.root as never,buildPendingReport([row({})],NOW+9),NOW+9);
    expect(out).toEqual({created:0,seen:1});expect(alertDoc(s)).toMatchObject({status:'dispositioned',seenCount:2,lastSeenAtMs:NOW+9});
    s.store.set('billingHoldOutbox/h1',{state:'applied'});
    expect(await clearResolvedAlerts(s.db as never,s.root as never,buildPendingReport([],NOW+10),NOW+10)).toMatchObject({cleared:0});
  });
  it('an acknowledged alert is still subject to normal clearing',async()=>{
    const s=await seeded();await recordDisposition(s.db as never,s.root as never,KEY,'acknowledge',who,NOW+1);
    s.store.set('billingHoldOutbox/h1',{state:'applied'});
    expect(await clearResolvedAlerts(s.db as never,s.root as never,buildPendingReport([],NOW+2),NOW+2)).toMatchObject({cleared:1});
    expect(alertDoc(s)).toMatchObject({status:'cleared',acknowledgedBy:'owner-1'});
  });
});

describe('guard owner attribution in alert identity and operator audit',()=>{
  const accountA='11111111-1111-4111-8111-111111111111',accountB='22222222-2222-4222-8222-222222222222';
  async function guardAlert(){
    const guardA={accountId:accountA,blocked:true,lastIncidentId:'a'.repeat(64),epoch:1,createdAtMs:1_000};
    const guardB={accountId:accountB,blocked:false};
    const s=stub({billingGuards:{[accountA]:guardA,[accountB]:guardB},accounts:{[accountA]:{available:12},[accountB]:{available:53}}});
    const report=await readPendingReport(s.root as never,NOW);
    await raisePendingAlerts(s.db as never,s.root as never,report,NOW);
    const key=alertKey('guard',accountA,report.rows[0].state,'needs_review'),path=ALERT_COLLECTION+'/'+key,original=s.store.get(path)!;
    expect(original).toMatchObject({kind:'guard',rowId:accountA,accountId:accountA,alertKey:key,status:'open'});
    s.writes.length=0;
    return {s,key,path,original,guardA,guardB};
  }
  it('guard alert identity does not expose a foreign owner attached to the original key',async()=>{
    const {s,key,path,original}=await guardAlert();
    s.store.set(path,{...original,accountId:accountB});
    const identity=alertIdentity({exists:true,id:key,data:()=>s.store.get(path)});
    // Either reject the record or explicitly withhold the hint. Never invent A from this alert alone.
    expect(identity?.accountId??null).toBe(null);
    expect(s.writes).toEqual([]);
  });
  for(const action of ['acknowledge','resolve'] as const){
    it('guard disposition '+action+' does not propagate a foreign hint to the new audit record',async()=>{
      const {s,key,path,original,guardA,guardB}=await guardAlert();
      s.store.set(path,{...original,accountId:accountB});
      const result=await fault(recordDisposition(s.db as never,s.root as never,key,action,who,NOW+1));
      const audit=s.store.get(AUDIT_COLLECTION+'/'+auditId(key,action));
      expect(s.store.get('billingGuards/'+accountA)).toEqual(guardA);
      expect(s.store.get('billingGuards/'+accountB)).toEqual(guardB);
      expect(s.store.get('accounts/'+accountA)).toEqual({available:12});
      expect(s.store.get('accounts/'+accountB)).toEqual({available:53});
      if(result==='corrupt'){expect(s.writes).toEqual([]);expect(audit).toBeUndefined();return;}
      expect(result).toBe('none');expect(audit).toBeDefined();
      expect(audit!.accountId,'an operator action must not perpetuate an unverified owner').toBe(null);
    });
  }
  it('retains an explicitly unattributed guard observation without inventing an owner',async()=>{
    const {s,key,path,original}=await guardAlert();
    s.store.set(path,{...original,accountId:null});
    expect(alertIdentity({exists:true,id:key,data:()=>s.store.get(path)})).toMatchObject({rowId:accountA,accountId:null});
    expect(await fault(recordDisposition(s.db as never,s.root as never,key,'acknowledge',who,NOW+1))).toBe('none');
    expect(s.store.get(AUDIT_COLLECTION+'/'+auditId(key,'acknowledge'))).toMatchObject({accountId:null});
    expect(s.store.get(path)?.accountId).toBe(null);
  });
});
