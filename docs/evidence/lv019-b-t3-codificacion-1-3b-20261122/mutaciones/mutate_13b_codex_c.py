import os, shutil, subprocess, sys, time
REPO = r"C:\Users\rob62\Documents\Codex\2026-11-11\vamos-a-continuar-linguistvision-en-esta-2"
SP = r"C:\Users\rob62\AppData\Local\Temp\claude\14302df9167c2660\5fb73f1c-c60d-4ae0-aa77-93d696a98422\scratchpad"
FB="server/commercial/firestoreBackend.ts"; FA="server/commercial/firestoreAi.ts"; RW="server/commercial/reserveAttemptWindow.ts"; SE=RW
M = [
 ('prepare-terminal-rows-unchecked', FB, 'docs.sealWitness.exists||docs.sealRecovery.exists||docs.releaseWitness.exists||docs.releaseRecovery.exists||', ''),
]
env = {k: v for k, v in os.environ.items() if k not in ("NODE_OPTIONS", "GOOGLE_APPLICATION_CREDENTIALS", "OPENROUTER_API_KEY", "GEMINI_API_KEY", "K_SERVICE")}
env.update({"NODE_ENV": "test", "FIRESTORE_EMULATOR_HOST": "127.0.0.1:8185", "GOOGLE_CLOUD_PROJECT": "demo-vistavo-ledger", "GCLOUD_PROJECT": "demo-vistavo-ledger"})
UNIT = "npx vitest run server/commercial/reserveAttemptWindow.test.ts server/commercial/reserveAttemptEvidence.test.ts server/commercial/reserveAttemptProfileSentinel.test.ts"
NODE = "node --no-network-family-autoselection --import tsx --test "
EMUS = [NODE + "server/commercial/textAccountReserveAckWindow.emulator.mjs"]
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
