#!/usr/bin/env bash
set -euo pipefail

RUNFILES_ROOT="${RUNFILES_DIR:-$0.runfiles}"
WORKSPACE_ROOT="${RUNFILES_ROOT}/_main"
ARCH="${1:?usage: package_macos.sh <arm64|x64> <addon-path>}"
ADDON_PATH="${2:?usage: package_macos.sh <arm64|x64> <addon-path>}"
case "${ARCH}" in
    arm64|x64) ;;
    *) echo "unsupported macOS architecture: ${ARCH}" >&2; exit 1 ;;
esac
STAGE="${TMPDIR:-/tmp}/dashql-native-package-$$"
trap 'chmod -R u+w "${STAGE}" 2>/dev/null || true; rm -rf "${STAGE}"' EXIT

mkdir -p "${STAGE}/dist" "${STAGE}/renderer"
cp -R "${WORKSPACE_ROOT}/packages/dashql-native/dist/." "${STAGE}/dist/"
cp "${WORKSPACE_ROOT}/packages/dashql-native/src/preload.cjs" "${STAGE}/preload.cjs"
VERSION_ENV="${RUNFILES_ROOT}/+dashql_app_version_ext+dashql_app_version/version.env"
VERSION="$(awk -F= '$1=="DASHQL_VERSION_TEXT"{print $2}' "${VERSION_ENV}")"
sed -e "s|\"version\": \"[^\"]*\"|\"version\": \"${VERSION}\"|" \
    "${WORKSPACE_ROOT}/packages/dashql-native/package.json" > "${STAGE}/package.json"
cp "${WORKSPACE_ROOT}/packages/dashql-native/electron-builder.yml" "${STAGE}/electron-builder.yml"
cp "${WORKSPACE_ROOT}/packages/dashql-native/Entitlements.plist" "${STAGE}/Entitlements.plist"
cp "${WORKSPACE_ROOT}/misc/logo-dashql-glyphs/app_icons_mac.icns" "${STAGE}/icon.icns"
cp -R "${WORKSPACE_ROOT}/packages/dashql-app/electron_deploy/." "${STAGE}/renderer/"
cp "${ADDON_PATH}" "${STAGE}/dashql_native_napi.node"
ln -s "${WORKSPACE_ROOT}/node_modules" "${STAGE}/node_modules"

BUILDER_ARGS=(--config "${STAGE}/electron-builder.yml")
if [[ -z "${CSC_LINK:-}" && -z "${CSC_NAME:-}" ]]; then
    export CSC_IDENTITY_AUTO_DISCOVERY=false
else
    BUILDER_ARGS+=(--config.mac.notarize=true)
fi
OUTPUT="${BUILD_WORKSPACE_DIRECTORY:-$PWD}/dist/electron/${ARCH}"
mkdir -p "${OUTPUT}"
node "${WORKSPACE_ROOT}/node_modules/electron-builder/cli.js" \
    "${BUILDER_ARGS[@]}" \
    --projectDir "${STAGE}" \
    --config.directories.output="${OUTPUT}" \
    --mac dmg zip \
    --${ARCH} \
    --publish never
