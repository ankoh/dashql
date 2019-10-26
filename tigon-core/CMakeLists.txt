# ---------------------------------------------------------------------------
# Tigon
# (c) 2019 Andre Kohn
# ---------------------------------------------------------------------------

project("Tigon")
cmake_minimum_required(VERSION 3.10)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_FLAGS -std=c++17)
set(CMAKE_CXX_FLAGS_DEBUG "${CMAKE_CXX_FLAGS_DEBUG} -fsanitize=address")

# ---------------------------------------------------------------------------
# Emscripten module path

# Set module path.
# Otherwise TestBigEndian fails in Snappy and Brotli builds.
# https://github.com/emscripten-core/emscripten/issues/400
if(DEFINED ENV{EMSDK})
    set(EMSDK $ENV{EMSDK})
    message(STATUS "EMSDK: ${EMSDK}/fastcomp/emscripten")
    set(CMAKE_MODULE_PATH "${CMAKE_MODULE_PATH};${EMSDK}/fastcomp/emscripten/cmake/Modules")
endif()

# ---------------------------------------------------------------------------
# Bison

find_package(BISON 3.3 REQUIRED)
find_package(FLEX REQUIRED)
find_package(Threads REQUIRED)

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
include("${CMAKE_SOURCE_DIR}/third_party/duckdb.cmake")
include("${CMAKE_SOURCE_DIR}/third_party/flatbuffers.cmake")
include("${CMAKE_SOURCE_DIR}/third_party/googletest.cmake")
include("${CMAKE_SOURCE_DIR}/third_party/rapidjson.cmake")
include("${CMAKE_SOURCE_DIR}/third_party/cwcsv.cmake")
include("${CMAKE_SOURCE_DIR}/third_party/spdlog.cmake")


# ---------------------------------------------------------------------------
# Proto project

add_subdirectory(
    "${CMAKE_SOURCE_DIR}/../tigon-proto/lib/cpp"
    "${CMAKE_BINARY_DIR}/proto"
)

# ---------------------------------------------------------------------------
# Headers

include_directories(
    "${FLATBUFFERS_INCLUDE_DIR}"
    "${CMAKE_SOURCE_DIR}/include"
)

# ---------------------------------------------------------------------------
# Libraries

add_library(tigon
    ${CMAKE_SOURCE_DIR}/src/extract/csv_extract.cc
    ${CMAKE_SOURCE_DIR}/src/extract/json_extract.cc
    ${CMAKE_SOURCE_DIR}/src/parser/sql/sql_parser.cc
    ${CMAKE_SOURCE_DIR}/src/tools/web/web_api.cc
)

include("${CMAKE_SOURCE_DIR}/src/parser/rpath/local.cmake")
include("${CMAKE_SOURCE_DIR}/src/parser/tql/local.cmake")

target_link_libraries(tigon
    tigon_proto
    tigon_rpath
    tigon_tql
    duckdb
    rapidjson cwcsv spdlog
    Threads::Threads
)

# ---------------------------------------------------------------------------
# Web API

add_executable(tigon_web
    ${CMAKE_SOURCE_DIR}/src/tools/web/web_api_proxy.cc
)

target_link_libraries(tigon_web tigon)

if(DEFINED ENV{EMSDK})
    set_target_properties(tigon_web PROPERTIES LINK_FLAGS "\
        -s MODULARIZE=1 \
        -s EXPORT_NAME=TigonCore \
        -s EXPORTED_FUNCTIONS='[\
            _main, \
            _tigon_create_session, \
            _tigon_end_session, \
            _tigon_get_buffer_data, \
            _tigon_get_buffer_size, \
            _tigon_release_buffer, \
            _tigon_get_response_buffer, \
            _tigon_get_response_error_message, \
            _tigon_get_response_status, \
            _tigon_parse_tql, \
            _tigon_run_query, \
            _tigon_plan_query \
        ]' \
        -s EXTRA_EXPORTED_RUNTIME_METHODS='[\"ccall\", \"cwrap\"]' \
    ")
endif()

# ---------------------------------------------------------------------------
# Tester

add_executable(tester
    ${CMAKE_SOURCE_DIR}/test/tester.cc
    ${CMAKE_SOURCE_DIR}/test/web_api_test.cc
    ${CMAKE_SOURCE_DIR}/test/examples/hw2/hw2_test.cc
    ${CMAKE_SOURCE_DIR}/test/parser/tql/tql_parser_test.cc
)
target_link_libraries(tester tigon gtest gmock Threads::Threads)

enable_testing()
add_test(tigon tester)

