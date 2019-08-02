# ---------------------------------------------------------------------------
# Tigon
# (c) 2019 Andre Kohn
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Bison & Flex
# ---------------------------------------------------------------------------

# Register flex and bison output
set(RPATH_SCANNER_OUT ${CMAKE_BINARY_DIR}/include/tigon/parser/rpath/rpath_scanner.cc)
set(RPATH_PARSER_OUT ${CMAKE_BINARY_DIR}/include/tigon/parser/rpath/rpath_parser.cc)
set(RPATH_PARSER_HEADER_OUT ${CMAKE_BINARY_DIR}/include/tigon/parser/rpath/rpath_parser.h)

set(RPATH_PARSE_CONTEXT ${CMAKE_SOURCE_DIR}/src/parser/rpath/rpath_parse_context.cc)
set(RPATH_SEMANTIC ${CMAKE_SOURCE_DIR}/src/parser/rpath/rpath_semantic.cc)
set(RPATH_CC ${RPATH_SCANNER_OUT} ${RPATH_PARSER_OUT} ${RPATH_COMPILER} ${RPATH_PARSE_CONTEXT} ${RPATH_SEMANTIC})
set(RPATH_CC_LINTING ${RPATH_COMPILER} ${RPATH_PARSE_CONTEXT})

if(NOT EXISTS ${RPATH_PARSER_OUT})
    file(WRITE ${RPATH_PARSER_OUT} "")
endif()
if(NOT EXISTS ${RPATH_PARSER_HEADER_OUT})
    file(WRITE ${RPATH_PARSER_HEADER_OUT} "")
endif()
if(NOT EXISTS ${RPATH_SCANNER_OUT})
    file(WRITE ${RPATH_SCANNER_OUT} "")
endif()

# Generate parser & scanner
add_custom_command(
    OUTPUT ${RPATH_SCANNER_OUT} ${RPATH_PARSER_OUT} 
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

add_library(tigon_rpath ${RPATH_CC})
target_include_directories(tigon_rpath PRIVATE ${CMAKE_BINARY_DIR}/include)
set_property(TARGET tigon_rpath PROPERTY CXX_STANDARD 17)

# ---------------------------------------------------------------------------
# Linting
# ---------------------------------------------------------------------------

add_clang_tidy_target(lint_parser_rpath "${RPATH_CC_LINTING}")
list(APPEND lint_targets lint_parser_rpath)
