#!/usr/bin/env bash
# Copyright (c) 2020 The DashQL Authors

set -euo pipefail

# -------------------------------------------------------------------------------------
# Login

AZ_TENANT="bbea9c1c-1860-49d5-9226-62a126bdf255"
AZ_USER="http://dashql-app-ci"
AZ_PASS="${AZ_PASS:-}"
if [[ -z "${AZ_PASS}" ]]; then
    read -sp "Password for ${AZ_USER}: " AZ_PASS
fi
az login \
    --service-principal \
    --tenant ${AZ_TENANT} \
    -u ${AZ_USER} \
    -p ${AZ_PASS}

# -------------------------------------------------------------------------------------
# Perform delete

DATE=date
if [[ "$OSTYPE" == "darwin"* ]]; then
    DATE=gdate
    echo "We use GNU date on macOS. Install it with: brew install coreutils"
fi
${DATE} --version 1>/dev/null \
    && { echo "[ OK   ] Command: ${DATE}"; } \
    || { echo "[ ERR  ] Command: ${DATE}"; exit 1; }

AZ_STORAGE="dashql"
AZ_CONTAINER="$1"

OLDER_THAN=$(${DATE} -u -d "$2 ago" '+%Y-%m-%dT%H:%MZ')
echo "OLDER_THAN='${OLDER_THAN}'"

az storage blob delete-batch \
    --auth-mode login \
    --account-name "${AZ_STORAGE}" \
    --source "${AZ_CONTAINER}" \
    --if-unmodified-since $OLDER_THAN
