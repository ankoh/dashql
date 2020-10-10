#!/bin/bash
set -euo pipefail

SOURCE_DIRECTORY="$(cd $(dirname "$BASH_SOURCE[0]") && pwd)" &> /dev/null
CARGO_WORSPACE_DIRECTORY="$(cd "$SOURCE_DIRECTORY" && cd ../.. && pwd)" &> /dev/null
CARGO_DIRECTORY="$(cd ~/.cargo && pwd)"

(
    cd "$SOURCE_DIRECTORY" && \
    cargo run generate-parser \
        ./dashql/dashql.y \
        ./dashql/dashql.y.x86_64-unknown-linux-gnu.rs \
        ./dashql/dashql.l \
        ./dashql/dashql.l.x86_64-unknown-linux-gnu.rs
)

docker run -it --rm \
    -v "$CARGO_DIRECTORY/registry":/root/.cargo/registry \
    -v "$CARGO_DIRECTORY/git":/root/.cargo/git \
    -v "$CARGO_WORSPACE_DIRECTORY":/workspace \
    dashql/dashql-parser:latest \
    /bin/bash -c "cd /workspace/core/parser && cargo run generate-parser \
        ./dashql/dashql.y \
        ./dashql/dashql.y.i686-unknown-linux-gnu.rs \
        ./dashql/dashql.l \
        ./dashql/dashql.l.i686-unknown-linux-gnu.rs"
