#!/bin/bash
set -euo pipefail
"$1" --check examples/snippets/hyper examples/snippets/d360
"$1" --check --dialect trino examples/snippets/trino
