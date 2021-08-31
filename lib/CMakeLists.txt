# Copyright (c) 2020 The DashQL Authors
# ---------------------------------------------------------------------------

# Use project versions cmake --help-policy CMP0048
if(POLICY CMP0048)
  cmake_policy(SET CMP0048 NEW)
endif(POLICY CMP0048)

project(dashql VERSION 0.1)
cmake_minimum_required(VERSION 3.10)

set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_FLAGS -std=c++17)

if(NOT EMSCRIPTEN)
  set(CMAKE_CXX_FLAGS_DEBUG
      "${CMAKE_CXX_FLAGS_DEBUG} -fsanitize=address -fsanitize=undefined")
endif()

# DuckDB makes heavy use of exceptions so there's no way around that
if(EMSCRIPTEN)
  if(CMAKE_BUILD_TYPE MATCHES Release)
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -Os")
  endif()
  set(CMAKE_CXX_FLAGS
      "${CMAKE_CXX_FLAGS} -sDISABLE_EXCEPTION_CATCHING=0 -fexceptions -sUSE_PTHREADS=0"
  )
endif()

# ---------------------------------------------------------------------------
# Ccache

find_program(CCACHE_PROGRAM ccache)
if(CCACHE_PROGRAM)
  set(CMAKE_C_COMPILER_LAUNCHER "${CCACHE_PROGRAM}")
  set(CMAKE_CXX_COMPILER_LAUNCHER "${CCACHE_PROGRAM}")
endif()

# ---------------------------------------------------------------------------
# Threads

set(CMAKE_THREAD_PREFER_PTHREAD TRUE)
set(THREADS_PREFER_PTHREAD_FLAG TRUE)
find_package(Threads REQUIRED)
set(THREAD_LIBS Threads::Threads)

# ---------------------------------------------------------------------------
# Parallelism

include(ProcessorCount)
ProcessorCount(NPROCS)
set(CMAKE_BUILD_PARALLEL_LEVEL ${NPROCS})

# ---------------------------------------------------------------------------
# CMake includes

set(CMAKE_MODULE_PATH ${CMAKE_SOURCE_DIR}/cmake/modules ${CMAKE_MODULE_PATH})

# Currently not needed include("${CMAKE_SOURCE_DIR}/cmake/binaryen.cmake")
# include("${CMAKE_SOURCE_DIR}/cmake/wasm-c-api.cmake")
# include("${CMAKE_SOURCE_DIR}/cmake/double-conversion.cmake")
# include("${CMAKE_SOURCE_DIR}/cmake/flatc.cmake")
# include("${CMAKE_SOURCE_DIR}/cmake/thrift.cmake")
# include("${CMAKE_SOURCE_DIR}/cmake/xlnt.cmake")
# include("${CMAKE_SOURCE_DIR}/cmake/spdlog.cmake")

include("${CMAKE_SOURCE_DIR}/cmake/duckdb.cmake")
include("${CMAKE_SOURCE_DIR}/cmake/boost.cmake")
include("${CMAKE_SOURCE_DIR}/cmake/arrow.cmake")
include("${CMAKE_SOURCE_DIR}/cmake/flatbuffers.cmake")
include("${CMAKE_SOURCE_DIR}/cmake/benchmark.cmake")
include("${CMAKE_SOURCE_DIR}/cmake/googletest.cmake")
include("${CMAKE_SOURCE_DIR}/cmake/gflags.cmake")
include("${CMAKE_SOURCE_DIR}/cmake/rapidjson.cmake")
include("${CMAKE_SOURCE_DIR}/cmake/nlohmann_json.cmake")
include("${CMAKE_SOURCE_DIR}/cmake/jmespath.cmake")
include("${CMAKE_SOURCE_DIR}/cmake/pugixml.cmake")
include("${CMAKE_SOURCE_DIR}/cmake/fmt.cmake")

# ---------------------------------------------------------------------------
# Code coverage

if(CODE_COVERAGE)
  if("${CMAKE_C_COMPILER_ID}" MATCHES "(Apple)?[Cc]lang"
     OR "${CMAKE_CXX_COMPILER_ID}" MATCHES "(Apple)?[Cc]lang")
    message("Building with llvm code coverage")
    set(CMAKE_C_FLAGS
        "${CMAKE_C_FLAGS} -fprofile-instr-generate -fcoverage-mapping")
    set(CMAKE_CXX_FLAGS
        "${CMAKE_CXX_FLAGS} -fprofile-instr-generate -fcoverage-mapping")
  elseif(CMAKE_COMPILER_IS_GNUCXX)
    message("Building with lcov code coverage")
    set(CMAKE_C_FLAGS
        "${CMAKE_C_FLAGS} --coverage -fprofile-arcs -ftest-coverage")
    set(CMAKE_CXX_FLAGS
        "${CMAKE_CXX_FLAGS} --coverage -fprofile-arcs -ftest-coverage")
  else()
    message(FATAL_ERROR "Code coverage requires Clang or GCC. Aborting.")
  endif()
endif()

# ---------------------------------------------------------------------------
# Proto

add_subdirectory("${CMAKE_SOURCE_DIR}/../packages/proto"
                 "${CMAKE_BINARY_DIR}/proto/")

# ---------------------------------------------------------------------------
# Headers

include_directories("${CMAKE_SOURCE_DIR}/include" "${CMAKE_BINARY_DIR}/include"
                    "${DUCKDB_INCLUDE_DIR}" "${DUCKDB_UTF8PROC_INCLUDE_DIR}")

# ---------------------------------------------------------------------------
# Parser

set(REQUIRED_BISON_VERSION 3.7)

# If Bison has been installed via homebrew, prefer this installation.
find_program(BREW_BIN brew)
if(BREW_BIN)
  execute_process(
    COMMAND ${BREW_BIN} --prefix bison
    OUTPUT_VARIABLE BISON_PREFIX
    OUTPUT_STRIP_TRAILING_WHITESPACE)
  set(BISON_EXECUTABLE "${BISON_PREFIX}/bin/bison")
  find_package(BISON ${REQUIRED_BISON_VERSION})
endif()

if(NOT BISON_FOUND)
  find_package(BISON ${REQUIRED_BISON_VERSION})
endif()

if(NOT BISON_FOUND)
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
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/lists/sql_unreserved_keywords.list)

set(GRAMMAR_RULES
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/dashql_fetch.y
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/dashql_input.y
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/dashql_load.y
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/dashql_query.y
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/dashql_statement.y
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/dashql_transform.y
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/dashql_viz.y
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/dson.y
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/sql_create.y
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/sql_select.y
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/sql_view.y)

set(GRAMMAR_TYPES
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/dashql_fetch.yh
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/dashql_input.yh
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/dashql_load.yh
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/dashql_query.yh
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/dashql_statement.yh
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/dashql_transform.yh
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/dashql_viz.yh
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/dson.yh
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/sql_create.yh
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/sql_select.yh
    ${CMAKE_SOURCE_DIR}/src/parser/grammar/rules/sql_view.yh)

# Build grammar file
add_custom_command(
  OUTPUT ${GRAMMAR_OUT}
  COMMAND rm -f ${GRAMMAR_OUT}
  # DECLARATIONS
  # ------------------------------------------------
  # Write the prologue
  COMMAND cat ${GRAMMAR_PROLOGUE} >> ${GRAMMAR_OUT}
  # Write the keyword token definitions Output: %token FILE1_KEYWORD1
  # FILE1_KEYWORD2 %token FILE2_KEYWORD1 FILE2_KEYWORD2
  COMMAND
    awk -F,
    "{t=substr($3, 1, length($3)-1); if (FNR == 1) { printf \"\\n%%token \" t } else { printf t }} END {print \"\\n\"}"
    ${GRAMMAR_KEYWORDS} >> ${GRAMMAR_OUT}
  # Write precedence rules
  COMMAND cat ${GRAMMAR_PRECEDENCES} >> ${GRAMMAR_OUT}
  # Write token types
  COMMAND cat ${GRAMMAR_TYPES} >> ${GRAMMAR_OUT}
  # RULES
  # ------------------------------------------------
  COMMAND echo "%%" >> ${GRAMMAR_OUT}
  # Write the keyword bison rules Output: file1: FILE1_KEYWORD1 |
  # FILE1_KEYWORD2; file2: FILE2_KEYWORD1 | FILE2_KEYWORD2;
  COMMAND
    awk -F,
    "{n = split(FILENAME, p, \"/\"); bn=p[n]; bn=substr(bn, 1, length(bn)-5); t=substr($3, 1, length($3) - 1); if (NR == 1 && FNR == 1) {printf \"\\n\" bn \":\" t} else if (FNR == 1) {printf \";\\n\" bn \":\" t} else {printf \"|\" t}} END {printf \";\\n\\n\"}"
    ${GRAMMAR_KEYWORDS} >> ${GRAMMAR_OUT}
  # Write all the grammar rules
  COMMAND cat ${GRAMMAR_RULES} >> ${GRAMMAR_OUT}
  # CODE
  # ------------------------------------------------
  COMMAND echo "%%" >> ${GRAMMAR_OUT}
  # Write the epilogue
  COMMAND cat ${GRAMMAR_EPILOGUE} >> ${GRAMMAR_OUT}
  VERBATIM
  DEPENDS ${GRAMMAR_KEYWORDS} ${GRAMMAR_PROLOGUE} ${GRAMMAR_PRECEDENCES}
          ${GRAMMAR_TYPES} ${GRAMMAR_RULES} ${GRAMMAR_EPILOGUE})

set(SCANNER_OUT ${CMAKE_BINARY_DIR}/include/dashql/parser/scanner.cc)
set(PARSER_OUT ${CMAKE_BINARY_DIR}/include/dashql/parser/parser.cc)
set(PARSER_HEADER_OUT ${CMAKE_BINARY_DIR}/include/dashql/parser/parser.h)

if(NOT EXISTS ${CMAKE_BINARY_DIR}/include/dashql/parser/)
  file(MAKE_DIRECTORY ${CMAKE_BINARY_DIR}/include/dashql/parser/)
endif()

# Generate parser & scanner
add_custom_command(
  OUTPUT ${SCANNER_OUT} ${PARSER_OUT} ${PARSER_HEADER_OUT}
  COMMAND
    ${BISON_EXECUTABLE} --defines=${PARSER_HEADER_OUT} --output=${PARSER_OUT}
    --report=state --report-file=${CMAKE_BINARY_DIR}/bison.log ${GRAMMAR_OUT}
  COMMAND ${FLEX_EXECUTABLE} --outfile=${SCANNER_OUT}
          ${CMAKE_SOURCE_DIR}/src/parser/scanner.l
  DEPENDS ${GRAMMAR_OUT} ${CMAKE_SOURCE_DIR}/src/parser/scanner.l)

add_library(
  dashql_parser
  ${SCANNER_OUT}
  ${PARSER_OUT}
  ${CMAKE_SOURCE_DIR}/src/parser/dson.cc
  ${CMAKE_SOURCE_DIR}/src/parser/enums.cc
  ${CMAKE_SOURCE_DIR}/src/parser/highlighting.cc
  ${CMAKE_SOURCE_DIR}/src/parser/keywords.cc
  ${CMAKE_SOURCE_DIR}/src/parser/nodes.cc
  ${CMAKE_SOURCE_DIR}/src/parser/parser_driver.cc
  ${CMAKE_SOURCE_DIR}/src/parser/qualified_name.cc
  ${CMAKE_SOURCE_DIR}/src/parser/scanner.cc
  ${CMAKE_SOURCE_DIR}/src/parser/script_options.cc)

target_link_libraries(dashql_parser dashql_proto)

# ---------------------------------------------------------------------------
# Libraries

add_library(
  dashql_common
  ${CMAKE_SOURCE_DIR}/src/common/wasm_response.cc
  ${CMAKE_SOURCE_DIR}/src/common/substring_buffer.cc
  ${CMAKE_SOURCE_DIR}/src/common/union_find.cc)

add_library(
  dashql_analyzer
  ${CMAKE_SOURCE_DIR}/src/analyzer/analyzer.cc
  ${CMAKE_SOURCE_DIR}/src/analyzer/analyzer_api.cc
  ${CMAKE_SOURCE_DIR}/src/analyzer/board_space.cc
  ${CMAKE_SOURCE_DIR}/src/analyzer/function_logic.cc
  ${CMAKE_SOURCE_DIR}/src/analyzer/input_value.cc
  ${CMAKE_SOURCE_DIR}/src/analyzer/json_patch.cc
  ${CMAKE_SOURCE_DIR}/src/analyzer/json_writer.cc
  ${CMAKE_SOURCE_DIR}/src/analyzer/program_editor.cc
  ${CMAKE_SOURCE_DIR}/src/analyzer/program_instance.cc
  ${CMAKE_SOURCE_DIR}/src/analyzer/program_matcher.cc
  ${CMAKE_SOURCE_DIR}/src/analyzer/stmt/fetch_stmt.cc
  ${CMAKE_SOURCE_DIR}/src/analyzer/stmt/input_stmt.cc
  ${CMAKE_SOURCE_DIR}/src/analyzer/stmt/load_stmt.cc
  ${CMAKE_SOURCE_DIR}/src/analyzer/stmt/transform_stmt.cc
  ${CMAKE_SOURCE_DIR}/src/analyzer/stmt/viz_stmt.cc
  ${CMAKE_SOURCE_DIR}/src/analyzer/syntax_matcher.cc
  ${CMAKE_SOURCE_DIR}/src/analyzer/task_planner.cc
  ${CMAKE_SOURCE_DIR}/src/analyzer/value_packing.cc
  ${CMAKE_SOURCE_DIR}/src/analyzer/value_printing.cc)

add_library(dashql_jmespath ${CMAKE_SOURCE_DIR}/src/jmespath/jmespath.cc
                            ${CMAKE_SOURCE_DIR}/src/jmespath/jmespath_api.cc)

add_library(dashql_test ${CMAKE_SOURCE_DIR}/src/test/analyzer_tests.cc
                        ${CMAKE_SOURCE_DIR}/src/test/grammar_tests.cc)

target_link_libraries(dashql_common dashql_proto flatbuffers rapidjson arrow)
target_link_libraries(
  dashql_analyzer
  dashql_parser
  dashql_common
  dashql_proto
  rapidjson
  fmt
  arrow)
target_link_libraries(dashql_jmespath dashql_common nlohmann_json jmespath)
target_link_libraries(
  dashql_test
  dashql_analyzer
  dashql_jmespath
  dashql_common
  dashql_proto
  pugixml
  gtest)

# ---------------------------------------------------------------------------
# Emscripten

# We need "-s WARN_ON_UNDEFINED_SYMBOLS=0" to instantiate the module with our
# own imports.
if(EMSCRIPTEN)
  set(ADDITIONAL_LINKER_FLAGS)
  if(WASM_FAST_LINKING)
    set(ADDITIONAL_LINKER_FLAGS -O0)
  else()
    set(ADDITIONAL_LINKER_FLAGS -Os)
  endif()

  add_executable(analyzer_wasm ${CMAKE_SOURCE_DIR}/src/wasm_main.cc)
  target_link_libraries(analyzer_wasm dashql_analyzer)
  set_target_properties(
    analyzer_wasm
    PROPERTIES
      LINK_FLAGS
      " -s ENVIRONMENT='web,node' \
        -s WARN_ON_UNDEFINED_SYMBOLS=1 \
        -s ALLOW_MEMORY_GROWTH=1 \
        -s USE_PTHREADS=0 \
        -s DISABLE_EXCEPTION_CATCHING=0 \
        -s MODULARIZE=1 \
        -s FILESYSTEM=0 \
        -s EXPORT_ES6=1 \
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
            _dashql_analyzer_update_task_status \
        ]' \
        -s EXPORTED_RUNTIME_METHODS='[\"ccall\"]' \
        ${ADDITIONAL_LINKER_FLAGS} \
        ")

  add_executable(jmespath_wasm ${CMAKE_SOURCE_DIR}/src/wasm_main.cc)
  target_link_libraries(jmespath_wasm dashql_jmespath)
  set_target_properties(
    jmespath_wasm
    PROPERTIES
      LINK_FLAGS
      " -s ENVIRONMENT='web,node' \
        -s WARN_ON_UNDEFINED_SYMBOLS=1 \
        -s ALLOW_MEMORY_GROWTH=1 \
        -s USE_PTHREADS=0 \
        -s DISABLE_EXCEPTION_CATCHING=0 \
        -s MODULARIZE=1 \
        -s FILESYSTEM=0 \
        -s EXPORT_ES6=1 \
        -s EXPORT_NAME='JMESPath' \
        -s EXPORTED_FUNCTIONS='[ \
            _main, \
            _malloc, \
            _free, \
            _jmespath_clear_response, \
            _jmespath_evaluate, \
            _jmespath_evaluate_utf8 \
        ]' \
        -s EXPORTED_RUNTIME_METHODS='[\"ccall\"]' \
        ${ADDITIONAL_LINKER_FLAGS} \
        ")
else()

endif()

# ---------------------------------------------------------------------------
# Tester

if(NOT EMSCRIPTEN)
  set(TEST_CC
      ${CMAKE_SOURCE_DIR}/test/analyzer/analyzer_spec_tests.cc
      ${CMAKE_SOURCE_DIR}/test/analyzer/function_logic_test.cc
      ${CMAKE_SOURCE_DIR}/test/analyzer/program_editor_test.cc
      ${CMAKE_SOURCE_DIR}/test/analyzer/program_matcher_test.cc
      ${CMAKE_SOURCE_DIR}/test/analyzer/syntax_matcher_test.cc
      ${CMAKE_SOURCE_DIR}/test/common/substring_buffer_test.cc
      ${CMAKE_SOURCE_DIR}/test/common/topological_sort_test.cc
      ${CMAKE_SOURCE_DIR}/test/common/union_find_test.cc
      ${CMAKE_SOURCE_DIR}/test/jmespath/jmespath_test.cc
      ${CMAKE_SOURCE_DIR}/test/parser/grammar_spec_tests.cc
      ${CMAKE_SOURCE_DIR}/test/tester.cc)
  set(TEST_LIBS
      dashql_test
      dashql_analyzer
      dashql_common
      dashql_proto
      jmespath
      flatbuffers
      gtest
      gmock
      gflags
      ${THREAD_LIBS})

  add_executable(tester ${TEST_CC})
  target_link_libraries(tester ${TEST_LIBS})

  add_executable(testgen ${CMAKE_SOURCE_DIR}/test/testgen.cc)
  target_link_libraries(testgen ${TEST_LIBS})
endif()
