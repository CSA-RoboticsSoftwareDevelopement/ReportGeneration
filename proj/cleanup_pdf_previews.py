"""Quarantine legacy Section Editor PDF sessions created before preview reuse.

The command is a dry run unless ``--apply`` is supplied. Quarantined sessions
remain recoverable for seven days and are purged by PDF Studio's normal cleanup.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
from pathlib import Path


ROOT = Path(__file__).with_name("uploads") / "pdf-studio"
QUARANTINE_ROOT = ROOT.parent / "pdf-studio-quarantine"


def _legacy_preview(directory: Path) -> tuple[bool, dict]:
    try:
        meta = json.loads((directory / "meta.json").read_text("utf-8"))
    except (OSError, json.JSONDecodeError):
        return False, {}
    candidate = (
        not meta.get("kind")
        and meta.get("name") == "Report.pdf"
        and not meta.get("undo")
        and not meta.get("redo")
        and not meta.get("shares")
        and not meta.get("protected")
        and not meta.get("was_protected")
        and (directory / "doc.pdf").is_file()
    )
    return candidate, meta


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="move candidates into seven-day quarantine")
    parser.add_argument("--restore", metavar="DOC_ID", help="restore one quarantined session")
    args = parser.parse_args()

    if args.restore:
        source = QUARANTINE_ROOT / args.restore
        target = ROOT / args.restore
        if not source.is_dir() or target.exists():
            parser.error("the quarantined session does not exist or its target is occupied")
        ROOT.mkdir(parents=True, exist_ok=True)
        shutil.move(str(source), str(target))
        print(f"Restored {args.restore}")
        return 0

    candidates = []
    if ROOT.is_dir():
        for directory in ROOT.iterdir():
            if not directory.is_dir():
                continue
            matched, meta = _legacy_preview(directory)
            if matched:
                candidates.append((directory, meta))

    action = "Quarantining" if args.apply else "Would quarantine"
    for directory, meta in candidates:
        print(f"{action} {directory.name} owner={meta.get('owner_id')} created={meta.get('created')}")

    if args.apply and candidates:
        QUARANTINE_ROOT.mkdir(parents=True, exist_ok=True)
        for directory, _ in candidates:
            target = QUARANTINE_ROOT / directory.name
            if target.exists():
                print(f"Skipped {directory.name}: already quarantined")
                continue
            shutil.move(str(directory), str(target))
            os.utime(target)

    print(f"{len(candidates)} legacy preview session(s) {'processed' if args.apply else 'found'}.")
    if not args.apply:
        print("Dry run only. Re-run with --apply after reviewing the list.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
