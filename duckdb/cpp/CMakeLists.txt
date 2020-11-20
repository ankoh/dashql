# Copyright (c) 2020 The DashQL Authors

# ---------------------------------------------------------------------------
# DuckDB sources

find_package(Python3 COMPONENTS Interpreter REQUIRED)

set(DUCKDB_SOURCE_DIR "${CMAKE_SOURCE_DIR}/../../submodules/duckdb")
ExternalProject_Add(
    duckdb_ep
    SOURCE_DIR "${DUCKDB_SOURCE_DIR}"
    PREFIX "${CMAKE_BINARY_DIR}/third_party/duckdb"
    DOWNLOAD_COMMAND ""
    UPDATE_COMMAND ""
    BUILD_COMMAND ""
    INSTALL_COMMAND ""
)

ExternalProject_Get_Property(duckdb_ep SOURCE_DIR)
set(DUCKDB_INCLUDE_DIR "${SOURCE_DIR}/src/include")
set(DUCKDB_INCLUDE_DIR "${DUCKDB_INCLUDE_DIR}" PARENT_SCOPE)
set(DUCKDB_AMALGAMATION "${DUCKDB_SOURCE_DIR}/src/amalgamation/duckdb.cpp")

add_custom_command(OUTPUT ${DUCKDB_AMALGAMATION}
    COMMAND ${Python3_EXECUTABLE} "${DUCKDB_SOURCE_DIR}/scripts/amalgamation.py"
    WORKING_DIRECTORY "${DUCKDB_SOURCE_DIR}"
)

# ---------------------------------------------------------------------------
# Headers

include_directories(
    "${CMAKE_CURRENT_SOURCE_DIR}/include"
    "${CMAKE_CURRENT_SOURCE_DIR}/../../core/cpp/include"
    "${DUCKDB_INCLUDE_DIR}"
)

# ---------------------------------------------------------------------------
# Library

add_library(duckdb_webdb
    ${DUCKDB_SOURCE_FILE}
    ${CMAKE_CURRENT_SOURCE_DIR}/../../submodules/duckdb/src/amalgamation/duckdb.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/src/webdb.cc
    ${CMAKE_CURRENT_SOURCE_DIR}/src/codec.cc
    ${CMAKE_CURRENT_SOURCE_DIR}/src/iterator.cc
    ${CMAKE_CURRENT_SOURCE_DIR}/src/json.cc
    ${CMAKE_CURRENT_SOURCE_DIR}/src/tablegen.cc
)

target_link_libraries(duckdb_webdb
    flatbuffers spdlog Threads::Threads
)

# ---------------------------------------------------------------------------
# FFI

set(DUCKDB_WEB_FFI " \
    _duckdb_web_connect, \
    _duckdb_web_disconnect, \
    _duckdb_web_register_buffer, \
    _duckdb_web_release_buffer, \
    _duckdb_web_run_query, \
    _duckdb_web_send_query, \
    _duckdb_web_fetch_query_results, \
    _duckdb_web_analyze_query \
")
set(DUCKDB_WEB_FFI "${DUCKDB_WEB_FFI}" PARENT_SCOPE)

add_library(duckdb_ffi ${CMAKE_CURRENT_SOURCE_DIR}/src/webdb_ffi.cc)
target_link_libraries(duckdb_ffi duckdb_webdb flatbuffers spdlog Threads::Threads)

if (EMSCRIPTEN)
    set(EM_LINKER_FLAGS " \
        -Wl,--shared-memory,--no-check-features \
        -s USE_PTHREADS=1 \
        -s DISABLE_EXCEPTION_CATCHING=0 \
        -s MODULARIZE=1 \
        -s EXPORT_NAME='DuckDB' \
        -s EXPORTED_FUNCTIONS='[ \
            _main, \
            _malloc, \
            _free, \
            ${DUCKDB_WEB_FFI} \
        ]' \
        -s EXTRA_EXPORTED_RUNTIME_METHODS='[\"ccall\",\"allocate\",\"ALLOC_STACK\", \"ALLOC_NORMAL\"]' \
        "
    )

    add_executable(duckdb_web ${CMAKE_CURRENT_SOURCE_DIR}/src/webdb_ffi.cc)
    target_compile_definitions(duckdb_web PUBLIC WITH_WEBDB_MAIN)
    target_link_libraries(duckdb_web duckdb_webdb flatbuffers spdlog Threads::Threads)
    set_target_properties(duckdb_web PROPERTIES LINK_FLAGS "${EM_LINKER_FLAGS} -s ENVIRONMENT='web,worker'")

    add_executable(duckdb_node ${CMAKE_CURRENT_SOURCE_DIR}/src/webdb_ffi.cc)
    target_compile_definitions(duckdb_node PUBLIC WITH_WEBDB_MAIN)
    target_link_libraries(duckdb_node duckdb_webdb flatbuffers spdlog Threads::Threads)
    set_target_properties(duckdb_node PROPERTIES LINK_FLAGS "${EM_LINKER_FLAGS} -s ENVIRONMENT='node'")
endif()

# ---------------------------------------------------------------------------
# Tester

if(NOT EMSCRIPTEN)

    add_executable(duckdb_tester
        ${CMAKE_CURRENT_SOURCE_DIR}/test/tester.cc
        ${CMAKE_CURRENT_SOURCE_DIR}/test/duckdb_test.cc
        ${CMAKE_CURRENT_SOURCE_DIR}/test/iterator_test.cc
        ${CMAKE_CURRENT_SOURCE_DIR}/test/webdb_test.cc
    )
    target_link_libraries(duckdb_tester
        duckdb_webdb
        flatbuffers gtest gmock Threads::Threads)

endif()

# ---------------------------------------------------------------------------
# Benchmarks

if(NOT EMSCRIPTEN)

    add_executable(bm_result_codec
        ${CMAKE_CURRENT_SOURCE_DIR}/bench/bm_result_codec.cc
    )
    target_link_libraries(bm_result_codec
        duckdb_webdb
        benchmark
        flatbuffers gtest gmock Threads::Threads)

endif()
