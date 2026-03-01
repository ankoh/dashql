#!/usr/bin/env bash
# Hermetic FlatBuffer TypeScript codegen for Bazel.
# Usage: FLATC=<path> SPEC_INDEX=<path> OUT_DIR=<path> "$0"
#   FLATC: path to flatc binary
#   SPEC_INDEX: path to dashql/index.fbs (SPEC_DIR is derived as dirname(dirname(SPEC_INDEX)))
#   OUT_DIR: output root; flatc will create OUT_DIR/dashql/buffers/...

set -euo pipefail

if [[ -z "${FLATC:-}" || -z "${SPEC_INDEX:-}" || -z "${OUT_DIR:-}" ]]; then
  echo "FLATC, SPEC_INDEX, OUT_DIR must be set" >&2
  exit 1
fi

SPEC_DIR="$(cd "$(dirname "$(dirname "$SPEC_INDEX")")" && pwd)"
mkdir -p "${OUT_DIR}"
"${FLATC}" -I "${SPEC_DIR}" -o "${OUT_DIR}" "${SPEC_INDEX}" --ts \
  --gen-all \
  --reflect-types --reflect-names \
  --gen-name-strings --gen-compare \
  --gen-mutable \
  --gen-object-api

# Index files: flatc is buggy for namespaces with depth > 1 (see flatbuffers#7898).
# Generate dashql/buffers/<name>.ts that re-export from ./<name>/*.js
TS_OUT_PROTO_BASE="${OUT_DIR}/dashql/buffers"
for PROTO_SUBDIR_PATH in "${TS_OUT_PROTO_BASE}"/*/; do
  [[ -d "${PROTO_SUBDIR_PATH}" ]] || continue
  PROTO_DIRNAME="$(basename "${PROTO_SUBDIR_PATH}")"
  PROTO_INDEX="${TS_OUT_PROTO_BASE}/${PROTO_DIRNAME}.ts"
  : > "${PROTO_INDEX}"
  for PROTO_FILE in "${TS_OUT_PROTO_BASE}/${PROTO_DIRNAME}"/*.ts; do
    [[ -f "${PROTO_FILE}" ]] || continue
    PROTO_FILENAME="$(basename "${PROTO_FILE}" .ts)"
    echo "export * from \"./${PROTO_DIRNAME}/${PROTO_FILENAME}.js\";" >> "${PROTO_INDEX}"
  done
done
