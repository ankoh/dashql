# Copyright (c) 2022 The DashQL Authors
# ---------------------------------------------------------------------------

if(POLICY CMP0048)
  cmake_policy(SET CMP0048 NEW)
endif(POLICY CMP0048)

project(dashql_parser VERSION 0.1)
cmake_minimum_required(VERSION 3.10)

set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_FLAGS -std=c++17)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# ---------------------------------------------------------------------------
# Parallelism

include(ProcessorCount)
ProcessorCount(NPROCS)
set(CMAKE_BUILD_PARALLEL_LEVEL ${NPROCS})

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
        -Wl,--export=dashql_parse \
        -flto \
    ")
endif()

# ---------------------------------------------------------------------------
# CMake includes

set(CMAKE_MODULE_PATH ${CMAKE_SOURCE_DIR}/cmake/modules ${CMAKE_MODULE_PATH})
include("${CMAKE_SOURCE_DIR}/cmake/flatbuffers.cmake")

add_subdirectory("${CMAKE_SOURCE_DIR}/../dashql-proto"
                 "${CMAKE_BINARY_DIR}/proto/")

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

set(GRAMMAR_OUT ${CMAKE_BINARY_DIR}/dashql.y)
set(GRAMMAR_DELIMITER ${CMAKE_SOURCE_DIR}/src/grammar/delimiter.y)
set(GRAMMAR_PROLOGUE ${CMAKE_SOURCE_DIR}/src/grammar/prologue.y)
set(GRAMMAR_EPILOGUE ${CMAKE_SOURCE_DIR}/src/grammar/epilogue.y)
set(GRAMMAR_PRECEDENCES ${CMAKE_SOURCE_DIR}/src/grammar/precedences.y)

set(GRAMMAR_KEYWORDS
    ${CMAKE_SOURCE_DIR}/src/grammar/lists/dashql_keywords.list
    ${CMAKE_SOURCE_DIR}/src/grammar/lists/sql_column_name_keywords.list
    ${CMAKE_SOURCE_DIR}/src/grammar/lists/sql_reserved_keywords.list
    ${CMAKE_SOURCE_DIR}/src/grammar/lists/sql_type_func_keywords.list
    ${CMAKE_SOURCE_DIR}/src/grammar/lists/sql_unreserved_keywords.list)

set(GRAMMAR_RULES
    ${CMAKE_SOURCE_DIR}/src/grammar/rules/dashql_import.y
    ${CMAKE_SOURCE_DIR}/src/grammar/rules/dashql_declare.y
    ${CMAKE_SOURCE_DIR}/src/grammar/rules/dashql_set.y
    ${CMAKE_SOURCE_DIR}/src/grammar/rules/dashql_load.y
    ${CMAKE_SOURCE_DIR}/src/grammar/rules/dashql_query.y
    ${CMAKE_SOURCE_DIR}/src/grammar/rules/dashql_statement.y
    ${CMAKE_SOURCE_DIR}/src/grammar/rules/dashql_viz.y
    ${CMAKE_SOURCE_DIR}/src/grammar/rules/dson.y
    ${CMAKE_SOURCE_DIR}/src/grammar/rules/sql_create.y
    ${CMAKE_SOURCE_DIR}/src/grammar/rules/sql_select.y
    ${CMAKE_SOURCE_DIR}/src/grammar/rules/sql_view.y)

set(GRAMMAR_TYPES
    ${CMAKE_SOURCE_DIR}/src/grammar/rules/dashql_import.yh
    ${CMAKE_SOURCE_DIR}/src/grammar/rules/dashql_declare.yh
    ${CMAKE_SOURCE_DIR}/src/grammar/rules/dashql_set.yh
    ${CMAKE_SOURCE_DIR}/src/grammar/rules/dashql_load.yh
    ${CMAKE_SOURCE_DIR}/src/grammar/rules/dashql_query.yh
    ${CMAKE_SOURCE_DIR}/src/grammar/rules/dashql_statement.yh
    ${CMAKE_SOURCE_DIR}/src/grammar/rules/dashql_viz.yh
    ${CMAKE_SOURCE_DIR}/src/grammar/rules/dson.yh
    ${CMAKE_SOURCE_DIR}/src/grammar/rules/sql_create.yh
    ${CMAKE_SOURCE_DIR}/src/grammar/rules/sql_select.yh
    ${CMAKE_SOURCE_DIR}/src/grammar/rules/sql_view.yh)

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
          ${CMAKE_SOURCE_DIR}/src/scanner.l
  DEPENDS ${GRAMMAR_OUT} ${CMAKE_SOURCE_DIR}/src/scanner.l)

# ---------------------------------------------------------------------------
# Module

set(LIB_SRC
    ${SCANNER_OUT}
    ${PARSER_OUT}
    ${CMAKE_SOURCE_DIR}/src/ffi.cc
    ${CMAKE_SOURCE_DIR}/src/ffi_response.cc
    ${CMAKE_SOURCE_DIR}/src/dson.cc
    ${CMAKE_SOURCE_DIR}/src/enums.cc
    ${CMAKE_SOURCE_DIR}/src/highlighting.cc
    ${CMAKE_SOURCE_DIR}/src/keywords.cc
    ${CMAKE_SOURCE_DIR}/src/nodes.cc
    ${CMAKE_SOURCE_DIR}/src/parser_driver.cc
    ${CMAKE_SOURCE_DIR}/src/scanner.cc)

if(WASM)
  add_executable(dashql_parser ${LIB_SRC})
else()
  add_library(dashql_parser ${LIB_SRC})
endif()

target_link_libraries(dashql_parser dashql_proto flatbuffers)
