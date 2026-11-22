import os, shutil, subprocess, sys, time
REPO = r"C:\Users\rob62\Documents\Codex\2026-11-11\vamos-a-continuar-linguistvision-en-esta-2"
SP = r"C:\Users\rob62\AppData\Local\Temp\claude\14302df9167c2660\5fb73f1c-c60d-4ae0-aa77-93d696a98422\scratchpad"
FB="server/commercial/firestoreBackend.ts"; FA="server/commercial/firestoreAi.ts"; SE="server/commercial/billingDrainSection.ts"
M = [
 ("age-boundary-strict", FB, "if(clock-createdAtMs<=limitAge)return 'skipped' as const;", "if(clock-createdAtMs<limitAge)return 'skipped' as const;"),
 ("age-state-reread-removed", FB, "if(typeof state!=='string'||!nonTerminal.includes(state))return 'skipped' as const;", "if(typeof state!=='string')return 'skipped' as const;"),
 ("age-future-accepted", FB, "||createdAtMs<0||createdAtMs>clock)return 'failed' as const;", "||createdAtMs<0)return 'failed' as const;"),
 ("age-reason-missing", FB, "reviewReason:'max_age',", ""),
 ("age-terminal-included", FB, "{collection:'billingOutbox',states:['pending','retry_wait']}", "{collection:'billingOutbox',states:['pending','retry_wait','settled']}"),
 ("age-cursor-always-null", FB, "next:(selected.length>=limit?selected[selected.length-1]?.id??null:null) as string|null", "next:null as string|null"),
 ("age-stop-ignored", FB, "if(!proceed){report.stopped=true;report.next=lastAttended??after;break;}", "if(!proceed){report.stopped=true;}"),
 ("age-tie-inclusion-removed", FB, "for(const candidate of candidates.slice(limit))if(candidate.id===cutId)selected.push(candidate);", ""),
 ("stall-limit-off-by-one", FB, "if(attempts>=EXTERNAL_BILLING_ATTEMPT_LIMIT){tx.update(ref,{state:'needs_review',attempts,lastErrorCode:code", "if(attempts>EXTERNAL_BILLING_ATTEMPT_LIMIT){tx.update(ref,{state:'needs_review',attempts,lastErrorCode:code"),
 ("stall-lease-ignored", FB, "['reserve_pending','release_pending'].includes(row.state)||hasIntentLease(d.data()!)||!validUnleasedBillingMetadata", "['reserve_pending','release_pending'].includes(row.state)||!validUnleasedBillingMetadata"),
 ("stall-state-ignored", FB, "row.requestKey!==requestKey||!['reserve_pending','release_pending'].includes(row.state)||hasIntentLease", "row.requestKey!==requestKey||hasIntentLease"),
 ("stall-no-wait", FB, "nextAttemptAt:now+billingAttemptDelay(attempts),lastAttemptAtMs:now,updatedAtMs:now});return true;", "nextAttemptAt:now,lastAttemptAtMs:now,updatedAtMs:now});return true;"),
 ("section-age-gate-missing", SE, "after,shouldContinue:gate('age')}", "after}"),
 ("section-age-runs-when-lost", SE, "if(!leaseLost&&typeof backend.escalateStaleBillingRows==='function')try{", "if(typeof backend.escalateStaleBillingRows==='function')try{"),
 ("section-age-not-counted", SE, "counts.staleEscalated+=count(record.escalated);", ""),
 ("section-age-cursor-not-saved", SE, "lease.setCursor({db,root,kind:'age',holderId,token,cursor:next,now:clock()})", "Promise.resolve(true)"),
 ("route-snapshot-no-stall", FA, "if(typeof row.snapshotVersion!=='string'){intentsFailed++;await this.backend.recordExternalBillingIntentStall(row.accountId,row.requestKey,'unavailable').catch(()=>undefined);continue;}", "if(typeof row.snapshotVersion!=='string'){intentsFailed++;continue;}"),
 ("route-evidence-no-stall", FA, "if(!failureEvidence){intentsFailed++;await this.backend.recordExternalBillingIntentStall(row.accountId,row.requestKey,'unavailable').catch(()=>undefined);continue;}", "if(!failureEvidence){intentsFailed++;continue;}"),
 ("route-status-no-stall", FA, "if(!statusSnapshot){intentsFailed++;await this.backend.recordExternalBillingIntentStall(row.accountId,row.requestKey,'unavailable').catch(()=>undefined);continue;}", "if(!statusSnapshot){intentsFailed++;continue;}"),
]
env = {k: v for k, v in os.environ.items() if k not in ("NODE_OPTIONS", "GOOGLE_APPLICATION_CREDENTIALS", "OPENROUTER_API_KEY", "GEMINI_API_KEY", "K_SERVICE")}
env.update({"NODE_ENV": "test", "FIRESTORE_EMULATOR_HOST": "127.0.0.1:8185", "GOOGLE_CLOUD_PROJECT": "demo-vistavo-ledger", "GCLOUD_PROJECT": "demo-vistavo-ledger"})
UNIT = "npx vitest run server/commercial/firestoreAgeEscalation.test.ts server/commercial/billingDrainSection.test.ts server/commercial/billingDrainLease.test.ts"
NODE = "node --no-network-family-autoselection --import tsx --test "
EMUS = [NODE + "server/commercial/firestoreAgeEscalation.emulator.mjs", NODE + "server/commercial/billingDrainSection.emulator.mjs"]
def run(cmd, timeout): return subprocess.run(cmd, shell=True, cwd=REPO, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)
files = {}
for rel in (FB, FA, SE):
    p = os.path.join(REPO, rel.replace("/", os.sep)); raw = open(p, "rb").read()
    files[rel] = (p, raw, raw.decode("utf-8").replace("\r\n", "\n")); shutil.copyfile(p, os.path.join(SP, os.path.basename(rel) + ".16cbak"))
def restore():
    ok = True
    for rel, (p, raw, _) in files.items():
        for _ in range(5):
            try:
                open(p, "wb").write(raw)
                if open(p, "rb").read() == raw: break
            except OSError: time.sleep(1)
        else: ok = False
    return ok
survivors = []
try:
    for name, rel, old, new in M:
        p, raw, orig = files[rel]
        if orig.count(old) != 1: print("%-30s SKIPPED (count %d)" % (name, orig.count(old)), flush=True); continue
        mutated = orig.replace(old, new, 1)
        if b"\r\n" in raw: mutated = mutated.replace("\n", "\r\n")
        open(p, "wb").write(mutated.encode("utf-8"))
        ku = run(UNIT, 300).returncode != 0; ke = False
        if not ku:
            for cmd in EMUS:
                if run(cmd, 600).returncode != 0: ke = True; break
        print("%-30s unit=%s emulator=%s" % (name, "KILLED" if ku else "survived", "-" if ku else ("KILLED" if ke else "survived")), flush=True)
        if not (ku or ke): survivors.append(name)
        if not restore(): print("RESTORE FAILED"); sys.exit(2)
finally:
    print("final restore verified:", restore())
print("survivors:", survivors); print("DONE")
