#!/bin/bash
set -euo pipefail
exec "$1" --spec=overlay/d360/api/spec.json --reference=docs/design/overlay/cdp --tests=overlay/d360/tests --check
