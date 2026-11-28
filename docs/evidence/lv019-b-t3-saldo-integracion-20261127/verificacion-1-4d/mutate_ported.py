import subprocess, hashlib, os, sys, re, json, time
M = r"C:\Users\rob62\Documents\Codex\2026-11-11\vamos-a-continuar-linguistvision-en-esta-2"
SP = r"C:\Users\rob62\AppData\Local\Temp\claude\14302df9167c2660\5fb73f1c-c60d-4ae0-aa77-93d696a98422\scratchpad\saldo"
TS = os.path.join(M, "server", "commercial", "billingUnblock.ts")
BASH = r"C:\Program Files\Git\bin\bash.exe"
orig = open(TS, "rb").read()
orig_hash = hashlib.sha256(orig).hexdigest()
text0 = orig.decode("utf-8")
nl = "\r\n" if "\r\n" in text0 else "\n"
lines0 = text0.split(nl)

def idx(pred, start=0):
    for i in range(start, len(lines0)):
        if pred(lines0[i]):
            return i
    raise SystemExit("anchor not found")

def mutate(fn):
    lines = list(lines0)
    fn(lines)
    return nl.join(lines)

def t1a(lines):
    i = idx(lambda l: "const guardKind=guard.get('lastIncidentId')" in l)
    assert "sameGuard(guard,accountId,clean)||!sameOpenAlert" in lines[i - 1]
    lines[i - 1] = lines[i - 1].replace("!sameGuard(guard,accountId,clean)||!sameOpenAlert(alert,accountId,clean)", "!sameOpenAlert(alert,accountId,clean)")

def t1b(lines):
    i = idx(lambda l: l.startswith("function sameGuard"))
    j = i + 1
    assert "guard.get('blocked')!==true||" in lines[j]
    lines[j] = lines[j].replace("guard.get('blocked')!==true||", "")

def t1c(lines):
    i = idx(lambda l: l.startswith("function sameGuard"))
    j = idx(lambda l: "intent!==outbox" in l, i)
    lines[j] = lines[j].replace("intent!==outbox", "(intent||outbox)")

def t2(lines):
    i = idx(lambda l: "if(authorizedBy!==data.authorizedBy)throw new UnblockFault('conflict');" in l)
    j = i + 1
    assert "sameOpenAlert" in lines[j]
    lines[j] = lines[j].replace("||!sameOpenAlert(alert,accountId,clean)", "")

def t3(lines):
    i = idx(lambda l: "// Same occurrence: the repeat can read Account's receipt" in l)
    j = i - 1
    assert "sameOpenAlert" in lines[j]
    lines[j] = lines[j].replace("||!sameOpenAlert(alert,accountId,clean)", "")

def t4(lines):
    i = idx(lambda l: "const guardKind=guard.get('lastIncidentId')" in l)
    assert "sameOpenAlert" in lines[i - 1]
    lines[i - 1] = lines[i - 1].replace("||!sameOpenAlert(alert,accountId,clean)", "")

def t5a(lines):
    i = idx(lambda l: "if(identity.state!==blockedState(clean.epoch,clean.createdAtMs,clean.incidentKey))throw" in l)
    lines[i] = lines[i].replace("if(identity.state!==blockedState(clean.epoch,clean.createdAtMs,clean.incidentKey))throw", "if(false)throw")

def t5b(lines):
    i = idx(lambda l: "stage:'guard_shape'" in l)
    assert "||guard.get('accountId')!==accountId" in lines[i]
    lines[i] = lines[i].replace("||guard.get('accountId')!==accountId", "")


def t1d(lines):
    i = idx(lambda l: "const guardKind=guard.get('lastIncidentId')" in l)
    lines[i - 1] = lines[i - 1].replace("!sameGuard(guard,accountId,clean)||!sameOpenAlert(alert,accountId,clean)", "!sameOpenAlert(alert,accountId,clean)")
    j = idx(lambda l: "!sameVersion(observed.guard,guard)||!sameRequest" in l, i)
    lines[j] = lines[j].replace("!sameVersion(observed.guard,guard)||", "")
    assert lines[j] != lines0[j]

PAT = {
    "T1": "a guard that stops being blocked, or names",
    "T2": "an alert that is no longer open stops a resume",
    "T3": "an alert that is no longer open stops a partial repeat",
    "T4": "an alert that closes during the partial repeat",
    "T5": "phase 0 refuses an open alert of another generation",
}
mutants = [
    ("T1a-recheck-sin-sameGuard", t1a, "T1"), ("T1b-sameGuard-sin-blocked", t1b, "T1"), ("T1c-sameGuard-sin-XOR", t1c, "T1"),
    ("T1d-recheck-sin-sameGuard-ni-version", t1d, "T1"), ("T2-reanudacion-sin-alerta-abierta", t2, "T2"), ("T3-parcial-sin-alerta-abierta", t3, "T3"),
    ("T4-recheck-sin-alerta-abierta", t4, "T4"), ("T5a-fase0-sin-estado-de-alerta", t5a, "T5"), ("T5b-fase0-sin-cuenta-de-guarda", t5b, "T5"),
]
only = sys.argv[1:]
results = []
try:
    for name, fn, test in mutants:
        if only and name not in only:
            continue
        mutated = mutate(fn)
        assert mutated != text0, name + ": sin cambio"
        open(TS, "wb").write(mutated.encode("utf-8"))
        out = os.path.join(SP, "mut-port-" + name)
        p = subprocess.run([BASH, os.path.join(SP, "verify_main.sh").replace("\\", "/"), out.replace("\\", "/"),
                            "--test-name-pattern=" + PAT[test]], capture_output=True, text=True, timeout=900)
        head = open(out + ".head.txt", encoding="utf-8", errors="replace").read()
        m = re.search(r"suite exit (\d+)", head)
        pf = re.search(r"pass (\d+)\s+fail (\d+)", head)
        killed = bool(m) and m.group(1) != "0" and pf and int(pf.group(2)) >= 1
        results.append((name, "MATADO" if killed else "SOBREVIVE", pf.group(0) if pf else "?"))
        print(results[-1], flush=True)
        time.sleep(20)
finally:
    open(TS, "wb").write(orig)
    now = hashlib.sha256(open(TS, "rb").read()).hexdigest()
    print("restaurado:", now == orig_hash, "hash", now[:12], flush=True)
