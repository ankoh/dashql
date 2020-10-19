# Copyright (c) 2020 The DashQL Authors

# Use project versions
# cmake --help-policy CMP0048
if (POLICY CMP0048)
    cmake_policy(SET CMP0048 NEW)
endif (POLICY CMP0048)

# ---------------------------------------------------------------------------

project(dashql_parser VERSION 0.1)
cmake_minimum_required(VERSION 3.10)

set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_FLAGS -std=c++17)

if (WITH_ASAN)
    set(CMAKE_CXX_FLAGS_DEBUG "${CMAKE_CXX_FLAGS_DEBUG} -fsanitize=address")
endif ()

if (EMSCRIPTEN)
    add_compile_options(-s DISABLE_EXCEPTION_CATCHING=0 -fexceptions)
endif ()

# ---------------------------------------------------------------------------
# CMake includes

include("${CMAKE_SOURCE_DIR}/cmake/benchmark.cmake")
include("${CMAKE_SOURCE_DIR}/cmake/flatbuffers.cmake")
include("${CMAKE_SOURCE_DIR}/cmake/googletest.cmake")

# ---------------------------------------------------------------------------
# Parallelism

include(ProcessorCount)
ProcessorCount(NPROCS)
set(CMAKE_BUILD_PARALLEL_LEVEL ${NPROCS})

# ---------------------------------------------------------------------------
# Bison

set(REQUIRED_BISON_VERSION 3.3)
find_package(BISON ${REQUIRED_BISON_VERSION})
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
        find_package(BISON ${REQUIRED_BISON_VERSION})
    endif()
endif()
if (NOT BISON_FOUND)
    message(FATAL_ERROR "Could not find bison")
endif()

# ---------------------------------------------------------------------------
# Headers

include_directories(
    "${CMAKE_SOURCE_DIR}/include"
    "${CMAKE_BINARY_DIR}/include"
)

# ---------------------------------------------------------------------------
# Parser & Scanner

set(DASHQL_SCANNER_OUT ${CMAKE_BINARY_DIR}/include/dashql/parser/scanner.cc)
set(DASHQL_PARSER_OUT ${CMAKE_BINARY_DIR}/include/dashql/parser/parser.cc)
set(DASHQL_PARSER_HEADER_OUT ${CMAKE_BINARY_DIR}/include/dashql/parser/parser.h)

IF(NOT EXISTS ${CMAKE_BINARY_DIR}/include/dashql/parser/)
    file(MAKE_DIRECTORY ${CMAKE_BINARY_DIR}/include/dashql/parser/)
ENDIF()

# Generate parser & scanner
add_custom_command(
    OUTPUT ${DASHQL_SCANNER_OUT} ${DASHQL_PARSER_OUT} ${DASHQL_PARSER_HEADER_OUT}
    COMMAND ${BISON_EXECUTABLE}
        --defines=${DASHQL_PARSER_HEADER_OUT}
        --output=${DASHQL_PARSER_OUT}
        --report=state
        --report-file=${CMAKE_BINARY_DIR}/bison.log
        ${CMAKE_SOURCE_DIR}/src/parser.y
    COMMAND ${FLEX_EXECUTABLE}
        --outfile=${DASHQL_SCANNER_OUT}
        ${CMAKE_SOURCE_DIR}/src/scanner.l
    DEPENDS
        ${CMAKE_SOURCE_DIR}/src/parser.y
        ${CMAKE_SOURCE_DIR}/src/scanner.l
)

add_library(dashql_parser
    ${DASHQL_SCANNER_OUT}
    ${DASHQL_PARSER_OUT}
    ${CMAKE_SOURCE_DIR}/src/parse_context.cc
    ${CMAKE_SOURCE_DIR}/src/syntax.cc
    ${CMAKE_SOURCE_DIR}/src/codec.cc
)

target_link_libraries(dashql_parser
    flatbuffers
)

# ---------------------------------------------------------------------------
# Emscripten

if (EMSCRIPTEN)
    set(EM_LINKER_FLAGS " \
        -Wl,--shared-memory,--no-check-features \
        -s USE_PTHREADS=0 \
        -s DISABLE_EXCEPTION_CATCHING=0 \
        -s MODULARIZE=1 \
        -s EXPORT_NAME='DashQLParser' \
        -s EXPORTED_FUNCTIONS='[ \
            _main, \
            _malloc, \
            _free, \
            _dashql_parse,
        ]' \
        -s EXTRA_EXPORTED_RUNTIME_METHODS='[\"ccall\",\"allocate\",\"ALLOC_STACK\", \"ALLOC_NORMAL\"]' \
        "
    )

    add_executable(dashql_parser_web ${CMAKE_SOURCE_DIR}/src/ffi.cc)
    target_link_libraries(dashql_parser dashql_parser spdlog)
    set_target_properties(dashql_parser PROPERTIES LINK_FLAGS "${EM_LINKER_FLAGS} -s ENVIRONMENT='web,worker'")

    add_executable(dashql_parser_node ${CMAKE_SOURCE_DIR}/src/ffi.cc)
    target_link_libraries(dashql_parser_node dashql_parser spdlog)
    set_target_properties(dashql_parser_node PROPERTIES LINK_FLAGS "${EM_LINKER_FLAGS} -s ENVIRONMENT='node'")
endif()


# ---------------------------------------------------------------------------
# Tester

if(NOT EMSCRIPTEN)

    add_executable(tester
        ${CMAKE_SOURCE_DIR}/test/tester.cc
        ${CMAKE_SOURCE_DIR}/test/parser_test.cc
        ${CMAKE_SOURCE_DIR}/test/codec_test.cc
    )
    target_link_libraries(tester 
        dashql_parser
        flatbuffers gtest gmock )

    enable_testing()
    add_test(dashql_parser tester)

endif()

# ---------------------------------------------------------------------------
# # Benchmarks
# 
# if(NOT EMSCRIPTEN)
# 
#     add_executable(bm_result_codec
#         ${CMAKE_SOURCE_DIR}/bench/bm_result_codec.cc
#     )
#     target_link_libraries(bm_result_codec
#         duckdb_webapi_core
#         benchmark
#         flatbuffers gtest gmock Threads::Threads)
# 
# endif()
