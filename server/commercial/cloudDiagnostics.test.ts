import {describe,it,expect,vi} from 'vitest';
import type {Firestore} from 'firebase-admin/firestore';
import {withCloudDiagnostics,diagnosticStage,diagnosticTransaction,cloudDiagnosticError} from './cloudDiagnostics';
describe('safe cloud diagnostics',()=>{
 it('isolates concurrent requests and records observed callbacks without leaking error payload',async()=>{
  const logs:string[]=[],secret='SYNTHETIC_SECRET_BODY_TOKEN',db={runTransaction:async(work:any)=>{await work({});return work({});}} as unknown as Firestore;
  const run=(code:number)=>withCloudDiagnostics(async()=>{try{await diagnosticTransaction('reserve',db,()=>diagnosticStage('reserve.read',async()=>42));throw Object.assign(new Error(secret),{code,stack:secret,body:secret});}catch(e){cloudDiagnosticError(e);}},()=>500,line=>logs.push(line));
  await Promise.all([run(10),run(4)]);expect(logs).toHaveLength(2);expect(logs.join('')).not.toContain(secret);
  const rows=logs.map(x=>JSON.parse(x));expect(new Set(rows.map(x=>x.traceId)).size).toBe(2);
  for(const row of rows){expect(row.attempts).toEqual({reserve:2});expect(row.stages['reserve.read'].calls).toBe(2);expect(row.stages['reserve.callback'].calls).toBe(2);expect(row.durationMs).toBeGreaterThanOrEqual(0);expect([10,4]).toContain(row.code);expect(row.event).toBe('cloud-http-internal');}
 });
 it('does not emit fast polling or expected authentication failures and never accepts string SDK codes',async()=>{
  const emit=vi.fn();await withCloudDiagnostics(async()=>undefined,()=>200,emit);await withCloudDiagnostics(async()=>undefined,()=>401,emit);expect(emit).not.toHaveBeenCalled();
  await withCloudDiagnostics(async()=>cloudDiagnosticError(Object.assign(new Error('private'),{name:'bad secret name',code:'private-token'})),()=>500,emit);
  const row=JSON.parse(emit.mock.calls[0][0]);expect(row.code).toBe('UNCLASSIFIED');expect(row.type).toBe('Error');expect(JSON.stringify(row)).not.toContain('private');
 });
 it('retains one sanitized summary for a slow successful request',async()=>{
  const emit=vi.fn();await withCloudDiagnostics(async()=>{await new Promise(r=>setTimeout(r,1510));},()=>202,emit);
  expect(emit).toHaveBeenCalledTimes(1);expect(JSON.parse(emit.mock.calls[0][0]).event).toBe('cloud-http-slow');
 });
 it('an emitter failure cannot alter committed result or mask original failure',async()=>{
  let committed=false;const emit=()=>{throw Error('synthetic logging outage');};
  await expect(withCloudDiagnostics(async()=>{committed=true;return 'durable-id';},()=>202,emit,true)).resolves.toBe('durable-id');expect(committed).toBe(true);
  const original=Object.assign(new Error('original-private'),{code:10});
  await expect(withCloudDiagnostics(async()=>{cloudDiagnosticError(original);throw original;},()=>500,emit)).rejects.toBe(original);
 });
});
