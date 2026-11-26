// LV-019.B paso 1.4a: puro (sin emulador). Fuente `guard` del reporte de Video, su clave por
// cuenta y epoca, y el trato de un guard sin hold ni incidencia. Rojo hoy: `PENDING_SOURCES`
// no incluye `guard` y `attentionOf` no marca `needs_review` una fila de guard.
import {describe,expect,it} from 'vitest';
import {PENDING_SOURCES,buildPendingReport,normalizePending,readPendingReport,type PendingRow} from './billingPendingReport';
import {ALERT_COLLECTION,alertKey,raisePendingAlerts} from './billingPendingAlerts';
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
 it('un guard sin hold ni incidencia se marca malformed, no se omite',async()=>{
  const report=await readPendingReport(stub({billingGuards:{[ACC]:{accountId:ACC,blocked:true}}}).root as never,NOW);
  const row=report.rows.find(r=>r.kind==='guard');
  expect(row).toBeTruthy();expect(row!.malformed).toBe(true);expect(row!.attention).toBe('malformed');
  // Un guard no bloqueado no es asunto del reporte (no aparece): el filtro es `blocked == true`.
  const clean=await readPendingReport(stub({billingGuards:{[ACC]:{accountId:ACC,blocked:false,lastIncidentId:'x'}}}).root as never,NOW);
  expect(clean.rows.some(r=>r.kind==='guard')).toBe(false);
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
