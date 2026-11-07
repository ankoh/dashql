#!/bin/bash
# Regenerate the documents of the checkout from the source, then the fixtures from the generated spec
set -euo pipefail
ROOT="$BUILD_WORKSPACE_DIRECTORY"
"$1" --api="$ROOT/overlay/d360/api" --docs="$ROOT/overlay/d360/docs" --write
"$2" --spec="$3" --reference="$ROOT/overlay/d360/docs" --tests="$ROOT/overlay/d360/tests" --write
