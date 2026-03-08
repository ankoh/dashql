#!/bin/bash
set -euo pipefail
exec "$1" --source_dir="$BUILD_WORKSPACE_DIRECTORY" --filter="$2"
