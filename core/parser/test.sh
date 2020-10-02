#!/bin/bash
set -euo pipefail

SOURCE_DIRECTORY="$(cd $(dirname "$BASH_SOURCE[0]") && pwd)" &> /dev/null

docker run -it --rm \
    -v ${SOURCE_DIRECTORY}:/parser \
    dashql/dashql-parser:latest \
    /bin/bash -c "cd /parser && cargo test"
