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
set(TQL_CC ${TQL_SCANNER_OUT} ${TQL_PARSER_OUT} ${TQL_COMPILER} ${TQL_PARSE_CONTEXT})
set(TQL_CC_LINTING ${TQL_COMPILER} ${TQL_PARSE_CONTEXT})

if(NOT EXISTS ${TQL_PARSER_OUT})
    file(WRITE ${TQL_PARSER_OUT} "")
endif()
if(NOT EXISTS ${TQL_PARSER_HEADER_OUT})
    file(WRITE ${TQL_PARSER_HEADER_OUT} "")
endif()
if(NOT EXISTS ${TQL_SCANNER_OUT})
    file(WRITE ${TQL_SCANNER_OUT} "")
endif()

# Generate parser & scanner
add_custom_target(tql_gen
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

add_library(tql ${TQL_CC})
target_include_directories(tql PRIVATE ${CMAKE_BINARY_DIR}/include)
set_property(TARGET tql PROPERTY CXX_STANDARD 17)
add_dependencies(tql tql_gen)

# ---------------------------------------------------------------------------
# Linting
# ---------------------------------------------------------------------------

add_clang_tidy_target(lint_parser_tql "${TQL_CC_LINTING}")
list(APPEND lint_targets lint_parser_tql)
