#!/bin/bash
# Copyright (c) 2020 The DashQL Authors

set -euo pipefail

DATE=date
if [[ "$OSTYPE" == "darwin"* ]]; then
    DATE=gdate
    echo "We use GNU date on macOS. Install it with: brew install coreutils"
fi
${DATE} --version 1>/dev/null \
    && { echo "[ OK   ] Command: ${DATE}"; } \
    || { echo "[ ERR  ] Command: ${DATE}"; exit 1; }

AZ_ACCOUNT="stdashql"
AZ_CONTAINER="$1"

OLDER_THAN=$(${DATE} -u -d "$2 ago" '+%Y-%m-%dT%H:%MZ')
echo "OLDER_THAN='${OLDER_THAN}'"

az storage blob delete-batch \
    --account-name "${AZ_ACCOUNT}" \
    --source "${AZ_CONTAINER}" \
    --if-unmodified-since $OLDER_THAN \
    --dry-run

az storage blob delete-batch \
    --account-name "${AZ_ACCOUNT}" \
    --source "${AZ_CONTAINER}" \
    --if-unmodified-since $OLDER_THAN
