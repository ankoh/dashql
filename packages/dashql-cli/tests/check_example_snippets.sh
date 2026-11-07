#!/bin/bash
set -euo pipefail
"$1" format --check examples/snippets/hyper examples/snippets/d360
"$1" format --check --dialect trino examples/snippets/trino
