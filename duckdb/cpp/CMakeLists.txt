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
set(DUCKDB_AMALGAMATION "${DUCKDB_SOURCE_DIR}/src/amalgamation/duckdb.cpp")

add_custom_command(OUTPUT ${DUCKDB_AMALGAMATION}
    COMMAND ${Python3_EXECUTABLE} "${DUCKDB_SOURCE_DIR}/scripts/amalgamation.py"
    WORKING_DIRECTORY "${DUCKDB_SOURCE_DIR}"
)

# ---------------------------------------------------------------------------
# Headers

include_directories(
    "${CMAKE_CURRENT_SOURCE_DIR}/include"
    "${DUCKDB_INCLUDE_DIR}"
)

# ---------------------------------------------------------------------------
# Library

add_library(duckdb_webapi
    ${DUCKDB_SOURCE_FILE}
    ${CMAKE_CURRENT_SOURCE_DIR}/../../submodules/duckdb/src/amalgamation/duckdb.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/src/webapi.cc
    ${CMAKE_CURRENT_SOURCE_DIR}/src/codec.cc
    ${CMAKE_CURRENT_SOURCE_DIR}/src/iterator.cc
    ${CMAKE_CURRENT_SOURCE_DIR}/src/json.cc
    ${CMAKE_CURRENT_SOURCE_DIR}/src/tablegen.cc
)

target_link_libraries(duckdb_webapi
    flatbuffers spdlog Threads::Threads
)

# ---------------------------------------------------------------------------
# API Proxy

if (EMSCRIPTEN)
    add_executable(duckdb_web ${CMAKE_CURRENT_SOURCE_DIR}/src/webapi_ffi.cc)
    target_link_libraries(duckdb_web duckdb_webapi flatbuffers spdlog Threads::Threads)
    set_target_properties(duckdb_web PROPERTIES LINK_FLAGS "${EM_LINKER_FLAGS} -s ENVIRONMENT='web,worker'")

    add_executable(duckdb_node ${CMAKE_CURRENT_SOURCE_DIR}/src/webapi_ffi.cc)
    target_link_libraries(duckdb_node duckdb_webapi flatbuffers spdlog Threads::Threads)
    set_target_properties(duckdb_node PROPERTIES LINK_FLAGS "${EM_LINKER_FLAGS} -s ENVIRONMENT='node'")
else()

    add_library(duckdb_ffi ${CMAKE_CURRENT_SOURCE_DIR}/src/webapi_ffi.cc)
    target_link_libraries(duckdb_ffi duckdb_webapie flatbuffers spdlog Threads::Threads)
endif()

# ---------------------------------------------------------------------------
# Tester

if(NOT EMSCRIPTEN)

    add_executable(duckdb_tester
        ${CMAKE_CURRENT_SOURCE_DIR}/test/tester.cc
        ${CMAKE_CURRENT_SOURCE_DIR}/test/duckdb_test.cc
        ${CMAKE_CURRENT_SOURCE_DIR}/test/iterator_test.cc
        ${CMAKE_CURRENT_SOURCE_DIR}/test/webapi_test.cc
    )
    target_link_libraries(duckdb_tester
        duckdb_webapi
        flatbuffers gtest gmock Threads::Threads)

endif()

# ---------------------------------------------------------------------------
# Benchmarks

if(NOT EMSCRIPTEN)

    add_executable(bm_result_codec
        ${CMAKE_CURRENT_SOURCE_DIR}/bench/bm_result_codec.cc
    )
    target_link_libraries(bm_result_codec
        duckdb_webapi
        benchmark
        flatbuffers gtest gmock Threads::Threads)

endif()
