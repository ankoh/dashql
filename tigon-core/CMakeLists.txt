# ---------------------------------------------------------------------------
# Tigon
# (c) 2019 Andre Kohn
# ---------------------------------------------------------------------------

project(tigon)
cmake_minimum_required(VERSION 3.10)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_FLAGS -std=c++17)
set(CMAKE_CXX_FLAGS_DEBUG "${CMAKE_CXX_FLAGS_DEBUG} -fsanitize=address")

# ---------------------------------------------------------------------------
# Homebrew (only relevant on macOS)

find_program(BREW_BIN brew)

# ---------------------------------------------------------------------------
# Emscripten module path

# Otherwise TestBigEndian fails in Snappy and Brotli builds.
# https://github.com/emscripten-core/emscripten/issues/400
if(DEFINED ENV{EMSDK})
    set(EMSDK $ENV{EMSDK})
    message(STATUS "EMSDK: ${EMSDK}/fastcomp/emscripten")
    set(CMAKE_MODULE_PATH "${CMAKE_MODULE_PATH};${EMSDK}/fastcomp/emscripten/cmake/Modules")
endif()

# ---------------------------------------------------------------------------
# Bison

find_package(BISON 2.5.1)
find_package(Flex REQUIRED)

# In the case where we cannot find a system-wide installation, look for
# homebrew and ask for its bison installation.
if(NOT BISON_FOUND)
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
# Include cmake

# Include cmake lists
include("${CMAKE_SOURCE_DIR}/cmake/clang-tidy.cmake")
include("${CMAKE_SOURCE_DIR}/third_party/duckdb.cmake")
include("${CMAKE_SOURCE_DIR}/third_party/flatbuffers.cmake")
include("${CMAKE_SOURCE_DIR}/third_party/googletest.cmake")
include("${CMAKE_SOURCE_DIR}/third_party/snappy.cmake")
include("${CMAKE_SOURCE_DIR}/third_party/brotli.cmake")
include("${CMAKE_SOURCE_DIR}/third_party/boost.cmake")
include("${CMAKE_SOURCE_DIR}/third_party/thrift.cmake")
include("${CMAKE_SOURCE_DIR}/third_party/arrow.cmake")

# ---------------------------------------------------------------------------
# Headers

# Include directories
include_directories(
    "${FLATBUFFERS_INCLUDE_DIR}"
    "${CMAKE_SOURCE_DIR}/include"
)

# Inlude parser
include("${CMAKE_SOURCE_DIR}/src/parser/tql/local.cmake")

# ---------------------------------------------------------------------------
# Web API

# Web API
add_executable(tigon_web
    ${CMAKE_SOURCE_DIR}/src/tools/web_api/web_api.cc
)
set_property(TARGET tigon_web PROPERTY CXX_STANDARD 17)

# Link libraries
target_link_libraries(tigon_web
    tql
    arrow parquet
    duckdb re2 miniz pg_query hyperloglog
)

# Define emscripten export
if(DEFINED ENV{EMSDK})
    set_target_properties(tigon_web PROPERTIES LINK_FLAGS "\
        -s MODULARIZE=1 \
        -s EXPORT_NAME=TigonWeb \
        -s EXPORTED_FUNCTIONS='[\
            _main, \
            _tigon_get_buffer, \
            _tigon_get_buffer_size, \
            _tigon_release_buffer, \
            _tigon_run_query \
        ]' \
        -s EXTRA_EXPORTED_RUNTIME_METHODS='[\"ccall\", \"cwrap\"]' \
    ")
endif()

# ---------------------------------------------------------------------------
# Tester

add_executable(tester
    ${CMAKE_SOURCE_DIR}/test/tester.cc
    ${CMAKE_SOURCE_DIR}/test/parser/tql/tql_parser_test.cc
)
target_link_libraries(tester
    tql
    gtest gmock
    arrow parquet
    duckdb re2 miniz pg_query hyperloglog
)

enable_testing()
add_test(tigon tester)

