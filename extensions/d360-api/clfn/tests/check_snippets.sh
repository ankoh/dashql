#!/bin/bash
set -euo pipefail
exec "$1" format --check extensions/d360-api/snippets
