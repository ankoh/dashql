#!/usr/bin/env bash
# The test of `rust_safety_test` (bazel/rust_safety.bzl): Bazel ran clippy on the crates to build the test, and a breach
# of a safety lint fails that build. The arguments are the markers that clippy wrote for the crates it passed.
set -euo pipefail
if [ "$#" -eq 0 ]; then
    echo "clippy checked no crate" >&2
    exit 1
fi
for marker in "$@"; do
    if [ ! -f "$marker" ]; then
        echo "clippy wrote no marker: $marker" >&2
        exit 1
    fi
done
echo "clippy passed the safety lints of $# crates"
