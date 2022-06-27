# Copyright (c) 2020 The DashQL Authors

.DEFAULT_GOAL := duckdb

# ---------------------------------------------------------------------------
# Config

ROOT_DIR:=$(shell dirname $(realpath $(firstword $(MAKEFILE_LIST))))

UID=${shell id -u}
GID=${shell id -g}

APP_RELEASE_DIR="${ROOT_DIR}/packages/app/build/release"
APP_RELEASE_TAG="$(shell git rev-parse --short HEAD)"

PARSER_SOURCE_DIR="${ROOT_DIR}/libs/dashql-parser"
PARSER_DEBUG_DIR="${PARSER_SOURCE_DIR}/build/Debug"
PARSER_RELEASE_DIR="${PARSER_SOURCE_DIR}/build/Release"
PARSER_RELWITHDEBINFO_DIR="${PARSER_SOURCE_DIR}/build/RelWithDebInfo"

DUCKDB_SOURCE_DIR="${ROOT_DIR}/libs/duckdbx"
DUCKDB_DEBUG_DIR="${DUCKDB_SOURCE_DIR}/build/Debug"
DUCKDB_RELEASE_DIR="${DUCKDB_SOURCE_DIR}/build/Release"
DUCKDB_RELWITHDEBINFO_DIR="${DUCKDB_SOURCE_DIR}/build/RelWithDebInfo"

CI_IMAGE_NAMESPACE="dashql"
CI_IMAGE_NAME="ci"
CI_IMAGE_TAG="$(shell cat ./actions/image/TAG)"
CI_IMAGE_FULLY_QUALIFIED="${CI_IMAGE_NAMESPACE}/${CI_IMAGE_NAME}:${CI_IMAGE_TAG}"
CACHE_DIRS=${ROOT_DIR}/.ccache/ ${ROOT_DIR}/.emscripten_cache/
IN_IMAGE_MOUNTS=-v${ROOT_DIR}:${ROOT_DIR}:delegated -v${ROOT_DIR}/.emscripten_cache/:/mnt/emscripten_cache/:delegated -v${ROOT_DIR}/.ccache/:/mnt/ccache/:delegated
IN_IMAGE_ENV=-e CCACHE_DIR=/mnt/ccache -e CCACHE_BASEDIR=${ROOT_DIR}/lib/ -e EM_CACHE=/mnt/emscripten_cache/
EXEC_ENVIRONMENT?=docker run -it --rm ${IN_IMAGE_MOUNTS} ${IN_IMAGE_ENV} "${CI_IMAGE_FULLY_QUALIFIED}"

CORES=$(shell grep -c ^processor /proc/cpuinfo 2>/dev/null || sysctl -n hw.ncpu)

# ---------------------------------------------------------------------------
# Tests

.PHONY: tests
tests:
	DASHQL_TEST_DATA=~/Repositories/duckdb-wasm/data/ cargo test --features native

# ---------------------------------------------------------------------------
# Flatbuffers

# Compile the flatbuffer schema
.PHONY: proto
proto:
	${EXEC_ENVIRONMENT} ${ROOT_DIR}/scripts/generate_proto.sh
	yarn workspace @dashql/proto build

# ---------------------------------------------------------------------------
# C++

.PHONY: duckdb
duckdb:
	mkdir -p ${DUCKDB_DEBUG_DIR}
	cmake -S ${DUCKDB_SOURCE_DIR} -B ${DUCKDB_DEBUG_DIR} \
		-GNinja \
		-DCMAKE_BUILD_TYPE=Debug \
		-DCMAKE_EXPORT_COMPILE_COMMANDS=1
	ln -sf ${DUCKDB_DEBUG_DIR}/compile_commands.json ${DUCKDB_SOURCE_DIR}/compile_commands.json
	cmake --build ${DUCKDB_DEBUG_DIR}

.PHONY: parser
parser:
	mkdir -p ${PARSER_DEBUG_DIR}
	cmake -S ${PARSER_SOURCE_DIR} -B ${PARSER_DEBUG_DIR} \
		-GNinja \
		-DCMAKE_BUILD_TYPE=Debug \
		-DCMAKE_EXPORT_COMPILE_COMMANDS=1
	ln -sf ${PARSER_DEBUG_DIR}/compile_commands.json ${PARSER_SOURCE_DIR}/compile_commands.json
	cmake --build ${PARSER_DEBUG_DIR}

# ---------------------------------------------------------------------------
# PWA

.PHONY: pwa
pwa:
	yarn workspace @dashql/dashql-app pwa:build:dev

.PHONY: pwa_start
pwa_start:
	yarn workspace @dashql/dashql-app pwa:start

# ---------------------------------------------------------------------------
# Utils

# Format all source files
.PHONY: format
format:
	${ROOT_DIR}/scripts/format

# Check formatting
.PHONY: check_format
check_format:
	${ROOT_DIR}/scripts/format check

# C++ formatting
.PHONY: clang_format
clang_format:
	python3 ./scripts/run_clang_format.py \
	--exclude ./lib/build \
	--exclude ./lib/third_party \
	-r ./lib/

# JS formatting
.PHONY: eslint
eslint:
	yarn workspace @dashql/core run lint
	yarn workspace @dashql/benchmarks run lint
	yarn workspace @dashql/core run lint

# Generate the compile commands for the language server
.PHONY: compile_commands
compile_commands: 
	mkdir -p ${PARSER_DEBUG_DIR}
	mkdir -p ${DUCKDB_DEBUG_DIR}
	cmake -S ${DUCKDB_SOURCE_DIR} -B ${DUCKDB_DEBUG_DIR} \
		-GNinja \
		-DCMAKE_BUILD_TYPE=Debug \
		-DCMAKE_EXPORT_COMPILE_COMMANDS=1
	cmake -S ${PARSER_SOURCE_DIR} -B ${PARSER_DEBUG_DIR} \
		-GNinja \
		-DCMAKE_BUILD_TYPE=Debug \
		-DCMAKE_EXPORT_COMPILE_COMMANDS=1
	ln -sf ${DUCKDB_DEBUG_DIR}/compile_commands.json ${DUCKDB_SOURCE_DIR}/compile_commands.json
	ln -sf ${PARSER_DEBUG_DIR}/compile_commands.json ${PARSER_SOURCE_DIR}/compile_commands.json

# Clean the repository
.PHONY: clean
clean:
	git clean -xfd
	git submodule foreach --recursive git clean -xfd
	git submodule update --init --recursive

# Build the docker dev image
.PHONY: docker_ci_image
docker_ci_image:
	tar -cvf - ./actions/image/Dockerfile | docker build \
		--platform linux/amd64 \
		-t ${CI_IMAGE_FULLY_QUALIFIED} \
		-f ./actions/image/Dockerfile \
		--build-arg UID=${UID} \
		--build-arg GID=${GID} \
		-

# Build infrastructure and packages required for development
.PHONY: bootstrap
bootstrap:
	git submodule update --init --recursive
	make docker_ci_image yarn_install
	make proto
	make wasm
	make core
