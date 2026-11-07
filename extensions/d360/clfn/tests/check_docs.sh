#!/bin/bash
set -euo pipefail
exec "$1" --source=extensions/d360/clfn/spec --docs=extensions/d360/clfn/docs --check
