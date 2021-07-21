#!/usr/bin/env bash
# Copyright (c) 2020 The DashQL Authors

set -euo pipefail

trap exit SIGINT

PROJECT_ROOT="$(cd $(dirname "$BASH_SOURCE[0]") && cd .. && pwd)" &> /dev/null

TMP_DIR="${PROJECT_ROOT}/.tmp"
BOOST_DIR="${TMP_DIR}/boost"
BOOST_VERSION="1.74.0"
BOOST_TARBALL="boost_1_74_0.tar.gz"
BOOST_TARBALL_PATH="${TMP_DIR}/${BOOST_TARBALL}"
EMSDK_ENV="${TMP_DIR}/emsdk/emsdk_env.sh"

CCACHE="ccache"
${CCACHE} --version \
    && { echo "[ OK  ] Command: ccache"; } \
    || { echo "[ ERR ] Command: ccache"; exit 1; }

if [ ! -f ${BOOST_TARBALL_PATH} ]; then
    curl -Lo "${BOOST_TARBALL_PATH}" "https://boostorg.jfrog.io/artifactory/main/release/${BOOST_VERSION}/source/${BOOST_TARBALL}"
fi

if [ ! -f "${EMSDK_ENV}" ]; then
    ${PROJECT_ROOT}/scripts/build_emsdk.sh
fi
source "${EMSDK_ENV}"

MODE=${1:-Fast}
echo "MODE=${MODE}"

BOOST_ARCHIVE=${BOOST_TARBALL_PATH} ${PROJECT_ROOT}/scripts/wasm_build.sh ${MODE}
