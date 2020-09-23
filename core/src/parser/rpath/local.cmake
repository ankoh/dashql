# ---------------------------------------------------------------------------
# DashQL
# (c) 2019 Andre Kohn
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Bison & Flex
# ---------------------------------------------------------------------------

# Register flex and bison output
set(RPATH_SCANNER_OUT ${CMAKE_BINARY_DIR}/include/dashql/parser/rpath/rpath_scanner.cc)
set(RPATH_PARSER_OUT ${CMAKE_BINARY_DIR}/include/dashql/parser/rpath/rpath_parser.cc)
set(RPATH_PARSER_HEADER_OUT ${CMAKE_BINARY_DIR}/include/dashql/parser/rpath/rpath_parser.h)

set(RPATH_PARSE_CONTEXT ${CMAKE_SOURCE_DIR}/src/parser/rpath/rpath_parse_context.cc)
set(RPATH_SEMANTIC ${CMAKE_SOURCE_DIR}/src/parser/rpath/rpath_semantic.cc)
set(RPATH_CC ${RPATH_SCANNER_OUT} ${RPATH_PARSER_OUT} ${RPATH_COMPILER} ${RPATH_PARSE_CONTEXT} ${RPATH_SEMANTIC})
set(RPATH_CC_LINTING ${RPATH_COMPILER} ${RPATH_PARSE_CONTEXT})

IF(NOT EXISTS ${CMAKE_BINARY_DIR}/include/dashql/parser/rpath/)
    file(MAKE_DIRECTORY ${CMAKE_BINARY_DIR}/include/dashql/parser/rpath/)
ENDIF()

# Generate parser & scanner
add_custom_command(
    OUTPUT ${RPATH_SCANNER_OUT} ${RPATH_PARSER_OUT} ${RPATH_PARSER_HEADER_OUT}
    COMMAND ${BISON_EXECUTABLE}
        --defines=${RPATH_PARSER_HEADER_OUT}
        --output=${RPATH_PARSER_OUT}
        --report=state
        --report-file=${CMAKE_BINARY_DIR}/rpath_bison.log
        ${CMAKE_SOURCE_DIR}/src/parser/rpath/rpath_parser.y
    COMMAND ${FLEX_EXECUTABLE}
        --outfile=${RPATH_SCANNER_OUT}
        ${CMAKE_SOURCE_DIR}/src/parser/rpath/rpath_scanner.l
    DEPENDS
        ${CMAKE_SOURCE_DIR}/src/parser/rpath/rpath_parser.y
        ${CMAKE_SOURCE_DIR}/src/parser/rpath/rpath_scanner.l
)

add_library(dashql_rpath ${RPATH_CC})
target_include_directories(dashql_rpath PRIVATE ${CMAKE_BINARY_DIR}/include)
set_property(TARGET dashql_rpath PROPERTY CXX_STANDARD 17)

# ---------------------------------------------------------------------------
# Linting
# ---------------------------------------------------------------------------

add_clang_tidy_target(lint_parser_rpath "${RPATH_CC_LINTING}")
list(APPEND lint_targets lint_parser_rpath)
