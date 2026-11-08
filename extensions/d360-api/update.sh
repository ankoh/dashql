#!/bin/bash
# Regenerate the documents of the checkout from the source
set -euo pipefail
ROOT="$BUILD_WORKSPACE_DIRECTORY"
"$1" --source="$ROOT/extensions/d360-api/clfn/spec" --docs="$ROOT/extensions/d360-api/clfn/docs" --write
