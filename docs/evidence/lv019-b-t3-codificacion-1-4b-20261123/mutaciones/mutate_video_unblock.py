import os, subprocess, sys, time, hashlib, threading
REPO = r"C:\Users\rob62\Documents\Codex\2026-11-11\vamos-a-continuar-linguistvision-en-esta-2"
SP = r"C:\Users\rob62\AppData\Local\Temp\claude\14302df9167c2660\5fb73f1c-c60d-4ae0-aa77-93d696a98422\scratchpad"
FILES = {
 "U": REPO + r"\server\commercial\billingUnblock.ts",
 "F": REPO + r"\server\commercial\firestoreBackend.ts",
}
originals = {k: open(v, "rb").read() for k, v in FILES.items()}
for k, v in FILES.items(): open(SP + "\\vun_" + k + ".bak", "wb").write(originals[k])
def sha(b): return hashlib.sha256(b).hexdigest()[:12]

# (name, file, old, new). Anchors use \n; they are converted to CRLF when the file is CRLF.
M = [
 ("control-noop", "U", "const hash=(value:unknown)", "const hash=(value:unknown)"),
 ("audit-id-no-epoch", "U", "return hash(['billing-unblock-v2',incidentKey,epoch,createdAtMs,action]);", "return hash(['billing-unblock-v2',incidentKey,createdAtMs,action]);"),
 ("audit-id-no-createdAt", "U", "return hash(['billing-unblock-v2',incidentKey,epoch,createdAtMs,action]);", "return hash(['billing-unblock-v2',incidentKey,epoch,action]);"),
 ("adm-state-not-checked", "U", "if(!admission.exists||admission.get('state')!=='needs_review')return null;", "if(!admission.exists)return null;"),
 ("adm-incident-not-checked", "U", "if(named!==incidentKey&&!planned.some(row=>row.collection==='billingIntentObservationIncidents'&&row.id===named))return null;", ""),
 ("adm-also-for-outbox", "U", "if(incident.kind==='intent'){", "if(true){"),
 ("adm-not-planned", "U", "if(admissionRow){incident.planned.push(admissionRow);incident.owned.add('billingIntentAdmissionGuards/'+clean.incidentKey);}", "if(admissionRow){incident.owned.add('billingIntentAdmissionGuards/'+clean.incidentKey);}"),
 ("adm-owned-dropped", "U", "incident.owned.add('billingIntentAdmissionGuards/'+clean.incidentKey);", ""),
 ("adm-write-not-clear", "U", "tx.update(snap.ref,{state:'clear',incidentId:FieldValue.delete(),updatedAtMs:FieldValue.delete()});", "tx.update(snap.ref,{state:'needs_review',incidentId:FieldValue.delete(),updatedAtMs:FieldValue.delete()});"),
 ("adm-incidentId-kept", "U", "tx.update(snap.ref,{state:'clear',incidentId:FieldValue.delete(),updatedAtMs:FieldValue.delete()});", "tx.update(snap.ref,{state:'clear',updatedAtMs:FieldValue.delete()});"),
 ("adm-updatedAt-kept", "U", "tx.update(snap.ref,{state:'clear',incidentId:FieldValue.delete(),updatedAtMs:FieldValue.delete()});", "tx.update(snap.ref,{state:'clear',incidentId:FieldValue.delete()});"),
 ("F-holdrow-createdAt-overwritten", "F", "return {...hold,state:'pending' as const,attempts:0,nextAttemptAt:now,...(hold.createdAtMs===undefined?{createdAtMs:now}:{})};", "return {...hold,state:'pending' as const,attempts:0,nextAttemptAt:now,createdAtMs:now};"),
 ("F-holdrow-legacy-not-stamped", "F", "return {...hold,state:'pending' as const,attempts:0,nextAttemptAt:now,...(hold.createdAtMs===undefined?{createdAtMs:now}:{})};", "return {...hold,state:'pending' as const,attempts:0,nextAttemptAt:now};"),
 ("F-holdrow-no-nextAttempt", "F", "return {...hold,state:'pending' as const,attempts:0,nextAttemptAt:now,...(hold.createdAtMs===undefined?{createdAtMs:now}:{})};", "return {...hold,state:'pending' as const,attempts:0,...(hold.createdAtMs===undefined?{createdAtMs:now}:{})};"),
 ("F-holdrow-attempts-not-zero", "F", "return {...hold,state:'pending' as const,attempts:0,nextAttemptAt:now,...(hold.createdAtMs===undefined?{createdAtMs:now}:{})};", "return {...hold,state:'pending' as const,attempts:1,nextAttemptAt:now,...(hold.createdAtMs===undefined?{createdAtMs:now}:{})};"),
 ("accountRows-not-transactional", "U", "const page=await tx.get(root.collection(collection).where('accountId','==',accountId));", "const page=await root.collection(collection).where('accountId','==',accountId).get();"),
 # ---- phase 0 generation / alert / guard shape
 ("p0-epoch-dropped", "U", "if(current.epoch!==clean.epoch||current.createdAtMs!==clean.createdAtMs||current.updatedAtMs!==clean.updatedAtMs)", "if(current.createdAtMs!==clean.createdAtMs||current.updatedAtMs!==clean.updatedAtMs)"),
 ("p0-createdAt-dropped", "U", "if(current.epoch!==clean.epoch||current.createdAtMs!==clean.createdAtMs||current.updatedAtMs!==clean.updatedAtMs)", "if(current.epoch!==clean.epoch||current.updatedAtMs!==clean.updatedAtMs)"),
 ("p0-updatedAt-dropped", "U", "if(current.epoch!==clean.epoch||current.createdAtMs!==clean.createdAtMs||current.updatedAtMs!==clean.updatedAtMs)", "if(current.epoch!==clean.epoch||current.createdAtMs!==clean.createdAtMs)"),
 ("p0-alert-owner-dropped", "U", "if(identity.kind!=='guard'||identity.rowId!==accountId)throw Object.assign(new UnblockFault('conflict'),{stage:'alert_owner'});", ""),
 ("p0-alert-status-dropped", "U", "if(identity.status!=='open')throw Object.assign(new UnblockFault('conflict'),{stage:'alert_status'});", ""),
 ("p0-alert-state-dropped", "U", "if(identity.state!==blockedState(clean.epoch,clean.createdAtMs,clean.incidentKey))throw Object.assign(new UnblockFault('conflict'),{stage:'alert_state:'+identity.state});", ""),
 ("p0-guard-account-dropped", "U", "||guard.get('accountId')!==accountId)throw Object.assign(new UnblockFault('conflict'),{stage:'guard_shape'});", ")throw Object.assign(new UnblockFault('conflict'),{stage:'guard_shape'});"),
 ("p0-rivals-ignored", "U", "if(rivals.length)throw Object.assign(new UnblockFault('unresolved')", "if(false)throw Object.assign(new UnblockFault('unresolved')"),
 ("p0-incident-null-ignored", "U", "if(intent===outbox)return null;", "if(intent&&outbox)return null;"),
 # ---- replays / resume
 ("released-branch-dropped", "U", "    if(released.exists){", "    if(false){"),
 ("released-operator-dropped", "U", "if(!samePayload(data)||!sameOperator(data))throw new UnblockFault('conflict');\n      // `video_released`", "if(!samePayload(data))throw new UnblockFault('conflict');\n      // `video_released`"),
 ("released-live-guard-allowed", "U", "      if(guard.exists&&guard.get('blocked')===true)throw new UnblockFault('conflict');\n      return {replayed:true as const,record:data!,videoReleased:true as const};", "      return {replayed:true as const,record:data!,videoReleased:true as const};"),
 ("released-payload-dropped", "U", "if(!samePayload(data)||!sameOperator(data))throw new UnblockFault('conflict');\n      // `video_released`", "if(!sameOperator(data))throw new UnblockFault('conflict');\n      // `video_released`"),
 ("p3-hold-applied-skip-dropped", "U", "      if(holdSettled&&data.state==='applied')continue;\n", ""),
 ("p3-hold-needs-review-not-accepted", "U", "(holdSettled&&(data.state==='applied'||data.state==='needs_review'))", "(holdSettled&&(data.state==='applied'))"),
 ("p3-hold-applied-not-accepted", "U", "(holdSettled&&(data.state==='applied'||data.state==='needs_review'))", "(holdSettled&&(data.state==='needs_review'))"),
 ("p3-hold-settled-any-collection", "U", "const holdSettled=row.collection==='billingHoldOutbox';", "const holdSettled=true;"),
 ("released-flag-dropped", "U", "videoBlocked:'videoReleased' in opened?false:Boolean(opened.record.videoBlocked)", "videoBlocked:Boolean(opened.record.videoBlocked)"),
 ("done-operator-dropped", "U", "if(!samePayload(data)||!sameOperator(data))throw new UnblockFault('conflict');\n      if(guard.exists&&guard.get('blocked')===true){", "if(!samePayload(data))throw new UnblockFault('conflict');\n      if(guard.exists&&guard.get('blocked')===true){"),
 ("done-payload-dropped", "U", "if(!samePayload(data)||!sameOperator(data))throw new UnblockFault('conflict');\n      if(guard.exists&&guard.get('blocked')===true){", "if(!sameOperator(data))throw new UnblockFault('conflict');\n      if(guard.exists&&guard.get('blocked')===true){"),
 ("done-generation-check-dropped", "U", "        if(!sameGeneration)throw new UnblockFault('conflict');\n", ""),
 ("requested-operator-dropped", "U", "if(authorizedBy!==data.authorizedBy)throw new UnblockFault('conflict');", ""),
 ("requested-payload-dropped", "U", "if(!samePayload(data))throw new UnblockFault('conflict');\n      if(authorizedBy!==data.authorizedBy)", "if(authorizedBy!==data.authorizedBy)"),
 ("requested-generation-dropped", "U", "if(guard.exists&&guard.get('blocked')===true&&!sameGeneration)throw new UnblockFault('conflict');", ""),
 ("sameGeneration-epoch-dropped", "U", "guard.get('epoch')===clean.epoch&&guard.get('createdAtMs')===clean.createdAtMs&&", "guard.get('createdAtMs')===clean.createdAtMs&&"),
 ("sameGeneration-createdAt-dropped", "U", "guard.get('epoch')===clean.epoch&&guard.get('createdAtMs')===clean.createdAtMs&&", "guard.get('epoch')===clean.epoch&&"),
 ("sameGeneration-incident-dropped", "U", "guard.get('createdAtMs')===clean.createdAtMs&&\n      (guard.get('lastIncidentId')===clean.incidentKey||guard.get('lastOutboxIncidentId')===clean.incidentKey);", "guard.get('createdAtMs')===clean.createdAtMs;"),
 ("sameGeneration-account-dropped", "U", "guard.get('blocked')===true&&guard.get('accountId')===accountId&&\n", "guard.get('blocked')===true&&\n"),
 # ---- partial repeat
 ("partial-account-blocked-ignored", "U", "if(again.blocked)return {unblocked:true,replayed:true,accountBlocked:true,videoBlocked:true,", "if(false)return {unblocked:true,replayed:true,accountBlocked:true,videoBlocked:true,"),
 ("partial-epoch-dropped", "U", "\n      if(current.epoch!==clean.epoch||current.createdAtMs!==clean.createdAtMs)throw new UnblockFault('conflict');", "\n      if(current.createdAtMs!==clean.createdAtMs)throw new UnblockFault('conflict');"),
 ("partial-createdAt-dropped", "U", "\n      if(current.epoch!==clean.epoch||current.createdAtMs!==clean.createdAtMs)throw new UnblockFault('conflict');", "\n      if(current.epoch!==clean.epoch)throw new UnblockFault('conflict');"),
 ("partial-alert-state-dropped", "U", "if(!identity||identity.status!=='open'||identity.state!==blockedState(clean.epoch,clean.createdAtMs,clean.incidentKey))throw new UnblockFault('conflict');\n      // The incident's rows", "if(!identity||identity.status!=='open')throw new UnblockFault('conflict');\n      // The incident's rows"),
 ("partial-alert-status-dropped", "U", "if(!identity||identity.status!=='open'||identity.state!==blockedState(clean.epoch,clean.createdAtMs,clean.incidentKey))throw new UnblockFault('conflict');\n      // The incident's rows", "if(!identity||identity.state!==blockedState(clean.epoch,clean.createdAtMs,clean.incidentKey))throw new UnblockFault('conflict');\n      // The incident's rows"),
 ("partial-rivals-ignored", "U", "if(rivals.length)return {unblocked:true as const,replayed:true as const,accountBlocked:false,videoBlocked:true as const,", "if(false)return {unblocked:true as const,replayed:true as const,accountBlocked:false,videoBlocked:true as const,"),
 ("partial-guard-not-deleted", "U", "      tx.delete(guardRef);\n      tx.update(alertRef,{status:'dispositioned',dispositionedAtMs:nowMs,dispositionedBy:authorizedBy,dispositionAuditId:unblockAuditId(clean.incidentKey,'video_released')});", "      tx.update(alertRef,{status:'dispositioned',dispositionedAtMs:nowMs,dispositionedBy:authorizedBy,dispositionAuditId:unblockAuditId(clean.incidentKey,'video_released')});"),
 ("partial-alert-not-dispositioned", "U", "      tx.update(alertRef,{status:'dispositioned',dispositionedAtMs:nowMs,dispositionedBy:authorizedBy,dispositionAuditId:unblockAuditId(clean.incidentKey,'video_released')});\n", ""),
 ("partial-alert-no-operator", "U", "dispositionedBy:authorizedBy,dispositionAuditId:unblockAuditId(clean.incidentKey,'video_released')", "dispositionAuditId:unblockAuditId(clean.incidentKey,'video_released')"),
 ("partial-record-not-created", "U", "      tx.create(releasedRef,{auditId:releasedId,action:'video_released',...payload,kind:String(partial.kind),accountId,holdId:String(partial.holdId),\n        advanced:[],accountBlocked:false,videoRivals:rivals,recordedAtMs:nowMs});\n", ""),
 ("partial-receipt-videoBlocked-true", "U", "return {unblocked:true as const,replayed:false as const,accountBlocked:false,videoBlocked:false as const,advanced:[],auditId:releasedId};", "return {unblocked:true as const,replayed:false as const,accountBlocked:false,videoBlocked:true as const,advanced:[],auditId:releasedId};"),
 # ---- phase 3
 ("p3-epoch-dropped", "U", "\n    if(current.epoch!==clean.epoch||current.createdAtMs!==clean.createdAtMs)throw new UnblockFault('conflict');", "\n    if(current.createdAtMs!==clean.createdAtMs)throw new UnblockFault('conflict');"),
 ("p3-createdAt-dropped", "U", "\n    if(current.epoch!==clean.epoch||current.createdAtMs!==clean.createdAtMs)throw new UnblockFault('conflict');", "\n    if(current.epoch!==clean.epoch)throw new UnblockFault('conflict');"),
 ("p3-alert-state-dropped", "U", "if(!identity||identity.status!=='open'||identity.state!==blockedState(clean.epoch,clean.createdAtMs,clean.incidentKey))throw new UnblockFault('conflict');\n    const rows:", "if(!identity||identity.status!=='open')throw new UnblockFault('conflict');\n    const rows:"),
 ("p3-alert-status-dropped", "U", "if(!identity||identity.status!=='open'||identity.state!==blockedState(clean.epoch,clean.createdAtMs,clean.incidentKey))throw new UnblockFault('conflict');\n    const rows:", "if(!identity||identity.state!==blockedState(clean.epoch,clean.createdAtMs,clean.incidentKey))throw new UnblockFault('conflict');\n    const rows:"),
 ("p3-state-recheck-dropped", "U", "      if(row.state!==null&&data.state!==row.state&&!(holdSettled&&(data.state==='applied'||data.state==='needs_review')))throw new UnblockFault('conflict');\n", ""),
 ("p3-reviewField-recheck-dropped", "U", "if(row.reviewField&&data[row.reviewField]!==clean.incidentKey)throw new UnblockFault('conflict');", ""),
 ("p3-rivals-ignored", "U", "const clear=!account.blocked&&rivals.length===0;", "const clear=!account.blocked;"),
 ("p3-account-blocked-ignored", "U", "const clear=!account.blocked&&rivals.length===0;", "const clear=rivals.length===0;"),
 ("p3-always-clear", "U", "const clear=!account.blocked&&rivals.length===0;", "const clear=true;"),
 ("p3-never-clear", "U", "const clear=!account.blocked&&rivals.length===0;", "const clear=false;"),
 ("p3-guard-not-deleted", "U", "    if(clear){\n      tx.delete(guardRef);\n", "    if(clear){\n"),
 ("p3-alert-not-dispositioned", "U", "      tx.update(alertRef,{status:'dispositioned',dispositionedAtMs:nowMs,dispositionedBy:authorizedBy,dispositionAuditId:unblockAuditId(clean.incidentKey,'unblocked')});\n", ""),
 ("p3-alert-no-operator", "U", "dispositionedBy:authorizedBy,dispositionAuditId:unblockAuditId(clean.incidentKey,'unblocked')", "dispositionAuditId:unblockAuditId(clean.incidentKey,'unblocked')"),
 ("p3-hold-not-applied", "U", "else if(row.collection==='billingHoldOutbox')tx.update(snap.ref,{state:'applied',appliedAtMs:nowMs,lastErrorCode:null});", "else if(row.collection==='billingHoldOutbox'){}"),
 ("p3-outbox-not-retry", "U", "tx.update(snap.ref,{state:'retry_wait',reviewIncidentId:FieldValue.delete(),nextAttemptAt:nowMs,updatedAtMs:nowMs});", "tx.update(snap.ref,{state:'needs_review',reviewIncidentId:FieldValue.delete(),nextAttemptAt:nowMs,updatedAtMs:nowMs});"),
 ("p3-outbox-pointer-kept", "U", "{state:'retry_wait',reviewIncidentId:FieldValue.delete(),nextAttemptAt:nowMs,updatedAtMs:nowMs}", "{state:'retry_wait',nextAttemptAt:nowMs,updatedAtMs:nowMs}"),
 ("p3-outbox-no-retry-time", "U", "{state:'retry_wait',reviewIncidentId:FieldValue.delete(),nextAttemptAt:nowMs,updatedAtMs:nowMs}", "{state:'retry_wait',reviewIncidentId:FieldValue.delete(),updatedAtMs:nowMs}"),
 ("p3-intent-reason-kept", "U", "{state:exit,reviewReason:FieldValue.delete(),reviewIncidentId:FieldValue.delete(),reviewOutboxIncidentId:FieldValue.delete(),updatedAtMs:nowMs}", "{state:exit,reviewIncidentId:FieldValue.delete(),reviewOutboxIncidentId:FieldValue.delete(),updatedAtMs:nowMs}"),
 ("p3-intent-incident-kept", "U", "{state:exit,reviewReason:FieldValue.delete(),reviewIncidentId:FieldValue.delete(),reviewOutboxIncidentId:FieldValue.delete(),updatedAtMs:nowMs}", "{state:exit,reviewReason:FieldValue.delete(),reviewOutboxIncidentId:FieldValue.delete(),updatedAtMs:nowMs}"),
 ("p3-intent-outbox-incident-kept", "U", "{state:exit,reviewReason:FieldValue.delete(),reviewIncidentId:FieldValue.delete(),reviewOutboxIncidentId:FieldValue.delete(),updatedAtMs:nowMs}", "{state:exit,reviewReason:FieldValue.delete(),reviewIncidentId:FieldValue.delete(),updatedAtMs:nowMs}"),
 ("p3-review-not-reviewed", "U", "if(row.collection==='billingReviewIncidents'||row.collection==='billingOutboxReviewIncidents')tx.update(snap.ref,{state:'reviewed',reviewedAtMs:nowMs,unblockAuditId:auditId});", "if(row.collection==='billingReviewIncidents'||row.collection==='billingOutboxReviewIncidents')tx.update(snap.ref,{state:'reviewed',unblockAuditId:auditId});"),
 ("p3-observation-not-reviewed", "U", "else if(row.collection==='billingIntentObservationIncidents')tx.update(snap.ref,{state:'reviewed',reviewedAtMs:nowMs,unblockAuditId:auditId});", "else if(row.collection==='billingIntentObservationIncidents')tx.update(snap.ref,{state:'reviewed',unblockAuditId:auditId});"),
 ("p3-review-no-audit-id", "U", "tx.update(snap.ref,{state:'reviewed',reviewedAtMs:nowMs,unblockAuditId:auditId});\n      else if(row.collection==='billingIntentObservationIncidents')", "tx.update(snap.ref,{state:'reviewed',reviewedAtMs:nowMs});\n      else if(row.collection==='billingIntentObservationIncidents')"),
 ("p3-done-videoBlocked-false", "U", "accountBlocked:account.blocked,videoBlocked:!clear,videoRivals:rivals", "accountBlocked:account.blocked,videoBlocked:false,videoRivals:rivals"),
 ("p3-receipt-videoBlocked-false", "U", "accountBlocked:account.blocked,videoBlocked:!clear,advanced,auditId};", "accountBlocked:account.blocked,videoBlocked:false,advanced,auditId};"),
 ("p3-receipt-accountBlocked-false", "U", "replayed:false as const,accountBlocked:account.blocked,videoBlocked:!clear,advanced,auditId};", "replayed:false as const,accountBlocked:false,videoBlocked:!clear,advanced,auditId};"),
 ("p3-rivals-owned-empty", "U", "const rivals=unresolvedRows(await accountRows(tx,root,accountId),new Set(rows.map(row=>row.planned.collection+'/'+row.planned.id)));", "const rivals=unresolvedRows(await accountRows(tx,root,accountId),new Set<string>());"),
 # ---- row selection
 ("hold-epoch-dropped", "U", "doc.data.epoch===undefined||doc.data.epoch===generation.epoch&&doc.data.createdAtMs===generation.createdAtMs", "doc.data.epoch===undefined||doc.data.createdAtMs===generation.createdAtMs"),
 ("hold-createdAt-dropped", "U", "doc.data.epoch===undefined||doc.data.epoch===generation.epoch&&doc.data.createdAtMs===generation.createdAtMs", "doc.data.epoch===undefined||doc.data.epoch===generation.epoch"),
 ("legacy-hold-epoch-dropped", "U", "??rows.holds.find(doc=>doc.id===legacyId&&doc.data.epoch===undefined);", "??rows.holds.find(doc=>doc.id===legacyId);"),
 ("hold-needs-review-not-planned", "U", "if(hold&&(hold.data.state==='pending'||hold.data.state==='needs_review')){planned.push", "if(hold&&(hold.data.state==='pending')){planned.push"),
 ("hold-owned-legacy-dropped", "U", "new Set<string>(['billingHoldOutbox/'+holdId,'billingHoldOutbox/'+legacyId])", "new Set<string>(['billingHoldOutbox/'+holdId])"),
 ("rival-intents-ignored", "U", "for(const doc of rows.intents)if(doc.data.state==='needs_review')add('billingIntents',doc);", ""),
 ("rival-outboxes-ignored", "U", "for(const doc of rows.outboxes)if(doc.data.state==='needs_review')add('billingOutbox',doc);", ""),
 ("rival-holds-pending-ignored", "U", "if(doc.data.state==='pending'||doc.data.state==='needs_review')add('billingHoldOutbox',doc);", "if(doc.data.state==='needs_review')add('billingHoldOutbox',doc);"),
 ("rival-holds-review-ignored", "U", "if(doc.data.state==='pending'||doc.data.state==='needs_review')add('billingHoldOutbox',doc);", "if(doc.data.state==='pending')add('billingHoldOutbox',doc);"),
 ("rival-reviews-ignored", "U", "for(const doc of rows.reviews)if(!whole(doc.data.reviewedAtMs))add('billingReviewIncidents',doc);", ""),
 ("rival-outbox-incidents-ignored", "U", "for(const doc of rows.outboxIncidents)if(!whole(doc.data.reviewedAtMs))add('billingOutboxReviewIncidents',doc);", ""),
 ("rival-observations-ignored", "U", "for(const doc of rows.observationIncidents)if(!whole(doc.data.reviewedAtMs))add('billingIntentObservationIncidents',doc);", ""),
 ("rows-not-scoped-to-account", "U", "tx.get(root.collection(collection).where('accountId','==',accountId))", "tx.get(root.collection(collection))"),
 ("identity-multiple-owners-allowed", "U", "if(keys.length!==1||!digest(keys[0]))throw new UnblockFault('conflict');", "if(keys.length<1||!digest(keys[0]))throw new UnblockFault('conflict');"),
 ("exit-job-created-dropped", "U", "if(intent.exists&&(intent.get('state')==='job_created'||typeof intent.get('jobId')==='string'))return 'job_created';", "if(false)return 'job_created';"),
 ("exit-jobId-dropped", "U", "(intent.get('state')==='job_created'||typeof intent.get('jobId')==='string')", "(intent.get('state')==='job_created')"),
 ("exit-release-prepared-dropped", "U", "return witness.exists&&witness.get('terminalRecovery')?.releasePrepared===true?'release_pending':'reserve_pending';", "return 'reserve_pending';"),
 # ---- request validation
 ("strict-keys-dropped", "U", "if(Object.keys(r).some(key=>!allowed.includes(key)))throw new UnblockFault('invalid');", ""),
 ("epoch-min-zero", "U", "!whole(epoch,1)||", "!whole(epoch,0)||"),
 ("accountEpoch-min-zero", "U", "||!whole(accountEpoch,1)||", "||!whole(accountEpoch,0)||"),
 ("actor-unchecked", "U", "if(typeof authorizedBy!=='string'||!actorPattern.test(authorizedBy))throw new UnblockFault('invalid');", ""),
 ("accountId-unchecked", "U", "if(!uuid.test(accountId))throw new UnblockFault('invalid');", ""),
 # ---- writers in firestoreBackend.ts
 ("F-guardEpoch-same-incident-grows", "F", "return {epoch:doc.get(incident.field)===incident.id?epoch:epoch+1,createdAtMs:createdAtMs as number};", "return {epoch:epoch+1,createdAtMs:createdAtMs as number};"),
 ("F-guardEpoch-new-epoch-2", "F", "if(!doc.exists||doc.get('blocked')!==true)return {epoch:1,createdAtMs:now};", "if(!doc.exists||doc.get('blocked')!==true)return {epoch:2,createdAtMs:now};"),
 ("F-writer-never-grows", "F", "const nextEpoch=doc.get(incident.field)===incident.id?epoch:epoch+1;", "const nextEpoch=epoch;"),
 ("F-writer-always-grows", "F", "const nextEpoch=doc.get(incident.field)===incident.id?epoch:epoch+1;", "const nextEpoch=epoch+1;"),
 ("F-writer-createdAt-restamped", "F", "epoch:nextEpoch,createdAtMs,updatedAtMs:now}", "epoch:nextEpoch,createdAtMs:now,updatedAtMs:now}"),
 ("F-writer-new-guard-epoch-2", "F", "[incident.field]:incident.id,epoch:1,createdAtMs:now,updatedAtMs:now},{merge:true});return {epoch:1,createdAtMs:now};", "[incident.field]:incident.id,epoch:2,createdAtMs:now,updatedAtMs:now},{merge:true});return {epoch:2,createdAtMs:now};"),
 ("F-preview-unattributable-dropped", "F", "if(doc.exists&&(doc.get('accountId')!==accountId||typeof doc.get('blocked')!=='boolean'))return null;", ""),
 ("F-preview-blocked-type-dropped", "F", "if(doc.exists&&(doc.get('accountId')!==accountId||typeof doc.get('blocked')!=='boolean'))return null;", "if(doc.exists&&(doc.get('accountId')!==accountId))return null;"),
 ("F-listing-validates-generation", "F", "return rows.docs.map(d=>({...d.data(),id:d.id,snapshotVersion:outboxVersion(d)}));", "return rows.docs.map(d=>({...d.data(),id:d.id,snapshotVersion:outboxVersion(d),...(storedHoldGeneration(d.data())??{})}));"),
 ("F-hold-id-without-generation", "F", "return {id:holdId(sourceKind,sourceId,generation),accountId", "return {id:holdId(sourceKind,sourceId),accountId"),
 ("F-hold-generation-partial-allowed", "F", "if(!Number.isSafeInteger(epoch)||Number(epoch)<1||!Number.isSafeInteger(createdAtMs)||Number(createdAtMs)<0)throw new LedgerFault('invariant');\n  return {epoch:Number(epoch),createdAtMs:Number(createdAtMs)};", "if(!Number.isSafeInteger(epoch)||Number(epoch)<1||!Number.isSafeInteger(createdAtMs)||Number(createdAtMs)<0)return undefined;\n  return {epoch:Number(epoch),createdAtMs:Number(createdAtMs)};"),
 ("F-oldHold-exists-check-dropped-direct", "F", "const holdValid=!oldHold?.exists||matchesHold(oldHold.data(),previewHold!)&&['pending','applied','needs_review'].includes(oldHold.get('state'));", "const holdValid=true;"),
 ("F-preview-written-mismatch-dropped", "F", "if(!preview||generation.epoch!==preview.epoch||generation.createdAtMs!==preview.createdAtMs)throw new LedgerFault('invariant');\n      if(hold&&holdRef&&!holdDoc?.exists)", "if(!preview)throw new LedgerFault('invariant');\n      if(hold&&holdRef&&!holdDoc?.exists)"),
]
env = {k: v for k, v in os.environ.items() if k not in ("NODE_OPTIONS", "GOOGLE_APPLICATION_CREDENTIALS", "OPENROUTER_API_KEY", "OPENROUTERROB_API_KEY", "GEMINI_API_KEY", "K_SERVICE")}
env.update({"NODE_ENV": "test", "FIRESTORE_EMULATOR_HOST": "127.0.0.1:8185"})
UNIT_SUITES = {
 "U": ["server/commercial/billingUnblock.emulator.mjs"],
 "F": ["server/commercial/billingUnblock.emulator.mjs", "server/commercial/firestoreBlocksA.emulator.mjs", "server/commercial/firestoreA3Exit.emulator.mjs", "server/commercial/firestoreAi.emulator.mjs"],
}
CMD = "node --no-network-family-autoselection --import tsx --test %s"

def restore():
    for _ in range(5):
        try:
            for k, v in FILES.items(): open(v, "wb").write(originals[k])
            if all(open(v, "rb").read() == originals[k] for k, v in FILES.items()): return True
        except OSError: time.sleep(1)
    return False

def run_failfast(cmd, limit=900):
    """Run a suite and kill it at the first TAP failure. Returns (verdict, tail)."""
    p = subprocess.Popen(cmd, shell=True, cwd=REPO, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
    verdict = None; first = ""; start = time.time(); lines = []
    def killer():
        subprocess.run("taskkill /PID %d /T /F" % p.pid, shell=True, capture_output=True)
    for line in p.stdout:
        lines.append(line)
        if line.startswith("not ok "):
            verdict = "killed"; first = line.strip()[:140]; killer(); break
        if time.time() - start > limit:
            verdict = "timeout"; killer(); break
    p.wait()
    if verdict is None:
        text = "".join(lines)
        verdict = "survived" if p.returncode == 0 and "# fail 0" in text else "killed"
        if verdict == "killed": first = "exit %s (no TAP failure line)" % p.returncode
    return verdict, first


import re, threading
NAMES = [l.rstrip("\n") for l in open(SP + "\\unblock_names.txt", encoding="utf-8") if l.strip()]
# The three writer-level tests only exercise firestoreBackend.ts; a billingUnblock.ts mutant cannot change them.
U_NAMES = [n for n in NAMES if not n.startswith("guard accounting:")]
SHARDS = 3
NODE = ["node", "--no-network-family-autoserection"]

def run_sharded(file, names, shards=SHARDS):
    """Run `names` of one test file in `shards` parallel node processes (fixtures are scoped per test); kill all at the first failure."""
    groups = [names[i::shards] for i in range(shards) if names[i::shards]]
    procs = []; state = {"fail": None}; lock = threading.Lock(); outs = [[] for _ in groups]
    def kill_all():
        for q in procs:
            if q.poll() is None: subprocess.run("taskkill /PID %d /T /F" % q.pid, shell=True, capture_output=True)
    def pump(idx, q):
        for line in q.stdout:
            outs[idx].append(line)
            if line.startswith("not ok "):
                with lock:
                    if state["fail"] is None: state["fail"] = line.strip()[:140]; kill_all()
    threads = []
    for idx, g in enumerate(groups):
        args = ["node", "--no-network-family-autoselection", "--import", "tsx", "--test"]
        for n in g: args += ["--test-name-pattern", "^" + re.escape(n) + "$"]
        args.append(file)
        q = subprocess.Popen(args, cwd=REPO, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
        procs.append(q); t = threading.Thread(target=pump, args=(idx, q), daemon=True); t.start(); threads.append(t)
    start = time.time()
    while any(q.poll() is None for q in procs):
        if time.time() - start > 1500: state["fail"] = state["fail"] or "timeout"; kill_all(); break
        time.sleep(1)
    for t in threads: t.join(timeout=5)
    if state["fail"]: return "killed", state["fail"]
    passed = 0
    for o, g in zip(outs, groups):
        text = "".join(o)
        m = re.search(r"^# pass (\d+)", text, flags=re.M); f = re.search(r"^# fail (\d+)", text, flags=re.M)
        if not m or not f or f.group(1) != "0" or int(m.group(1)) != len(g): return "killed", "shard did not pass all %d tests" % len(g)
        passed += int(m.group(1))
    return "survived", ""

only = sys.argv[1:]
results = []; survivors = []
try:
    for name, which, old, new in M:
        if only and name not in only: continue
        src = originals[which].decode("utf-8")
        crlf = "\r\n" in src
        o = old.replace("\n", "\r\n") if crlf else old
        n = new.replace("\n", "\r\n") if crlf else new
        if src.count(o) != 1:
            results.append((name, "SKIPPED (anchor count %d)" % src.count(o))); print(name, "SKIPPED", flush=True); continue
        t0 = time.time()
        open(FILES[which], "wb").write(src.replace(o, n, 1).encode("utf-8"))
        verdict, first = "?", ""
        if which == "U":
            verdict, first = run_sharded("server/commercial/billingUnblock.emulator.mjs", U_NAMES)
        else:
            verdict, first = run_sharded("server/commercial/billingUnblock.emulator.mjs", NAMES)
            if verdict == "survived":
                for suite in UNIT_SUITES["F"][1:]:
                    verdict, first = run_failfast(CMD % suite)
                    if verdict != "survived": first = suite.split("/")[-1] + ": " + first; break
        results.append((name, verdict.upper() + (" - " + first if first else "")))
        if verdict == "survived": survivors.append(name)
        print("%-40s %s (%ds)" % (name, results[-1][1], time.time() - t0), flush=True)
        if not restore(): print("RESTORE FAILED", name); sys.exit(2)
finally:
    ok = restore()
    print("final restore verified:", ok, {k: sha(open(v, "rb").read()) == sha(originals[k]) for k, v in FILES.items()})
print("survivors:", survivors)
