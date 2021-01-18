#!/bin/bash
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
# Upload the build to the azure container.
#
# We deliberately do not sync with --delete here.
# A client may still see the old index.html while we're propagating the new one.
# This would result in broken apps until the caches pick up the new version.
#
# We instead plain copy the whole release archive independent of whether the files exist.
# This allows us to discover old versions quickly via the modification timestamps.
#
# We also rely on cache busting.
# All files in the static folder MUST include [contenthash] in the filename.
# That means that caches are never "stale" since an updated index.html will refer to new filenames.

AZ_STORAGE="stdashql"
AZ_CONTAINER="$1"
APP_RELEASE="$2"

# -------------------------------------------------------------------------------------
# Cache TTLs:
#   index.html 10 minutes
#   static     7 days
#

TTL_INDEX=600
TTL_STATIC=604800

# -------------------------------------------------------------------------------------
# CONFIG

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)/.."
APP_DEPLOY_TMP="${ROOT_DIR}/artifacts/tmp"

BROTLI_LEVEL=11
BROTLI_FILE_MATCHERS=(
    "*.js"
    "*.css"
    "*.ttf"
    "*.wasm"
)
BROTLI_CONTENT_TYPES=(
    "application/javascript"
    "text/css"
    "font/ttf"
    "application/wasm"
)

brotli --version 1>/dev/null \
    && { echo "[ OK   ] Command: brotli"; } \
    || { echo "[ ERR  ] Command: brotli"; exit 1; }

realpath --version 1>/dev/null \
    && { echo "[ OK   ] Command: realpath"; } \
    || { echo "[ ERR  ] Command: realpath"; exit 1; }

# -------------------------------------------------------------------------------------
# Prepare archive

rm -rf ${APP_DEPLOY_TMP}
mkdir -p ${APP_DEPLOY_TMP}

# -------------------------------------------------------------------------------------
# Compress files with brotli

echo "Compressing .js, .css, .ttf and .wasm with brotli"
find ${APP_RELEASE} \
    -type f \( -iname "*.js" -o -iname "*.css" -o -iname "*.ttf"  -o -iname "*.wasm" \) \
    -exec sh -c "export OUT=${APP_DEPLOY_TMP}/\$(realpath --relative-to ${APP_RELEASE} {}) && mkdir -p \$(dirname \${OUT}) && brotli --verbose --force --quality=${BROTLI_LEVEL} --output=\${OUT} {}" \; \

echo "Files"
rsync -av --ignore-existing ${APP_RELEASE}/ ${APP_DEPLOY_TMP}/
find ${APP_DEPLOY_TMP} \
    -type f \
    -exec sh -c "du -hs {}" \; \

# -------------------------------------------------------------------------------------
# Copy compressed files to azure

for IDX in "${!BROTLI_FILE_MATCHERS[@]}"; do
    BROTLI_FILE_MATCHER=${BROTLI_FILE_MATCHERS[$IDX]}
    BROTLI_CONTENT_TYPE=${BROTLI_CONTENT_TYPES[$IDX]}

    echo "Copy ./static/${BROTLI_FILE_MATCHER} to Azure"
    az storage blob upload-batch \
        --auth-mode login \
        --account-name "${AZ_STORAGE}" \
        --destination "${AZ_CONTAINER}/static" \
        --source "${APP_DEPLOY_TMP}/static" \
        --pattern "${BROTLI_FILE_MATCHER}" \
        --content-type "${BROTLI_CONTENT_TYPE}" \
        --content-encoding "br" \
        --content-cache-control "max-age=${TTL_STATIC}"

    find "${APP_DEPLOY_TMP}/static" -type f -iname "${BROTLI_FILE_MATCHER}" -delete
done

# -------------------------------------------------------------------------------------
# Copy uncompressed files to azure

echo "Copy ./static/ to Azure"
az storage blob upload-batch \
    --auth-mode login \
    --account-name "${AZ_STORAGE}" \
    --destination "${AZ_CONTAINER}/static" \
    --source "${APP_DEPLOY_TMP}/static" \
    --content-cache-control "max-age=${TTL_STATIC}"

rm -r "${APP_DEPLOY_TMP}/static"

# -------------------------------------------------------------------------------------
# Copy all other files to azure

echo "Copy other files to Azure"
az storage blob upload-batch \
    --auth-mode login \
    --account-name "${AZ_STORAGE}" \
    --destination "${AZ_CONTAINER}" \
    --source "${APP_DEPLOY_TMP}" \
    --content-cache-control "max-age=${TTL_INDEX}"

