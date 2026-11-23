#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 path/to/model.sysml" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BUNDLE_DIR="$REPO_ROOT/.tools/sysml-pilot-0.62.0/sysml"
CLASSES_DIR="$SCRIPT_DIR/build/classes"
LIBRARY_DIR="$BUNDLE_DIR/sysml.library"

if [[ ! -d "$CLASSES_DIR" ]]; then
  echo "Validator has not been bootstrapped. Run $SCRIPT_DIR/bootstrap.sh first." >&2
  exit 2
fi

ALL_JAR="$(find "$BUNDLE_DIR" -maxdepth 1 -name 'jupyter-sysml-kernel-*-all.jar' -print -quit)"
if [[ -z "$ALL_JAR" ]]; then
  echo "Official Pilot runtime JAR not found. Run bootstrap.sh first." >&2
  exit 2
fi

if [[ ! -d "$LIBRARY_DIR" ]]; then
  echo "SysML library directory not found: $LIBRARY_DIR" >&2
  exit 2
fi

model_path="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"

java -cp "$CLASSES_DIR:$ALL_JAR" \
  io.github.huaiguo.sysmlvalidator.ValidatorMain \
  --library "$LIBRARY_DIR" \
  --file "$model_path"
