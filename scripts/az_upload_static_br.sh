#!/usr/bin/env bash
# Copyright (c) 2020 The DashQL Authors

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)/.."

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

AZ_STORAGE="dashql"
AZ_DESTINATION"$1"
INPUT_DIR="$2"
INPUT_TMP="${ROOT_DIR}/.tmp/static"

# -------------------------------------------------------------------------------------
# Cache TTLs:
#   static     7 days
#

TTL_STATIC=604800

# -------------------------------------------------------------------------------------
# CONFIG


BROTLI_LEVEL=11
BROTLI_FILE_MATCHERS=(
    "*.js"
    "*.svg"
    "*.csv"
    "*.html"
    "*.css"
    "*.ttf"
    "*.wasm"
)
BROTLI_CONTENT_TYPES=(
    "application/javascript"
    "image/svg+xml"
    "text/csv"
    "text/html"
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

rm -rf ${INPUT_TMP}
mkdir -p ${INPUT_TMP}

# -------------------------------------------------------------------------------------
# Compress files with brotli

echo "Compressing .js, .svg, .csv, .html, .css, .ttf and .wasm with brotli"
find "${INPUT_DIR}" \
    -type f \( -iname "*.js" -o -iname "*.svg" -o -iname "*.csv" -o -iname "*.html" -o -iname "*.css" -o -iname "*.ttf"  -o -iname "*.wasm" \) \
    -exec sh -c "export OUT=${INPUT_TMP}/\$(realpath --relative-to ${INPUT_DIR} {}) && mkdir -p \$(dirname \${OUT}) && brotli --verbose --force --quality=${BROTLI_LEVEL} --output=\${OUT} {}" \; \

echo "Files"
rsync -av --ignore-existing ${INPUT_DIR}/ ${INPUT_TMP}/
find ${INPUT_TMP} \
    -type f \
    -exec sh -c "du -hs {}" \; \

# -------------------------------------------------------------------------------------
# Copy compressed files to azure

for IDX in "${!BROTLI_FILE_MATCHERS[@]}"; do
    BROTLI_FILE_MATCHER=${BROTLI_FILE_MATCHERS[$IDX]}
    BROTLI_CONTENT_TYPE=${BROTLI_CONTENT_TYPES[$IDX]}

    echo "Copy ${BROTLI_FILE_MATCHER} to Azure"
    az storage blob upload-batch \
        --auth-mode login \
        --account-name "${AZ_STORAGE}" \
        --destination "${AZ_DESTINATION}" \
        --source "${INPUT_TMP}" \
        --pattern "${BROTLI_FILE_MATCHER}" \
        --content-type "${BROTLI_CONTENT_TYPE}" \
        --content-encoding "br" \
        --content-cache-control "max-age=${TTL_STATIC}"

    find "${INPUT_TMP}" -type f -iname "${BROTLI_FILE_MATCHER}" -delete
done
