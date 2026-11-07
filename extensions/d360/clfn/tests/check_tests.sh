#!/bin/bash
set -euo pipefail
exec "$1" --spec=extensions/d360/clfn/spec/spec.json --reference=extensions/d360/clfn/docs --tests=extensions/d360/clfn/tests --check
