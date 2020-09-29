# Copyright (c) 2020 The DashQL Authors

# Use project versions
# cmake --help-policy CMP0048
if (POLICY CMP0048)
    cmake_policy(SET CMP0048 NEW)
endif (POLICY CMP0048)

# ---------------------------------------------------------------------------

project(duckdbjs VERSION 0.1)
cmake_minimum_required(VERSION 3.10)

set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_FLAGS -std=c++17)
set(CMAKE_CXX_FLAGS_DEBUG "${CMAKE_CXX_FLAGS_DEBUG} -fsanitize=address")

# ---------------------------------------------------------------------------
# Parallelism

include(ProcessorCount)
ProcessorCount(NPROCS)
set(CMAKE_BUILD_PARALLEL_LEVEL ${NPROCS})

# ---------------------------------------------------------------------------
# Threading

set(THREADS_PREFER_PTHREAD_FLAG ON)
find_package(Threads REQUIRED)
find_package(Python3 COMPONENTS Interpreter REQUIRED)

# ---------------------------------------------------------------------------
# CMake includes

include("${CMAKE_SOURCE_DIR}/cmake/clang-tidy.cmake")
include("${CMAKE_SOURCE_DIR}/cmake/duckdb.cmake")
include("${CMAKE_SOURCE_DIR}/cmake/flatbuffers.cmake")
include("${CMAKE_SOURCE_DIR}/cmake/spdlog.cmake")
include("${CMAKE_SOURCE_DIR}/cmake/googletest.cmake")

# ---------------------------------------------------------------------------
# Proto project

add_subdirectory(
    "${CMAKE_SOURCE_DIR}/../proto/lib/cpp"
    "${CMAKE_BINARY_DIR}/proto"
)

# ---------------------------------------------------------------------------
# Headers

include_directories(
    "${CMAKE_SOURCE_DIR}/include"
    "${DUCKDB_INCLUDE_DIR}"
)

# ---------------------------------------------------------------------------
# Library

add_library(duckdb_webapi_core
    ${DUCKDB_SOURCE_FILE}
    ${CMAKE_SOURCE_DIR}/../submodules/duckdb/src/amalgamation/duckdb.cpp
    ${CMAKE_SOURCE_DIR}/src/api.cc
    ${CMAKE_SOURCE_DIR}/src/proto/duckdb_codec.cc
    ${CMAKE_SOURCE_DIR}/src/proto/json_conversion.cc
)

target_link_libraries(duckdb_webapi_core
    duckdb_webapi_proto
    flatbuffers spdlog Threads::Threads
)

# ---------------------------------------------------------------------------
# API Proxy

add_executable(duckdb_webapi
    ${CMAKE_SOURCE_DIR}/src/api_proxy.cc
)

target_link_libraries(duckdb_webapi
    duckdb_webapi_core
    duckdb_webapi_proto
    flatbuffers spdlog Threads::Threads
)

if(EMSCRIPTEN)
    # SAFE_HEAP breaks duckdb 0.2
    # -s SAFE_HEAP=1
    set_target_properties(duckdb_webapi PROPERTIES
        LINK_FLAGS "\
            -s ENVIRONMENT='web,worker' \
            -s USE_PTHREADS=1 \
            -Wl,--shared-memory,--no-check-features \
            -s DISABLE_EXCEPTION_CATCHING=0 \
            -s MODULARIZE=1 \
            -s EXPORT_NAME='DuckDB' \
            -s EXPORTED_FUNCTIONS='[ \
                _main, \
                _malloc, \
                _free \
            ]' \
            -s EXTRA_EXPORTED_RUNTIME_METHODS='[\"ccall\",\"allocate\",\"ALLOC_STACK\", \"ALLOC_NORMAL\"]' \
        "
    )
endif()

# ---------------------------------------------------------------------------
# Tester

if(NOT EMSCRIPTEN)

    add_executable(tester
        ${CMAKE_SOURCE_DIR}/test/tester.cc
        ${CMAKE_SOURCE_DIR}/test/duckdb_test.cc
    )
    target_link_libraries(tester 
        duckdb_webapi_core
        duckdb_webapi_proto
        flatbuffers gtest gmock Threads::Threads)

    enable_testing()
    add_test(duckdbjs tester)

endif()

