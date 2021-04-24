# Copyright (c) 2020 The DashQL Authors

.DEFAULT_GOAL := core

# ---------------------------------------------------------------------------
# Config

ROOT_DIR:=$(shell dirname $(realpath $(firstword $(MAKEFILE_LIST))))

UID=${shell id -u}
GID=${shell id -g}

APP_RELEASE_DIR="${ROOT_DIR}/packages/app/build/release"
APP_RELEASE_TAG="$(shell git rev-parse --short HEAD)"
APP_DEPLOY_TMP="${ROOT_DIR}/artifacts/tmp"

LIB_SOURCE_DIR="${ROOT_DIR}/lib"
LIB_DEBUG_DIR="${ROOT_DIR}/lib/build/Debug"
LIB_RELEASE_DIR="${ROOT_DIR}/lib/build/Release"
LIB_RELWITHDEBINFO_DIR="${ROOT_DIR}/lib/build/RelWithDebInfo"
CORE_WASM_DIR="${ROOT_DIR}/packages/core/src/wasm"
DUCKDB_WASM_DIR="${ROOT_DIR}/packages/duckdb/src/wasm"
DATAFRAME_WASM_DIR="${ROOT_DIR}/packages/dataframe/src/wasm"

CI_IMAGE_NAMESPACE="dashql"
CI_IMAGE_NAME="ci"
CI_IMAGE_TAG="$(shell cat ./actions/image/TAG)"
CI_IMAGE_FULLY_QUALIFIED="${CI_IMAGE_NAMESPACE}/${CI_IMAGE_NAME}:${CI_IMAGE_TAG}"
CACHE_DIRS=${ROOT_DIR}/.ccache/ ${ROOT_DIR}/.emscripten_cache/
IN_IMAGE_MOUNTS=-v${ROOT_DIR}:${ROOT_DIR} -v${ROOT_DIR}/.emscripten_cache/:/mnt/emscripten_cache/ -v${ROOT_DIR}/.ccache/:/mnt/ccache/
IN_IMAGE_ENV=-e CCACHE_DIR=/mnt/ccache -e CCACHE_BASEDIR=${ROOT_DIR}/lib/ -e EM_CACHE=/mnt/emscripten_cache/
EXEC_ENVIRONMENT?=docker run -it --rm ${IN_IMAGE_MOUNTS} ${IN_IMAGE_ENV} "${CI_IMAGE_FULLY_QUALIFIED}"

CORES=$(shell grep -c ^processor /proc/cpuinfo 2>/dev/null || sysctl -n hw.ncpu)

# ---------------------------------------------------------------------------
# Formatting

# Format all source files
.PHONY: format
format:
	${ROOT_DIR}/scripts/format

.PHONY: check_format
check_format:
	${ROOT_DIR}/scripts/format check

# ---------------------------------------------------------------------------
# Building

# Compile the core in debug mode
.PHONY: lib
lib:
	mkdir -p ${LIB_DEBUG_DIR}
	cmake -S ${LIB_SOURCE_DIR} -B ${LIB_DEBUG_DIR} \
		-GNinja \
		-DCMAKE_BUILD_TYPE=Debug \
		-DCMAKE_EXPORT_COMPILE_COMMANDS=1
	ninja -C ${LIB_DEBUG_DIR}

# Compile the core in release mode
.PHONY: lib_relwithdebinfo
lib_relwithdebinfo:
	mkdir -p ${LIB_RELWITHDEBINFO_DIR}
	cmake -S ${LIB_SOURCE_DIR} -B ${LIB_RELWITHDEBINFO_DIR} \
		-GNinja \
		-DCMAKE_BUILD_TYPE=RelWithDebInfo
	ninja -C ${LIB_RELWITHDEBINFO_DIR}

# Compile the core in release mode
.PHONY: lib_release
lib_release:
	mkdir -p ${LIB_RELEASE_DIR}
	cmake -S ${LIB_SOURCE_DIR} -B ${LIB_RELEASE_DIR} \
		-GNinja \
		-DCMAKE_BUILD_TYPE=Release
	ninja -C ${LIB_RELEASE_DIR}

# Test the core library
.PHONY: lib_tests
lib_tests: lib
	${LIB_DEBUG_DIR}/tester --source_dir ${LIB_SOURCE_DIR}

# Debug the core library
.PHONY: lib_tests
lib_tests_lldb: lib
	lldb ${LIB_DEBUG_DIR}/tester -- --source_dir ${LIB_SOURCE_DIR}

# Test the core library
.PHONY: lib_tests_relwithdebinfo
lib_tests_relwithdebinfo: lib_relwithdebinfo
	${LIB_RELWITHDEBINFO_DIR}/tester --source_dir ${LIB_SOURCE_DIR}

# Test the core library
.PHONY: lib_tests_relwithdebinfo_lldb
lib_tests_relwithdebinfo_lldb: lib_relwithdebinfo
	lldb ${LIB_RELWITHDEBINFO_DIR}/tester -- --source_dir ${LIB_SOURCE_DIR}

# Generate declarative tests
.PHONY: lib_testgen
lib_testgen: lib
	${LIB_DEBUG_DIR}/testgen ${LIB_SOURCE_DIR}

# Generate declarative tests
.PHONY: lib_testgen_gdb
lib_testgen_gdb: lib
	gdb --args ${LIB_DEBUG_DIR}/testgen ${LIB_SOURCE_DIR}

# Debug the library
.PHONY: lib_debug
lib_debug: lib
	lldb --args ${LIB_DEBUG_DIR}/tester ${LIB_SOURCE_DIR}

# Build the dashql_core javascript library
.PHONY: core
core:
	yarn workspace @dashql/core build

# Build the dashql_core javascript library
.PHONY: core_watch
core_watch:
	yarn workspace @dashql/core build:watch

# Test the dashql_core javascript library
.PHONY: core_tests
core_tests: core
	yarn workspace @dashql/core test

# Build the benchmarks
.PHONY: bench
bench:
	yarn workspace @dashql/bench build

# Compile the flatbuffer schema
.PHONY: proto
proto:
	${EXEC_ENVIRONMENT} ${ROOT_DIR}/scripts/generate_proto.sh
	yarn workspace @dashql/proto build

# Build the wasm module with debug info
.PHONY: wasm
wasm:
	mkdir -p ${CACHE_DIRS}
	${EXEC_ENVIRONMENT} ${ROOT_DIR}/scripts/wasm_build_lib.sh Fast

# Build the wasm modules with all debug info
.PHONY: wasm_debug
wasm_debug:
	mkdir -p ${CACHE_DIRS}
	${EXEC_ENVIRONMENT} ${ROOT_DIR}/scripts/wasm_build_lib.sh Debug

# Build the wasm modules
.PHONY: wasm_release
wasm_release:
	mkdir -p ${CACHE_DIRS}
	${EXEC_ENVIRONMENT} ${ROOT_DIR}/scripts/wasm_build_lib.sh Release

# Builds the app
.PHONY: app
app:
	yarn workspace @dashql/app build:debug

# Creates a release archive
.PHONY: app_release
app_release:
	yarn workspace @dashql/app build:release

# Runs a node server with the release build
.PHONY: app_release_server
app_release_server:
	yarn workspace @dashql/app serve:release

# Starts the dev server
.PHONY: app_start
app_start:
	yarn workspace @dashql/app start

# Build the duckdb library
.PHONY: duckdb
duckdb:
	yarn workspace @dashql/duckdb build

# Build the duckdb docs
.PHONY: duckdb_docs
duckdb_docs:
	yarn workspace @dashql/duckdb docs

# Run the duckdb javascript tests
.PHONY: duckdb_tests
duckdb_tests: duckdb
	yarn workspace @dashql/duckdb test

# Run the duckdb javascript tests in browser
.PHONY: duckdb_tests_browser
duckdb_tests_browser: duckdb
	yarn workspace @dashql/duckdb test:browser

# Run the duckdb javascript tests in browser
.PHONY: duckdb_tests_browser
duckdb_tests_debug: duckdb
	yarn workspace @dashql/duckdb test:browser:dbg

# Run the duckdb javascript tests on nodejs
.PHONY: duckdb_tests_node
duckdb_tests_node: duckdb
	yarn workspace @dashql/duckdb test:node

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
	yarn workspace @dashql/duckdb run lint
	yarn workspace @dashql/core run lint
	yarn workspace @dashql/bench run lint
	yarn workspace @dashql/app run lint

# Install all yarn packages
.PHONY: yarn_install
yarn_install:
	yarn

# ---------------------------------------------------------------------------
# Environment

# Generate the compile commands for the language server
.PHONY: compile_commands
compile_commands: 
	mkdir -p ${LIB_DEBUG_DIR}
	cmake -S ${LIB_SOURCE_DIR} -B ${LIB_DEBUG_DIR} \
		-GNinja \
		-DCMAKE_BUILD_TYPE=Debug \
		-DCMAKE_EXPORT_COMPILE_COMMANDS=1
	ln -sf ${LIB_DEBUG_DIR}/compile_commands.json ${LIB_SOURCE_DIR}/compile_commands.json

# Reset the duckdb repo
.PHONY: reset_duckdb
reset_duckdb:
	rm -rf ${ROOT_DIR}/submodules/duckdb/src/amalgamation/*
	rm -rf ${ROOT_DIR}/submodules/duckdb/build/*

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
	make duckdb
	make core

# Run all js tests
.PHONY: jstests
jstests:
	make proto
	make duckdb_tests
	make core_tests

# ---------------------------------------------------------------------------
# Data

# Package the uni schema data
UNI_SCHEMA_DIR="${ROOT_DIR}/data/uni"
UNI_SCHEMA_OUT="${UNI_SCHEMA_DIR}/out"
UNI_SCHEMA_PKG="${UNI_SCHEMA_DIR}/target/release/pkg_uni"
.PHONY: pkg_uni_schema
pkg_uni:
	cargo +nightly build --manifest-path="${UNI_SCHEMA_DIR}/Cargo.toml" --release
	mkdir -p ${UNI_SCHEMA_OUT}
	${UNI_SCHEMA_PKG} ${UNI_SCHEMA_OUT}
	cd ${UNI_SCHEMA_OUT} && rm -f ./all.zip && zip ./all.zip ./*.parquet
