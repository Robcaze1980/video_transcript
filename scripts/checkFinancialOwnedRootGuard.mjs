// Offline negative controls for the synthetic-root deletion guard. No emulator or sockets are used.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FINANCIAL_PROJECT, FINANCIAL_HOST, FINANCIAL_ROOT_COLLECTIONS,
  prepareFinancialOwnedRoot, deleteFinancialOwnedRoot } from '../server/commercial/financialOwnedRootGuard.mjs';

const id='11111111-1111-4111-8111-111111111111';
const marker={project:FINANCIAL_PROJECT,purpose:'offline-synthetic-control',nonce:'22222222-2222-4222-8222-222222222222'};
function mock(collection=FINANCIAL_ROOT_COLLECTIONS[0],present=true){
  const calls={reads:0,creates:0,deletes:0};let value=present?structuredClone(marker):null,children=[];
  const db={projectId:FINANCIAL_PROJECT,databaseId:'(default)',_settings:{projectId:FINANCIAL_PROJECT,servicePath:'127.0.0.1',port:8198,ssl:false,preferRest:false},
    async recursiveDelete(root){calls.deletes++;assert.equal(root,ref);value=null;children=[];}};
  const ref={firestore:db,path:`${collection}/${id}`,parent:{path:collection},
    async get(){calls.reads++;const copy=value&&structuredClone(value);return {exists:!!copy,data:()=>copy};},
    async listCollections(){return children;},async create(next){calls.creates++;assert.equal(value,null);value=structuredClone(next);}};
  return {db,ref,calls,setValue(next){value=next;},setChildren(next){children=next;}};
}
async function refused(change){
  const c=mock();change(c);
  await assert.rejects(()=>deleteFinancialOwnedRoot(c.db,c.ref,marker));
  assert.equal(c.calls.deletes,0);
  return c;
}

test('only a matching marked root is deleted',async()=>{
  const c=mock();await deleteFinancialOwnedRoot(c.db,c.ref,marker);assert.equal(c.calls.deletes,1);
});
test('all 22 known roots are distinct and accepted in the fake client',async()=>{
  assert.equal(FINANCIAL_ROOT_COLLECTIONS.length,22);assert.equal(new Set(FINANCIAL_ROOT_COLLECTIONS).size,22);
  for(const collection of FINANCIAL_ROOT_COLLECTIONS){const c=mock(collection);await deleteFinancialOwnedRoot(c.db,c.ref,marker);assert.equal(c.calls.deletes,1);}
});
test('a missing or altered marker refuses deletion',async()=>{
  for(const value of [null,{...marker,nonce:id},{...marker,extra:true}]){
    const c=mock();c.setValue(value);await assert.rejects(()=>deleteFinancialOwnedRoot(c.db,c.ref,marker));assert.equal(c.calls.deletes,0);
  }
});
test('wrong host, project, credentials and client binding fail before any read',async()=>{
  for(const change of [
    c=>{c.db.projectId='demo-other';},c=>{c.db._settings.projectId='demo-other';},
    c=>{c.db._settings.servicePath='0.0.0.0';},c=>{c.db._settings.port=8185;},
    c=>{c.db._settings.ssl=true;},c=>{c.db._settings.credentials={};},
    c=>{c.ref.firestore={};},
  ]){const c=await refused(change);assert.equal(c.calls.reads,0);}
});
test('foreign, nested or malformed roots fail before any read',async()=>{
  for(const change of [
    c=>{c.ref.path=`foreign/${id}`;c.ref.parent.path='foreign';},
    c=>{c.ref.path=`${FINANCIAL_ROOT_COLLECTIONS[0]}/${id}/child`},
    c=>{c.ref.path=`${FINANCIAL_ROOT_COLLECTIONS[0]}/not-a-uuid`},
    c=>{c.ref.parent.path='foreign';},
  ]){const c=await refused(change);assert.equal(c.calls.reads,0);}
});
test('wrong environment or inherited credential blocks all operations',async()=>{
  for(const [key,value] of [['FIRESTORE_EMULATOR_HOST','127.0.0.1:8185'],['GOOGLE_CLOUD_PROJECT','demo-other'],['GOOGLE_APPLICATION_CREDENTIALS','synthetic-only']]){
    const before=process.env[key];process.env[key]=value;
    try{const c=await refused(()=>{});assert.equal(c.calls.reads,0);}finally{if(before===undefined)delete process.env[key];else process.env[key]=before;}
  }
});
test('a new empty root is marked before deletion',async()=>{
  const c=mock(undefined,false);await prepareFinancialOwnedRoot(c.db,c.ref,marker);assert.equal(c.calls.creates,1);
  await deleteFinancialOwnedRoot(c.db,c.ref,marker);assert.equal(c.calls.deletes,1);
});
test('an existing root or unmarked descendants are never overwritten',async()=>{
  const a=mock();await assert.rejects(()=>prepareFinancialOwnedRoot(a.db,a.ref,marker));assert.equal(a.calls.creates,0);
  const b=mock(undefined,false);b.setChildren([{id:'synthetic-child'}]);await assert.rejects(()=>prepareFinancialOwnedRoot(b.db,b.ref,marker));assert.equal(b.calls.creates,0);
});
test('a failed delete propagates and cannot be reported as cleanup',async()=>{
  const c=mock();c.db.recursiveDelete=async()=>{c.calls.deletes++;throw Error('synthetic delete failure');};
  await assert.rejects(()=>deleteFinancialOwnedRoot(c.db,c.ref,marker));assert.equal(c.calls.deletes,1);
});
