# Copyright (c) 2020 The DashQL Authors
# ---------------------------------------------------------------------------

# Use project versions
# cmake --help-policy CMP0048
if (POLICY CMP0048)
    cmake_policy(SET CMP0048 NEW)
endif (POLICY CMP0048)

project(dashql_core VERSION 0.1)
cmake_minimum_required(VERSION 3.10)

set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_FLAGS -std=c++17)

if (WITH_ASAN)
    set(CMAKE_CXX_FLAGS_DEBUG "${CMAKE_CXX_FLAGS_DEBUG} -fsanitize=address")
endif ()

# DuckDB makes heavy use of exceptions so there's no way around that
if (EMSCRIPTEN)
    add_compile_options(-s DISABLE_EXCEPTION_CATCHING=0 -fexceptions)
endif ()

# ---------------------------------------------------------------------------
# Threads

set(CMAKE_THREAD_PREFER_PTHREAD TRUE)
set(THREADS_PREFER_PTHREAD_FLAG TRUE)
find_package(Threads REQUIRED)

# ---------------------------------------------------------------------------
# Parallelism

include(ProcessorCount)
ProcessorCount(NPROCS)
set(CMAKE_BUILD_PARALLEL_LEVEL ${NPROCS})

# ---------------------------------------------------------------------------
# CMake includes

include("${CMAKE_SOURCE_DIR}/cmake/flatbuffers.cmake")
include("${CMAKE_SOURCE_DIR}/cmake/benchmark.cmake")
include("${CMAKE_SOURCE_DIR}/cmake/googletest.cmake")
include("${CMAKE_SOURCE_DIR}/cmake/rapidjson.cmake")
include("${CMAKE_SOURCE_DIR}/cmake/pugixml.cmake")
include("${CMAKE_SOURCE_DIR}/cmake/spdlog.cmake")
add_subdirectory("${CMAKE_SOURCE_DIR}/../../duckdb/cpp/" "${CMAKE_BINARY_DIR}/duckdb/")

# ---------------------------------------------------------------------------
# Headers

include_directories(
    "${CMAKE_SOURCE_DIR}/include"
    "${CMAKE_BINARY_DIR}/include"
    "${CMAKE_SOURCE_DIR}/../../duckdb/cpp/include"
    "${CMAKE_BINARY_DIR}/duckdb/include"
    "${DUCKDB_INCLUDE_DIR}"
)

# ---------------------------------------------------------------------------
# Parser

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

set(GRAMMAR_OUT ${CMAKE_BINARY_DIR}/dashql.y)
set(GRAMMAR_DELIMITER ${CMAKE_SOURCE_DIR}/src/parser/grammar/delimiter.y)
set(GRAMMAR_PROLOGUE ${CMAKE_SOURCE_DIR}/src/parser/grammar/prologue.y)
set(GRAMMAR_EPILOGUE ${CMAKE_SOURCE_DIR}/src/parser/grammar/epilogue.y)
set(GRAMMAR_PRECEDENCES ${CMAKE_SOURCE_DIR}/src/parser/grammar/precedences.y)

set(GRAMMAR_KEYWORDS
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/lists/dashql_keywords.list
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/lists/sql_column_name_keywords.list
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/lists/sql_reserved_keywords.list
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/lists/sql_type_func_keywords.list
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/lists/sql_unreserved_keywords.list
)

set(GRAMMAR_RULES
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/dashql_common.y
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/dashql_extract.y
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/dashql_load.y
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/dashql_param.y
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/dashql_query.y
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/dashql_statement.y
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/dashql_viz.y
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/sql_select.y
)

set(GRAMMAR_TYPES
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/dashql_common.yh
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/dashql_extract.yh
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/dashql_load.yh
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/dashql_param.yh
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/dashql_query.yh
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/dashql_statement.yh
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/dashql_viz.yh
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/sql_select.yh
)

# Build grammar file
add_custom_command(
    OUTPUT ${GRAMMAR_OUT}
    COMMAND rm -f ${GRAMMAR_OUT}

    # DECLARATIONS
    # ------------------------------------------------
    # Write the prologue
    COMMAND cat ${GRAMMAR_PROLOGUE} >> ${GRAMMAR_OUT}
    # Write the keyword token definitions
    # Output:
    #   %token FILE1_KEYWORD1 FILE1_KEYWORD2
    #   %token FILE2_KEYWORD1 FILE2_KEYWORD2
    COMMAND awk -F, "{t=substr($3, 1, length($3)-1); if (FNR == 1) { printf \"\\n%%token \" t } else { printf t }} END {print \"\\n\"}" ${GRAMMAR_KEYWORDS} >> ${GRAMMAR_OUT}
    # Write precedence rules
    COMMAND cat ${GRAMMAR_PRECEDENCES} >> ${GRAMMAR_OUT}
    # Write token types
    COMMAND cat ${GRAMMAR_TYPES} >> ${GRAMMAR_OUT}

    # RULES
    # ------------------------------------------------
    COMMAND echo "%%" >> ${GRAMMAR_OUT}
    # Write the keyword bison rules
    # Output:
    #   file1: FILE1_KEYWORD1 | FILE1_KEYWORD2;
    #   file2: FILE2_KEYWORD1 | FILE2_KEYWORD2;
    COMMAND awk -F, "{n = split(FILENAME, p, \"/\"); bn=p[n]; bn=substr(bn, 1, length(bn)-5); t=substr($3, 1, length($3) - 1); if (NR == 1 && FNR == 1) {printf \"\\n\" bn \":\" t} else if (FNR == 1) {printf \";\\n\" bn \":\" t} else {printf \"|\" t}} END {printf \";\\n\\n\"}" ${GRAMMAR_KEYWORDS} >> ${GRAMMAR_OUT}
    # Write all the grammar rules
    COMMAND cat ${GRAMMAR_RULES} >> ${GRAMMAR_OUT}

    # CODE
    # ------------------------------------------------
    COMMAND echo "%%" >> ${GRAMMAR_OUT}
    # Write the epilogue
    COMMAND cat ${GRAMMAR_EPILOGUE} >> ${GRAMMAR_OUT}

    VERBATIM
    DEPENDS
        ${GRAMMAR_PROLOGUE}
        ${GRAMMAR_PRECEDENCES}
        ${GRAMMAR_TYPES}
        ${GRAMMAR_RULES}
        ${GRAMMAR_EPILOGUE}
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
        ${CMAKE_SOURCE_DIR}/src/parser/scanner.l
    DEPENDS
        ${GRAMMAR_OUT}
        ${CMAKE_SOURCE_DIR}/src/parser/scanner.l
)

add_library(dashql_parser
    ${SCANNER_OUT}
    ${PARSER_OUT}
    ${CMAKE_SOURCE_DIR}/src/parser/keywords.cc
    ${CMAKE_SOURCE_DIR}/src/parser/options.cc
    ${CMAKE_SOURCE_DIR}/src/parser/parser_driver.cc
    ${CMAKE_SOURCE_DIR}/src/parser/scanner.cc
)

target_link_libraries(dashql_parser flatbuffers)

# ---------------------------------------------------------------------------

add_library(dashql_core
    ${CMAKE_SOURCE_DIR}/src/action_planner.cc
    ${CMAKE_SOURCE_DIR}/src/common/substring_buffer.cc
    ${CMAKE_SOURCE_DIR}/src/program_instance.cc
    ${CMAKE_SOURCE_DIR}/src/program_matcher.cc
    ${CMAKE_SOURCE_DIR}/src/session.cc
)

target_link_libraries(dashql_core dashql_parser duckdb_webdb)

# ---------------------------------------------------------------------------
# Emscripten

add_library(duckdb_core_ffi ${CMAKE_SOURCE_DIR}/src/session_ffi.cc)
target_link_libraries(duckdb_core_ffi duckdb_webdb flatbuffers spdlog Threads::Threads)

if (EMSCRIPTEN)
    set(EM_LINKER_FLAGS " \
        -Wl,--shared-memory,--no-check-features \
        -s USE_PTHREADS=1 \
        -s DISABLE_EXCEPTION_CATCHING=0 \
        -s MODULARIZE=1 \
        -s EXPORT_NAME='DashQLCore' \
        -s EXPORTED_FUNCTIONS='[ \
            _main, \
            _malloc, \
            _free, \
            _dashql_clear_response, \
            _dashql_evaluate, \
            ${DUCKDB_WEB_CONNECTION_INTERFACE} \
        ]' \
        -s EXTRA_EXPORTED_RUNTIME_METHODS='[\"ccall\",\"allocate\",\"ALLOC_STACK\", \"ALLOC_NORMAL\"]' \
        "
    )

    add_executable(dashql_core_web ${CMAKE_SOURCE_DIR}/src/session_ffi.cc)
    target_link_libraries(dashql_core_web dashql_core duckdb_ffi)
    set_target_properties(dashql_core_web PROPERTIES LINK_FLAGS "${EM_LINKER_FLAGS} -s ENVIRONMENT='web,worker'")

    add_executable(dashql_core_node ${CMAKE_SOURCE_DIR}/src/session_ffi.cc)
    target_link_libraries(dashql_core_node dashql_core duckdb_ffi)
    set_target_properties(dashql_core_node PROPERTIES LINK_FLAGS "${EM_LINKER_FLAGS} -s ENVIRONMENT='node'")

else()


endif()


# ---------------------------------------------------------------------------
# Tester

if(NOT EMSCRIPTEN)
    add_executable(tester
        ${CMAKE_SOURCE_DIR}/test/default/common/substring_buffer_test.cc
        ${CMAKE_SOURCE_DIR}/test/default/common/topological_sort_test.cc
        ${CMAKE_SOURCE_DIR}/test/default/program_matcher_test.cc
        ${CMAKE_SOURCE_DIR}/test/tester.cc
    )
    target_link_libraries(tester
        dashql_core
        flatbuffers gtest gmock
        Threads::Threads
    )

    add_executable(grammar_tests
        ${CMAKE_SOURCE_DIR}/src/test/action_test_encoder.cc
        ${CMAKE_SOURCE_DIR}/src/test/program_test_encoder.cc
        ${CMAKE_SOURCE_DIR}/test/grammar_tests.cc
    )
    target_link_libraries(grammar_tests
        dashql_core
        pugixml
        flatbuffers gtest gmock
        Threads::Threads
    )

    add_executable(grammar_testgen
        ${CMAKE_SOURCE_DIR}/src/test/action_test_encoder.cc
        ${CMAKE_SOURCE_DIR}/src/test/program_test_encoder.cc
        ${CMAKE_SOURCE_DIR}/test/grammar_testgen.cc
    )
    target_link_libraries(grammar_testgen
        dashql_core
        pugixml
        flatbuffers gtest gmock
        Threads::Threads
    )
endif()
