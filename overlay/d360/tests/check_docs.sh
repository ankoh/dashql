#!/bin/bash
set -euo pipefail
exec "$1" --api=overlay/d360/api --docs=overlay/d360/docs --check
