#!/bin/bash
set -euo pipefail
exec "$1" --source=extensions/d360-api/clfn/spec --docs=extensions/d360-api/clfn/docs --check
