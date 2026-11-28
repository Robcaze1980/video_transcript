#!/usr/bin/env python3
# LV-019-B -- author the isolated "unblock-fence" harness variant from the
# reviewed "UnblockFocus" templates. Offline and inert: it never starts an
# emulator, fixture, Firebase emulator, network or cloud call, never reads
# credentials and never changes real money. The local emulator runs closed and
# proves no production rule. It never inspects or stops a foreign process.
#
# Usage (from the target worktree root, base 61e64070...):
#     python scripts/generateUnblockFenceHarness.py .
import re
import sys
from pathlib import Path

BASE_OLD = 'e4ed64dc87122352d68ac68763b653308a377787'
BASE_NEW = '61e64070c2ac6245caaee8eaad620feb68d9e246'

FIXTURE_OLD = 'server/commercial/billingUnblock.emulator.mjs'
FIXTURE_NEW = 'server/account/unblockFence.emulator.mjs'

NEW_SELECTED = [
    'Fenced predecessor before reconciliation',
    'Fenced reconciliation before late predecessor',
    'Fenced simultaneous predecessor and reconciliation',
]

# The new fixture currently uses these titles: rename them to NEW_SELECTED in the
# same order, never touching a test body.
TITLE_RENAMES = [
    ('A: a confirmed predecessor whose response was discarded is recovered by reconciliation with no successor',
     'Fenced predecessor before reconciliation'),
    ('B: a reconciliation whose response was discarded is idempotent; late predecessor rejected, successor confirmed once',
     'Fenced reconciliation before late predecessor'),
    ('C: concurrent predecessor confirm vs reconciliation yields exactly one serialized winner',
     'Fenced simultaneous predecessor and reconciliation'),
]

TEMPLATES = {
    'scripts/prepareUnblockFocusIsolation.mjs': 'scripts/prepareUnblockFenceIsolation.mjs',
    'scripts/runUnblockFocusEmulator.mjs': 'scripts/runUnblockFenceEmulator.mjs',
    'scripts/runUnblockFocusIsolated.ps1': 'scripts/runUnblockFenceIsolated.ps1',
}

SELECTED_BLOCK = 'const selectedNames = [\n' + ''.join(f"  '{n}',\n" for n in NEW_SELECTED) + '];'


def read_required(path, label):
    target = Path(path)
    if not target.is_file():
        raise SystemExit(f'FAIL: missing {label}: {target}')
    return target.read_bytes().decode('utf-8')


def replace_count(text, old, new, label, expected):
    found = text.count(old)
    if found != expected:
        raise SystemExit(f'FAIL [{label}]: expected {expected} match(es) of {old!r}, found {found}')
    return text.replace(old, new)


def replace_regex(text, pattern, repl, label, expected=1):
    new_text, found = re.subn(pattern, repl, text)
    if found != expected:
        raise SystemExit(f'FAIL [{label}]: expected {expected} match(es), found {found}')
    return new_text


def rename_artifacts(text, label):
    for token, replacement in (('UnblockFocus', 'UnblockFence'), ('unblock-focus', 'unblock-fence')):
        if token not in text:
            raise SystemExit(f'FAIL [{label}]: token {token!r} not found')
        text = text.replace(token, replacement)
    return text


def build_prepare(text):
    text = rename_artifacts(text, 'prepare')
    text = replace_count(text, BASE_OLD, BASE_NEW, 'prepare.base', 1)
    return replace_regex(text, r'expectedSelected!==17', 'expectedSelected!==3', 'prepare.expectedSelected')


def build_launcher(text):
    text = rename_artifacts(text, 'launcher')
    text = replace_count(text, FIXTURE_OLD, FIXTURE_NEW, 'launcher.fixtureFiles', 1)
    text = replace_regex(text, r'const selectedNames = \[[^\]]*\];',
                         lambda _match: SELECTED_BLOCK, 'launcher.selectedNames')
    return replace_count(text, 'seventeen', 'three', 'launcher.comment', 1)


def build_ps1(text):
    # Rename UnblockFocus/unblock-focus -> UnblockFence/unblock-fence in paths,
    # names and checks, then pin base. The original dedicated-port guard is left
    # byte-for-byte intact: it throws immediately if 8198/9198/9298 is already in
    # use, never waits and never touches a foreign process. Port-free readiness is
    # verified by the operator before execution.
    text = rename_artifacts(text, 'ps1')
    text = replace_count(text, BASE_OLD, BASE_NEW, 'ps1.base', 1)
    return text

def renamed_fixture_text(path):
    text = read_required(path, 'fixture')
    for old, new in TITLE_RENAMES:
        found = text.count(old)
        if found != 1:
            raise SystemExit(f'FAIL [fixture]: title must appear exactly once, found {found}: {old!r}')
        text = text.replace(old, new)
    for old, _new in TITLE_RENAMES:
        if old in text:
            raise SystemExit(f'FAIL [fixture]: stale title remains: {old!r}')
    return text


def main():
    root = Path(sys.argv[1] if len(sys.argv) > 1 else '.').resolve()

    builders = {
        'scripts/prepareUnblockFocusIsolation.mjs': build_prepare,
        'scripts/runUnblockFocusEmulator.mjs': build_launcher,
        'scripts/runUnblockFocusIsolated.ps1': build_ps1,
    }
    built = {
        TEMPLATES[source]: builder(read_required(root / source, source))
        for source, builder in builders.items()
    }
    fixture_text = renamed_fixture_text(root / FIXTURE_NEW)

    # Validate everything before writing anything; never overwrite pre-existing files.
    for destination in built:
        if (root / destination).exists():
            raise SystemExit(f'FAIL: refusing to overwrite pre-existing file {destination}')
    for destination, text in built.items():
        target = root / destination
        target.parent.mkdir(parents=True, exist_ok=True)
        with open(target, 'xb') as handle:
            handle.write(text.encode('utf-8'))
    (root / FIXTURE_NEW).write_bytes(fixture_text.encode('utf-8'))

    print('Generated:')
    for destination in built:
        print(f'  {destination}')
    print(f'Renamed the three test titles in {FIXTURE_NEW} (bodies untouched)')
    print('No emulator, fixture, network, cloud or Firebase command was run.')


if __name__ == '__main__':
    main()
