#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

python3 - "$SCRIPT_DIR" <<'PY'
import json
import pathlib
import subprocess
import sys

root = pathlib.Path(sys.argv[1])
validate = root / "validate.sh"

cases = [
    ("valid", root / "fixtures/valid/simple-part.sysml", 0, True, None),
    ("syntax-error", root / "fixtures/invalid/syntax-error.sysml", 1, False, "syntax"),
    ("semantic-error", root / "fixtures/invalid/semantic-error.sysml", 1, False, "semantic"),
]

for name, fixture, expected_exit, expected_valid, expected_kind in cases:
    proc = subprocess.run(
        [str(validate), str(fixture)],
        text=True,
        capture_output=True,
        check=False,
    )

    if proc.returncode != expected_exit:
        raise SystemExit(
            f"{name}: expected exit {expected_exit}, got {proc.returncode}\n"
            f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
        )

    try:
        result = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"{name}: output is not JSON: {exc}\n{proc.stdout}")

    if result.get("valid") is not expected_valid:
        raise SystemExit(
            f"{name}: expected valid={expected_valid}, got {result.get('valid')}"
        )

    if expected_kind is not None:
        matching = [
            item for item in result.get("diagnostics", [])
            if item.get("kind") == expected_kind
        ]
        if not matching:
            kinds = {item.get("kind") for item in result.get("diagnostics", [])}
            raise SystemExit(
                f"{name}: expected diagnostic kind {expected_kind!r}, got {sorted(kinds)}"
            )

        first = matching[0]
        if first.get("line") is None or first.get("column") is None:
            raise SystemExit(
                f"{name}: expected line/column on {expected_kind!r} diagnostic"
            )
        if first.get("source") != "omg-pilot":
            raise SystemExit(
                f"{name}: expected source='omg-pilot', got {first.get('source')!r}"
            )

    validator = result.get("validator", {})
    if (
        validator.get("name") != "omg-sysml-v2-pilot"
        or validator.get("version") != "0.62.0"
        or validator.get("tag") != "2026-08"
    ):
        raise SystemExit(f"{name}: unexpected validator metadata: {validator}")

    print(f"PASS {name}")

print("All validator smoke tests passed.")
PY
