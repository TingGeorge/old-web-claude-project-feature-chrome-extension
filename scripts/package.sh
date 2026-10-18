#!/bin/bash
# Packages a release into dist/:
#   dist/claude-folders-vX.Y.Z.zip            the extension, ready for "Load unpacked"
#   dist/claude-folders-webstore-vX.Y.Z.zip   the extension without "key" (Chrome Web Store upload)
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

version="$(scripts/version.sh)"

rm -rf dist
stage="dist/claude-folders"
mkdir -p "$stage"
cp -R extension/. "$stage/"
cp README.md LICENSE "$stage/"
# The README's images.
mkdir -p "$stage/docs"
cp -R docs/images "$stage/docs/"
(cd dist && zip -qry "claude-folders-v$version.zip" claude-folders -x '.*' '*/.*')

# The Web Store assigns its own ID and rejects manifests that contain "key".
store="dist/store"
cp -R extension "$store"
python3 - "$store/manifest.json" <<'PY'
import json, sys
path = sys.argv[1]
with open(path) as f:
    manifest = json.load(f)
manifest.pop("key", None)
with open(path, "w") as f:
    json.dump(manifest, f, indent=2, ensure_ascii=False)
    f.write("\n")
PY
(cd "$store" && zip -qr "../claude-folders-webstore-v$version.zip" . -x '.*' '*/.*')
rm -rf "$stage" "$store"
ls -l dist
