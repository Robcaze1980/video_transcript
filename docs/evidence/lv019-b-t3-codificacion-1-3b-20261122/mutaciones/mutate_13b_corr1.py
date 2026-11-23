import hashlib, os, subprocess, sys, time
REPO = r"C:\Users\rob62\.t3\worktrees\vamos-a-continuar-linguistvision-en-esta-2\lv019b-t3-a3-ack"
A = "server/commercial/firestoreAi.ts"
OLD = "if(data.identityKey!==attempt.witness.identityKey||data.reservationId!==attempt.witness.reservationId||data.seconds!==attempt.witness.seconds)throw new AiFault('conflict');"
NEW = "if(false)throw new AiFault('conflict');"
env = {k: v for k, v in os.environ.items() if k not in ('NODE_OPTIONS','GOOGLE_APPLICATION_CREDENTIALS','OPENROUTER_API_KEY','GEMINI_API_KEY','K_SERVICE')}
env.update({'NODE_ENV':'test','FIRESTORE_EMULATOR_HOST':'127.0.0.1:8185','GOOGLE_CLOUD_PROJECT':'demo-vistavo-ledger','GCLOUD_PROJECT':'demo-vistavo-ledger'})
NODE = r"C:\Users\rob62\AppData\Local\LinguistVision\tools\node-v24.13.0-win-x64\node.exe"
EMU = f'"{NODE}" --no-network-family-autoselection --import tsx --test server/commercial/textAccountReserveAckWindow.emulator.mjs'
p = os.path.join(REPO, A.replace('/', os.sep))
raw = open(p,'rb').read()
digest = hashlib.sha256(raw).hexdigest()
orig = raw.decode('utf-8').replace('\r\n','\n')
def restore():
    open(p,'wb').write(raw)
    return hashlib.sha256(open(p,'rb').read()).hexdigest() == digest
rows = []
try:
    if orig.count(OLD) != 1:
        print('SKIPPED: expected exactly one occurrence, found', orig.count(OLD), flush=True)
        rows.append(('post-tuple-equality-removed','SKIPPED','-','-'))
    else:
        mutated = orig.replace(OLD, NEW, 1)
        if b'\r\n' in raw: mutated = mutated.replace('\n','\r\n')
        open(p,'wb').write(mutated.encode('utf-8'))
        try:
            run = subprocess.run(EMU, shell=True, cwd=REPO, env=env, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=900)
            verdict = 'KILLED' if run.returncode != 0 else 'survived'
            rows.append(('post-tuple-equality-removed', verdict, '-', verdict))
            print('%-34s %s' % ('post-tuple-equality-removed', verdict), flush=True)
            print('--- mutation output tail ---', flush=True)
            print((((run.stdout or '') + (run.stderr or ''))[-3000:]).encode('ascii','replace').decode('ascii'), flush=True)
        except subprocess.TimeoutExpired:
            rows.append(('post-tuple-equality-removed','KILLED(timeout)','-','-'))
finally:
    print('final restore verified:', restore(), flush=True)
print('---RESULTS---')
for row in rows: print('\t'.join(row))
print('survivors:', [r[0] for r in rows if r[1].startswith('survived') or r[1].startswith('SKIPPED')])
print('DONE')