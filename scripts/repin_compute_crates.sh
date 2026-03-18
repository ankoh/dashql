#!/usr/bin/env bash
set -euo pipefail
cd "$BUILD_WORKSPACE_DIRECTORY"
CARGO_BAZEL_REPIN=1 bazel build @compute_crates//:all
