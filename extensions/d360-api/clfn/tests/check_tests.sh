#!/bin/bash
set -euo pipefail
exec "$1" --spec=extensions/d360-api/clfn/spec/spec.json --reference=extensions/d360-api/clfn/docs --tests=extensions/d360-api/clfn/tests --check
