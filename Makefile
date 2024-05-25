ROOT_DIR:=$(shell dirname $(realpath $(firstword $(MAKEFILE_LIST))))

UID=${shell id -u}
GID=${shell id -g}

LIB_SOURCE_DIR="${ROOT_DIR}/packages/sqlynx-core"
LIB_DEBUG_DIR="${LIB_SOURCE_DIR}/build/native/o0"
LIB_RELWITHDEBINFO_DIR="${LIB_SOURCE_DIR}/build/native/o2"
LIB_RELEASE_DIR="${LIB_SOURCE_DIR}/build/native/o3"
LIB_COVERAGE_DIR="${LIB_SOURCE_DIR}/build/coverage"

CORES=$(shell grep -c ^processor /proc/cpuinfo 2>/dev/null || sysctl -n hw.ncpu)

LLVM_PROFDATA=llvm-profdata
LLVM_COV=llvm-cov
OS := $(shell uname)
ifeq ($(OS),Darwin)
	LLVM_PROFDATA=/opt/homebrew/opt/llvm/bin/llvm-profdata
	LLVM_COV=/opt/homebrew/opt/llvm/bin/llvm-cov
endif

# ---------------------------------------------------------------------------
# Parser

.PHONY: infra_linux
infra_linux:
	./scripts/install_infra.sh linux
	rustup target add x86_64-unknown-linux-gnu

.PHONY: infra_macos
infra_macos:
	./scripts/install_infra.sh macos
	rustup target add aarch64-apple-darwin
	rustup target add x86_64-apple-darwin

.PHONY: flatbuf
flatbuf:
	./scripts/generate_flatbuf.sh

.PHONY: protobuf
protobuf:
	./node_modules/.bin/buf generate && yarn workspace @ankoh/sqlynx-pb build

.PHONY: core_native_o0
core_native_o0:
	mkdir -p ${LIB_DEBUG_DIR}
	cmake -S ${LIB_SOURCE_DIR} -B ${LIB_DEBUG_DIR} \
		-DCMAKE_BUILD_TYPE=Debug \
		-DCMAKE_EXPORT_COMPILE_COMMANDS=1
	ln -sf ${LIB_DEBUG_DIR}/compile_commands.json ${LIB_SOURCE_DIR}/compile_commands.json
	cmake --build ${LIB_DEBUG_DIR} --parallel ${CORES}

.PHONY: core_native_o0_cov
core_native_o0_cov:
	mkdir -p ${LIB_DEBUG_DIR}
	cmake -S ${LIB_SOURCE_DIR} -B ${LIB_DEBUG_DIR} \
		-DCODE_COVERAGE=1 \
		-DCMAKE_BUILD_TYPE=Debug \
		-DCMAKE_EXPORT_COMPILE_COMMANDS=1
	ln -sf ${LIB_DEBUG_DIR}/compile_commands.json ${LIB_SOURCE_DIR}/compile_commands.json
	cmake --build ${LIB_DEBUG_DIR} --parallel ${CORES}

.PHONY: core_native_o2
core_native_o2:
	mkdir -p ${LIB_RELWITHDEBINFO_DIR}
	cmake -S ${LIB_SOURCE_DIR} -B ${LIB_RELWITHDEBINFO_DIR} -DCMAKE_BUILD_TYPE=RelWithDebInfo
	cmake --build ${LIB_RELWITHDEBINFO_DIR} --parallel ${CORES}

.PHONY: core_native_o3
core_native_o3:
	mkdir -p ${LIB_RELEASE_DIR}
	cmake -S ${LIB_SOURCE_DIR} -B ${LIB_RELEASE_DIR} -DCMAKE_BUILD_TYPE=Release
	cmake --build ${LIB_RELEASE_DIR} --parallel ${CORES}

.PHONY: core_native_tests
core_native_tests:
	${LIB_DEBUG_DIR}/tester --source_dir . --gtest_filter="-*Rope*"

.PHONY: core_native_tests_slow
core_native_tests_slow:
	${LIB_DEBUG_DIR}/tester --source_dir .

.PHONY: core_native_coverage
core_native_coverage:
	${LLVM_PROFDATA} merge -output=default.prof -instr default.profraw
	${LLVM_COV} show \
		--instr-profile default.prof \
		--format html \
		--ignore-filename-regex='.*/build/native/Debug/.*' \
		--ignore-filename-regex='.*/utf8proc/.*' \
		--ignore-filename-regex='.*/proto/proto_generated.h' \
		--ignore-filename-regex='.*/.*\.list' \
		-o ${LIB_COVERAGE_DIR} \
		${LIB_DEBUG_DIR}/tester

.PHONY: benchmark_pipeline
benchmark_pipeline:
	${LIB_RELWITHDEBINFO_DIR}/benchmark_pipeline

.PHONY: benchmark_layout
benchmark_layout:
	${LIB_RELWITHDEBINFO_DIR}/benchmark_layout

.PHONY: core_wasm_o0
core_wasm_o0:
	./scripts/build_parser_wasm.sh o0

.PHONY: core_wasm_o2
core_wasm_o2:
	./scripts/build_parser_wasm.sh o2

.PHONY: core_wasm_o3
core_wasm_o3:
	./scripts/build_parser_wasm.sh o3

.PHONY: core_js_o0
core_js_o0:
	yarn workspace @ankoh/sqlynx-core build:o0

.PHONY: core_js_o2
core_js_o2:
	yarn workspace @ankoh/sqlynx-core build:o2

.PHONY: core_js_o3
core_js_o3:
	yarn workspace @ankoh/sqlynx-core build:o3

.PHONY: core_js_tests
core_js_tests:
	yarn workspace @ankoh/sqlynx-core test

.PHONY: core_js_debug
core_js_tests_debug:
	yarn workspace @ankoh/sqlynx-core test:debug

.PHONY: pwa_pages
pwa_pages:
	yarn workspace @ankoh/sqlynx-app build:pages

.PHONY: pwa_reloc
pwa_reloc:
	yarn workspace @ankoh/sqlynx-app build:reloc

.PHONY: pwa_dev
pwa_dev:
	yarn workspace @ankoh/sqlynx-app serve:dev

.PHONY: pwa_tests
pwa_tests:
	yarn workspace @ankoh/sqlynx-app test

.PHONY: lint
lint:
	DEBUG=eslint:cli-engine yarn run eslint

.PHONY: native_mac_dev
native_mac_dev:
	yarn run tauri dev

.PHONY: native_mac_o0
native_mac_o0:
	yarn run tauri build --ci --bundles dmg --debug --verbose

.PHONY: native_mac
native_mac_universal:
	yarn run tauri build --ci --target universal-apple-darwin --bundles dmg

.PHONY: native_mac_updates
native_mac_updates:
	yarn run tauri build --ci --bundles updater,app

.PHONY: native_tests
native_tests:
	cargo test

.PHONY: svg_symbols
svg_symbols:
	python3 ./scripts/generate_svg_symbols.py

.PHONY: snapshots
snapshots:
	${LIB_DEBUG_DIR}/snapshotter --source_dir .
