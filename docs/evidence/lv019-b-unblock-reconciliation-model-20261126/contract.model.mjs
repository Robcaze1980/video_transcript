// Synthetic contract model. The synchronous copy/commit represents one serialized Account transaction.
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {test} from 'node:test';

const proof=Object.freeze({
  scope:'video-after-cut',owner:'account-A',identityVersion:'uid-link-3',incident:'incident-A',
  occurrence:'video-guard-A',operation:'unblock-A',originalAudit:'original-video-audit',
  evidence:'review-evidence-A',initialAttempt:'attempt-initial',
});
const original={incarnation:'account-guard-1',epoch:1};
const initial={id:proof.initialAttempt,generation:original};
const operator='authenticated-operator';
const dispatcher='authenticated-settlement-service';
const proposal={
  id:'reconciliation-1',old:initial.id,next:'attempt-successor',generation:original,
};
const need=(condition,code)=>{if(!condition)throw Error(code);};

function generation(state){
  return state.guard&&{incarnation:state.guard.incarnation,epoch:state.guard.epoch};
}

class AccountModel {
  state={
    identityVersion:proof.identityVersion,
    owner:proof.owner,
    guard:{...original,rivals:0},
    incident:'active',
    anchor:{
      v:2,scope:proof.scope,owner:proof.owner,incident:proof.incident,incarnation:original.incarnation,
      operation:null,current:null,attempts:new Map(),reconciliations:new Map(),
    },
    receipt:null,mutations:0,
    balance:{available:10,reserved:3,consumed:0},reservation:{seconds:3,state:'reserved'},ledger:['reserve-3'],
  };

  // Authority verification stands in for an authenticated and authorized emitter; see the design.
  transaction(actor,expectedRole,attested,fn){
    need(actor===expectedRole,'forbidden');
    const s=structuredClone(this.state);
    need(isDeepStrictEqual(attested,proof)&&s.owner===attested.owner&&
      s.identityVersion===attested.identityVersion,'authority');
    const a=s.anchor;
    need(a?.v===2&&a.scope===attested.scope&&a.owner===attested.owner&&
      a.incident===attested.incident,'anchor');
    if(a.operation===null){
      need(a.current===null&&a.attempts.size===0&&a.reconciliations.size===0&&!s.receipt,'anchor');
    }else need(isDeepStrictEqual(a.operation,attested),'authority');
    const result=fn(s,a);
    this.state=s;
    return structuredClone(result);
  }

  receiptStatus(s,a){
    if(!s.receipt){
      need(s.incident==='active'&&s.guard?.incarnation===a.incarnation,'incident');
      return null;
    }
    const {attemptId,generation:accepted,operation}=s.receipt;
    const attempt=a.attempts.get(attemptId);
    need(s.incident==='reviewed'&&isDeepStrictEqual(operation,a.operation)&&
      attempt?.state==='committed'&&a.current===attemptId&&
      accepted.incarnation===a.incarnation&&isDeepStrictEqual(attempt.generation,accepted),'receipt_conflict');
    return {state:'confirmed',attemptId,accepted,blocked:s.guard!==null};
  }

  register(actor,attested,request){
    return this.transaction(actor,dispatcher,attested,(s,a)=>{
      need(request.id===attested.initialAttempt,'attempt');
      const receipt=this.receiptStatus(s,a);
      if(receipt){
        need(receipt.attemptId===request.id&&isDeepStrictEqual(receipt.accepted,request.generation),'fenced');
        return receipt;
      }
      if(a.operation){
        const previous=a.attempts.get(request.id);
        need(a.current===request.id&&previous?.state==='active'&&
          isDeepStrictEqual(previous.generation,request.generation),'fenced');
      }
      need(isDeepStrictEqual(request.generation,generation(s)),'generation');
      if(!a.operation){
        a.operation=attested;
        a.current=request.id;
        a.attempts.set(request.id,{state:'active',generation:request.generation});
      }
      return {state:'authorized',attemptId:a.current,generation:request.generation};
    });
  }

  reconcile(actor,attested,request){
    return this.transaction(actor,operator,attested,(s,a)=>{
      const previous=a.reconciliations.get(request.id);
      need(!previous||isDeepStrictEqual(previous,request),'reconcile_conflict');
      const vacant=a.operation===null;
      need(vacant?request.old===attested.initialAttempt:a.attempts.has(request.old),'attempt');
      const receipt=this.receiptStatus(s,a);
      if(receipt)return receipt;
      if(previous){
        const old=a.attempts.get(request.old),next=a.attempts.get(request.next);
        need(old?.state==='fenced'&&old.successor===request.next&&
          next&&isDeepStrictEqual(next.generation,request.generation),'history');
        if(a.current!==request.next)return {state:'superseded',attemptId:request.next};
        need(next.state==='active','history');
        if(!isDeepStrictEqual(request.generation,generation(s)))return {state:'stale',attemptId:request.next};
        return {state:'authorized',attemptId:a.current,generation:request.generation};
      }
      need(vacant||a.current===request.old&&a.attempts.get(request.old)?.state==='active','fenced');
      need(request.next!==request.old&&!a.attempts.has(request.next),'attempt_reused');
      need(isDeepStrictEqual(request.generation,generation(s)),'generation');

      const old=a.attempts.get(request.old);
      a.operation=attested;
      a.attempts.set(request.old,{state:'fenced',generation:old?.generation??null,successor:request.next});
      a.attempts.set(request.next,{state:'active',generation:request.generation});
      a.current=request.next;
      a.reconciliations.set(request.id,request);
      return {state:'authorized',attemptId:a.current,generation:request.generation};
    });
  }

  dispatch(actor,attested,request){
    return this.transaction(actor,dispatcher,attested,(s,a)=>{
      const receipt=this.receiptStatus(s,a);
      if(receipt){
        need(receipt.attemptId===request.id&&isDeepStrictEqual(receipt.accepted,request.generation),'fenced');
        return {...receipt,replayed:true};
      }
      const attempt=a.attempts.get(request.id);
      need(a.current===request.id&&attempt?.state==='active','fenced');
      need(isDeepStrictEqual(request.generation,attempt.generation)&&
        isDeepStrictEqual(attempt.generation,generation(s)),'generation');

      a.attempts.set(request.id,{...attempt,state:'committed'});
      s.receipt={attemptId:request.id,generation:attempt.generation,operation:a.operation};
      s.incident='reviewed';
      if(!s.guard.rivals)s.guard=null;
      s.mutations++;
      return {...this.receiptStatus(s,a),replayed:false};
    });
  }

  // Model controls for account-side events. They do not edit the accepted receipt.
  addRival(){
    if(!this.state.guard)this.state.guard={incarnation:'account-guard-2',epoch:1,rivals:1};
    else{
      this.state.guard.epoch++;
      this.state.guard.rivals++;
    }
  }

  resolveRival(){
    this.state.guard.rivals--;
    if(!this.state.guard.rivals&&this.state.incident==='reviewed')this.state.guard=null;
  }
}

function harness() {
  const account=new AccountModel();
  const snapshot=()=>structuredClone(account.state);
  const economicState=()=>{
    const {balance,reservation,ledger}=snapshot();
    return {balance,reservation,ledger};
  };
  const originalMoney=economicState();
  return {
    account,snapshot,
    register:(request=initial)=>account.register(dispatcher,proof,request),
    reconcile:(request=proposal)=>account.reconcile(operator,proof,request),
    dispatch:(request=initial)=>account.dispatch(dispatcher,proof,request),
    oneDecision:()=>{
      assert.equal(account.state.mutations,1);
      assert.equal(account.state.incident,'reviewed');
      assert.deepEqual(economicState(),originalMoney);
    },
  };
}
const successor={id:proposal.next,generation:original};

function refused(f,action,code){
  const before=f.snapshot();
  assert.throws(action,{message:code});
  assert.deepEqual(f.snapshot(),before);
}

test('lost Video commit ACK before any POST: a trusted vacant anchor can be fenced and progress',()=>{
  const f=harness();
  const videoClaim=Object.freeze({old:initial.id,audit:proof.originalAudit});
  assert.equal(f.account.state.anchor.operation,null);
  assert.equal(f.account.state.receipt,null);

  const result=f.reconcile({...proposal,old:videoClaim.old});
  assert.deepEqual(result,{state:'authorized',attemptId:successor.id,generation:original});
  assert.equal(f.account.state.incident,'active');
  assert.equal(f.account.state.receipt,null);
  refused(f,()=>f.register(),'fenced');
  refused(f,()=>f.dispatch(),'fenced');
  assert.equal(f.dispatch(successor).blocked,false);
  f.oneDecision();
});

test('old POST commits before the fence: reconciliation reads the exact receipt, including lost ACK',()=>{
  const f=harness();
  f.register();
  f.dispatch();
  f.account.addRival();
  const before=f.snapshot();
  assert.deepEqual(f.reconcile(),{state:'confirmed',attemptId:initial.id,accepted:original,blocked:true});
  assert.deepEqual(f.snapshot(),before);
  assert.equal(f.account.state.anchor.attempts.has(successor.id),false);
  f.oneDecision();
});

for(const lateOfOld of ['before','after']){
  test('fence wins: a late old POST is rejected '+lateOfOld+' the successor commits',()=>{
    const f=harness();
    f.register();
    assert.equal(f.reconcile().attemptId,successor.id);
    if(lateOfOld==='before')refused(f,()=>f.dispatch(),'fenced');
    assert.equal(f.dispatch(successor).replayed,false);
    if(lateOfOld==='after')refused(f,()=>f.dispatch(),'fenced');
    assert.equal(f.dispatch(successor).replayed,true);
    assert.equal(f.reconcile().attemptId,successor.id);
    f.oneDecision();
  });
}

test('a legitimate generation conflict leaves no receipt; the corrected generation can progress after fencing',()=>{
  const f=harness();
  f.register();
  f.account.addRival();
  refused(f,()=>f.dispatch(),'generation');
  refused(f,()=>f.reconcile(),'generation');
  assert.equal(f.account.state.receipt,null);
  f.account.resolveRival();

  const current=generation(f.account.state);
  assert.equal(current.epoch,2);
  assert.equal(f.reconcile({...proposal,generation:current}).attemptId,successor.id);
  refused(f,()=>f.dispatch({...initial,generation:current}),'fenced');
  assert.deepEqual(f.dispatch({...successor,generation:current}),{
    state:'confirmed',attemptId:successor.id,accepted:current,blocked:false,replayed:false,
  });
  f.oneDecision();
});

test('lost fence ACK and competing operators recover the same decision without granting a second successor',()=>{
  const f=harness();
  f.register();
  const lost=f.reconcile();
  const durable=f.snapshot();
  assert.deepEqual(f.reconcile(),lost);
  assert.deepEqual(f.snapshot(),durable);
  refused(f,()=>f.reconcile({...proposal,next:'other-attempt'}),'reconcile_conflict');
  refused(f,()=>f.reconcile({...proposal,id:'other-decision',next:'other-attempt'}),'fenced');
  refused(f,()=>f.dispatch({...successor,id:'other-attempt'}),'fenced');
  assert.equal(f.dispatch(successor).replayed,false);
  f.oneDecision();
});

test('a second generation change denies the successor and prevents an old reconciliation replay restoring it',()=>{
  const f=harness();
  f.register();
  f.reconcile();
  f.account.addRival();
  assert.deepEqual(f.reconcile(),{state:'stale',attemptId:successor.id});
  refused(f,()=>f.dispatch(successor),'generation');
  const nextGeneration=generation(f.account.state);
  refused(f,()=>f.reconcile({...proposal,id:'other-decision',old:successor.id,next:initial.id,
    generation:nextGeneration}),'attempt_reused');

  const newer={id:'reconciliation-2',old:successor.id,next:'attempt-third',generation:nextGeneration};
  f.reconcile(newer);
  assert.deepEqual(f.reconcile(),{state:'superseded',attemptId:successor.id});
  refused(f,()=>f.dispatch(successor),'fenced');
  assert.equal(f.dispatch({id:newer.next,generation:nextGeneration}).blocked,true);
  f.account.resolveRival();
  assert.equal(f.reconcile(newer).blocked,false);
  f.oneDecision();
});

test('an unauthorized operator or a different owner, evidence or identity generation cannot fence',()=>{
  const f=harness();
  f.register();
  refused(f,()=>f.account.reconcile(dispatcher,proof,proposal),'forbidden');
  for(const other of [{owner:'account-B'},{evidence:'other-evidence'},{occurrence:'other-video-guard'}]){
    refused(f,()=>f.account.reconcile(operator,{...proof,...other},proposal),'authority');
  }
  f.account.state.owner='account-B';
  refused(f,()=>f.reconcile(),'authority');
  f.account.state.owner=proof.owner;
  f.account.state.identityVersion='uid-link-5';
  refused(f,()=>f.reconcile(),'authority');
  refused(f,()=>f.dispatch(),'authority');
});

test('missing or legacy control state and an unrecognized initial attempt stay in review',()=>{
  const f=harness();
  refused(f,()=>f.reconcile({...proposal,old:'unproven-prior'}),'attempt');
  const originalAnchor=f.snapshot().anchor;
  f.account.state.anchor=null;
  refused(f,()=>f.reconcile(),'anchor');
  f.account.state.anchor={...originalAnchor,v:1};
  refused(f,()=>f.reconcile(),'anchor');
});

test('an existing permit with an unacknowledged registration is fenced without losing progress',()=>{
  const f=harness();
  f.register();
  assert.equal(f.account.state.receipt,null);
  assert.equal(f.reconcile().attemptId,successor.id);
  refused(f,()=>f.register(),'fenced');
  refused(f,()=>f.dispatch(),'fenced');
  assert.equal(f.dispatch(successor).replayed,false);
  f.oneDecision();
});

test('a guard recreated with the same epoch does not authorize a surviving active incident',()=>{
  const f=harness();
  f.register();
  f.account.state.guard={incarnation:'new-guard',epoch:original.epoch,rivals:0};
  refused(f,()=>f.dispatch(),'incident');
  refused(f,()=>f.reconcile({...proposal,generation:generation(f.account.state)}),'incident');
});

test('a reconciliation replay loses its authority if an attempt record is missing',()=>{
  const f=harness();
  f.register();
  f.reconcile();
  f.account.state.anchor.attempts.delete(successor.id);
  refused(f,()=>f.reconcile(),'history');
  refused(f,()=>f.dispatch(successor),'fenced');
});

test('a reviewed incident with a missing receipt never produces a successor',()=>{
  const f=harness();
  f.register();
  f.account.addRival();
  const current=generation(f.account.state);
  f.reconcile({...proposal,generation:current});
  f.dispatch({...successor,generation:current});
  f.account.state.receipt=null;
  refused(f,()=>f.reconcile({...proposal,generation:current}),'incident');
  refused(f,()=>f.dispatch({...successor,generation:current}),'incident');
});

test('a receipt that conflicts with the original authorization cannot justify fencing or closing',()=>{
  const f=harness();
  f.register();
  f.dispatch();
  f.account.state.receipt.operation={...proof,evidence:'corrupt-receipt-value'};
  refused(f,()=>f.reconcile(),'receipt_conflict');
  refused(f,()=>f.dispatch(),'receipt_conflict');
});
