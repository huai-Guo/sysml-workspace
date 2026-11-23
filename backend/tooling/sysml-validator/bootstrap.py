"""Portable checksum-pinned Pilot bootstrap using only Python and Java 21."""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
import urllib.request
import zipfile
from pathlib import Path


def main():
    tooling = Path(__file__).resolve().parent
    root = tooling.parent.parent
    lock = json.loads((tooling / "upstream.lock.json").read_text())
    version = subprocess.run(["java", "-version"], capture_output=True, text=True, check=True)
    if not re.search(r'version "21[.\"]', version.stderr):
        raise SystemExit("Java 21 is required")
    tools = root / ".tools"
    tools.mkdir(exist_ok=True)
    archive = tools / lock["distribution"]["asset"]
    if not archive.exists():
        partial = archive.with_suffix(".partial")
        with urllib.request.urlopen(lock["distribution"]["url"], timeout=60) as response, partial.open("wb") as out:
            size = 0
            while block := response.read(1024 * 1024):
                size += len(block)
                if size > 250 * 1024 * 1024:
                    raise SystemExit("Pilot distribution exceeds size bound")
                out.write(block)
        partial.replace(archive)
    with archive.open("rb") as source:
        digest = hashlib.file_digest(source, "sha256").hexdigest()
    if digest != lock["distribution"]["sha256"]:
        raise SystemExit("Pilot distribution checksum mismatch")
    bundle = tools / ("sysml-pilot-" + lock["pilotVersion"])
    with zipfile.ZipFile(archive) as zip_file:
        for member in zip_file.infolist():
            if not (bundle / member.filename).resolve().is_relative_to(bundle.resolve()):
                raise SystemExit("Unexpected archive path")
        zip_file.extractall(bundle)
    jar = next(bundle.glob(lock["runtimeJarPattern"]))
    classes = tooling / "build" / "classes"
    classes.mkdir(parents=True, exist_ok=True)
    source = tooling / "src" / "main" / "java" / "io" / "github" / "huaiguo" / "sysmlvalidator" / "ValidatorMain.java"
    subprocess.run(["javac", "-encoding", "UTF-8", "-cp", str(jar), "-d", str(classes), str(source)], check=True)
    print("Pilot bootstrap complete; release checksum verified.")


if __name__ == "__main__":
    main()
