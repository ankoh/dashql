# Copyright (c) 2020 The DashQL Authors
# ---------------------------------------------------------------------------

# Use project versions
# cmake --help-policy CMP0048
if (POLICY CMP0048)
    cmake_policy(SET CMP0048 NEW)
endif (POLICY CMP0048)

project(dashql VERSION 0.1)
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
    add_compile_options(-s DISABLE_EXCEPTION_CATCHING=0 -fexceptions -sUSE_PTHREADS=0)
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

SET(CMAKE_MODULE_PATH
  ${CMAKE_SOURCE_DIR}/cmake/modules
  ${CMAKE_MODULE_PATH}
)

include("${CMAKE_SOURCE_DIR}/cmake/flatbuffers.cmake")
include("${CMAKE_SOURCE_DIR}/cmake/benchmark.cmake")
include("${CMAKE_SOURCE_DIR}/cmake/binaryen.cmake")
include("${CMAKE_SOURCE_DIR}/cmake/googletest.cmake")
include("${CMAKE_SOURCE_DIR}/cmake/gflags.cmake")
include("${CMAKE_SOURCE_DIR}/cmake/rapidjson.cmake")
include("${CMAKE_SOURCE_DIR}/cmake/pugixml.cmake")
include("${CMAKE_SOURCE_DIR}/cmake/spdlog.cmake")
include("${CMAKE_SOURCE_DIR}/cmake/wasm-c-api.cmake")

# ---------------------------------------------------------------------------
# Code coverage

if(CODE_COVERAGE)
    if("${CMAKE_C_COMPILER_ID}" MATCHES "(Apple)?[Cc]lang" OR "${CMAKE_CXX_COMPILER_ID}" MATCHES "(Apple)?[Cc]lang")
        message("Building with llvm code coverage")
        set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -fprofile-instr-generate -fcoverage-mapping")
        set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -fprofile-instr-generate -fcoverage-mapping")
    elseif(CMAKE_COMPILER_IS_GNUCXX)
        message("Building with lcov code coverage")
        set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} --coverage -fprofile-arcs -ftest-coverage")
        set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} --coverage -fprofile-arcs -ftest-coverage")
    else()
        message(FATAL_ERROR "Code coverage requires Clang or GCC. Aborting.")
    endif()
endif()

# ---------------------------------------------------------------------------
# DuckDB

set(DUCKDB_SOURCE_DIR "${CMAKE_SOURCE_DIR}/../submodules/duckdb")
set(DUCKDB_INCLUDE_DIR "${DUCKDB_SOURCE_DIR}/src/include")
set(DUCKDB_UTF8PROC_INCLUDE_DIR "${DUCKDB_SOURCE_DIR}/third_party/utf8proc/include")
set(DUCKDB_FMT_INCLUDE_DIR "${DUCKDB_SOURCE_DIR}/third_party/fmt/include")
set(DUCKDB_AMALGAMATION "${DUCKDB_SOURCE_DIR}/src/amalgamation/duckdb.cpp")

if (EMSCRIPTEN) 
    # Load duckdb.wasm archive
    include(FetchContent)
    FetchContent_Declare(
        duckdb_wasm
        URL "https://github.com/dashql/duckdb/releases/download/0.2.4.1/duckdb-wasm32-nothreads.zip"
        URL_HASH "SHA256=1ac85c1e2e7fadcd86a5a3befff87aae2d1d2ad615d664e2228357777ff8a2a9"
    )
    FetchContent_GetProperties(duckdb_wasm)
    if(NOT duckdb_wasm_POPULATED)
        FetchContent_Populate(duckdb_wasm)
    endif()

    # Command to extract archive
    set(DUCKDB_WASM_ARCHIVE ${duckdb_wasm_SOURCE_DIR}/duckdb-wasm32-nothreads.zip)
    set(DUCKDB_WASM_OUT ${CMAKE_BINARY_DIR}/duckdb.wasm)
    add_custom_target(
        duckdb_wasm
        COMMAND ${CMAKE_COMMAND} -E remove ${DUCKDB_WASM_OUT}
        COMMAND ${CMAKE_COMMAND} -E tar xvz ${DUCKDB_WASM_ARCHIVE}
        WORKING_DIRECTORY ${CMAKE_BINARY_DIR}
    )

    # INTERFACE library to link prebuilt wasmt
    add_library(duckdb INTERFACE)
    add_dependencies(duckdb duckdb_wasm)
    target_compile_options(duckdb INTERFACE -DDUCKDB_NO_THREADS=1)
    target_link_libraries(duckdb INTERFACE ${CMAKE_BINARY_DIR}/duckdb.wasm)
    set_property(TARGET duckdb APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${DUCKDB_INCLUDE_DIR})
    set_property(TARGET duckdb APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${DUCKDB_UTF8PROC_INCLUDE_DIR})
    set_property(TARGET duckdb APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${DUCKDB_FMT_INCLUDE_DIR})

else ()

    # Amalgamate DuckDB
    find_package(Python3 COMPONENTS Interpreter REQUIRED)
    add_custom_command(OUTPUT ${DUCKDB_AMALGAMATION}
        COMMAND ${Python3_EXECUTABLE} "${DUCKDB_SOURCE_DIR}/scripts/amalgamation.py"
        WORKING_DIRECTORY "${DUCKDB_SOURCE_DIR}"
    )

    # Compile library
    add_library(duckdb ${DUCKDB_AMALGAMATION})
    target_compile_options(duckdb PUBLIC -DDUCKDB_NO_THREADS=1)
    set_property(TARGET duckdb APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${DUCKDB_INCLUDE_DIR})
    set_property(TARGET duckdb APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${DUCKDB_UTF8PROC_INCLUDE_DIR})
    set_property(TARGET duckdb APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${DUCKDB_FMT_INCLUDE_DIR})
endif ()

# ---------------------------------------------------------------------------
# Proto

add_subdirectory("${CMAKE_SOURCE_DIR}/../proto" "${CMAKE_BINARY_DIR}/proto/")

# ---------------------------------------------------------------------------
# Headers

include_directories(
    "${CMAKE_SOURCE_DIR}/include"
    "${CMAKE_BINARY_DIR}/include"
    "${DUCKDB_INCLUDE_DIR}"
    "${DUCKDB_UTF8PROC_INCLUDE_DIR}"
)

# ---------------------------------------------------------------------------
# Parser

set(REQUIRED_BISON_VERSION 3.7)

# If Bison has been installed via homebrew, prefer this installation.
find_program(BREW_BIN brew)
if (BREW_BIN)
    execute_process(COMMAND ${BREW_BIN} --prefix bison
                    OUTPUT_VARIABLE BISON_PREFIX
                    OUTPUT_STRIP_TRAILING_WHITESPACE)
    set(BISON_EXECUTABLE "${BISON_PREFIX}/bin/bison")
    find_package(BISON ${REQUIRED_BISON_VERSION})
endif()

if (NOT BISON_FOUND)
    find_package(BISON ${REQUIRED_BISON_VERSION})
endif()

if (NOT BISON_FOUND)
    message(FATAL_ERROR "Could not find bison")
endif()

find_package(FLEX REQUIRED)

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
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/sql_create.y
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/sql_select.y
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/sql_view.y
)

set(GRAMMAR_TYPES
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/dashql_common.yh
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/dashql_extract.yh
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/dashql_load.yh
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/dashql_param.yh
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/dashql_query.yh
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/dashql_statement.yh
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/dashql_viz.yh
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/sql_create.yh
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/sql_select.yh
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/sql_view.yh
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
        ${GRAMMAR_KEYWORDS}
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

target_link_libraries(dashql_parser dashql_proto)

# ---------------------------------------------------------------------------
# Libraries

add_library(dashql_common
    ${CMAKE_SOURCE_DIR}/src/common/blob_stream.cc
    ${CMAKE_SOURCE_DIR}/src/common/ffi_response.cc
    ${CMAKE_SOURCE_DIR}/src/common/pattern_search.cc
    ${CMAKE_SOURCE_DIR}/src/common/substring_buffer.cc
    ${CMAKE_SOURCE_DIR}/src/common/union_find.cc
)

add_library(dashql_extract
    ${CMAKE_SOURCE_DIR}/src/extract/csv_extract.cc
    ${CMAKE_SOURCE_DIR}/src/extract/csv_parser.cc
    ${CMAKE_SOURCE_DIR}/src/extract/csv_sniffer.cc
    ${CMAKE_SOURCE_DIR}/src/extract/extract.cc
)

add_library(dashql_dataframe
    ${CMAKE_SOURCE_DIR}/src/dataframe/dataframe.cc
    ${CMAKE_SOURCE_DIR}/src/dataframe/dataframe_ffi.cc
)

add_library(dashql_analyzer
    ${CMAKE_SOURCE_DIR}/src/analyzer/action_planner.cc
    ${CMAKE_SOURCE_DIR}/src/analyzer/analyzer.cc
    ${CMAKE_SOURCE_DIR}/src/analyzer/analyzer_ffi.cc
    ${CMAKE_SOURCE_DIR}/src/analyzer/function_logic.cc
    ${CMAKE_SOURCE_DIR}/src/analyzer/parameter_value.cc
    ${CMAKE_SOURCE_DIR}/src/analyzer/program_editor.cc
    ${CMAKE_SOURCE_DIR}/src/analyzer/program_instance.cc
    ${CMAKE_SOURCE_DIR}/src/analyzer/program_matcher.cc
    ${CMAKE_SOURCE_DIR}/src/analyzer/syntax_matcher.cc
    ${CMAKE_SOURCE_DIR}/src/analyzer/viz_statement.cc
    ${CMAKE_SOURCE_DIR}/src/analyzer/value.cc
)

add_library(dashql_webdb
    ${CMAKE_SOURCE_DIR}/src/webdb/codec.cc
    ${CMAKE_SOURCE_DIR}/src/webdb/iterator.cc
    ${CMAKE_SOURCE_DIR}/src/webdb/json.cc
    ${CMAKE_SOURCE_DIR}/src/webdb/webdb.cc
    ${CMAKE_SOURCE_DIR}/src/webdb/webdb_ffi.cc
)

add_library(dashql_test
    ${CMAKE_SOURCE_DIR}/src/test/analyzer_tests.cc
    ${CMAKE_SOURCE_DIR}/src/test/blob_stream_tests.cc
    ${CMAKE_SOURCE_DIR}/src/test/grammar_tests.cc
)

target_link_libraries(dashql_common dashql_proto flatbuffers spdlog)
target_link_libraries(dashql_extract dashql_proto flatbuffers spdlog duckdb)
target_link_libraries(dashql_analyzer dashql_parser dashql_common dashql_proto spdlog duckdb)
target_link_libraries(dashql_dataframe dashql_common dashql_proto binaryen)
target_link_libraries(dashql_webdb dashql_extract dashql_common dashql_proto duckdb spdlog)
target_link_libraries(dashql_test dashql_webdb dashql_analyzer dashql_common dashql_proto pugixml gtest duckdb)

# ---------------------------------------------------------------------------
# Emscripten

# We need "-s WARN_ON_UNDEFINED_SYMBOLS=0" to instantiate the module with our own imports.
if (EMSCRIPTEN)
    set(ADDITIONAL_LINKER_FLAGS)
    if (WASM_FAST_LINKING)
        set(ADDITIONAL_LINKER_FLAGS -O0)
    endif ()

    set(DATAFRAME_WASM_LINKER_FLAGS " \
        -s LLD_REPORT_UNDEFINED=1 \
        -s WARN_ON_UNDEFINED_SYMBOLS=1 \
        -s ALLOW_MEMORY_GROWTH=1 \
        -s USE_PTHREADS=0 \
        -s DISABLE_EXCEPTION_CATCHING=0 \
        -s MODULARIZE=1 \
        -s EXPORT_NAME='DashQLTable' \
        -s EXPORTED_FUNCTIONS='[ \
            _main, \
            _malloc, \
            _free, \
            _dashql_dataframe_algebra_tree, \
            _dashql_dataframe, \
            _dashql_dataframe_get_module \
        ]' \
        -s EXTRA_EXPORTED_RUNTIME_METHODS='[\"ccall\"]' \
        ${ADDITIONAL_LINKER_FLAGS} \
        "
    )

    add_executable(dataframe_wasm ${CMAKE_SOURCE_DIR}/src/ffi_main.cc)
    target_link_libraries(dataframe_wasm dashql_dataframe)
    set_target_properties(dataframe_wasm PROPERTIES LINK_FLAGS "${DATAFRAME_WASM_LINKER_FLAGS} -s ENVIRONMENT='web'")

    add_executable(dataframe_wasm_node ${CMAKE_SOURCE_DIR}/src/ffi_main.cc)
    target_link_libraries(dataframe_wasm_node dashql_dataframe)
    set_target_properties(dataframe_wasm_node PROPERTIES LINK_FLAGS "${DATAFRAME_WASM_LINKER_FLAGS} -s ENVIRONMENT='node'")

    set(ANALYZER_WASM_LINKER_FLAGS " \
        -s LLD_REPORT_UNDEFINED=1 \
        -s WARN_ON_UNDEFINED_SYMBOLS=1 \
        -s ALLOW_MEMORY_GROWTH=1 \
        -s USE_PTHREADS=0 \
        -s DISABLE_EXCEPTION_CATCHING=0 \
        -s MODULARIZE=1 \
        -s EXPORT_NAME='DashQLAnalyzer' \
        -s EXPORTED_FUNCTIONS='[ \
            _main, \
            _malloc, \
            _free, \
            _dashql_clear_response, \
            _dashql_analyzer_reset, \
            _dashql_analyzer_parse_program, \
            _dashql_analyzer_instantiate_program, \
            _dashql_analyzer_plan_program, \
            _dashql_analyzer_edit_program, \
            _dashql_analyzer_update_action_status \
        ]' \
        -s EXTRA_EXPORTED_RUNTIME_METHODS='[\"ccall\"]' \
        ${ADDITIONAL_LINKER_FLAGS} \
        "
    )

    add_executable(analyzer_wasm ${CMAKE_SOURCE_DIR}/src/ffi_main.cc)
    target_link_libraries(analyzer_wasm dashql_analyzer)
    set_target_properties(analyzer_wasm PROPERTIES LINK_FLAGS "${ANALYZER_WASM_LINKER_FLAGS} -s ENVIRONMENT='web'")

    add_executable(analyzer_wasm_node ${CMAKE_SOURCE_DIR}/src/ffi_main.cc)
    target_link_libraries(analyzer_wasm_node dashql_analyzer)
    set_target_properties(analyzer_wasm_node PROPERTIES LINK_FLAGS "${ANALYZER_WASM_LINKER_FLAGS} -s ENVIRONMENT='node'")

    set(WEBDB_WASM_LINKER_FLAGS " \
        -s LLD_REPORT_UNDEFINED=1 \
        -s WARN_ON_UNDEFINED_SYMBOLS=0 \
        -s ALLOW_MEMORY_GROWTH=1 \
        -s USE_PTHREADS=0 \
        -s DISABLE_EXCEPTION_CATCHING=0 \
        -s MODULARIZE=1 \
        -s EXPORT_NAME='DashQLWebDB' \
        -s EXPORTED_FUNCTIONS='[ \
            _main, \
            _malloc, \
            _free, \
            _dashql_clear_response, \
            _dashql_webdb_connect, \
            _dashql_webdb_disconnect, \
            _dashql_webdb_run_query, \
            _dashql_webdb_send_query, \
            _dashql_webdb_fetch_query_results, \
            _dashql_webdb_analyze_query \
        ]' \
        -s EXTRA_EXPORTED_RUNTIME_METHODS='[\"ccall\"]' \
        ${ADDITIONAL_LINKER_FLAGS} \
        "
    )

    add_executable(webdb_wasm ${CMAKE_SOURCE_DIR}/src/ffi_main.cc)
    target_link_libraries(webdb_wasm dashql_webdb flatbuffers spdlog)
    set_target_properties(webdb_wasm PROPERTIES LINK_FLAGS "${WEBDB_WASM_LINKER_FLAGS} -s ENVIRONMENT='web'")

    add_executable(webdb_wasm_node ${CMAKE_SOURCE_DIR}/src/ffi_main.cc)
    target_link_libraries(webdb_wasm_node dashql_webdb flatbuffers spdlog)
    set_target_properties(webdb_wasm_node PROPERTIES LINK_FLAGS "${WEBDB_WASM_LINKER_FLAGS} -s ENVIRONMENT='node'")
else()


endif()

# ---------------------------------------------------------------------------
# Tester

if(NOT EMSCRIPTEN)
    set (TEST_CC
        ${CMAKE_SOURCE_DIR}/test/analyzer/analyzer_spec_tests.cc
        ${CMAKE_SOURCE_DIR}/test/analyzer/function_logic_test.cc
        ${CMAKE_SOURCE_DIR}/test/analyzer/program_editor_test.cc
        ${CMAKE_SOURCE_DIR}/test/analyzer/program_matcher_test.cc
        ${CMAKE_SOURCE_DIR}/test/analyzer/syntax_matcher_test.cc
        ${CMAKE_SOURCE_DIR}/test/common/pod_vector_test.cc
        ${CMAKE_SOURCE_DIR}/test/common/substring_buffer_test.cc
        ${CMAKE_SOURCE_DIR}/test/common/topological_sort_test.cc
        ${CMAKE_SOURCE_DIR}/test/common/union_find_test.cc
        ${CMAKE_SOURCE_DIR}/test/dataframe/dataframe_test.cc
        ${CMAKE_SOURCE_DIR}/test/dataframe/hellowasm_test.cc
        ${CMAKE_SOURCE_DIR}/test/extract/csv_parser_test.cc
        ${CMAKE_SOURCE_DIR}/test/extract/csv_sniffer_test.cc
        ${CMAKE_SOURCE_DIR}/test/extract/extract_test.cc
        ${CMAKE_SOURCE_DIR}/test/parser/grammar_spec_tests.cc
        ${CMAKE_SOURCE_DIR}/test/tester.cc
        ${CMAKE_SOURCE_DIR}/test/webdb/duckdb_test.cc
        ${CMAKE_SOURCE_DIR}/test/webdb/iterator_test.cc
        ${CMAKE_SOURCE_DIR}/test/webdb/webdb_test.cc
    )
    set (TEST_LIBS
        dashql_test
        dashql_extract dashql_analyzer dashql_dataframe dashql_webdb dashql_common
        dashql_proto
        wasm_api
        flatbuffers gtest gmock gflags
        Threads::Threads
    )

    add_executable(tester ${TEST_CC})
    target_link_libraries(tester ${TEST_LIBS})

    add_executable(testgen
        ${CMAKE_SOURCE_DIR}/test/testgen.cc
    )
    target_link_libraries(testgen ${TEST_LIBS})
endif()

# ---------------------------------------------------------------------------
# Benchmarks

if(NOT EMSCRIPTEN)

    add_executable(bm_result_codec
        ${CMAKE_SOURCE_DIR}/bench/bm_result_codec.cc
    )
    target_link_libraries(bm_result_codec
        dashql_webdb
        dashql_proto
        benchmark
        flatbuffers gtest gmock Threads::Threads)

endif()
