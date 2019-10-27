# ---------------------------------------------------------------------------
# Tigon
# (c) 2019 Andre Kohn
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Bison & Flex
# ---------------------------------------------------------------------------

# Register flex and bison output
set(TQL_SCANNER_OUT ${CMAKE_BINARY_DIR}/include/tigon/parser/tql/tql_scanner.cc)
set(TQL_PARSER_OUT ${CMAKE_BINARY_DIR}/include/tigon/parser/tql/tql_parser.cc)
set(TQL_PARSER_HEADER_OUT ${CMAKE_BINARY_DIR}/include/tigon/parser/tql/tql_parser.h)

set(TQL_PARSE_CONTEXT ${CMAKE_SOURCE_DIR}/src/parser/tql/tql_parse_context.cc)
set(TQL_SEMANTIC ${CMAKE_SOURCE_DIR}/src/parser/tql/tql_semantic.cc)
set(TQL_SYNTAX ${CMAKE_SOURCE_DIR}/src/parser/tql/tql_syntax.cc)
set(TQL_CC ${TQL_SCANNER_OUT} ${TQL_PARSER_OUT} ${TQL_COMPILER} ${TQL_PARSE_CONTEXT} ${TQL_SEMANTIC} ${TQL_SYNTAX})
set(TQL_CC_LINTING ${TQL_COMPILER} ${TQL_PARSE_CONTEXT} ${TQL_SEMANA})

IF(NOT EXISTS ${CMAKE_BINARY_DIR}/include/tigon/parser/tql/)
    file(MAKE_DIRECTORY ${CMAKE_BINARY_DIR}/include/tigon/parser/tql/)
ENDIF()

# Generate parser & scanner
add_custom_command(
    OUTPUT ${TQL_SCANNER_OUT} ${TQL_PARSER_OUT} ${TQL_PARSER_HEADER_OUT}
    COMMAND ${BISON_EXECUTABLE}
        --defines=${TQL_PARSER_HEADER_OUT}
        --output=${TQL_PARSER_OUT}
        --report=state
        --report-file=${CMAKE_BINARY_DIR}/tql_bison.log
        ${CMAKE_SOURCE_DIR}/src/parser/tql/tql_parser.y
    COMMAND ${FLEX_EXECUTABLE}
        --outfile=${TQL_SCANNER_OUT}
        ${CMAKE_SOURCE_DIR}/src/parser/tql/tql_scanner.l
    DEPENDS
        ${CMAKE_SOURCE_DIR}/src/parser/tql/tql_parser.y
        ${CMAKE_SOURCE_DIR}/src/parser/tql/tql_scanner.l
)

add_library(tigon_tql ${TQL_CC})
target_include_directories(tigon_tql PRIVATE ${CMAKE_BINARY_DIR}/include)
target_link_libraries(tigon_tql flatbuffers)
set_property(TARGET tigon_tql PROPERTY CXX_STANDARD 17)

# ---------------------------------------------------------------------------
# Linting
# ---------------------------------------------------------------------------

add_clang_tidy_target(lint_parser_tql "${TQL_CC_LINTING}")
list(APPEND lint_targets lint_parser_tql)
