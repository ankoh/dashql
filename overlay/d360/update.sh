#!/bin/bash
# Regenerate the spec from the reference documents of the checkout, then the fixtures from the spec
set -euo pipefail
ROOT="$BUILD_WORKSPACE_DIRECTORY"
"$1" --reference="$ROOT/overlay/d360/docs" --write="$ROOT/overlay/d360/api/spec.json"
"$2" --spec="$ROOT/overlay/d360/api/spec.json" --reference="$ROOT/overlay/d360/docs" --tests="$ROOT/overlay/d360/tests" --write
