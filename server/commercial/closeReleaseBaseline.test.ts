import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {verifyCloseBaseline,closeBaselineImage,closeBaselinePaths,closeResourceNames} from '../../deploy/google-cloud/closeReleaseBaseline.mjs';
import {assertDeploymentQuiescent} from '../../deploy/google-cloud/stabilizationQuiescence.mjs';
const bytes=(value:any)=>Buffer.from(JSON.stringify(value)),sha=(value:Buffer)=>createHash('sha256').update(value).digest('hex');
function fixture(){
 const resources=closeResourceNames.map((name:string,index:number)=>({name,uid:'11111111-1111-4111-8111-'+String(index).padStart(12,'0'),image:closeBaselineImage,verified:true}));
 const state={project:'vistavo-prod',complete:true,image:closeBaselineImage,labels:{app:'vistavo',phase:'ai-candidate',managedby:'codex-lv007-ai'},resources:Object.fromEntries(resources.map((row:any)=>[row.name,{...row}]))};
 const ready={project:'vistavo-prod',image:closeBaselineImage,resources:structuredClone(resources)};
 const readback={project:'vistavo-prod',image:closeBaselineImage,resources:resources.map((row:any)=>({...row,publicInvoker:false,...(row.name.includes('/services/')?{ingress:'INGRESS_TRAFFIC_INTERNAL_ONLY',minInstances:0}:{})})),cloudSql:{httpStatus:200,instances:0}};
 const acceptance={task:'LV-007.STAB/LV-017.LOCAL',result:'PASS',acceptedBy:'Codex',publicRelease:false,fullReportRead:true,evidence:[{file:closeBaselinePaths.readback,sha256:sha(bytes(readback))}]};
 const serialize=(bind=true)=>{if(bind)acceptance.evidence[0].sha256=sha(bytes(readback));return {stateBytes:bytes(state),readyBytes:bytes(ready),readbackBytes:bytes(readback),acceptanceBytes:bytes(acceptance)};};
 return {state,ready,readback,acceptance,serialize};
}
describe('close release imports only the accepted private0b8 baseline',()=>{
 it('verifies all five UIDs and the accepted readback byte hash without credentials',()=>{const f=fixture(),proof=verifyCloseBaseline(f.serialize());expect(proof.baselineImage).toBe(closeBaselineImage);expect(proof.resources).toHaveLength(5);expect(proof.readbackSha256).toBe(f.acceptance.evidence[0].sha256);});
 it.each(['acceptance','public-approval','author','image','uid','pending-operation','extra-resource','sql','public-resource','min-one','incomplete'])('refuses %s baseline before any PATCH',kind=>{
  const f=fixture(),name=closeResourceNames[0];if(kind==='acceptance')f.acceptance.result='INCONCLUYENTE';if(kind==='public-approval')f.acceptance.publicRelease=true;if(kind==='author')f.acceptance.acceptedBy='unverified';if(kind==='image')f.state.image=f.state.image.replace('0b8bbd','111111');if(kind==='uid')f.ready.resources[0].uid='wrong';if(kind==='pending-operation')f.state.resources[name].operation='projects/vistavo-prod/locations/us-central1/operations/pending';if(kind==='extra-resource')f.ready.resources.push({...f.ready.resources[0]});if(kind==='sql')f.readback.cloudSql.instances=1;if(kind==='public-resource')f.readback.resources[0].publicInvoker=true;if(kind==='min-one')f.readback.resources.find((row:any)=>row.name.includes('/services/'))!.minInstances=1;if(kind==='incomplete')f.state.complete=false;
  let patches=0;expect(()=>{verifyCloseBaseline(f.serialize());patches++;}).toThrow();expect(patches).toBe(0);
 });
 it('refuses a readback changed after its acceptance even if its new fields look private',()=>{const f=fixture();f.readback.resources[0].uid='another';let patches=0;expect(()=>{verifyCloseBaseline(f.serialize(false));patches++;}).toThrow('readback binding');expect(patches).toBe(0);});
 it('accepted baseline cannot bypass live file-only quiescence before PATCH',async()=>{
  const f=fixture();let patches=0,queries=0;verifyCloseBaseline(f.serialize());
  await expect((async()=>{await assertDeploymentQuiescent({project:'vistavo-prod',root:'vistavo/candidate-v1',image:'new-immutable-candidate',phase:'before-runtime-update',required:async(_url:string,method:string,body:any)=>{expect(method).toBe('POST');queries++;return body.structuredQuery.from[0].collectionId==='fileOutbox'?[{document:{name:'synthetic'}}]:[{readTime:'synthetic'}];},record:async()=>{}});patches++;})()).rejects.toThrow('blocks rollout');expect(patches).toBe(0);expect(queries).toBe(5);
 });
});
