#!/bin/bash
# Regenerate the documents of the checkout from the source, then the fixtures from the generated spec
set -euo pipefail
ROOT="$BUILD_WORKSPACE_DIRECTORY"
"$1" --source="$ROOT/extensions/d360/clfn/spec" --docs="$ROOT/extensions/d360/clfn/docs" --write
"$2" --spec="$3" --reference="$ROOT/extensions/d360/clfn/docs" --tests="$ROOT/extensions/d360/clfn/tests" --write
