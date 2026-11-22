import os, shutil, subprocess, sys, time
REPO = r"C:\Users\rob62\Documents\Codex\2026-11-11\vamos-a-continuar-linguistvision-en-esta-2"
SP = r"C:\Users\rob62\AppData\Local\Temp\claude\14302df9167c2660\5fb73f1c-c60d-4ae0-aa77-93d696a98422\scratchpad"
FB = "server/commercial/firestoreBackend.ts"; AI = "server/commercial/firestoreAi.ts"; PR = "server/commercial/billingPendingReport.ts"
M = [
 ("c3-ack-match-ignored", FB, "if(after?.ackMatches&&after.settlementSnapshot&&current.exists&&['pending','retry_wait'].includes(current.get('state'))", "if(after&&after.settlementSnapshot&&current.exists&&['pending','retry_wait'].includes(current.get('state'))"),
 ("c3-version-unchecked", FB, "&&currentVersion===version&&matchesOutboxSnapshot(current.data(),after.expected)){\n        const reread=", "&&matchesOutboxSnapshot(current.data(),after.expected)){\n        const reread="),
 ("c3-intact-ignored", FB, "        if(intact){", "        if(true){"),
 ("c3-no-attempt-limit", FB, "if(attempts>=EXTERNAL_BILLING_ATTEMPT_LIMIT){tx.update(outbox,{state:'needs_review',attempts,lastErrorCode:'closure_unverified',lastAttemptAtMs:now});return {state:'needs_review',ownerBlocked:false};}\n", "\n"),
 ("c3-attempt-not-counted", FB, "const now=Date.now(),attempts=Number(previous)+1,delay=Math.min(15*60_000,1000*2**Math.min(attempts,10));\n          if(attempts>=", "const now=Date.now(),attempts=Number(previous),delay=Math.min(15*60_000,1000*2**Math.min(attempts,10));\n          if(attempts>="),
 ("already-settled-ack-mismatch-ok", FB, "if(after?.ackMatches&&after.settlementSnapshot&&current.exists&&current.get('state')==='settled'", "if(after?.settlementSnapshot&&current.exists&&current.get('state')==='settled'"),
 ("divergent-ack-throws", FB, "const ackMatches=ack.reservationId===expected.reservationId&&ack.seconds===expected.seconds&&ack.state===(expected.action==='capture'?'captured':'released');", "if(ack.reservationId!==expected.reservationId||ack.seconds!==expected.seconds||ack.state!==(expected.action==='capture'?'captured':'released'))throw new LedgerFault('invalid');const ackMatches=true;"),
 ("e3-same-document-unchecked", FB, "&&identicalClosed&&directClosedMatch&&directIntentSameDocument)return", "&&identicalClosed&&directClosedMatch)return"),
 ("e3-ignore-all-versions", FB, "{ignore:['intent'],allowClosed:true}", "{ignore:directDocumentNames,allowClosed:true}"),
 ("e3-count-with-snapshot", FB, "if(recordReview&&!isRecovery&&!snapshotBound&&owner&&actionProven", "if(recordReview&&!isRecovery&&owner&&actionProven"),
 ("e3-never-reaches-review", FB, "if(attempts<EXTERNAL_BILLING_ATTEMPT_LIMIT){\n          const delay=Math.min(15*60_000,1000*2**Math.min(attempts,10));\n          tx.update(intent,{attempts,lastErrorCode:'closure_unverified'", "if(true){\n          const delay=Math.min(15*60_000,1000*2**Math.min(attempts,10));\n          tx.update(intent,{attempts,lastErrorCode:'closure_unverified'"),
 ("guard-epoch-constant", PR, "return {kind,id,state:'blocked:'+epoch,", "return {kind,id,state:'blocked:1',"),
 ("guard-filter-false", PR, "filter:{field:'blocked',value:true}", "filter:{field:'blocked',value:false}"),
 ("guard-no-incident-ok", PR, "guardAccount===null||!incident}", "guardAccount===null}"),
 ("catch-fallback-removed", AI, "if(job&&typeof job.requestKey==='string')await this.backend.recordExternalBillingReview(", "if(false&&job&&typeof job.requestKey==='string')await this.backend.recordExternalBillingReview("),
]
env = {k: v for k, v in os.environ.items() if k not in ("NODE_OPTIONS", "GOOGLE_APPLICATION_CREDENTIALS", "OPENROUTER_API_KEY", "GEMINI_API_KEY", "K_SERVICE")}
env.update({"NODE_ENV": "test", "FIRESTORE_EMULATOR_HOST": "127.0.0.1:8185", "GOOGLE_CLOUD_PROJECT": "demo-vistavo-ledger", "GCLOUD_PROJECT": "demo-vistavo-ledger"})
UNIT = "npx vitest run server/commercial/firestoreBlocksA.test.ts server/commercial/billingPendingReport.test.ts server/commercial/billingReadOnlyRoot.test.ts server/commercial/billingSweepSection.test.ts"
EMU = "node --no-network-family-autoselection --import tsx --test server/commercial/firestoreBlocksA.emulator.mjs"
def run(cmd, timeout):
    return subprocess.run(cmd, shell=True, cwd=REPO, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)
files = {}
for rel in (FB, AI, PR):
    p = os.path.join(REPO, rel.replace("/", os.sep)); raw = open(p, "rb").read()
    files[rel] = (p, raw, raw.decode("utf-8").replace("\r\n", "\n"))
    shutil.copyfile(p, os.path.join(SP, os.path.basename(rel) + ".14abak2"))
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
DONE_BEFORE={'c3-ack-match-ignored','c3-version-unchecked','c3-intact-ignored','c3-no-attempt-limit','c3-attempt-not-counted','already-settled-ack-mismatch-ok','divergent-ack-throws','e3-same-document-unchecked'}
survivors = []
try:
    for name, rel, old, new in M:
        if name in DONE_BEFORE: continue
        p, raw, orig = files[rel]
        if orig.count(old) != 1:
            print("%-32s SKIPPED (count %d)" % (name, orig.count(old)), flush=True); continue
        mutated = orig.replace(old, new, 1)
        if b"\r\n" in raw: mutated = mutated.replace("\n", "\r\n")
        open(p, "wb").write(mutated.encode("utf-8"))
        pu = run(UNIT, 300); ku = pu.returncode != 0
        ke = False
        if not ku:
            pe = run(EMU, 600); ke = pe.returncode != 0
        print("%-32s unit=%s emulator=%s" % (name, "KILLED" if ku else "survived", "-" if ku else ("KILLED" if ke else "survived")), flush=True)
        if not (ku or ke): survivors.append(name)
        if not restore(): print("RESTORE FAILED"); sys.exit(2)
finally:
    print("final restore verified:", restore())
print("survivors:", survivors)
print("DONE")
