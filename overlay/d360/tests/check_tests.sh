#!/bin/bash
set -euo pipefail
exec "$1" --spec=overlay/d360/api/spec.json --reference=overlay/d360/docs --tests=overlay/d360/tests --check
