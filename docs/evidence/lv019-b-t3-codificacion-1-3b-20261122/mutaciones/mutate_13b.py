import hashlib, os, subprocess, sys, time
REPO = r"C:\Users\rob62\.t3\worktrees\vamos-a-continuar-linguistvision-en-esta-2\lv019b-t3-a3-ack"
W = "server/commercial/reserveAttemptWindow.ts"
B = "server/commercial/firestoreBackend.ts"
E = "server/commercial/reserveAttemptEvidence.ts"
LOOP = "    const expected=attempt.versions[name],actual=documentVersion(docs[name]);"
def drop(name):
    return f"    if(name==='{name}')continue;const expected=attempt.versions[name],actual=documentVersion(docs[name]);"
M = [(f'doc-{name}', W, LOOP, drop(name)) for name in
     ('identity','input','project','origin','intentGuard','request','jobMarker','sealWitness','sealRecovery','releaseWitness','releaseRecovery')]
M += [
 ('version-updateTime-ignored', W, "expected.updateTime!==actual.updateTime", "false"),
 ('version-createTime-ignored', W, "expected.createTime!==actual.createTime||", ""),
 ('version-existence-ignored', W, "expected.exists!==actual.exists", "false"),
 ('intent-state-ignored', W, "if(row.state!=='reserve_pending')return true;", ""),
 ('intent-input-ignored', W, "if(row.inputId!==attempt.witness.inputId)return true;", ""),
 ('intent-operation-ignored', W, "if(row.operation!==attempt.witness.operation)return true;", ""),
 ('intent-revision-ignored', W, "if(row.revision!==attempt.witness.revision)return true;", ""),
 ('intent-seconds-ignored', W, "if(row.seconds!==attempt.witness.seconds)return true;", ""),
 ('intent-jobId-ignored', W, "if(row.jobId!==undefined)return true;", ""),
 ('intent-null-row-accepted', W, "if(!row)return true;", ""),
 ('account-pilot-ignored', W, "if(account.aiPilot!==true)return true;", ""),
 ('account-simulation-ignored', W, "if(account.simulationOnly!==true)return true;", ""),
 ('guard-any-state-accepted', W, "if(guard.exists&&(guard.get('accountId')!==accountId||guard.get('blocked')!==false))return true;", ""),
 ('guard-account-binding-ignored', W, "guard.get('accountId')!==accountId||", ""),
 ('guard-blocked-ignored', W, "||guard.get('blocked')!==false", ""),
 ('terminal-half-pair-accepted', W, "if(sealWitness.exists!==sealRecovery.exists)return null;", ""),
 ('ack-stage-removed', B, "try{stageReserveAck(tx,this.root,attempt,reserveAck,ackPrepared,ackObserved);}", "try{void stageReserveAck;}"),
 ('window-check-removed', B, "if(reserveAttemptWindowChanged(attempt,windowDocs,accountId))throw new LedgerFault('conflict');", ""),
 # Moved to mutate_13b_retry.py so each ACK guard is mutated exactly once.
 # ('ack-conflict-overwritten', E, "    if (!equalObservation(data(ack), attempt)) return conflict();", "    if (false) return conflict();"),
 # ('ack-not-created', E, "  tx.create(target.ack, observation(attempt));\n  return Object.freeze({state:'recorded', attribution:'unverified'});\n}", "  void observation(attempt);\n  return Object.freeze({state:'recorded', attribution:'unverified'});\n}"),
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
unit_cmd = 'npx vitest run server/commercial/reserveAttemptWindow.test.ts server/commercial/reserveAttemptEvidence.test.ts'
emu_cmd = f'"{NODE}" --no-network-family-autoselection --import tsx --test server/commercial/textAccountReserveAckWindow.emulator.mjs'
rows = []
try:
    for name, rel, old, new in M:
        p, raw, digest, orig = files[rel]
        if orig.count(old) < 1:
            rows.append((name, f'SKIPPED(count {orig.count(old)})', '-', '-')); print(rows[-1], flush=True); continue
        mutated = orig.replace(old, new, 1)
        if b'\r\n' in raw: mutated = mutated.replace('\n','\r\n')
        open(p,'wb').write(mutated.encode('utf-8'))
        try:
            unit = run(unit_cmd, 240)
            unit_killed = unit.returncode != 0
            emu_killed = False
            if not unit_killed:
                emu = run(emu_cmd, 600)
                emu_killed = emu.returncode != 0
            verdict = 'KILLED' if (unit_killed or emu_killed) else 'survived'
            rows.append((name, verdict, 'KILLED' if unit_killed else 'survived', '-' if unit_killed else ('KILLED' if emu_killed else 'survived')))
        except subprocess.TimeoutExpired:
            rows.append((name,'KILLED(timeout)','-','-'))
        print('%-34s %s / %s' % (name, rows[-1][2], rows[-1][3]), flush=True)
        if not restore(): print('RESTORE FAILED'); sys.exit(2)
finally:
    print('final restore verified:', restore())
print('---RESULTS---')
for row in rows: print('\t'.join(row))
survivors = [r[0] for r in rows if r[1].startswith('survived') or r[1].startswith('SKIPPED')]
print('survivors:', survivors); print('DONE')
