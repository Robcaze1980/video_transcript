// Documentation model only. Account copy/commit encodes explicit serial schedules, not Firestore.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {isDeepStrictEqual as same} from 'node:util';

const services=Object.freeze({hold:'hold-service',register:'register-service',
  dispatch:'dispatch-service',reconcile:'reconcile-service'});
const operator='operator-A', alternateOperator='operator-B';
const cut={id:'writer-cut-2',scope:'video-root',issuer:'verified-video-source'};
const link={videoAccount:'video-account-A',identity:'synthetic-uid-key',version:'uid-link-3'};
const digest=(...args)=>createHash('sha256').update(JSON.stringify(args)).digest('hex');
const originKey=origin=>digest('hold-origin-v2',origin.scope,origin.occurrence);
const accountIncident=(owner,origin)=>digest('account-incident-v2',owner,originKey(origin));
const need=(condition,code)=>{if(!condition)throw Error(code);};
const generation=guard=>guard&&({id:guard.id,epoch:guard.epoch,createdAtMs:guard.createdAtMs,
  createVersion:guard.createVersion});

function videoSource(){
  const rows=new Map(), issued=new WeakMap();
  const allowed=new Set([operator,alternateOperator]);
  const sourceHash=source=>digest('source-v2',source.scope,source.cut,source.videoAccount,
    source.identity,source.linkVersion,source.occurrence,source.incidentKey,source.creation);
  const seal=(kind,origin,operation,request)=>{
    const token=Object.freeze({});
    issued.set(token,structuredClone({kind,audience:'account',issuer:cut.issuer,origin,operation,request}));
    return token;
  };

  function seed(name){
    const source={scope:cut.scope,cut:cut.id,videoAccount:link.videoAccount,identity:link.identity,
      linkVersion:link.version,occurrence:'video-occurrence-'+name,incidentKey:'video-incident-'+name,
      creation:'video-create-'+name};
    const origin={...source,hash:sourceHash(source)};
    const operation={id:'unblock-'+name,originalAudit:'video-audit-'+name,
      originHash:origin.hash,evidence:'operator-evidence-'+name,initialAttempt:'first-try-'+name,operator};
    const fact=structuredClone(source);
    rows.set(name,{fact,origin,guard:{occurrence:source.occurrence,creation:source.creation,
      account:source.videoAccount,blocked:true},outbox:{originHash:origin.hash,occurrence:source.occurrence},
      operation,witness:digest(operation),dispatchClaim:digest(operation),bindings:{...link},
      auditCreated:'video-audit-commit-'+name,auditVersion:'video-audit-commit-'+name,
      alert:'open',rowsMatch:true});
  }

  function holdEvidence(name){
    const row=rows.get(name);
    need(row&&same(row.origin,{...row.fact,hash:sourceHash(row.fact)})&&
      row.guard.blocked&&row.guard.creation===row.fact.creation&&row.guard.account===row.fact.videoAccount&&
      row.guard.occurrence===row.fact.occurrence&&row.outbox.occurrence===row.fact.occurrence&&
      row.outbox.originHash===row.origin.hash&&row.bindings.version===row.fact.linkVersion&&
      row.bindings.videoAccount===row.fact.videoAccount&&row.bindings.identity===row.fact.identity,'video_origin');
    return row;
  }

  function attest(name,kind,request=null,actor=operator){
    const row=holdEvidence(name);
    if(kind==='hold')return seal(kind,row.origin,null,request);
    need(allowed.has(actor)&&row.operation.operator===actor,'operator');
    const proof=digest(row.operation);
    need(row.alert==='open'&&row.rowsMatch&&row.auditCreated===row.auditVersion&&
      row.operation.originHash===row.origin.hash&&row.witness===proof&&row.dispatchClaim===proof,'video_audit');
    return seal(kind,row.origin,row.operation,request);
  }

  return {rows,seed,attest,verify:token=>structuredClone(issued.get(token))};
}

class AccountModel {
  state={
    binding:{...link,owner:'account-A'},
    activeCut:{...cut},
    guard:null,births:new Map(),nextBirth:1,
    incidents:new Map(),origins:new Map(),anchors:new Map(),receipts:new Map(),effects:[],
    balance:{available:10,reserved:3,consumed:0},reservation:{seconds:3,state:'reserved'},ledger:['reserve-3'],
  };

  constructor(verify){this.verify=verify;}

  transaction(kind,caller,token,request,fn){
    need(caller===services[kind],'forbidden');
    const proof=this.verify(token);
    need(proof?.kind===kind&&proof.audience==='account'&&same(proof.request,request),'attestation');
    const s=structuredClone(this.state),{origin,operation}=proof;
    const binding=s.binding;
    need(s.activeCut?.scope===origin.scope&&s.activeCut.id===origin.cut&&
      s.activeCut.issuer===proof.issuer,'cut');
    need(origin.identity===binding.identity&&origin.videoAccount===binding.videoAccount&&
      origin.linkVersion===binding.version,'binding');
    const ref=accountIncident(binding.owner,origin);
    const result=fn(s,ref,origin,operation);
    this.state=s;
    return structuredClone(result);
  }

  guardIsProven(s){
    if(!s.guard||!same(s.births.get(s.guard.id),
      {createVersion:s.guard.createVersion,createdAtMs:s.guard.createdAtMs}))return false;
    return [...s.guard.members].every(ref=>{
      const row=s.incidents.get(ref);
      return row?.owner===s.binding.owner&&row.birth===s.guard.id&&row.birthVersion===s.guard.createVersion&&
        (row.status==='active'||row.status==='reviewed');
    });
  }

  anchor(s,ref,origin){
    const row=s.incidents.get(ref),a=s.anchors.get(ref);
    need(a?.v===2&&a.cut===s.activeCut.id&&a.owner===s.binding.owner&&s.origins.get(originKey(origin))===ref&&
      row?.owner===s.binding.owner&&same(row.origin,origin)&&
      a.originHash===origin.hash&&a.birth===row.birth&&a.birthVersion===row.birthVersion&&
      s.births.get(a.birth)?.createVersion===a.birthVersion,'anchor');
    if(a.operation===null){
      need(a.current===null&&!a.attempts.size&&!a.reconciliations.size&&!s.receipts.has(ref),'anchor');
    }
    return {a,row};
  }

  enroll(caller,token){
    return this.transaction('hold',caller,token,null,(s,ref,origin)=>{
      const indexed=s.origins.get(originKey(origin));
      if(indexed||s.incidents.has(ref)||s.anchors.has(ref)||s.receipts.has(ref)){
        const {row}=this.anchor(s,ref,origin);
        this.receiptStatus(s,ref,s.anchors.get(ref),row);
        return {ref,created:false,status:row.status};
      }

      if(s.guard){
        need(this.guardIsProven(s),'guard');
        s.guard.epoch++;
      }else{
        const next=s.nextBirth++;
        s.guard={id:'account-guard-'+next,epoch:1,createdAtMs:10,
          createVersion:'verified-account-create-'+next,members:new Set()};
        s.births.set(s.guard.id,{createdAtMs:s.guard.createdAtMs,createVersion:s.guard.createVersion});
      }
      const birth=s.guard.id,birthVersion=s.guard.createVersion;
      s.guard.members.add(ref);
      s.origins.set(originKey(origin),ref);
      s.incidents.set(ref,{owner:s.binding.owner,origin,birth,birthVersion,status:'active'});
      s.anchors.set(ref,{v:2,owner:s.binding.owner,cut:s.activeCut.id,originHash:origin.hash,birth,birthVersion,
        operation:null,current:null,attempts:new Map(),reconciliations:new Map()});
      return {ref,created:true,status:'active'};
    });
  }

  attempt(a,id){
    const attempt=a.attempts.get(id);
    need(attempt,'attempt');
    if(id!==a.operation.initialAttempt){
      const decision=a.reconciliations.get(attempt.reconcileId);
      const previous=decision&&a.attempts.get(decision.old);
      need(decision?.next===id&&same(decision.generation,attempt.generation)&&
        previous?.state==='fenced'&&previous.successor===id,'history');
    }
    return attempt;
  }

  receiptStatus(s,ref,a,row){
    const receipt=s.receipts.get(ref);
    if(!receipt){
      need(row.status==='active'&&this.guardIsProven(s)&&s.guard.id===a.birth&&
        s.guard.createVersion===a.birthVersion&&s.guard.members.has(ref),'incident');
      return null;
    }
    const {attemptId,accepted,operation}=receipt,attempt=this.attempt(a,attemptId);
    need(row.status==='reviewed'&&same(operation,a.operation)&&attempt.state==='committed'&&
      a.current===attemptId&&accepted.id===a.birth&&accepted.createVersion===a.birthVersion&&
      same(attempt.generation,accepted)&&(!s.guard||this.guardIsProven(s)),'receipt');
    return {state:'confirmed',ref,attemptId,accepted,blocked:s.guard!==null};
  }

  withOperation(kind,caller,token,request,fn){
    return this.transaction(kind,caller,token,request,(s,ref,origin,operation)=>{
      const {a,row}=this.anchor(s,ref,origin);
      need(operation?.originHash===origin.hash&&(a.operation===null||same(operation,a.operation)),'operation');
      return fn(s,ref,a,row,operation,this.receiptStatus(s,ref,a,row));
    });
  }

  register(caller,token,request){
    return this.withOperation('register',caller,token,request,(s,_ref,a,_row,operation,receipt)=>{
      need(request.id===operation.initialAttempt,'attempt');
      if(receipt){
        need(receipt.attemptId===request.id&&same(receipt.accepted,request.generation),'fenced');
        return receipt;
      }
      if(a.operation){
        const prior=a.attempts.get(request.id);
        need(a.current===request.id&&prior?.state==='active'&&same(prior.generation,request.generation),'fenced');
      }
      need(same(request.generation,generation(s.guard)),'generation');
      if(!a.operation){
        a.operation=operation;
        a.current=request.id;
        a.attempts.set(request.id,{state:'active',generation:structuredClone(request.generation)});
      }
      return {state:'recorded',attemptId:a.current,generation:request.generation};
    });
  }

  reconcile(caller,token,request){
    return this.withOperation('reconcile',caller,token,request,(s,_ref,a,_row,operation,receipt)=>{
      const prior=a.reconciliations.get(request.id),vacant=a.operation===null;
      need(!prior||same(prior,request),'reconcile_conflict');
      need(vacant?request.old===operation.initialAttempt:a.attempts.has(request.old),'attempt');
      if(receipt)return receipt;
      if(prior){
        const old=a.attempts.get(request.old),next=a.attempts.get(request.next);
        need(old?.state==='fenced'&&old.successor===request.next&&next&&same(next.generation,request.generation),'history');
        if(a.current!==request.next)return {state:'superseded',attemptId:request.next};
        need(next.state==='active','history');
        return {state:same(request.generation,generation(s.guard))?'authorized':'stale',attemptId:request.next};
      }

      need(vacant||a.current===request.old&&this.attempt(a,request.old).state==='active','fenced');
      need(request.next!==request.old&&!a.attempts.has(request.next),'attempt_reused');
      need(same(request.generation,generation(s.guard)),'generation');
      const old=a.attempts.get(request.old);
      a.operation=operation;
      a.attempts.set(request.old,{state:'fenced',generation:old?.generation??null,successor:request.next});
      a.attempts.set(request.next,{state:'active',generation:structuredClone(request.generation),reconcileId:request.id});
      a.current=request.next;
      a.reconciliations.set(request.id,structuredClone(request));
      return {state:'authorized',attemptId:a.current};
    });
  }

  dispatch(caller,token,request){
    return this.withOperation('dispatch',caller,token,request,(s,ref,a,row,_operation,receipt)=>{
      if(receipt){
        need(receipt.attemptId===request.id&&same(receipt.accepted,request.generation),'fenced');
        return {...receipt,replayed:true};
      }
      need(a.current===request.id,'fenced');
      const attempt=this.attempt(a,request.id);
      need(attempt.state==='active','fenced');
      need(same(request.generation,attempt.generation)&&same(attempt.generation,generation(s.guard)),'generation');

      a.attempts.set(request.id,{...attempt,state:'committed'});
      s.receipts.set(ref,structuredClone({attemptId:request.id,accepted:attempt.generation,operation:a.operation}));
      row.status='reviewed';
      s.effects.push(ref);
      if([...s.guard.members].every(member=>s.incidents.get(member).status==='reviewed'))s.guard=null;
      return {...this.receiptStatus(s,ref,a,row),replayed:false};
    });
  }
}

function harness({enrolled=true}={}){
  const video=videoSource(),account=new AccountModel(video.verify);
  const snapshot=()=>structuredClone(account.state),guards=()=>generation(account.state.guard);
  const economic=()=>({balance:account.state.balance,reservation:account.state.reservation,ledger:account.state.ledger});
  const money=structuredClone(economic());
  const refs=new Map();
  const enroll=name=>{
    const result=account.enroll(services.hold,video.attest(name,'hold'));
    refs.set(name,result.ref);
    return result;
  };
  const req=(name='A',guard=guards())=>({id:video.rows.get(name).operation.initialAttempt,generation:guard});
  const act=(name,kind,request,actor=operator)=>account[kind](services[kind],video.attest(name,kind,request,actor),request);
  video.seed('A');
  if(enrolled)enroll('A');
  const initial=req(),proposal={id:'reconcile-A-1',old:initial.id,next:'next-A-1',generation:initial.generation};
  return {video,account,snapshot,guards,enroll,req,act,initial,proposal,
    add:name=>{video.seed(name);return enroll(name);},
    ref:(name='A')=>refs.get(name),
    anchor:(name='A')=>account.state.anchors.get(refs.get(name)),
    register:(request=initial,name='A')=>act(name,'register',request),
    reconcile:(request=proposal,name='A')=>act(name,'reconcile',request),
    dispatch:(request=initial,name='A')=>act(name,'dispatch',request),
    successor:(request=proposal)=>({id:request.next,generation:request.generation}),
    effects:(...names)=>{
      assert.deepEqual(account.state.effects,names.map(name=>refs.get(name)));
      assert.deepEqual(economic(),money);
    },
  };
}

function refused(f,fn,code){
  const before=f.snapshot();
  assert.throws(fn,{message:code});
  assert.deepEqual(f.snapshot(),before);
}

function review(f,name){
  const attempt=f.req(name);
  f.register(attempt,name);
  return f.dispatch(attempt,name);
}

test('a verified hold atomically enrolls the occurrence and exact retry does not create another anchor',()=>{
  const f=harness({enrolled:false});
  assert.deepEqual([f.account.state.anchors.size,f.account.state.incidents.size], [0,0]);
  const first=f.enroll('A'),after=f.snapshot();
  assert.deepEqual([first.created,f.account.state.origins.size,f.account.state.anchors.size,
    f.account.state.guard.members.size],[true,1,1,1]);
  assert.deepEqual(f.enroll('A'),{...first,created:false});
  assert.deepEqual(f.snapshot(),after);
});

test('before enrolling, Account requires the verified cut, hold purpose, service and occurrence evidence',()=>{
  const f=harness({enrolled:false}),token=f.video.attest('A','hold');
  refused(f,()=>f.account.enroll(services.dispatch,token),'forbidden');
  refused(f,()=>f.account.enroll(services.hold,{}),'attestation');
  refused(f,()=>f.account.enroll(services.hold,f.video.attest('A','register',f.initial)),'attestation');
  f.account.state.activeCut=null;
  refused(f,()=>f.enroll('A'),'cut');
  f.account.state.activeCut={...cut};
  refused(f,()=>f.reconcile({...f.proposal,generation:f.initial.generation}),'anchor');
  f.video.rows.get('A').outbox.occurrence='different-occurrence';
  refused(f,()=>f.enroll('A'),'video_origin');
  assert.equal(f.account.state.guard,null);
});

test('another source with identical hold fields lacks authority and adoption cannot silently follow a changed account',()=>{
  const f=harness(),other=videoSource();
  other.seed('A');
  refused(f,()=>f.account.enroll(services.hold,other.attest('A','hold')),'attestation');
  // This synthetic corruption forces the same linkage version across owners, contrary to normal issuance.
  f.account.state.binding.owner='account-B';
  refused(f,()=>f.enroll('A'),'anchor');
  assert.equal(f.account.state.incidents.size,1);
});

test('a copied immutable origin with different evidence fails even when the hold carries the same occurrence ID',()=>{
  const f=harness(),row=f.video.rows.get('A');
  row.fact.incidentKey='alternate-incident';
  row.origin={...row.origin,incidentKey:row.fact.incidentKey,hash:digest('source-v2',row.fact.scope,
    row.fact.cut,row.fact.videoAccount,row.fact.identity,row.fact.linkVersion,row.fact.occurrence,
    row.fact.incidentKey,row.fact.creation)};
  row.outbox.originHash=row.origin.hash;
  refused(f,()=>f.enroll('A'),'anchor');
});

test('lost local commit ACK with zero POST can fence the attested, never-enrolled attempt',()=>{
  const f=harness();
  assert.equal(f.anchor().operation,null);
  assert.equal(f.account.state.receipts.size,0);
  assert.deepEqual(f.reconcile(),{state:'authorized',attemptId:f.proposal.next});
  assert.equal(f.account.state.receipts.size,0);
  refused(f,()=>f.register(),'fenced');
  refused(f,()=>f.dispatch(),'fenced');
  assert.equal(f.dispatch(f.successor()).blocked,false);
  f.effects('A');
});

test('a vacant v2 anchor lacking enrollment, or missing a proven initial attempt, cannot authorize recovery',()=>{
  const f=harness();
  refused(f,()=>f.reconcile({...f.proposal,old:'unproven-initial'}),'attempt');
  refused(f,()=>f.register({...f.initial,id:'unproven-initial'}),'attempt');
  const original=structuredClone(f.anchor());
  for(const broken of [null,{...original,v:1},{...original,cut:null},
    {...original,owner:'account-B'},{...original,originHash:'different-origin'}]){
    f.account.state.anchors.set(f.ref(),broken);
    refused(f,()=>f.reconcile(),'anchor');
  }
  f.account.state.anchors.set(f.ref(),original);
  f.account.state.origins.clear();
  refused(f,()=>f.reconcile(),'anchor');
});

test('changed and restored Video authorization metadata cannot mint a fresh reconciliation token',()=>{
  const f=harness(),row=f.video.rows.get('A'),request=structuredClone(row.operation);
  row.operation={...row.operation,evidence:'temporarily-different'};
  refused(f,()=>f.reconcile(),'video_audit');
  row.operation=request;
  row.auditVersion='restored-with-new-physical-version';
  refused(f,()=>f.reconcile(),'video_audit');
  assert.equal(f.anchor().operation,null);
});

test('the same acknowledged operation requires the original operator even if another operator is allowlisted',()=>{
  const f=harness();
  f.register();
  refused(f,()=>f.act('A','reconcile',f.proposal,alternateOperator),'operator');
  assert.equal(f.reconcile().state,'authorized');
  refused(f,()=>f.act('A','dispatch',f.successor(),alternateOperator),'operator');
  assert.equal(f.dispatch(f.successor()).blocked,false);
  f.effects('A');
});

test('registration and dispatch require their own authenticated service, purpose and exact payload',()=>{
  const f=harness(),token=f.video.attest('A','register',f.initial);
  refused(f,()=>f.account.register(services.reconcile,token,f.initial),'forbidden');
  refused(f,()=>f.account.dispatch(services.dispatch,token,f.initial),'attestation');
  refused(f,()=>f.account.register(services.register,token,{...f.initial,id:'tampered'}),'attestation');
  assert.equal(f.account.register(services.register,token,f.initial).state,'recorded');
  const dispatch=f.video.attest('A','dispatch',f.initial);
  refused(f,()=>f.account.dispatch(services.register,dispatch,f.initial),'forbidden');
  refused(f,()=>f.account.dispatch(services.dispatch,{},f.initial),'attestation');
  assert.equal(f.account.dispatch(services.dispatch,dispatch,f.initial).replayed,false);
  f.effects('A');
});

test('binding A→B→A with a new generation cannot reuse old authentic authority',()=>{
  const f=harness();
  f.register();
  const token=f.video.attest('A','reconcile',f.proposal);
  f.account.state.binding={...link,owner:'account-B',version:'uid-link-4'};
  refused(f,()=>f.account.reconcile(services.reconcile,token,f.proposal),'binding');
  f.account.state.binding={...link,owner:'account-A',version:'uid-link-5'};
  refused(f,()=>f.account.reconcile(services.reconcile,token,f.proposal),'binding');
  refused(f,()=>f.dispatch(),'binding');
  f.effects();
});

test('an ACK lost after original POST retains its exact receipt and replays without another effect',()=>{
  const f=harness();
  f.register();
  const first=f.dispatch();
  assert.equal(first.replayed,false);
  const after=f.snapshot();
  assert.deepEqual(f.dispatch(),{...first,replayed:true});
  assert.deepEqual(f.reconcile(),{state:'confirmed',ref:f.ref(),attemptId:f.initial.id,
    accepted:f.initial.generation,blocked:false});
  assert.deepEqual(f.snapshot(),after);
  assert.equal(f.anchor().attempts.has(f.proposal.next),false);
  f.effects('A');
});

for(const when of ['before','after']){
  test('the fence wins and a retained old POST has no effect '+when+' successor confirmation',()=>{
    const f=harness();
    f.register();
    const late=f.video.attest('A','dispatch',f.initial);
    const deliverLate=()=>f.account.dispatch(services.dispatch,late,f.initial);
    assert.equal(f.reconcile().state,'authorized');
    if(when==='before')refused(f,deliverLate,'fenced');
    assert.equal(f.dispatch(f.successor()).replayed,false);
    if(when==='after')refused(f,deliverLate,'fenced');
    assert.equal(f.dispatch(f.successor()).replayed,true);
    assert.equal(f.reconcile().attemptId,f.proposal.next);
    f.effects('A');
  });
}

test('the 409 path recovers with corrected generation after the independent rival is reviewed',()=>{
  const f=harness();
  f.register();
  f.add('B');
  refused(f,()=>f.dispatch(),'generation');
  refused(f,()=>f.reconcile(),'generation');
  assert.equal(f.account.state.receipts.size,0);
  assert.equal(review(f,'B').blocked,true);
  const corrected={...f.proposal,generation:f.guards()};
  assert.equal(corrected.generation.epoch,2);
  assert.equal(f.reconcile(corrected).state,'authorized');
  refused(f,()=>f.dispatch({...f.initial,generation:corrected.generation}),'fenced');
  assert.equal(f.dispatch(f.successor(corrected)).blocked,false);
  f.effects('B','A');
});

test('a lost registration response recovers state without a POST and the old permit can be fenced',()=>{
  const f=harness();
  assert.throws(()=>{
    f.register();
    throw Error('transport lost registration ACK');
  },{message:'transport lost registration ACK'});
  const after=f.snapshot();
  assert.equal(f.register().state,'recorded');
  assert.deepEqual(f.snapshot(),after);
  f.effects();
  assert.equal(f.reconcile().state,'authorized');
  refused(f,()=>f.register(),'fenced');
  refused(f,()=>f.dispatch(),'fenced');
  assert.equal(f.dispatch(f.successor()).blocked,false);
  f.effects('A');
});

test('a lost fence ACK and competitors recover only the exact reconciliation',()=>{
  const f=harness();
  f.register();
  assert.throws(()=>{
    f.reconcile();
    throw Error('transport lost fence ACK');
  },{message:'transport lost fence ACK'});
  const after=f.snapshot();
  assert.deepEqual(f.reconcile(),{state:'authorized',attemptId:f.proposal.next});
  assert.deepEqual(f.snapshot(),after);
  refused(f,()=>f.reconcile({...f.proposal,next:'different-attempt'}),'reconcile_conflict');
  refused(f,()=>f.reconcile({...f.proposal,id:'different-id',next:'different-attempt'}),'fenced');
  refused(f,()=>f.act('A','reconcile',f.proposal,alternateOperator),'operator');
  assert.equal(f.dispatch(f.successor()).blocked,false);
  f.effects('A');
});

test('generation can move again and a replay never revives the superseded successor',()=>{
  const f=harness();
  f.register();
  f.reconcile();
  f.add('B');
  assert.deepEqual(f.reconcile(),{state:'stale',attemptId:f.proposal.next});
  refused(f,()=>f.dispatch(f.successor()),'generation');
  const next={id:'reconcile-A-2',old:f.proposal.next,next:'next-A-2',generation:f.guards()};
  refused(f,()=>f.reconcile({...next,next:f.initial.id}),'attempt_reused');
  assert.equal(f.reconcile(next).state,'authorized');
  assert.deepEqual(f.reconcile(),{state:'superseded',attemptId:f.proposal.next});
  refused(f,()=>f.dispatch(f.successor()),'fenced');
  assert.equal(f.dispatch(f.successor(next)).blocked,true);
  assert.equal(review(f,'B').blocked,false);
  assert.equal(f.reconcile(next).blocked,false);
  f.effects('A','B');
});

test('separate anchors and receipts protect two active incidents with a common guard',()=>{
  const f=harness();
  f.add('B');
  const a=f.req('A'),b=f.req('B');
  f.register(a,'A');
  f.register(b,'B');
  const first=f.dispatch(a,'A');
  assert.equal(first.blocked,true);
  assert.equal(f.account.state.receipts.has(f.ref('B')),false);
  const after=f.snapshot();
  assert.deepEqual(f.dispatch(a,'A'),{...first,replayed:true});
  refused(f,()=>f.dispatch(a,'B'),'fenced');
  assert.deepEqual(f.snapshot(),after);
  assert.equal(f.dispatch(b,'B').blocked,false);
  assert.equal(f.account.state.guard,null);
  f.effects('A','B');
});

test('a later incident starts another creation and an old receipt cannot close it',()=>{
  const f=harness();
  f.register();
  f.dispatch();
  f.add('B');
  const current=structuredClone(f.account.state.guard);
  assert.equal(current.epoch,f.initial.generation.epoch);
  assert.equal(current.createdAtMs,f.initial.generation.createdAtMs);
  assert.notEqual(current.createVersion,f.initial.generation.createVersion);
  const old=f.reconcile();
  assert.deepEqual([old.ref,old.blocked,old.accepted],[f.ref(),true,f.initial.generation]);
  assert.deepEqual(f.enroll('A'),{ref:f.ref(),created:false,status:'reviewed'});
  assert.deepEqual(f.account.state.guard,current);
  assert.equal(f.account.state.receipts.has(f.ref('B')),false);
  f.effects('A');
});

test('identical guard fields after recreation do not restore the physical creation proof',()=>{
  const f=harness();
  f.register();
  const {createVersion,...sameFields}=f.guards();
  f.account.state.guard={...f.account.state.guard,createVersion:'restored-create-version'};
  const {createVersion:restored,...restoredFields}=f.guards();
  assert.deepEqual(restoredFields,sameFields);
  assert.notEqual(restored,createVersion);
  refused(f,()=>f.dispatch(),'incident');
  refused(f,()=>f.reconcile({...f.proposal,generation:f.guards()}),'incident');
});

test('a retained enrollment but lost Account anchor cannot be recreated by replay or reconciliation',()=>{
  const f=harness();
  f.register();
  f.account.state.anchors.delete(f.ref());
  refused(f,()=>f.enroll('A'),'anchor');
  refused(f,()=>f.reconcile(),'anchor');
  refused(f,()=>f.dispatch(),'anchor');
});

test('a lost successor or its decision does not create a second authority',()=>{
  const f=harness();
  f.register();
  f.reconcile();
  const successor=structuredClone(f.anchor().attempts.get(f.proposal.next));
  f.anchor().attempts.delete(f.proposal.next);
  refused(f,()=>f.reconcile(),'history');
  refused(f,()=>f.dispatch(f.successor()),'attempt');
  f.anchor().attempts.set(f.proposal.next,successor);
  f.anchor().reconciliations.delete(f.proposal.id);
  refused(f,()=>f.dispatch(f.successor()),'history');
});

test('loss of another claimed incident cannot be read as the last blocker being reviewed',()=>{
  const f=harness();
  f.add('B');
  const a=f.req();
  f.register(a);
  f.account.state.incidents.delete(f.ref('B'));
  refused(f,()=>f.dispatch(a),'incident');
  assert.ok(f.account.state.guard);
  f.effects();
});

test('a missing receipt for a reviewed incident cannot authorize a successor',()=>{
  const f=harness();
  f.add('B');
  assert.equal(review(f,'A').blocked,true);
  const a=f.req();
  f.account.state.receipts.delete(f.ref());
  refused(f,()=>f.reconcile(),'incident');
  refused(f,()=>f.dispatch(a),'incident');
  assert.ok(f.account.state.guard);
  f.effects('A');
});

test('the same incident with incompatible original authorization cannot unlock or reuse its receipt',()=>{
  const f=harness();
  f.register();
  f.dispatch();
  f.account.state.receipts.get(f.ref()).operation.evidence='damaged-receipt';
  refused(f,()=>f.reconcile(),'receipt');
  refused(f,()=>f.dispatch(),'receipt');
});
