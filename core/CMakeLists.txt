# ---------------------------------------------------------------------------
# DashQL
# (c) 2019 Andre Kohn
# ---------------------------------------------------------------------------

# Use project versions
# cmake --help-policy CMP0048
if (POLICY CMP0048)
    cmake_policy(SET CMP0048 NEW)
endif (POLICY CMP0048)

# ---------------------------------------------------------------------------

project("DashQL" VERSION 0.1)
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
# Bison

find_package(BISON 3.3)
find_package(FLEX REQUIRED)

# In the case where we cannot find a system-wide installation, look for
# homebrew and ask for its bison installation.
if(NOT BISON_FOUND)
    find_program(BREW_BIN brew)
    if (BREW_BIN)
        execute_process(COMMAND ${BREW_BIN} --prefix bison
                        OUTPUT_VARIABLE BISON_PREFIX
                        OUTPUT_STRIP_TRAILING_WHITESPACE)
        set(BISON_EXECUTABLE "${BISON_PREFIX}/bin/bison")
        find_package(BISON 2.5.1)
    endif()
endif()
if (NOT BISON_FOUND)
    message(FATAL_ERROR "Could not find bison")
endif()

# ---------------------------------------------------------------------------
# CMake includes

include("${CMAKE_SOURCE_DIR}/cmake/clang-tidy.cmake")
include("${CMAKE_SOURCE_DIR}/cmake/cwcsv.cmake")
include("${CMAKE_SOURCE_DIR}/cmake/duckdb.cmake")
include("${CMAKE_SOURCE_DIR}/cmake/googletest.cmake")
include("${CMAKE_SOURCE_DIR}/cmake/protobuf.cmake")
include("${CMAKE_SOURCE_DIR}/cmake/rapidjson.cmake")
include("${CMAKE_SOURCE_DIR}/cmake/spdlog.cmake")


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
)

# ---------------------------------------------------------------------------
# Libraries

add_library(dashql
    ${DUCKDB_AMALGAMATION}
    ${CMAKE_SOURCE_DIR}/src/extract/csv_extract.cc
    ${CMAKE_SOURCE_DIR}/src/extract/json_extract.cc
    ${CMAKE_SOURCE_DIR}/src/parser/sql/sql_parser.cc
    ${CMAKE_SOURCE_DIR}/src/proto/duckdb_codec.cc
    ${CMAKE_SOURCE_DIR}/src/proto/tql_codec.cc
    ${CMAKE_SOURCE_DIR}/src/tools/web/web_api.cc
)

include("${CMAKE_SOURCE_DIR}/src/parser/rpath/local.cmake")
include("${CMAKE_SOURCE_DIR}/src/parser/tql/local.cmake")

target_link_libraries(dashql
    dashql_proto
    dashql_rpath
    dashql_tql
    duckdb
    protobuf rapidjson cwcsv
    spdlog
    Threads::Threads
)

if(EMSCRIPTEN)
    set_target_properties(dashql PROPERTIES
        COMPILE_FLAGS "\
            -s DISABLE_EXCEPTION_CATCHING=0 \
        "
    )
endif()

# ---------------------------------------------------------------------------
# Web API

add_executable(dashql_core
    ${CMAKE_SOURCE_DIR}/src/tools/web/web_api_proxy.cc
)

target_link_libraries(dashql_core dashql)

if(EMSCRIPTEN)
    # SAFE_HEAP breaks duckdb 0.2
    # -s SAFE_HEAP=1
    set_target_properties(dashql_core PROPERTIES
        COMPILE_FLAGS "\
            -s DISABLE_EXCEPTION_CATCHING=0 \
        "
        LINK_FLAGS "\
            -s ENVIRONMENT='web,worker' \
            -s USE_PTHREADS=1 \
            -s PTHREAD_POOL_SIZE=4 \
            -s TOTAL_MEMORY=2097088KB \
            -Wl,--shared-memory,--no-check-features \
            -s DISABLE_EXCEPTION_CATCHING=0 \
            -s MODULARIZE=1 \
            -s EXPORT_NAME='DashQLCore' \
            -s EXPORTED_FUNCTIONS='[ \
                _main, \
                _malloc, \
                _free, \
                _dashql_create_session, \
                _dashql_create_session, \
                _dashql_end_session, \
                _dashql_register_buffer, \
                _dashql_release_buffer, \
                _dashql_parse_tql, \
                _dashql_run_query, \
                _dashql_plan_query, \
                _dashql_extract_data, \
                _dashql_compute_grid_layout \
            ]' \
            -s EXTRA_EXPORTED_RUNTIME_METHODS='[\"FS\", \"ccall\",\"allocate\",\"ALLOC_STACK\", \"ALLOC_NORMAL\"]' \
        "
    )
endif()

# ---------------------------------------------------------------------------
# Tester

if(NOT EMSCRIPTEN)

    add_executable(tester
        ${CMAKE_SOURCE_DIR}/test/tester.cc
        ${CMAKE_SOURCE_DIR}/test/duckdb_test.cc
        ${CMAKE_SOURCE_DIR}/test/parser/tql/tql_parser_test.cc
    )
    target_link_libraries(tester dashql gtest gmock Threads::Threads)

    enable_testing()
    add_test(dashql tester)

endif()
