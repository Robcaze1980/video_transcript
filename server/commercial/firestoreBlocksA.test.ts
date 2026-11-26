// LV-019.B paso 1.4a: puro (sin emulador). Fuente `guard` del reporte de Video, su clave por
// cuenta y epoca, y el trato de un guard sin hold ni incidencia. Rojo hoy: `PENDING_SOURCES`
// no incluye `guard` y `attentionOf` no marca `needs_review` una fila de guard.
import {describe,expect,it} from 'vitest';
import {PENDING_SOURCES,buildPendingReport,normalizePending,readPendingReport,type PendingRow} from './billingPendingReport';
import {ALERT_COLLECTION,alertKey,clearResolvedAlerts,raisePendingAlerts} from './billingPendingAlerts';
import {stub} from './billingFirestoreStub';

const NOW=10_000_000,ACC='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
const guardSource=()=>PENDING_SOURCES.find(source=>source.kind==='guard');

describe('la fuente guard del reporte de Video',()=>{
 it('declara billingGuards filtrado por un solo campo `blocked == true`, sin indice compuesto',()=>{
  const source=guardSource();
  expect(source).toBeTruthy();
  expect(source).toMatchObject({kind:'guard',collection:'billingGuards'});
  // Un solo campo de filtro, booleano: Firestore sirve la igualdad con su indice de un solo campo.
  expect(source!.filter).toEqual({field:'blocked',value:true});
  expect(source!.terminalStates).toEqual([]);
 });
 it('lee una fila por cuenta bloqueada y la marca needs_review',async()=>{
  const report=await readPendingReport(stub({billingGuards:{[ACC]:{accountId:ACC,blocked:true,lastIncidentId:'inc-1'}}}).root as never,NOW);
  const rows=report.rows.filter(row=>row.kind==='guard');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({kind:'guard',id:ACC,accountId:ACC,malformed:false,attention:'needs_review'});
 });
 it('reports a blocked guard with a different account in its document path without attributing an owner',async()=>{
  const guard={accountId:OTHER,blocked:true,lastIncidentId:'inc-foreign',epoch:2,createdAtMs:1_000};
  const s=stub({billingGuards:{[ACC]:guard}});
  const report=await readPendingReport(s.root as never,NOW);
  expect(report.rows).toEqual([
    expect.objectContaining({kind:'guard',id:ACC,accountId:null,malformed:true,attention:'malformed'}),
  ]);
  expect(report.attention).toEqual(report.rows);
  expect(s.store.get('billingGuards/'+ACC)).toEqual(guard);
  expect(s.store.has('billingGuards/'+OTHER)).toBe(false);
  expect(s.writes).toEqual([]);
 });
 it('un guard sin hold ni incidencia se marca malformed, no se omite',async()=>{
  const report=await readPendingReport(stub({billingGuards:{[ACC]:{accountId:ACC,blocked:true}}}).root as never,NOW);
  const row=report.rows.find(r=>r.kind==='guard');
  expect(row).toBeTruthy();expect(row!.malformed).toBe(true);expect(row!.attention).toBe('malformed');
  // Un guard no bloqueado no es asunto del reporte (no aparece): el filtro es `blocked == true`.
  const clean=await readPendingReport(stub({billingGuards:{[ACC]:{accountId:ACC,blocked:false,lastIncidentId:'x'}}}).root as never,NOW);
  expect(clean.rows.some(r=>r.kind==='guard')).toBe(false);
 });
 it('classifies a blocked guard with only non-string incident references as malformed and still alerts',async()=>{
  const findings=[];
  for(const incident of [{lastIncidentId:7},{lastOutboxIncidentId:{id:'synthetic-incident'}}]){
   const guard={accountId:ACC,blocked:true,epoch:2,createdAtMs:1_000,...incident};
   const s=stub({billingGuards:{[ACC]:guard}});
   const pending=await readPendingReport(s.root as never,NOW);
   expect(pending.attention).toHaveLength(1);
   expect(await raisePendingAlerts(s.db as never,s.root as never,pending,NOW)).toEqual({created:1,seen:0});
   expect(s.store.get('billingGuards/'+ACC)).toEqual(guard);
   const [alert]=[...s.store.entries()].filter(([path])=>path.startsWith(ALERT_COLLECTION+'/'));
   findings.push({malformed:pending.attention[0].malformed,attention:pending.attention[0].attention,reason:alert[1].reason});
  }
  expect(findings).toEqual(Array.from({length:2},()=>({malformed:true,attention:'malformed',reason:'malformed'})));
 });
 it('preserves both reference orders and uses the surviving document ID without narrowing legacy to hashes',()=>{
  const intent='a'.repeat(64),outbox='b'.repeat(64),legacy='inc-1';
  const checks=[
   [{lastIncidentId:intent,lastOutboxIncidentId:outbox},outbox],
   [{lastOutboxIncidentId:outbox,lastIncidentId:intent},outbox],
   [{lastIncidentId:legacy},legacy],
  ] as const;
  for(const [refs,key] of checks){
   const row=normalizePending('guard',ACC,{accountId:ACC,blocked:true,...refs});
   expect(row).toMatchObject({state:'blocked:1:0:'+key,accountId:ACC,malformed:false});
  }
 });
 it('still exposes a malformed companion in either field and drops the account hint',async()=>{
  const key='valid-legacy-id';
  for(const pair of [
   {lastIncidentId:7,lastOutboxIncidentId:key},
   {lastIncidentId:key,lastOutboxIncidentId:{id:'other'}},
   {lastIncidentId:null,lastOutboxIncidentId:key},
   {lastIncidentId:key,lastOutboxIncidentId:''},
  ]){
   const original={accountId:ACC,blocked:true,...pair};
   const s=stub({billingGuards:{[ACC]:original}}),report=await readPendingReport(s.root as never,NOW);
   expect(report.attention[0]).toMatchObject({state:'blocked:1:0:'+key,accountId:null,malformed:true,attention:'malformed'});
   expect(await raisePendingAlerts(s.db as never,s.root as never,report,NOW)).toEqual({created:1,seen:0});
   const alert=s.store.get(ALERT_COLLECTION+'/'+alertKey('guard',ACC,'blocked:1:0:'+key,'malformed'));
   expect(alert).toMatchObject({status:'open',accountId:null});
   expect(s.store.get('billingGuards/'+ACC)).toEqual(original);
   expect(s.store.has('billingGuards/'+OTHER)).toBe(false);
  }
 });
 it('does not copy unusable incident IDs into malformed alert states',()=>{
  for(const bad of ['', '  ', '/', '..', '__reserved__', 'inc\u0000id', 'é'.repeat(751)]){
   for(const field of ['lastIncidentId','lastOutboxIncidentId']){
    const row=normalizePending('guard',ACC,{accountId:OTHER,blocked:true,[field]:bad});
    expect(row).toMatchObject({state:'blocked:1:0:',accountId:null,malformed:true});
    const matchingOwner=normalizePending('guard',ACC,{accountId:ACC,blocked:true,[field]:bad});
    expect(matchingOwner).toMatchObject({state:'blocked:1:0:',accountId:null,malformed:true});
   }
  }
 });
 it('la clave distingue cuenta y epoca: dos epocas de la misma cuenta son dos alertas',async()=>{
  // A generation is epoch + createdAtMs, and the state also names the incident: both are required so a
  // re-block after a release is a new alert (a legacy guard without epoch is read as epoch 1 with mark 0).
  const mark=1_000;
  const first=await readPendingReport(stub({billingGuards:{[ACC]:{accountId:ACC,blocked:true,lastIncidentId:'i',epoch:1,createdAtMs:mark}}}).root as never,NOW);
  const second=await readPendingReport(stub({billingGuards:{[ACC]:{accountId:ACC,blocked:true,lastIncidentId:'i',epoch:2,createdAtMs:mark+1}}}).root as never,NOW);
  const one=first.rows.find(r=>r.kind==='guard')!,two=second.rows.find(r=>r.kind==='guard')!;
  expect(one.state).not.toBe(two.state);
  expect(one.attention).toBe('needs_review');
  const keyOne=alertKey(one.kind,one.id,one.state,'needs_review'),keyTwo=alertKey(two.kind,two.id,two.state,'needs_review');
  expect(keyOne).not.toBe(keyTwo);
  expect(keyOne).toBe(alertKey('guard',ACC,one.state,'needs_review'));
  // La misma generacion y el mismo incidente dan la misma clave (dedupe del barrido).
  const again=await readPendingReport(stub({billingGuards:{[ACC]:{accountId:ACC,blocked:true,lastIncidentId:'i',epoch:1,createdAtMs:mark}}}).root as never,NOW);
  const same=again.rows.find(r=>r.kind==='guard')!;
  expect(alertKey(same.kind,same.id,same.state,'needs_review')).toBe(keyOne);
  // La misma generacion con OTRO incidente es otra ocurrencia del bloqueo: otra alerta.
  const reblocked=await readPendingReport(stub({billingGuards:{[ACC]:{accountId:ACC,blocked:true,lastIncidentId:'j',epoch:1,createdAtMs:mark}}}).root as never,NOW);
  const otherIncident=reblocked.rows.find(r=>r.kind==='guard')!;
  expect(alertKey(otherIncident.kind,otherIncident.id,otherIncident.state,'needs_review')).not.toBe(keyOne);
  // Y dos cuentas distintas nunca comparten clave.
  const other=await readPendingReport(stub({billingGuards:{[OTHER]:{accountId:OTHER,blocked:true,lastIncidentId:'i',epoch:1,createdAtMs:mark}}}).root as never,NOW);
  const foreign=other.rows.find(r=>r.kind==='guard')!;
  expect(alertKey(foreign.kind,foreign.id,foreign.state,'needs_review')).not.toBe(keyOne);
 });
 it('el barrido levanta exactamente una alerta por cuenta y epoca y no la duplica al repetir',async()=>{
  const s=stub({billingGuards:{[ACC]:{accountId:ACC,blocked:true,lastIncidentId:'inc-1',epoch:1,createdAtMs:1_000}}});
  const report=await readPendingReport(s.root as never,NOW);
  const first=await raisePendingAlerts(s.db as never,s.root as never,report,NOW);
  const second=await raisePendingAlerts(s.db as never,s.root as never,report,NOW+1000);
  expect(first.created).toBe(1);expect(second).toEqual({created:0,seen:1});
  const alerts=[...s.store.entries()].filter(([k])=>k.startsWith(ALERT_COLLECTION+'/'));
  expect(alerts).toHaveLength(1);
  expect(alerts[0][1]).toMatchObject({kind:'guard',rowId:ACC,reason:'needs_review',status:'open',seenCount:2});
 });
 it('normalizePending delega la forma del guard y no inventa estado',()=>{
  const row:PendingRow=normalizePending('guard',ACC,{accountId:ACC,blocked:true,lastIncidentId:'i',epoch:3,createdAtMs:1_000});
  expect(row).toMatchObject({kind:'guard',id:ACC,state:'blocked:3:1000:i',accountId:ACC,malformed:false});
  expect(buildPendingReport([row],NOW).attention[0]).toMatchObject({kind:'guard',attention:'needs_review'});
  expect(normalizePending('guard',ACC,{accountId:ACC,blocked:true}).malformed).toBe(true);
 });
});
describe('fuente guard: epoca valida, invalida y ausente (ronda 2)',()=>{
  const guardRow=(extra:Record<string,unknown>)=>({accountId:ACC,blocked:true,lastIncidentId:'inc-1',...extra});
  it('un epoch presente pero invalido (0, negativo, no entero, texto) es malformed, no blocked:1',()=>{
    for(const bad of [0,-1,1.5,'1','x',true]){
      const row=normalizePending('guard',ACC,guardRow({epoch:bad}));
      expect(row.malformed,`epoch ${String(bad)} must be malformed`).toBe(true);
    }
  });
  it('un guard legacy SIN epoch ni createdAtMs se lee como epoca 1 con marca 0 y no es malformed',()=>{
    const row=normalizePending('guard',ACC,guardRow({}));
    expect(row).toMatchObject({state:'blocked:1:0:inc-1',malformed:false,accountId:ACC});
    expect(buildPendingReport([row],NOW).attention[0]).toMatchObject({kind:'guard',attention:'needs_review'});
  });
  it('un epoch entero valido se refleja en el estado y no es malformed',()=>{
    expect(normalizePending('guard',ACC,guardRow({epoch:4,createdAtMs:2_000}))).toMatchObject({state:'blocked:4:2000:inc-1',malformed:false});
  });
  it('un epoch sin createdAtMs (o al reves) no puede nombrar su generacion y es malformed',()=>{
    expect(normalizePending('guard',ACC,guardRow({epoch:4})).malformed).toBe(true);
    expect(normalizePending('guard',ACC,guardRow({createdAtMs:2_000})).malformed).toBe(true);
  });
  it('la lectura filtrada pagina el guard: pageSize 2 con 5 cuentas bloqueadas lista las 5 sin repetir ni perder',async()=>{
    const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','55555555-5555-4555-8555-555555555555'];
    const guards:Record<string,Record<string,unknown>>={};for(const id of ids)guards[id]={accountId:id,blocked:true,lastIncidentId:'inc-'+id};
    const report=await readPendingReport(stub({billingGuards:guards}).root as never,NOW,{pageSize:2});
    const rows=report.rows.filter(row=>row.kind==='guard');
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map(row=>row.id)).size).toBe(5);
    expect(rows.map(row=>row.id).sort()).toEqual([...ids].sort());
    expect(rows.every(row=>row.attention==='needs_review')).toBe(true);
  });
});

// A prior report may be delivered after a newer sweep superseded its alert. The source guard's
// document id binds its account even in that history. Only the alert hint is corrupted below.
for(const status of ['open','superseded'] as const){
 it('does not count a foreign owner hint as current when a guard alert is '+status,async()=>{
  const incident='a'.repeat(64),guard={accountId:ACC,blocked:true,epoch:1,createdAtMs:1_000,lastIncidentId:incident};
  const other={accountId:OTHER,blocked:false};
  const s=stub({billingGuards:{[ACC]:guard,[OTHER]:other},accounts:{[ACC]:{available:12},[OTHER]:{available:53}}});
  const read=()=>readPendingReport(s.root as never,NOW);
  const original=await read();
  expect(original.rows).toEqual([expect.objectContaining({kind:'guard',id:ACC,accountId:ACC,malformed:false,attention:'needs_review'})]);
  const key=alertKey('guard',ACC,original.rows[0].state,'needs_review'),path=ALERT_COLLECTION+'/'+key;
  await raisePendingAlerts(s.db as never,s.root as never,original,NOW);
  if(status==='superseded'){
   // Advance the fixture's guard exactly as a second intent incident would. Use the actual sweep to supersede.
   s.store.set('billingGuards/'+ACC,{...guard,epoch:2,lastIncidentId:'b'.repeat(64)});
   const newer=await read();
   await raisePendingAlerts(s.db as never,s.root as never,newer,NOW+1);
   expect((await clearResolvedAlerts(s.db as never,s.root as never,newer,NOW+2)).superseded).toBe(1);
  }
  const prior=s.store.get(path)!;
  expect(prior).toMatchObject({alertKey:key,kind:'guard',rowId:ACC,reason:'needs_review',accountId:ACC,status});
  const damaged={...prior,accountId:OTHER};
  s.store.set(path,damaged); // synthetic privileged write to the hint only
  const writes=s.writes.length,sourceGuard=structuredClone(s.store.get('billingGuards/'+ACC));
  let failed=false;
  try{await raisePendingAlerts(s.db as never,s.root as never,original,NOW+3);}
  catch(error){if(!(error instanceof AggregateError))throw error;failed=true;}
  const after=s.store.get(path)!;
  expect(s.store.get('billingGuards/'+ACC)).toEqual(sourceGuard);
  expect(s.store.get('billingGuards/'+OTHER)).toEqual(other);
  expect(s.store.get('accounts/'+ACC)).toEqual({available:12});
  expect(s.store.get('accounts/'+OTHER)).toEqual({available:53});
  expect(s.writes.slice(writes).every(name=>name.split(':')[1].startsWith(ALERT_COLLECTION+'/'))).toBe(true);
  const creditedToForeign=after.accountId===OTHER&&after.status==='open'&&Number(after.seenCount)>Number(prior.seenCount);
  const result={before:status,after:after.status,seenBefore:prior.seenCount,seenAfter:after.seenCount,
   reopenCount:after.reopenCount??0,ownerIsB:after.accountId===OTHER,failed};
  expect(creditedToForeign,'a new sighting must not credit B for the verified A guard: '+JSON.stringify(result)).toBe(false);
 });
}
it('withdraws a stale hint to null for the identical malformed tuple without discarding its history',async()=>{
 const guard={accountId:ACC,blocked:true,epoch:0,createdAtMs:1_000,lastIncidentId:'a'.repeat(64)};
 const s=stub({billingGuards:{[ACC]:guard}});
 const prior=await readPendingReport(s.root as never,NOW);
 expect(prior.attention[0]).toMatchObject({id:ACC,accountId:ACC,attention:'malformed'});
 const key=alertKey('guard',ACC,prior.attention[0].state,'malformed'),path=ALERT_COLLECTION+'/'+key;
 await raisePendingAlerts(s.db as never,s.root as never,prior,NOW);
 s.store.set('billingGuards/'+ACC,{...guard,accountId:OTHER});
 const current=await readPendingReport(s.root as never,NOW+1);
 expect(current.attention[0]).toMatchObject({id:ACC,accountId:null,state:prior.attention[0].state,attention:'malformed'});
 expect(await raisePendingAlerts(s.db as never,s.root as never,current,NOW+1)).toEqual({created:0,seen:1});
 expect(s.store.get(path)).toMatchObject({alertKey:key,accountId:null,status:'open',seenCount:2,firstSeenAtMs:NOW,lastSeenAtMs:NOW+1});
 expect(s.store.has('billingGuards/'+OTHER)).toBe(false);
});

it('only withdraws a legacy foreign guard hint on an otherwise valid malformed alert and never restores it',async()=>{
 const state='blocked:1:1000:'+('a'.repeat(64)),key=alertKey('guard',ACC,state,'malformed'),path=ALERT_COLLECTION+'/'+key;
 const guard={accountId:OTHER,blocked:true,epoch:0,createdAtMs:1_000,lastIncidentId:'a'.repeat(64)};
 const s=stub({billingGuards:{[ACC]:guard}});
 const current=await readPendingReport(s.root as never,NOW);
 expect(current.rows[0]).toMatchObject({id:ACC,accountId:null,state,attention:'malformed'});
 await raisePendingAlerts(s.db as never,s.root as never,current,NOW);
 const record=s.store.get(path)!;
 s.store.set(path,{...record,accountId:OTHER}); // historical reader trusted the owner field on a divergent guard
 expect(await raisePendingAlerts(s.db as never,s.root as never,current,NOW+1)).toEqual({created:0,seen:1});
 expect(s.store.get(path)).toEqual({...record,seenCount:2,lastSeenAtMs:NOW+1,accountId:null});
 s.store.set('billingGuards/'+ACC,{...guard,accountId:ACC});
 const repaired=await readPendingReport(s.root as never,NOW+2);
 expect(repaired.rows[0]).toMatchObject({id:ACC,accountId:ACC,state,attention:'malformed'});
 await raisePendingAlerts(s.db as never,s.root as never,repaired,NOW+2);
 expect(s.store.get(path)).toEqual({...record,seenCount:3,lastSeenAtMs:NOW+2,accountId:null});
 const invalid={...s.store.get(path)!,accountId:OTHER,status:['open']};
 s.store.set(path,invalid);
 await expect(raisePendingAlerts(s.db as never,s.root as never,current,NOW+3)).rejects.toMatchObject({seen:0,created:0});
 expect(s.store.get(path)).toEqual(invalid);
});
it('reports a foreign stored guard hint as corrupt without cleaning it or either account',async()=>{
 const guard={accountId:ACC,blocked:true,epoch:1,createdAtMs:1_000,lastIncidentId:'a'.repeat(64)};
 const s=stub({billingGuards:{[ACC]:guard}});
 const current=await readPendingReport(s.root as never,NOW);
 await raisePendingAlerts(s.db as never,s.root as never,current,NOW);
 const key=alertKey('guard',ACC,current.rows[0].state,'needs_review'),path=ALERT_COLLECTION+'/'+key;
 const damaged={...s.store.get(path)!,accountId:OTHER};
 s.store.set(path,damaged);
 const n=s.writes.length;
 expect(await clearResolvedAlerts(s.db as never,s.root as never,current,NOW+1)).toMatchObject({corrupt:1,kept:0,cleared:0});
 expect(s.writes).toHaveLength(n);expect(s.store.get(path)).toEqual(damaged);
 expect(s.store.get('billingGuards/'+ACC)).toEqual(guard);expect(s.store.has('billingGuards/'+OTHER)).toBe(false);
});
