#!/usr/bin/env bash
# Re-resolve the crate universes declared in bazel/crates/*.MODULE.bazel and rewrite their Cargo.lock files.
#
#   bazel run //scripts:repin_crates                 re-resolve after spec edits, keeping locked transitive versions
#   bazel run //scripts:repin_crates -- full         upgrade every crate to the newest version the specs allow
#   bazel run //scripts:repin_crates -- <crate>@<v>  upgrade one crate
#
# `--only <universe>` (crates, core_crates) before these limits the repin to one universe.
set -euo pipefail
cd "${BUILD_WORKSPACE_DIRECTORY:-$(dirname "$0")/..}"
only=
if [ "${1:-}" = --only ]; then
    only="$2"
    shift 2
fi
env -u CARGO_BAZEL_REPIN_ONLY ${only:+CARGO_BAZEL_REPIN_ONLY="$only"} CARGO_BAZEL_REPIN="${1:-1}" bazel mod deps --lockfile_mode=update
# Evaluate once more without the repin variables, so MODULE.bazel.lock does not record them.
env -u CARGO_BAZEL_REPIN -u CARGO_BAZEL_REPIN_ONLY bazel mod deps --lockfile_mode=update
