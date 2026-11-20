#!/usr/bin/env bash
# The test of `rustfmt_test` (bazel/rustfmt.bzl): rustfmt checks the Rust files of a package. The arguments are rustfmt,
# the rustfmt.toml of the repo and the files. A module of another file is checked on its own, skip_children keeps
# rustfmt from reading the generated modules that the test doesn't see.
set -euo pipefail
rustfmt="$1"
config="$2"
shift 2
if [ "$#" -eq 0 ]; then
    echo "rustfmt checked no file" >&2
    exit 1
fi
if ! "$rustfmt" --check --edition 2021 --config-path "$config" --config skip_children=true "$@"; then
    echo "rustfmt would change the files above, run: bazel run //bazel:rustfmt" >&2
    exit 1
fi
echo "rustfmt passed $# files"
