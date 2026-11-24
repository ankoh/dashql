#!/bin/bash
set -euo pipefail
exec "$1" --check extensions/d360-api/snippets
