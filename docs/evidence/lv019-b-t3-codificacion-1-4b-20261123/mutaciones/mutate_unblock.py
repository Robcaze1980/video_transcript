import os, shutil, subprocess, sys, time, hashlib
REPO = r"C:\Users\rob62\Documents\Codex\2026-11-11\vamos-a-continuar-linguistvision-en-esta-2"
SP = r"C:\Users\rob62\AppData\Local\Temp\claude\14302df9167c2660\5fb73f1c-c60d-4ae0-aa77-93d696a98422\scratchpad"
FILES = {
 "B": REPO + r"\server\account\backend.ts",
 "H": REPO + r"\server\account\http.ts",
 "C": REPO + r"\server\commercial\accountBillingClient.ts",
}
originals = {k: open(v, "rb").read() for k, v in FILES.items()}
for k, v in FILES.items(): open(SP + "\\unb_" + k + ".bak", "wb").write(originals[k])
def sha(b): return hashlib.sha256(b).hexdigest()[:12]

M = [
 # --- backend.ts: unblockVideoBilling
 ("strict-keys-dropped", "B", "||Object.keys(request).sort().join(',')!=='createdAtMs,epoch,incidentId,reviewRef')bad();", "||false)bad();"),
 ("replay-ignores-reviewRef", "B", "&&unblock.get('reviewRef')===reviewRef)return {unblocked:true as const,replayed:true as const,blocked:guard.exists};", ")return {unblocked:true as const,replayed:true as const,blocked:guard.exists};"),
 ("replay-ignores-epoch", "B", "&&unblock.get('epoch')===epoch&&unblock.get('createdAtMs')===createdAtMs&&", "&&unblock.get('createdAtMs')===createdAtMs&&"),
 ("replay-ignores-createdAt", "B", "&&unblock.get('createdAtMs')===createdAtMs&&unblock.get('reviewRef')===reviewRef)return", "&&unblock.get('reviewRef')===reviewRef)return"),
 ("replay-conflict-becomes-replay", "B", "    throw new AccountFault('conflict');\n   }\n   const blocked=billingHold(guard,accountId,identityKey);", "    return {unblocked:true as const,replayed:true as const,blocked:guard.exists};\n   }\n   const blocked=billingHold(guard,accountId,identityKey);"),
 ("guard-epoch-ignored", "B", "||guard.get('epoch')!==epoch||guard.get('createdAtMs')!==createdAtMs)throw new AccountFault('conflict');", "||guard.get('createdAtMs')!==createdAtMs)throw new AccountFault('conflict');"),
 ("guard-createdAt-ignored", "B", "||guard.get('epoch')!==epoch||guard.get('createdAtMs')!==createdAtMs)throw new AccountFault('conflict');", "||guard.get('epoch')!==epoch)throw new AccountFault('conflict');"),
 ("not-blocked-allowed", "B", "if(!blocked||guard.get('epoch')!==epoch", "if(guard.get('epoch')!==epoch"),
 ("record-missing-allowed", "B", "   if(!record.exists)throw new AccountFault('conflict');\n   if(record.get('ownerAccountId')!==accountId||record.get('identityKey')!==identityKey||record.get('incidentId')!==incident||!integer(record.get('createdAtMs')))invariant();\n   if(record.get('state')!=='active')throw new AccountFault('conflict');", "   if(record.exists&&record.get('state')!=='active')throw new AccountFault('conflict');"),
 ("incident-state-not-checked", "B", "   if(record.get('state')!=='active')throw new AccountFault('conflict');\n   // `incidentCount`", "   // `incidentCount`"),
 ("incident-state-conflict-to-replay", "B", "   if(record.get('state')!=='active')throw new AccountFault('conflict');\n   // `incidentCount`", "   if(record.get('state')!=='active')return {unblocked:true as const,replayed:true as const,blocked:guard.exists};\n   // `incidentCount`"),
 ("counter-always-deletes", "B", "if(nextReviewed===incidentCount)tx.delete(guardRef);else tx.update(guardRef,{reviewedCount:nextReviewed});", "tx.delete(guardRef);"),
 ("counter-never-deletes", "B", "if(nextReviewed===incidentCount)tx.delete(guardRef);else tx.update(guardRef,{reviewedCount:nextReviewed});", "tx.update(guardRef,{reviewedCount:nextReviewed});"),
 ("counter-not-incremented", "B", "else tx.update(guardRef,{reviewedCount:nextReviewed});", "else tx.update(guardRef,{reviewedCount:reviewed});"),
 ("incident-not-marked", "B", "   tx.update(recordRef,{state:'reviewed',reviewedAtMs:time});\n", "   tx.update(recordRef,{reviewedAtMs:time});\n"),
 ("unblock-record-not-created", "B", "   tx.create(unblockRef,{ownerAccountId:accountId,identityKey,incidentId:incident,epoch,createdAtMs,reviewRef,unblockedAtMs:time});\n", ""),
 ("unblock-record-no-reviewRef", "B", "incidentId:incident,epoch,createdAtMs,reviewRef,unblockedAtMs:time});", "incidentId:incident,epoch,createdAtMs,unblockedAtMs:time});"),
 ("unblock-record-uses-wrong-time", "B", "reviewRef,unblockedAtMs:time});", "reviewRef,unblockedAtMs:0});"),
 ("reviewRef-no-length-limit", "B", "/^[^\\u0000-\\u001f\\u007f]{1,200}$/.test(value)", "/^[^\\u0000-\\u001f\\u007f]{1,}$/.test(value)"),
 ("reviewRef-allows-control", "B", "/^[^\\u0000-\\u001f\\u007f]{1,200}$/.test(value)", "/^[^\\u0000-\\u001e\\u007f]{1,200}$/.test(value)"),
 ("reviewRef-allows-del", "B", "/^[^\\u0000-\\u001f\\u007f]{1,200}$/.test(value)", "/^[^\\u0000-\\u001f]{1,200}$/.test(value)"),
 ("epoch-min-zero", "B", "if(!integer(epoch,1)||!integer(createdAtMs)||!reviewRefValid(reviewRef))bad();", "if(!integer(epoch,0)||!integer(createdAtMs)||!reviewRefValid(reviewRef))bad();"),
 ("identity-missing-not-fault", "B", "   const identity=await tx.get(identityRef);if(!identity.exists)throw new AccountFault('account_not_provisioned');\n   if(typeof identity.get('uid')!=='string'||uidKey(identity.get('uid'))!==identityKey)invariant();\n   const accountId=identity.get('accountId');if(typeof accountId!=='string'||!uuid.test(accountId))invariant();\n   const accountRef=", "   const identity=await tx.get(identityRef);\n   const accountId=identity.get('accountId');\n   const accountRef="),
 # --- backend.ts: videoBillingHold (status read)
 ("hold-reviewed-reports-recorded", "B", "return {blocked,recorded:false};}\n   invariant();", "return {blocked,recorded:true};}\n   invariant();"),
 ("hold-active-unblocked-allowed", "B", "if(state==='active'){if(!blocked)invariant();return {blocked,recorded:true};}", "if(state==='active'){return {blocked,recorded:true};}"),
 ("hold-unknown-state-allowed", "B", "return {blocked,recorded:false};}\n   invariant();", "return {blocked,recorded:false};}\n   return {blocked,recorded:false};"),
 ("hold-reviewedAt-not-validated", "B", "if(!integer(record.get('reviewedAtMs')))invariant();", ""),
 ("hold-reviewedAt-optional", "B", "if(!integer(record.get('reviewedAtMs')))invariant();", "if(record.get('reviewedAtMs')!==undefined&&!integer(record.get('reviewedAtMs')))invariant();"),
 ("receipt-blocked-false-on-apply", "B", "blocked:nextReviewed!==incidentCount};", "blocked:false};"),
 ("receipt-blocked-true-on-apply", "B", "blocked:nextReviewed!==incidentCount};", "blocked:true};"),
 ("receipt-blocked-false-on-replay", "B", "replayed:true as const,blocked:guard.exists};\n    throw", "replayed:true as const,blocked:false};\n    throw"),
 ("receipt-blocked-true-on-replay", "B", "replayed:true as const,blocked:guard.exists};\n    throw", "replayed:true as const,blocked:true};\n    throw"),
 ("client-blocked-not-validated", "C", "||typeof row.replayed!=='boolean'||typeof row.blocked!=='boolean')throw", "||typeof row.replayed!=='boolean')throw"),
 ("client-blocked-hardcoded", "C", "replayed:row.replayed,blocked:row.blocked};", "replayed:row.replayed,blocked:false};"),
 # --- http.ts
 ("http-unblock-any-internal-caller", "H", "if(!url.pathname.endsWith('/status')&&caller.email!==internal.settlementCaller)throw new HttpFault(403,'forbidden');", "if(url.pathname==='/api/internal/video/billing-holds'&&caller.email!==internal.settlementCaller)throw new HttpFault(403,'forbidden');"),
 ("http-unblock-open-to-all", "H", "if(!url.pathname.endsWith('/status')&&caller.email!==internal.settlementCaller)throw new HttpFault(403,'forbidden');", ""),
 ("http-unblock-body-loose", "H", "const b=await json(req,['identityKey','incidentId','epoch','createdAtMs','reviewRef']);", "const b=await json(req,['identityKey','incidentId','epoch','createdAtMs','reviewRef','extra']);"),
 ("http-reviewRef-allows-us", "H", "!/^[^\\u0000-\\u001f\\u007f]{1,200}$/.test(b.reviewRef))throw", "!/^[^\\u0000-\\u001e\\u007f]{1,200}$/.test(b.reviewRef))throw"),
 ("http-reviewRef-allows-del", "H", "!/^[^\\u0000-\\u001f\\u007f]{1,200}$/.test(b.reviewRef))throw", "!/^[^\\u0000-\\u001f]{1,200}$/.test(b.reviewRef))throw"),
 ("client-reviewRef-allows-us", "C", "typeof reviewRef!=='string'||!/^[^\\u0000-\\u001f\\u007f]{1,200}$/.test(reviewRef))throw new AccountBillingFault('invalid');\n  const value", "typeof reviewRef!=='string'||!/^[^\\u0000-\\u001e\\u007f]{1,200}$/.test(reviewRef))throw new AccountBillingFault('invalid');\n  const value"),
 ("client-reviewRef-allows-del", "C", "typeof reviewRef!=='string'||!/^[^\\u0000-\\u001f\\u007f]{1,200}$/.test(reviewRef))throw new AccountBillingFault('invalid');\n  const value", "typeof reviewRef!=='string'||!/^[^\\u0000-\\u001f]{1,200}$/.test(reviewRef))throw new AccountBillingFault('invalid');\n  const value"),
 ("http-epoch-min-zero", "H", "||(b.epoch as number)<1||", "||(b.epoch as number)<0||"),
 ("http-createdAt-negative", "H", "||(b.createdAtMs as number)<0||", "||(b.createdAtMs as number)<-5||"),
 ("http-reviewRef-no-limit", "H", "typeof b.reviewRef!=='string'||!/^[^\\u0000-\\u001f\\u007f]{1,200}$/.test(b.reviewRef))", "typeof b.reviewRef!=='string'||!/^[^\\u0000-\\u001f\\u007f]{1,}$/.test(b.reviewRef))"),
 ("http-reviewRef-no-type", "H", "typeof b.reviewRef!=='string'||!/^[^\\u0000-\\u001f\\u007f]{1,200}$/.test(b.reviewRef))", "!/^[^\\u0000-\\u001f\\u007f]{1,200}$/.test(String(b.reviewRef)))"),
 ("http-identityKey-unchecked", "H", "if(typeof b.identityKey!=='string'||!/^[a-f0-9]{64}(?![\\s\\S])/.test(b.identityKey)||typeof b.incidentId!=='string'||!(uuid.test(b.incidentId)||/^[a-f0-9]{64}(?![\\s\\S])/.test(b.incidentId))||!Number.isSafeInteger(b.epoch)", "if(typeof b.incidentId!=='string'||!(uuid.test(b.incidentId)||/^[a-f0-9]{64}(?![\\s\\S])/.test(b.incidentId))||!Number.isSafeInteger(b.epoch)"),
 ("http-epoch-not-safe-integer", "H", "||!Number.isSafeInteger(b.epoch)||", "||typeof b.epoch!=='number'||"),
 ("http-result-not-sent", "H", "send(200,result);return;\n     }\n     const b=await json(req,['identityKey','incidentId']);", "send(200,{unblocked:true,replayed:false});return;\n     }\n     const b=await json(req,['identityKey','incidentId']);"),
 # --- client
 ("client-unblocked-not-checked", "C", "if(row.unblocked!==true||typeof row.replayed!=='boolean'||typeof row.blocked!=='boolean')", "if(typeof row.replayed!=='boolean'||typeof row.blocked!=='boolean')"),
 ("client-replayed-not-checked", "C", "if(row.unblocked!==true||typeof row.replayed!=='boolean'||typeof row.blocked!=='boolean')", "if(row.unblocked!==true||typeof row.blocked!=='boolean')"),
 ("client-receipt-hardcoded", "C", "return {unblocked:true as const,replayed:row.replayed,blocked:row.blocked};", "return {unblocked:true as const,replayed:false,blocked:row.blocked};"),
 ("client-epoch-min-zero", "C", "!Number.isSafeInteger(epoch)||epoch<1||!Number.isSafeInteger(createdAtMs)", "!Number.isSafeInteger(epoch)||epoch<0||!Number.isSafeInteger(createdAtMs)"),
 ("client-reviewRef-no-limit", "C", "typeof reviewRef!=='string'||!/^[^\\u0000-\\u001f\\u007f]{1,200}$/.test(reviewRef))throw new AccountBillingFault('invalid');\n  const value=await this.post('/api/internal/video/billing-holds/unblock'", "typeof reviewRef!=='string'||!/^[^\\u0000-\\u001f\\u007f]{1,}$/.test(reviewRef))throw new AccountBillingFault('invalid');\n  const value=await this.post('/api/internal/video/billing-holds/unblock'"),
 ("client-wrong-path", "C", "'/api/internal/video/billing-holds/unblock',{identityKey,incidentId,epoch,createdAtMs,reviewRef}", "'/api/internal/video/billing-holds',{identityKey,incidentId,epoch,createdAtMs,reviewRef}"),
 ("client-body-drops-reviewRef", "C", "{identityKey,incidentId,epoch,createdAtMs,reviewRef});\n  if(!value", "{identityKey,incidentId,epoch,createdAtMs});\n  if(!value"),
]
env = {k: v for k, v in os.environ.items() if k not in ("NODE_OPTIONS", "GOOGLE_APPLICATION_CREDENTIALS", "OPENROUTER_API_KEY", "GEMINI_API_KEY", "K_SERVICE")}
env.update({"NODE_ENV": "test", "FIRESTORE_EMULATOR_HOST": "127.0.0.1:8185", "GOOGLE_CLOUD_PROJECT": "demo-vistavo-ledger", "GCLOUD_PROJECT": "demo-vistavo-ledger"})
UNIT = "npx vitest run --maxWorkers=3 server/account server/commercial/accountBillingClient.test.ts"
EMU = "node --no-network-family-autoselection --import tsx --test server/account/unblockAudited.emulator.mjs server/account/backend.emulator.mjs"

def restore():
    for _ in range(5):
        try:
            for k, v in FILES.items(): open(v, "wb").write(originals[k])
            if all(open(v, "rb").read() == originals[k] for k, v in FILES.items()): return True
        except OSError: time.sleep(1)
    return False

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
            results.append((name, "SKIPPED (count %d)" % src.count(o))); continue
        open(FILES[which], "wb").write(src.replace(o, n, 1).encode("utf-8"))
        killed_by = None
        p = subprocess.run(UNIT, shell=True, cwd=REPO, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=600)
        if p.returncode != 0: killed_by = "vitest"
        else:
            p = subprocess.run(EMU, shell=True, cwd=REPO, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=600)
            if p.returncode != 0: killed_by = "emulator"
        results.append((name, ("KILLED by " + killed_by) if killed_by else "SURVIVED"))
        if not killed_by: survivors.append(name)
        if not restore(): print("RESTORE FAILED", name); sys.exit(2)
finally:
    ok = restore()
    print("final restore verified:", ok, {k: sha(open(v, "rb").read()) == sha(originals[k]) for k, v in FILES.items()})
for r in results: print("%-36s %s" % r)
print("survivors:", survivors)
