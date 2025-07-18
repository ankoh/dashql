if(POLICY CMP0048)
  cmake_policy(SET CMP0048 NEW)
endif(POLICY CMP0048)

cmake_minimum_required(VERSION 3.10)
project(dashql VERSION 0.1)

set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_FLAGS -std=c++20)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# ---------------------------------------------------------------------------
# Address sanitizer
if(NOT WASM AND(CMAKE_BUILD_TYPE MATCHES Debug))
  set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -fno-omit-frame-pointer -fsanitize=address")
  set(CMAKE_LINKER_FLAGS "${CMAKE_LINKER_FLAGS} -fno-omit-frame-pointer -fsanitize=address")
endif()

# ---------------------------------------------------------------------------
# Code coverage
if(CODE_COVERAGE AND NOT WASM)
  if("${CMAKE_C_COMPILER_ID}" MATCHES "(Apple)?[Cc]lang"
    OR "${CMAKE_CXX_COMPILER_ID}" MATCHES "(Apple)?[Cc]lang")
    message("Building with llvm code coverage")
    set(CMAKE_C_FLAGS
      "${CMAKE_C_FLAGS} -fprofile-instr-generate -fcoverage-mapping")
    set(CMAKE_CXX_FLAGS
      "${CMAKE_CXX_FLAGS} -fprofile-instr-generate -fcoverage-mapping")
  else()
    message(FATAL_ERROR "Code coverage requires Clang. Aborting.")
  endif()
endif()

# ---------------------------------------------------------------------------
# WASM
if(WASM)
  if(CMAKE_BUILD_TYPE MATCHES Release)
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -Os")
  endif()

  set(CMAKE_EXECUTABLE_SUFFIX ".wasm")
  set(CMAKE_CXX_FLAGS
    "${CMAKE_CXX_FLAGS} \
        -DWASM=1 \
        --target=wasm32-wasi \
        -fno-exceptions \
        ")
  set(CMAKE_EXE_LINKER_FLAGS
    "${CMAKE_EXE_LINKER_FLAGS} \
        -Wl,--export=dashql_version \
        -Wl,--export=dashql_malloc \
        -Wl,--export=dashql_free \
        -Wl,--export=dashql_delete_result \
        -Wl,--export=dashql_catalog_new \
        -Wl,--export=dashql_catalog_clear \
        -Wl,--export=dashql_catalog_contains_entry_id \
        -Wl,--export=dashql_catalog_describe_entries \
        -Wl,--export=dashql_catalog_describe_entries_of \
        -Wl,--export=dashql_catalog_load_script \
        -Wl,--export=dashql_catalog_drop_script \
        -Wl,--export=dashql_catalog_add_descriptor_pool \
        -Wl,--export=dashql_catalog_drop_descriptor_pool \
        -Wl,--export=dashql_catalog_add_schema_descriptor \
        -Wl,--export=dashql_catalog_add_schema_descriptors \
        -Wl,--export=dashql_catalog_get_statistics \
        -Wl,--export=dashql_catalog_flatten \
        -Wl,--export=dashql_script_new \
        -Wl,--export=dashql_script_insert_text_at \
        -Wl,--export=dashql_script_insert_char_at \
        -Wl,--export=dashql_script_erase_text_range \
        -Wl,--export=dashql_script_replace_text \
        -Wl,--export=dashql_script_to_string \
        -Wl,--export=dashql_script_scan \
        -Wl,--export=dashql_script_parse \
        -Wl,--export=dashql_script_analyze \
        -Wl,--export=dashql_script_get_catalog_entry_id \
        -Wl,--export=dashql_script_get_scanned \
        -Wl,--export=dashql_script_get_parsed \
        -Wl,--export=dashql_script_get_analyzed \
        -Wl,--export=dashql_script_get_statistics \
        -Wl,--export=dashql_script_move_cursor \
        -Wl,--export=dashql_script_complete_at_cursor \
        -Wl,--export=dashql_script_registry_new \
        -Wl,--export=dashql_script_registry_clear \
        -Wl,--export=dashql_script_registry_add_script \
        -Wl,--export=dashql_script_registry_drop_script \
        -Wl,--export=dashql_script_registry_find_column \
        -flto \
    ")
endif()

# ---------------------------------------------------------------------------
# CMake includes
set(CMAKE_MODULE_PATH ${CMAKE_SOURCE_DIR}/cmake/modules ${CMAKE_MODULE_PATH})
include(${CMAKE_SOURCE_DIR}/cmake/version.cmake)
include(${CMAKE_SOURCE_DIR}/cmake/flatbuffers.cmake)
include(${CMAKE_SOURCE_DIR}/cmake/frozen.cmake)
include(${CMAKE_SOURCE_DIR}/cmake/ankerl.cmake)
include(${CMAKE_SOURCE_DIR}/cmake/phmap.cmake)
include(${CMAKE_SOURCE_DIR}/cmake/rapidjson.cmake)
add_subdirectory(${CMAKE_SOURCE_DIR}/vendor/utf8proc)

if(NOT WASM)
  find_package(Threads REQUIRED)
  include(${CMAKE_SOURCE_DIR}/cmake/gtest.cmake)
  include(${CMAKE_SOURCE_DIR}/cmake/gflags.cmake)
  include(${CMAKE_SOURCE_DIR}/cmake/benchmark.cmake)
  include(${CMAKE_SOURCE_DIR}/cmake/pugixml.cmake)
endif()

include_directories("${CMAKE_SOURCE_DIR}/include" "${CMAKE_BINARY_DIR}/include")

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

set(GRAMMAR_SOURCE_DIR ${CMAKE_SOURCE_DIR}/../../grammar/)

set(GRAMMAR_OUT ${CMAKE_BINARY_DIR}/dashql.y)
set(GRAMMAR_DELIMITER ${GRAMMAR_SOURCE_DIR}/delimiter.y)
set(GRAMMAR_PROLOGUE ${GRAMMAR_SOURCE_DIR}/prologue.y)
set(GRAMMAR_EPILOGUE ${GRAMMAR_SOURCE_DIR}/epilogue.y)
set(GRAMMAR_PRECEDENCES ${GRAMMAR_SOURCE_DIR}/precedences.y)

set(GRAMMAR_KEYWORDS
  ${GRAMMAR_SOURCE_DIR}/lists/sql_column_name_keywords.list
  ${GRAMMAR_SOURCE_DIR}/lists/sql_reserved_keywords.list
  ${GRAMMAR_SOURCE_DIR}/lists/sql_type_func_keywords.list
  ${GRAMMAR_SOURCE_DIR}/lists/sql_unreserved_keywords.list)

set(GRAMMAR_RULES
  ${GRAMMAR_SOURCE_DIR}/rules/sql_create.y
  ${GRAMMAR_SOURCE_DIR}/rules/sql_select.y
  ${GRAMMAR_SOURCE_DIR}/rules/sql_view.y
  ${GRAMMAR_SOURCE_DIR}/rules/ext_statement.y
  ${GRAMMAR_SOURCE_DIR}/rules/ext_set.y
  ${GRAMMAR_SOURCE_DIR}/rules/ext_varargs.y)

set(GRAMMAR_TYPES
  ${GRAMMAR_SOURCE_DIR}/rules/sql_create.yh
  ${GRAMMAR_SOURCE_DIR}/rules/sql_select.yh
  ${GRAMMAR_SOURCE_DIR}/rules/sql_view.yh
  ${GRAMMAR_SOURCE_DIR}/rules/ext_statement.yh
  ${GRAMMAR_SOURCE_DIR}/rules/ext_set.yh
  ${GRAMMAR_SOURCE_DIR}/rules/ext_varargs.yh)

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
  # %type<string_view> file1
  # %token<string_view> FILE1_KEYWORD1 FILE1_KEYWORD2
  # %type<string_view> file2
  # %token<string_view> FILE2_KEYWORD1 FILE2_KEYWORD2
  COMMAND
  awk -F,
  "{n = split(FILENAME, p, \"/\"); bn=p[n]; bn=substr(bn, 1, length(bn)-5); t=substr($3, 1, length($3)-1); if (FNR == 1) { printf \"\\n%%type<std::string_view> \" bn \"\\n%%token<std::string_view> \" t } else { printf t }} END {print \"\\n\"}"
  ${GRAMMAR_KEYWORDS} >> ${GRAMMAR_OUT}

  # Write precedence rules
  COMMAND cat ${GRAMMAR_PRECEDENCES} >> ${GRAMMAR_OUT}

  # Write token types
  COMMAND cat ${GRAMMAR_TYPES} >> ${GRAMMAR_OUT}

  # RULES
  # ------------------------------------------------
  COMMAND echo "%%" >> ${GRAMMAR_OUT}

  # Write the keyword bison rules
  # Output:
  # file1: FILE1_KEYWORD1{$$=$1;} | FILE1_KEYWORD2{$$=$1;};
  # file2: FILE2_KEYWORD1{$$=$1;} | FILE2_KEYWORD2{$$=$1;};
  COMMAND
  awk -F,
  "{n = split(FILENAME, p, \"/\"); bn=p[n]; bn=substr(bn, 1, length(bn)-5); t=substr($3, 1, length($3) - 1); if (NR == 1 && FNR == 1) {printf \"\\n\" bn \":\" t \"{$$=$1;}\"} else if (FNR == 1) {printf \";\\n\" bn \":\" t \"{$$=$1;}\"} else {printf \"|\" t \"{$$=$1;}\"}} END {printf \";\\n\\n\"}"
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

set(SCANNER_OUT ${CMAKE_BINARY_DIR}/include/dashql/parser/scanner_generated.cc)
set(PARSER_OUT ${CMAKE_BINARY_DIR}/include/dashql/parser/parser_generated.cc)
set(PARSER_HEADER_OUT ${CMAKE_BINARY_DIR}/include/dashql/parser/parser_generated.h)

if(NOT EXISTS ${CMAKE_BINARY_DIR}/include/dashql/parser/)
  file(MAKE_DIRECTORY ${CMAKE_BINARY_DIR}/include/dashql/parser/)
endif()

# Generate parser & scanner
add_custom_command(
  OUTPUT ${SCANNER_OUT} ${PARSER_OUT} ${PARSER_HEADER_OUT}
  COMMAND ${FLEX_EXECUTABLE}
    --outfile=${SCANNER_OUT} -F -8
    ${GRAMMAR_SOURCE_DIR}/scanner.l
  COMMAND ${BISON_EXECUTABLE}
    --defines=${PARSER_HEADER_OUT}
    --output=${PARSER_OUT}
    --report=state
    --report-file=${CMAKE_BINARY_DIR}/bison.log
    ${GRAMMAR_OUT}
  COMMAND sed -e "s/private:/protected:/g" ${PARSER_HEADER_OUT} > ${PARSER_HEADER_OUT}.mod
  COMMAND ${CMAKE_COMMAND} -E rename ${PARSER_HEADER_OUT}.mod ${PARSER_HEADER_OUT}
  DEPENDS ${GRAMMAR_SOURCE_DIR}/scanner.l ${GRAMMAR_KEYWORDS} ${GRAMMAR_RULES} ${GRAMMAR_TYPES} ${GRAMMAR_OUT})

# ---------------------------------------------------------------------------
# Module

set(LIB_SRC
  ${SCANNER_OUT}
  ${PARSER_OUT}
  ${CMAKE_SOURCE_DIR}/src/analyzer/analysis_state.cc
  ${CMAKE_SOURCE_DIR}/src/analyzer/analyzer.cc
  ${CMAKE_SOURCE_DIR}/src/analyzer/completion.cc
  ${CMAKE_SOURCE_DIR}/src/analyzer/constant_propagation_pass.cc
  ${CMAKE_SOURCE_DIR}/src/analyzer/identify_column_restrictions_pass.cc
  ${CMAKE_SOURCE_DIR}/src/analyzer/identify_column_transforms_pass.cc
  ${CMAKE_SOURCE_DIR}/src/analyzer/identify_function_calls_pass.cc
  ${CMAKE_SOURCE_DIR}/src/analyzer/name_resolution_pass.cc
  ${CMAKE_SOURCE_DIR}/src/analyzer/pass_manager.cc
  ${CMAKE_SOURCE_DIR}/src/api.cc
  ${CMAKE_SOURCE_DIR}/src/catalog.cc
  ${CMAKE_SOURCE_DIR}/src/parser/grammar/enums.cc
  ${CMAKE_SOURCE_DIR}/src/parser/grammar/keywords.cc
  ${CMAKE_SOURCE_DIR}/src/parser/grammar/state.cc
  ${CMAKE_SOURCE_DIR}/src/parser/grammar/tokens.cc
  ${CMAKE_SOURCE_DIR}/src/parser/parse_context.cc
  ${CMAKE_SOURCE_DIR}/src/parser/parser.cc
  ${CMAKE_SOURCE_DIR}/src/parser/scanner.cc
  ${CMAKE_SOURCE_DIR}/src/script.cc
  ${CMAKE_SOURCE_DIR}/src/script_comparison.cc
  ${CMAKE_SOURCE_DIR}/src/script_cursor.cc
  ${CMAKE_SOURCE_DIR}/src/script_registry.cc
  ${CMAKE_SOURCE_DIR}/src/script_signature.cc
  ${CMAKE_SOURCE_DIR}/src/script_snippet.cc
  ${CMAKE_SOURCE_DIR}/src/text/names.cc
  ${CMAKE_SOURCE_DIR}/src/utils/rope.cc
  ${CMAKE_SOURCE_DIR}/src/utils/murmur3.cc
  ${CMAKE_SOURCE_DIR}/src/utils/string_conversion.cc
)

if(WASM)
  add_executable(dashql ${LIB_SRC})
else()
  add_library(dashql ${LIB_SRC})
endif()

target_link_libraries(dashql dashql_version flatbuffers frozen ankerl utf8proc)

# ---------------------------------------------------------------------------
# Tester
if(NOT WASM)
  add_library(dashql_testutils
    ${CMAKE_SOURCE_DIR}/src/testing/analyzer_snapshot_test.cc
    ${CMAKE_SOURCE_DIR}/src/testing/completion_snapshot_test.cc
    ${CMAKE_SOURCE_DIR}/src/testing/parser_snapshot_test.cc
    ${CMAKE_SOURCE_DIR}/src/testing/registry_snapshot_test.cc
    ${CMAKE_SOURCE_DIR}/src/testing/xml_tests.cc
  )
  target_link_libraries(dashql_testutils dashql pugixml gtest)

  set(TEST_SRC
    ${CMAKE_SOURCE_DIR}/test/analyzer_snapshot_test_suite.cc
    ${CMAKE_SOURCE_DIR}/test/api_test.cc
    ${CMAKE_SOURCE_DIR}/test/catalog_test.cc
    ${CMAKE_SOURCE_DIR}/test/chunk_buffer_test.cc
    ${CMAKE_SOURCE_DIR}/test/completion_snapshot_test_suite.cc
    ${CMAKE_SOURCE_DIR}/test/completion_test.cc
    ${CMAKE_SOURCE_DIR}/test/cursor_test.cc
    ${CMAKE_SOURCE_DIR}/test/keywords_test.cc
    ${CMAKE_SOURCE_DIR}/test/name_tagging_test.cc
    ${CMAKE_SOURCE_DIR}/test/parser_snapshot_test_suite.cc
    ${CMAKE_SOURCE_DIR}/test/parser_test.cc
    ${CMAKE_SOURCE_DIR}/test/registry_snapshot_test_suite.cc
    ${CMAKE_SOURCE_DIR}/test/rope_test.cc
    ${CMAKE_SOURCE_DIR}/test/scanner_test.cc
    ${CMAKE_SOURCE_DIR}/test/script_test.cc
    ${CMAKE_SOURCE_DIR}/test/topk_test.cc
    ${CMAKE_SOURCE_DIR}/test/unification_test.cc
  )
  add_executable(tester test/tester.cc ${TEST_SRC})
  target_link_libraries(tester dashql_testutils pugixml gtest gmock gflags Threads::Threads)

  add_executable(benchmark_pipeline benchmarks/benchmark_pipeline.cc)
  target_link_libraries(benchmark_pipeline dashql_testutils benchmark gtest gflags Threads::Threads)

  add_executable(benchmark_pipeline_ctes benchmarks/benchmark_pipeline_ctes.cc)
  target_link_libraries(benchmark_pipeline_ctes dashql_testutils benchmark gtest gflags Threads::Threads)

  add_executable(benchmark_catalog benchmarks/benchmark_catalog.cc)
  target_link_libraries(benchmark_catalog dashql_testutils benchmark gtest gflags Threads::Threads)

  add_executable(snapshotter tools/snapshotter.cc)
  target_link_libraries(snapshotter dashql dashql_testutils pugixml gtest gflags Threads::Threads)

  add_executable(sql2tpl tools/sql2tpl.cc)
  target_link_libraries(sql2tpl dashql dashql_testutils pugixml gtest gflags Threads::Threads)
endif()
