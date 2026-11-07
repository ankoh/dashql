#!/bin/bash
set -euo pipefail
exec "$1" format --check overlay/d360/snippets
