#!/bin/bash
# Prints the release version (from extension/manifest.json).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$REPO_DIR/extension/manifest.json"
