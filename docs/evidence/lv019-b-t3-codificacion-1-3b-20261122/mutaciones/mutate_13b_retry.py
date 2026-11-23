import hashlib, os, subprocess, sys, time
REPO = r"C:\Users\rob62\.t3\worktrees\vamos-a-continuar-linguistvision-en-esta-2\lv019b-t3-a3-ack"
W = "server/commercial/reserveAttemptWindow.ts"
B = "server/commercial/firestoreBackend.ts"
E = "server/commercial/reserveAttemptEvidence.ts"
M = [
 ('intent-null-row-accepted', W, "if(!row)return true;", ""),
 ('account-simulation-ignored', W, "if(account.simulationOnly!==true)return true;", ""),
 # Guard removed as unreachable: the preflight already rejects a missing account.
 ('ack-tuple-not-validated', E, "  const attempt = copyAttemptV1(value); copyAck(observed, attempt.witness);", "  const attempt = copyAttemptV1(value);"),
 ('ack-conflict-overwritten', E, "    if (!equalObservation(data(ack), attempt)) return conflict();", "    if (false) return conflict();"),
 ('ack-not-created', E, "  tx.create(target.ack, observation(attempt));\n  return Object.freeze({state:'recorded', attribution:'unverified'});\n}", "  void observation(attempt);\n  return Object.freeze({state:'recorded', attribution:'unverified'});\n}"),
]
env = {k: v for k, v in os.environ.items() if k not in ('NODE_OPTIONS','GOOGLE_APPLICATION_CREDENTIALS','OPENROUTER_API_KEY','GEMINI_API_KEY','K_SERVICE')}
env.update({'NODE_ENV':'test','FIRESTORE_EMULATOR_HOST':'127.0.0.1:8185','GOOGLE_CLOUD_PROJECT':'demo-vistavo-ledger','GCLOUD_PROJECT':'demo-vistavo-ledger'})
NODE = r"C:\Users\rob62\AppData\Local\LinguistVision\tools\node-v24.13.0-win-x64\node.exe"
def run(cmd, timeout):
    return subprocess.run(cmd, shell=True, cwd=REPO, env=env, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=timeout)
files = {}
for rel in (W,B,E):
    p = os.path.join(REPO, rel.replace('/', os.sep)); raw = open(p,'rb').read()
    files[rel] = (p, raw, hashlib.sha256(raw).hexdigest(), raw.decode('utf-8').replace('\r\n','\n'))
def restore():
    ok = True
    for rel,(p,raw,digest,_) in files.items():
        for _ in range(5):
            try:
                open(p,'wb').write(raw)
                if open(p,'rb').read() == raw: break
            except OSError: time.sleep(1)
        else: ok = False
        if hashlib.sha256(open(p,'rb').read()).hexdigest() != digest: ok = False
    return ok
def mutate_last(text, old, new):
    index = text.rfind(old)
    return text[:index] + new + text[index+len(old):]
unit_cmd = 'npx vitest run server/commercial/reserveAttemptWindow.test.ts server/commercial/reserveAttemptEvidence.test.ts'
emu_cmd = f'"{NODE}" --no-network-family-autoselection --import tsx --test server/commercial/textAccountReserveAckWindow.emulator.mjs'
rows = []
try:
    for name, rel, old, new in M:
        p, raw, digest, orig = files[rel]
        if orig.count(old) < 1:
            rows.append((name,'SKIPPED(count 0)','-','-')); print(rows[-1], flush=True); continue
        # The ACK conflict guard exists in both recordReserveAckInTransaction and
        # stageReserveAck; the job path uses the last one, so mutate that.
        mutated = mutate_last(orig, old, new) if name in ('ack-tuple-not-validated','ack-conflict-overwritten','ack-not-created') else orig.replace(old, new, 1)
        if b'\r\n' in raw: mutated = mutated.replace('\n','\r\n')
        open(p,'wb').write(mutated.encode('utf-8'))
        unit = run(unit_cmd, 240); unit_killed = unit.returncode != 0
        emu_killed = False
        if not unit_killed:
            emu = run(emu_cmd, 600); emu_killed = emu.returncode != 0
        rows.append((name, 'KILLED' if (unit_killed or emu_killed) else 'survived', 'KILLED' if unit_killed else 'survived', '-' if unit_killed else ('KILLED' if emu_killed else 'survived')))
        print('%-34s %s / %s' % (name, rows[-1][2], rows[-1][3]), flush=True)
        if not restore(): print('RESTORE FAILED'); sys.exit(2)
finally:
    print('final restore verified:', restore())
print('---RESULTS---')
for row in rows: print('\t'.join(row))
print('survivors:', [r[0] for r in rows if r[1].startswith('survived') or r[1].startswith('SKIPPED')])
