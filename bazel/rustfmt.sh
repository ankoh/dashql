#!/usr/bin/env bash
# `bazel run //bazel:rustfmt [-- <path>...]`: formats the Rust files of the repo that git knows, tracked or new and not
# ignored, under the paths if given. Generated files are not in the tree, so they stay unformatted.
set -euo pipefail
rustfmt="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
shift
cd "$BUILD_WORKSPACE_DIRECTORY"
files=()
while IFS= read -r -d '' file; do
    [ -f "$file" ] && files+=("$file")
done < <(git ls-files -z --cached --others --exclude-standard -- "${@:-.}" | grep -z '\.rs$')
if [ "${#files[@]}" -eq 0 ]; then
    echo "no Rust files" >&2
    exit 0
fi
"$rustfmt" --edition 2021 --config-path rustfmt.toml --config skip_children=true "${files[@]}"
echo "rustfmt formatted ${#files[@]} files"
