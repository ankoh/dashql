#!/bin/bash

set -euo pipefail

if [[ ${EUID} -eq 0 ]]; then
    echo "run_hyperd.sh must NOT be run as root." >&2
    exit 1
fi

exec "${HYPER_INSTALL_DIR}/hyperd" run \
    $(find /etc/opt/hyper/conf.d -type f 2>/dev/null | sort -n | awk '{print "--config "$1}') \
    --no-password
