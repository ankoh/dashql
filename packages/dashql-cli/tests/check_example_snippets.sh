#!/bin/bash
set -euo pipefail
"$1" format --check examples/snippets/hyper examples/snippets/salesforce
"$1" format --check --dialect trino examples/snippets/trino
