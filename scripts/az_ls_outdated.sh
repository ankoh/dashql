#!/bin/bash
# Copyright (c) 2020 The DashQL Authors

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)/.."

DATE=date
if [[ "$OSTYPE" == "darwin"* ]]; then
    DATE=gdate
    echo "We use GNU date on macOS. Install it with: brew install coreutils"
fi
${DATE} --version 1>/dev/null \
    && { echo "[ OK   ] Command: ${DATE}"; } \
    || { echo "[ ERR  ] Command: ${DATE}"; exit 1; }

STORAGE_ACCOUNT="stdashql"
STORAGE_CONTAINER="$1"
OLDER_THAN=$(${DATE} -d "$2 ago" "+%s")

az storage fs list --account-name ${STORAGE_ACCOUNT} --query="[?name=='${STORAGE_CONTAINER}']"
