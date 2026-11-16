import {describe,it,expect} from 'vitest';
import {assertDeploymentQuiescent} from '../../deploy/google-cloud/stabilizationQuiescence.mjs';
function fixture(){
 const states:Record<string,string[]>={outbox:[],fileOutbox:[],jobs:[],artifacts:[],uploads:[]},events:any[]=[],queries:string[]=[];
 const required=async(url:string,method:string,body:any)=>{expect(url).toBe('https://firestore.googleapis.com/v1/projects/vistavo-prod/databases/(default)/documents/vistavo/candidate-v1:runQuery');expect(method).toBe('POST');const q=body.structuredQuery,col=q.from[0].collectionId;queries.push(col);expect(q.limit).toBe(1);const filter=q.where.fieldFilter,match=filter.op==='IN'?filter.value.arrayValue.values.map((x:any)=>x.stringValue):[filter.value.stringValue];return states[col].some(s=>match.includes(s))?[{document:{name:'synthetic'}}]:[{readTime:'synthetic'}];};
 return {states,events,queries,guard:(phase:string)=>assertDeploymentQuiescent({project:'vistavo-prod',root:'vistavo/candidate-v1',image:'synthetic-immutable-image',phase,required,record:async(event:any)=>{events.push(event);}})};
}
describe('actual rollout quiescence guard',()=>{
 it('file-only pending work blocks the first PATCH with no AI outbox or Job',async()=>{
  const f=fixture();f.states.fileOutbox=['pending'];let patches=0;
  await expect((async()=>{await f.guard('before-runtime-update');patches++;})()).rejects.toThrow('blocks rollout');expect(patches).toBe(0);expect(f.events[0]).toMatchObject({pendingFound:false,filePendingFound:true,activeFound:false});expect(f.queries).toEqual(['outbox','fileOutbox','jobs','artifacts','uploads']);
 });
 it('file work appearing after API readback prevents maintenance PATCH',async()=>{
  const f=fixture();let apiPatches=0,maintenancePatches=0;
  await f.guard('before-runtime-update');apiPatches++;f.states.fileOutbox=['pending'];
  await expect((async()=>{await f.guard('after-api-before-maintenance');maintenancePatches++;})()).rejects.toThrow('blocks rollout');expect(apiPatches).toBe(1);expect(maintenancePatches).toBe(0);expect(f.events[1].filePendingFound).toBe(true);
 });
 it('done file work, empty outboxes and terminal jobs permit both rollout stages',async()=>{
  const f=fixture();f.states.fileOutbox=['done'];f.states.jobs=['succeeded','failed','cancelled'];f.states.uploads=['ready','deleted'];f.states.artifacts=['ready','purged'];let patches=0;
  for(const phase of ['before-runtime-update','after-api-before-maintenance']){await f.guard(phase);patches++;}expect(patches).toBe(2);expect(f.events.every(e=>!e.pendingFound&&!e.filePendingFound&&!e.activeFound)).toBe(true);
 });
 it.each(['outbox','queued','running','unknown'])('preserves the prior all-profile guard for %s',async kind=>{
  const f=fixture();if(kind==='outbox')f.states.outbox=['pending'];else f.states.jobs=[kind];let patches=0;
  await expect((async()=>{await f.guard('before-runtime-update');patches++;})()).rejects.toThrow('blocks rollout');expect(patches).toBe(0);
 });
 it.each(['pending','staged','purging'])('artifact-only %s work blocks PATCH even without either outbox',async state=>{
  const f=fixture();f.states.artifacts=[state];let patches=0;await expect((async()=>{await f.guard('before-runtime-update');patches++;})()).rejects.toThrow('blocks rollout');expect(patches).toBe(0);expect(f.events[0].artifactWorkFound).toBe(true);
 });
 it.each(['uploading','queued','verifying','cleaning','deleting'])('upload-only %s work blocks maintenance cutover',async state=>{
  const f=fixture();let apiPatches=0,maintenancePatches=0;await f.guard('before-runtime-update');apiPatches++;f.states.uploads=[state];await expect((async()=>{await f.guard('after-api-before-maintenance');maintenancePatches++;})()).rejects.toThrow('blocks rollout');expect(apiPatches).toBe(1);expect(maintenancePatches).toBe(0);expect(f.events[1].uploadWorkFound).toBe(true);
 });
});
