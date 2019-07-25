# ---------------------------------------------------------------------------
# Tigon
# (c) 2019 Andre Kohn
# ---------------------------------------------------------------------------

cmake_minimum_required(VERSION 3.10)

# Configure cmake
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# TestBigEndian fails in Snappy and Brotli builds.
# https://github.com/emscripten-core/emscripten/issues/400
if(DEFINED ENV{EMSDK})
    set(EMSDK $ENV{EMSDK})
    message(STATUS "EMSDK: ${EMSDK}/fastcomp/emscripten")
    set(CMAKE_MODULE_PATH "${CMAKE_MODULE_PATH};${EMSDK}/fastcomp/emscripten/cmake/Modules")
endif()

# Unfortunately, macOS (<= High Sierra) ships with a too old bison version.
# You need to manually install bison and flex via homebrew.
# (It's a good thing to have homebrew installed anyway)
# https://brew.sh/index_de.html
# - brew update
# - brew install bison flex
#
# As homebrew won't override the system's default bison, we need to tell
# cmake where it should look.
if (APPLE)
    list(APPEND CMAKE_PREFIX_PATH /usr/local/opt/bison)
    list(APPEND CMAKE_PREFIX_PATH /usr/local/opt/flex)
endif (APPLE)

# ---------------------------------------------------------------------------

# Include cmake lists
include("${CMAKE_SOURCE_DIR}/cmake/clang-tidy.cmake")
include("${CMAKE_SOURCE_DIR}/third_party/arrow.cmake")
include("${CMAKE_SOURCE_DIR}/third_party/duckdb.cmake")
include("${CMAKE_SOURCE_DIR}/third_party/flatbuffers.cmake")
include("${CMAKE_SOURCE_DIR}/third_party/googletest.cmake")
include("${CMAKE_SOURCE_DIR}/third_party/snappy.cmake")
include("${CMAKE_SOURCE_DIR}/third_party/brotli.cmake")

# Find packages
find_package(BISON REQUIRED)
find_package(FLEX REQUIRED)

# ---------------------------------------------------------------------------

# Include directories
include_directories(
    "${FLATBUFFERS_INCLUDE_DIR}"
    "${CMAKE_SOURCE_DIR}/include"
)

# Inlude parser
include("${CMAKE_SOURCE_DIR}/src/parser/tql/local.cmake")

# ---------------------------------------------------------------------------

# Web API
add_executable(tigon_web
    ${CMAKE_SOURCE_DIR}/src/tools/web_api/web_api.cc
)

# Link libraries
target_link_libraries(tigon_web
    tql
    snappy
    brotli_enc brotli_dec brotli_common
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

add_executable(tester
    ${CMAKE_SOURCE_DIR}/test/tester.cc
    ${CMAKE_SOURCE_DIR}/test/parser/tql/tql_parser_test.cc
)
target_link_libraries(tester
    tql
    gtest gmock
    duckdb re2 miniz pg_query hyperloglog
)

enable_testing()
add_test(tigon tester)

