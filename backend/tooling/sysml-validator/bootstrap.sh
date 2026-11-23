#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TOOLS_DIR="$REPO_ROOT/.tools"
BUNDLE_DIR="$TOOLS_DIR/sysml-pilot-0.62.0"
ZIP_PATH="$TOOLS_DIR/jupyter-sysml-kernel-0.62.0.zip"

ASSET_URL="https://github.com/Systems-Modeling/SysML-v2-Pilot-Implementation/releases/download/2026-08/jupyter-sysml-kernel-0.62.0.zip"
EXPECTED_SHA256="5a015ed3f2b3d2dae14e9c3fb9602d9e1fef5f9ce33cf396c422329405cc3cb2"

for command_name in java javac curl unzip sha256sum; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Required command '$command_name' was not found on PATH." >&2
    exit 2
  }
done

JAVA_VERSION="$(java -version 2>&1 | head -n 1)"
if [[ ! "$JAVA_VERSION" =~ version\ \"21(\.|\\\") ]]; then
  echo "Java 21 is required. Found: $JAVA_VERSION" >&2
  exit 2
fi

mkdir -p "$TOOLS_DIR"

if [[ "${1:-}" == "--force" ]]; then
  rm -rf "$BUNDLE_DIR" "$ZIP_PATH"
fi

if [[ ! -d "$BUNDLE_DIR" ]]; then
  if [[ ! -f "$ZIP_PATH" ]]; then
    echo "Downloading official SysML v2 Pilot 0.62.0 bundle..."
    curl --fail --location --retry 3 --output "$ZIP_PATH" "$ASSET_URL"
  fi

  echo "$EXPECTED_SHA256  $ZIP_PATH" | sha256sum --check --status || {
    rm -f "$ZIP_PATH"
    echo "Checksum mismatch for Pilot bundle." >&2
    exit 2
  }

  mkdir -p "$BUNDLE_DIR"
  unzip -q "$ZIP_PATH" -d "$BUNDLE_DIR"
fi

SYSML_BUNDLE_DIR="$BUNDLE_DIR/sysml"
ALL_JAR="$(find "$SYSML_BUNDLE_DIR" -maxdepth 1 -name 'jupyter-sysml-kernel-*-all.jar' -print -quit)"
LIBRARY_DIR="$SYSML_BUNDLE_DIR/sysml.library"

if [[ -z "$ALL_JAR" ]]; then
  echo "Could not find the official shaded kernel JAR under $SYSML_BUNDLE_DIR." >&2
  exit 2
fi

if [[ ! -d "$LIBRARY_DIR" ]]; then
  echo "Could not find the official SysML library under $LIBRARY_DIR." >&2
  exit 2
fi

CLASSES_DIR="$SCRIPT_DIR/build/classes"
rm -rf "$CLASSES_DIR"
mkdir -p "$CLASSES_DIR"

javac -cp "$ALL_JAR" \
  -d "$CLASSES_DIR" \
  "$SCRIPT_DIR/src/main/java/io/github/huaiguo/sysmlvalidator/ValidatorMain.java"

echo "Validator bootstrap complete."
echo "Official release: 2026-08 / 0.62.0"
echo "Bundle SHA256: $EXPECTED_SHA256"
echo "Runtime JAR: $ALL_JAR"
echo "SysML library: $LIBRARY_DIR"
echo "Run smoke tests: ./tooling/sysml-validator/smoke-test.sh"
