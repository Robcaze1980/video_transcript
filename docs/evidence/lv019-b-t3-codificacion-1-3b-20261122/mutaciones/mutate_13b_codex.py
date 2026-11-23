import os, shutil, subprocess, sys, time
REPO = r"C:\Users\rob62\Documents\Codex\2026-11-11\vamos-a-continuar-linguistvision-en-esta-2"
SP = r"C:\Users\rob62\AppData\Local\Temp\claude\14302df9167c2660\5fb73f1c-c60d-4ae0-aa77-93d696a98422\scratchpad"
FB="server/commercial/firestoreBackend.ts"; FA="server/commercial/firestoreAi.ts"; RW="server/commercial/reserveAttemptWindow.ts"; SE=RW
M = [
 ('post-tuple-equality-removed', FA, "if(data.identityKey!==attempt.witness.identityKey||data.reservationId!==attempt.witness.reservationId||data.seconds!==attempt.witness.seconds)throw new AiFault('conflict');", ''),
 ('ack-not-preserved-on-failure', FA, 'await this.backend.recordExternalReserveAck(attempt,ack).catch(()=>undefined);', ''),
 ('job-without-ack-argument', FA, 'AI_CATALOG_VERSION,data,undefined,uid!,attempt,ack);', 'AI_CATALOG_VERSION,data,undefined,uid!);'),
 ('window-check-removed', FB, "if(reserveAttemptWindowChanged(attempt,windowDocs,accountId))throw new LedgerFault('conflict');", ''),
 ('stage-ack-removed', FB, "try{stageReserveAck(tx,this.root,attempt,reserveAck,ackPrepared,ackObserved);}catch(error){if(error instanceof ReserveAttemptEvidenceFault)throw new LedgerFault('invariant');throw error;}", ''),
 ('prepare-identity-account-unchecked', FB, "docs.identity.get('accountId')!==accountId||typeof uid!=='string'", "typeof uid!=='string'"),
 ('prepare-blocked-guard-unchecked', FB, 'if(this.billingBlocked(docs.guard,accountId)||!validClearIntentAdmissionGuard(docs.intentGuard,key)||', 'if(!validClearIntentAdmissionGuard(docs.intentGuard,key)||'),
 ('prepare-request-marker-unchecked', FB, 'docs.request.exists||docs.jobMarker.exists||docs.sealWitness.exists', 'docs.sealWitness.exists'),
 ('prepare-terminal-rows-unchecked', FB, 'docs.sealWitness.exists||docs.sealRecovery.exists||docs.releaseWitness.exists||docs.releaseRecovery.exists||', ''),
 ('prepare-reservation-id-unchecked', FB, '||stored.reservationId!==expectedReservationId', ''),
 ('win-state-unchecked', RW, "if(row.state!=='reserve_pending')return true;", ''),
 ('win-jobid-unchecked', RW, 'if(row.jobId!==undefined)return true;', ''),
 ('win-simulationonly-unchecked', RW, 'if(account.simulationOnly!==true)return true;', ''),
 ('win-aipilot-unchecked', RW, 'if(account.aiPilot!==true)return true;', ''),
 ('win-guard-blocked-unchecked', RW, "||guard.get('blocked')!==false))return true;", '))return true;'),
 ('win-seconds-unchecked', RW, 'if(row.seconds!==attempt.witness.seconds)return true;', ''),
 ('win-revision-unchecked', RW, 'if(row.revision!==attempt.witness.revision)return true;', ''),
 ('win-version-time-unchecked', RW, 'if(expected.exists&&actual.exists&&(expected.createTime!==actual.createTime||expected.updateTime!==actual.updateTime))return true;', ''),
 ('win-immutable-identity-dropped', RW, "'identity',", ''),
 ('win-immutable-input-dropped', RW, "'input',", ''),
 ('win-immutable-project-dropped', RW, "'project',", ''),
 ('win-immutable-origin-dropped', RW, "'origin',", ''),
 ('win-immutable-intentGuard-dropped', RW, "'intentGuard',", ''),
 ('win-immutable-request-dropped', RW, "'request',", ''),
 ('win-immutable-jobMarker-dropped', RW, "'jobMarker',", ''),
 ('win-immutable-sealWitness-dropped', RW, "'sealWitness',", ''),
 ('win-immutable-sealRecovery-dropped', RW, "'sealRecovery',", ''),
 ('win-immutable-releaseWitness-dropped', RW, "'releaseWitness',", ''),
 ('win-immutable-releaseRecovery-dropped', RW, "'releaseRecovery',", ''),
]
env = {k: v for k, v in os.environ.items() if k not in ("NODE_OPTIONS", "GOOGLE_APPLICATION_CREDENTIALS", "OPENROUTER_API_KEY", "GEMINI_API_KEY", "K_SERVICE")}
env.update({"NODE_ENV": "test", "FIRESTORE_EMULATOR_HOST": "127.0.0.1:8185", "GOOGLE_CLOUD_PROJECT": "demo-vistavo-ledger", "GCLOUD_PROJECT": "demo-vistavo-ledger"})
UNIT = "npx vitest run server/commercial/reserveAttemptWindow.test.ts server/commercial/reserveAttemptEvidence.test.ts server/commercial/reserveAttemptProfileSentinel.test.ts"
NODE = "node --no-network-family-autoselection --import tsx --test "
EMUS = [NODE + "server/commercial/textAccountReserveAckWindow.emulator.mjs", "bash C:/Users/rob62/AppData/Local/Temp/claude/14302df9167c2660/5fb73f1c-c60d-4ae0-aa77-93d696a98422/scratchpad/ref_launcher.sh"]
def run(cmd, timeout): return subprocess.run(cmd, shell=True, cwd=REPO, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)
files = {}
for rel in (FB, FA, RW):
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
