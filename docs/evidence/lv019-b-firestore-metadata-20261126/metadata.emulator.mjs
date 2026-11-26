import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {isAbsolute,join} from 'node:path';
import {after,before,test} from 'node:test';

const project='demo-vistavo-metadata',host='127.0.0.1:8194',collection='synthetic_creation_metadata';
const purpose='lv019b-creation-metadata';
const names=['guard','witness','anchor'];
let db,created=0,cleaned=0;

function verifyEnvironment(){
  assert.equal(process.env.NODE_ENV,'test');
  assert.equal(process.env.GOOGLE_CLOUD_PROJECT,project);
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST,host);
  assert.equal(process.env.METADATA_SERVER_DETECTION,'none');
  assert.match(process.versions.node,/^24\./);
  for(const key of ['GOOGLE_APPLICATION_CREDENTIALS','GCLOUD_PROJECT','K_SERVICE','FIREBASE_CONFIG',
    'GEMINI_API_KEY','OPENROUTER_API_KEY','HTTP_PROXY','HTTPS_PROXY','NODE_OPTIONS']){
    assert.equal(process.env[key],undefined);
  }
}

async function inventory(label){
  const roots=await db.collection(collection).listDocuments();
  const collections=await db.listCollections();
  console.log(JSON.stringify({inventory:label,roots:roots.length,collections:collections.length,created,cleaned}));
  assert.equal(roots.length,0);
  assert.equal(collections.length,0);
}

before(async()=>{
  verifyEnvironment();
  const dependencies=process.env.LV_METADATA_DEPENDENCIES;
  assert.ok(dependencies&&isAbsolute(dependencies));
  const require=createRequire(join(dependencies,'package.json'));
  const {Firestore}=require('firebase-admin/firestore');
  db=new Firestore({projectId:project,host,ssl:false,preferRest:false});
  assert.equal(db.projectId,project);
  assert.equal(db._settings.servicePath,'127.0.0.1');
  assert.equal(db._settings.port,8194);
  assert.equal(db._settings.ssl,false);
  assert.equal(db._settings.preferRest,false);
  await inventory('before');
});
after(async()=>{
  if(!db)return;
  try{
    await inventory('after');
    assert.equal(created,cleaned);
  }finally{
    await db.terminate();
  }
});

function stamp(time){
  assert.ok(time);
  assert.ok(Number.isSafeInteger(time.seconds));
  assert.ok(Number.isInteger(time.nanoseconds)&&time.nanoseconds>=0&&time.nanoseconds<1e9);
  return [time.seconds,time.nanoseconds];
}
function later(current,prior){
  const [s,n]=stamp(current),[ps,pn]=stamp(prior);
  assert.ok(s>ps||(s===ps&&n>pn),'expected version to advance, including sub-millisecond precision');
}
const members=(root)=>names.map(name=>root.collection('versions').doc(name));
const body=name=>({role:name,case:'synthetic',visibleSequence:1});

async function birth(documents){
  await db.runTransaction(async tx=>{
    for(const document of documents)tx.create(document,body(document.id));
  });
}
async function snapshots(documents){
  return db.runTransaction(tx=>tx.getAll(...documents));
}
function sameInitialBirth(snapshots){
  const create=snapshots[0].createTime;
  for(const snap of snapshots){
    assert.equal(snap.exists,true);
    assert.deepEqual(stamp(snap.createTime),stamp(create));
    assert.deepEqual(stamp(snap.updateTime),stamp(create));
  }
  return stamp(create);
}
function record(phase,snaps){
  console.log(JSON.stringify({phase,versions:snaps.map(snap=>({
    document:snap.id,create:stamp(snap.createTime),update:stamp(snap.updateTime),
  }))}));
}

async function fixture(run){
  const root=db.collection(collection).doc(randomUUID());
  const marker={project,purpose,nonce:randomUUID()};
  const documents=members(root);
  try{
    await root.create(marker);
    created++;
    await birth(documents);
    await run(documents);
  }finally{
    const marked=await root.get();
    if(marked.exists){
      assert.match(root.path,/^synthetic_creation_metadata\/[0-9a-f-]{36}$/);
      assert.deepEqual(marked.data(),marker);
      const roots=await db.collection(collection).listDocuments();
      assert.deepEqual(roots.map(ref=>ref.path),[root.path]);
      const groups=await root.listCollections();
      assert.ok(groups.every(group=>group.id==='versions'));
      const live=await root.collection('versions').listDocuments();
      for(const ref of live){
        assert.ok(documents.some(document=>document.path===ref.path));
        assert.deepEqual(await ref.listCollections(),[]);
      }
      await db.runTransaction(async tx=>{
        assert.deepEqual((await tx.get(root)).data(),marker);
        for(const document of live)tx.delete(document);
        tx.delete(root);
      });
      assert.ok((await db.getAll(root,...documents)).every(doc=>!doc.exists));
      assert.deepEqual(await db.collection(collection).listDocuments(),[]);
      cleaned++;
      console.log(JSON.stringify({cleanup:'verified',removed:live.length+1,created,cleaned}));
    }else{
      assert.ok((await db.getAll(...documents)).every(doc=>!doc.exists));
    }
  }
}

test('same transaction gives guard, birth witness and anchor the same creation version',()=>fixture(async documents=>{
  const inside=await snapshots(documents);
  sameInitialBirth(inside);
  const outside=await db.getAll(...documents);
  assert.deepEqual(sameInitialBirth(outside),sameInitialBirth(inside));
  record('same-transaction',inside);
}));

test('editing and restoring the exact guard values advances updateTime while createTime stays fixed',()=>fixture(async documents=>{
  const [guard]=documents;
  const original=await snapshots(documents);
  await guard.update({visibleSequence:2});
  const edited=await snapshots(documents);
  await guard.update({visibleSequence:1});
  const restored=await snapshots(documents);
  assert.deepEqual(edited[0].data(),{...body(guard.id),visibleSequence:2});
  assert.deepEqual(restored[0].data(),original[0].data());
  assert.deepEqual(stamp(edited[0].createTime),stamp(original[0].createTime));
  assert.deepEqual(stamp(restored[0].createTime),stamp(original[0].createTime));
  later(edited[0].updateTime,original[0].updateTime);
  later(restored[0].updateTime,edited[0].updateTime);
  assert.deepEqual(sameInitialBirth(edited.slice(1)),sameInitialBirth(original.slice(1)));
  assert.deepEqual(sameInitialBirth(restored.slice(1)),sameInitialBirth(original.slice(1)));
  record('original-before-ABA',original);
  record('edited',edited);
  record('restored',restored);
}));

test('deleting and recreating only the guard with identical values changes createTime',()=>fixture(async documents=>{
  const [guard]=documents;
  const original=await snapshots(documents);
  await guard.delete();
  const missing=await guard.get();
  assert.equal(missing.exists,false);
  assert.equal(missing.createTime,undefined);
  assert.equal(missing.updateTime,undefined);
  await guard.create(body(guard.id));
  const recreated=await snapshots(documents);
  assert.deepEqual(recreated[0].data(),original[0].data());
  later(recreated[0].createTime,original[0].createTime);
  assert.deepEqual(stamp(recreated[0].updateTime),stamp(recreated[0].createTime));
  assert.deepEqual(sameInitialBirth(recreated.slice(1)),sameInitialBirth(original.slice(1)));
  assert.notDeepEqual(stamp(recreated[0].createTime),stamp(recreated[1].createTime));
  record('individually-recreated',recreated);
}));

test('recreating all three in one transaction can restore their equality at a different version',()=>fixture(async documents=>{
  const original=await snapshots(documents);
  await db.runTransaction(async tx=>{for(const document of documents)tx.delete(document);});
  assert.ok((await snapshots(documents)).every(doc=>!doc.exists));
  await birth(documents);
  const recreated=await snapshots(documents);
  assert.deepEqual(recreated.map(doc=>doc.data()),original.map(doc=>doc.data()));
  sameInitialBirth(recreated);
  later(recreated[0].createTime,original[0].createTime);
  record('old-common-birth',original);
  record('new-common-birth',recreated);
}));
