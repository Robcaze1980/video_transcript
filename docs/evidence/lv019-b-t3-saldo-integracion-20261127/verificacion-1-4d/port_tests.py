import re, os, sys
M = r"C:\Users\rob62\Documents\Codex\2026-11-11\vamos-a-continuar-linguistvision-en-esta-2"
src = open(os.path.join(M, "docs", "history", "lv019-b-unblock-suite-contrato-previo-20261127", "billingUnblock.piece2.emulator.mjs.txt"), encoding="utf-8").read().replace("\r\n", "\n")
dst_path = os.path.join(M, "server", "commercial", "billingUnblock.emulator.mjs")
dst = open(dst_path, encoding="utf-8", newline="").read()
names = [
    "11 negative: a guard that stops being blocked, or names the incident through both fields, in phase 3 aborts the release",
    "11 negative: an alert that is no longer open stops a resume before it reaches Account",
    "11 negative: an alert that is no longer open stops a partial repeat before it reaches Account",
    "11 negative: an alert that closes during the partial repeat keeps the Video guard and writes no release",
    "11 negative: phase 0 refuses an open alert of another generation, or a guard that names another account, before Account is ever asked",
]
blocks = []
for n in names:
    assert dst.count(n) == 0, "ya existe: " + n
    i = src.index("test('" + n)
    end = src.index("\n});\n", i) + 5
    blocks.append(src[i:end])
section = ("// ---------------------------------------------------------------------------\n"
           "// Ported on 27 nov 2026 from the suite of the previous contract (docs/history/lv019-b-unblock-suite-contrato-previo-20261127):\n"
           "// five behaviors that mutation testing showed were not pinned by this suite (task 1.4d). Each one was re-verified by mutation here.\n"
           "// ---------------------------------------------------------------------------\n")
text = section + "\n".join(blocks)
assert dst.endswith("\r\n") or dst.endswith("\n")
eol = "\r\n" if "\r\n" in dst else "\n"
text = text.replace("\n", eol)
if not dst.endswith(eol):
    dst += eol
open(dst_path, "w", encoding="utf-8", newline="").write(dst + text)
print("agregadas", len(blocks), "pruebas;", len(text), "caracteres")
