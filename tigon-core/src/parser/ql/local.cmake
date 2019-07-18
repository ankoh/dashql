# ---------------------------------------------------------------------------
# Tigon
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Bison & Flex
# ---------------------------------------------------------------------------

# Register flex and bison output
set(QL_SCANNER_OUT     "${CMAKE_SOURCE_DIR}/src/parser/ql/gen/ql_scanner.cc")
set(QL_PARSER_OUT      "${CMAKE_SOURCE_DIR}/src/parser/ql/gen/ql_parser.cc")
set(QL_PARSE_CONTEXT   "${CMAKE_SOURCE_DIR}/src/parser/ql/ql_parse_context.cc")
set(QL_CC ${QL_SCANNER_OUT} ${QL_PARSER_OUT} ${QL_COMPILER} ${QL_PARSE_CONTEXT})
set(QL_CC_LINTING ${QL_COMPILER} ${QL_PARSE_CONTEXT})

# Clear the output files
file(WRITE ${QL_SCANNER_OUT} "")
file(WRITE ${QL_PARSER_OUT} "")

# Generate parser & scanner
add_custom_target(ql_gen
    COMMAND ${BISON_EXECUTABLE}
        --defines="${CMAKE_SOURCE_DIR}/src/parser/ql/gen/ql_parser.h"
        --output=${QL_PARSER_OUT}
        --report=state
        --report-file="${CMAKE_BINARY_DIR}/ql_bison.log"
        "${CMAKE_SOURCE_DIR}/src/parser/ql/ql_parser.y"
    COMMAND ${FLEX_EXECUTABLE}
        --outfile=${QL_SCANNER_OUT}
        "${CMAKE_SOURCE_DIR}/src/parser/ql/ql_scanner.l"
    DEPENDS "${CMAKE_SOURCE_DIR}/src/parser/ql/ql_parser.y"
            "${CMAKE_SOURCE_DIR}/src/parser/ql/ql_scanner.l")

add_library(ql ${QL_CC})
add_dependencies(ql ql_gen)

# ---------------------------------------------------------------------------
# Linting
# ---------------------------------------------------------------------------

add_clang_tidy_target(lint_parser_ql "${QL_CC_LINTING}")
list(APPEND lint_targets lint_parser_ql)
