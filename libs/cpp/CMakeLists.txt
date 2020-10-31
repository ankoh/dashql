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
# Threads

set(THREAD_LIB "")
if (NOT EMSCRIPTEN)
    set(CMAKE_THREAD_PREFER_PTHREAD TRUE)
    set(THREADS_PREFER_PTHREAD_FLAG TRUE)
    find_package(Threads REQUIRED)
    set(THREAD_LIB Threads::Threads)
endif ()

# ---------------------------------------------------------------------------
# CMake includes

include("${CMAKE_SOURCE_DIR}/cmake/flatbuffers.cmake")
include("${CMAKE_SOURCE_DIR}/cmake/benchmark.cmake")
include("${CMAKE_SOURCE_DIR}/cmake/googletest.cmake")
include("${CMAKE_SOURCE_DIR}/cmake/rapidjson.cmake")
include("${CMAKE_SOURCE_DIR}/cmake/rapidyaml.cmake")

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
# Grammar

set(GRAMMAR_OUT ${CMAKE_BINARY_DIR}/dashql.y)
set(GRAMMAR_DELIMITER ${CMAKE_SOURCE_DIR}/src/grammar/delimiter.y)
set(GRAMMAR_PROLOGUE ${CMAKE_SOURCE_DIR}/src/grammar/prologue.y)
set(GRAMMAR_EPILOGUE ${CMAKE_SOURCE_DIR}/src/grammar/epilogue.y)
set(GRAMMAR_TOKENS ${CMAKE_SOURCE_DIR}/src/grammar/tokens.y)

set(GRAMMAR_RULES
    ${CMAKE_SOURCE_DIR}/src/grammar/rules/dashql_common.y
    ${CMAKE_SOURCE_DIR}/src/grammar/rules/dashql_extract.y
    ${CMAKE_SOURCE_DIR}/src/grammar/rules/dashql_load.y
    ${CMAKE_SOURCE_DIR}/src/grammar/rules/dashql_param.y
    ${CMAKE_SOURCE_DIR}/src/grammar/rules/dashql_query.y
    ${CMAKE_SOURCE_DIR}/src/grammar/rules/dashql_statement.y
    ${CMAKE_SOURCE_DIR}/src/grammar/rules/dashql_viz.y
    ${CMAKE_SOURCE_DIR}/src/grammar/rules/sql_select.y
)

set(GRAMMAR_TYPES
    ${CMAKE_SOURCE_DIR}/src/grammar/rules/dashql_common.yh
    ${CMAKE_SOURCE_DIR}/src/grammar/rules/dashql_extract.yh
    ${CMAKE_SOURCE_DIR}/src/grammar/rules/dashql_load.yh
    ${CMAKE_SOURCE_DIR}/src/grammar/rules/dashql_param.yh
    ${CMAKE_SOURCE_DIR}/src/grammar/rules/dashql_query.yh
    ${CMAKE_SOURCE_DIR}/src/grammar/rules/dashql_statement.yh
    ${CMAKE_SOURCE_DIR}/src/grammar/rules/dashql_viz.yh
    ${CMAKE_SOURCE_DIR}/src/grammar/rules/sql_select.yh
)

# Build grammar file
add_custom_command(
    OUTPUT ${GRAMMAR_OUT}
    COMMAND rm -f ${GRAMMAR_OUT}
    COMMAND cat ${GRAMMAR_PROLOGUE} >> ${GRAMMAR_OUT}
    COMMAND cat ${GRAMMAR_TOKENS} >> ${GRAMMAR_OUT}
    COMMAND cat ${GRAMMAR_TYPES} >> ${GRAMMAR_OUT}
    COMMAND echo "%%" >> ${GRAMMAR_OUT}
    COMMAND cat ${GRAMMAR_RULES} >> ${GRAMMAR_OUT}
    COMMAND echo "%%" >> ${GRAMMAR_OUT}
    COMMAND cat ${GRAMMAR_EPILOGUE} >> ${GRAMMAR_OUT}
    DEPENDS
        ${GRAMMAR_PROLOGUE}
        ${GRAMMAR_EPILOGUE}
        ${GRAMMAR_TOKENS}
        ${GRAMMAR_RULES}
        ${GRAMMAR_TYPES}
)

set(SCANNER_OUT ${CMAKE_BINARY_DIR}/include/dashql/parser/scanner.cc)
set(PARSER_OUT ${CMAKE_BINARY_DIR}/include/dashql/parser/parser.cc)
set(PARSER_HEADER_OUT ${CMAKE_BINARY_DIR}/include/dashql/parser/parser.h)

IF(NOT EXISTS ${CMAKE_BINARY_DIR}/include/dashql/parser/)
    file(MAKE_DIRECTORY ${CMAKE_BINARY_DIR}/include/dashql/parser/)
ENDIF()

# Generate parser & scanner
add_custom_command(
    OUTPUT ${SCANNER_OUT} ${PARSER_OUT} ${PARSER_HEADER_OUT}
    COMMAND ${BISON_EXECUTABLE}
        --defines=${PARSER_HEADER_OUT}
        --output=${PARSER_OUT}
        --report=state
        --report-file=${CMAKE_BINARY_DIR}/bison.log
        ${GRAMMAR_OUT}
    COMMAND ${FLEX_EXECUTABLE}
        --outfile=${SCANNER_OUT}
        ${CMAKE_SOURCE_DIR}/src/scanner.l
    DEPENDS
        ${GRAMMAR_OUT}
        ${CMAKE_SOURCE_DIR}/src/scanner.l
)

# ---------------------------------------------------------------------------
# Library

add_library(dashql_parser
    ${SCANNER_OUT}
    ${PARSER_OUT}
    ${CMAKE_SOURCE_DIR}/src/json_encoder.cc
    ${CMAKE_SOURCE_DIR}/src/parser_driver.cc
    ${CMAKE_SOURCE_DIR}/src/module_builder.cc
)

target_link_libraries(dashql_parser
    rapidjson
    flatbuffers
    ${THREAD_LIB}
)

add_library(dashql_parser_test
    ${CMAKE_SOURCE_DIR}/src/test/yaml_encoder.cc
)

target_link_libraries(dashql_parser_test
    dashql_parser
    ryml ryml_c4core
    flatbuffers
    ${THREAD_LIB}
)

# ---------------------------------------------------------------------------
# Emscripten

if (EMSCRIPTEN)
    set(EM_LINKER_FLAGS " \
        -s USE_PTHREADS=0 \
        -s DISABLE_EXCEPTION_CATCHING=0 \
        -s MODULARIZE=1 \
        -s EXPORT_NAME='DashQLParser' \
        -s EXPORTED_FUNCTIONS='[ \
            _main, \
            _malloc, \
            _free, \
            _dashql_parse, \
            _dashql_parser_free \
        ]' \
        -s EXTRA_EXPORTED_RUNTIME_METHODS='[\"ccall\",\"allocate\",\"ALLOC_STACK\", \"ALLOC_NORMAL\"]' \
        "
    )

    add_executable(dashql_parser_web ${CMAKE_SOURCE_DIR}/src/ffi.cc)
    target_link_libraries(dashql_parser_web dashql_parser)
    set_target_properties(dashql_parser_web PROPERTIES LINK_FLAGS "${EM_LINKER_FLAGS} -s ENVIRONMENT='web,worker'")

    add_executable(dashql_parser_node ${CMAKE_SOURCE_DIR}/src/ffi.cc)
    target_link_libraries(dashql_parser_node dashql_parser)
    set_target_properties(dashql_parser_node PROPERTIES LINK_FLAGS "${EM_LINKER_FLAGS} -s ENVIRONMENT='node'")
else()
    add_library(dashql_parser_ffi ${CMAKE_SOURCE_DIR}/src/ffi.cc)
    target_link_libraries(dashql_parser_ffi dashql_parser)

endif()


# ---------------------------------------------------------------------------
# Tester

if(NOT EMSCRIPTEN)

    add_executable(grammar_tests
        ${CMAKE_SOURCE_DIR}/test/grammar_tests.cc
    )
    target_link_libraries(grammar_tests
        dashql_parser
        dashql_parser_test
        flatbuffers gtest gmock
        ${THREAD_LIB})

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
