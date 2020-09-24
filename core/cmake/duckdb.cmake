# ---------------------------------------------------------------------------
# DashQL
# (c) 2019 Andre Kohn
# ---------------------------------------------------------------------------

include(ExternalProject)

set(DUCKDB_SOURCE_DIR "${CMAKE_SOURCE_DIR}/../submodules/duckdb")
ExternalProject_Add(
    duckdb_ep
    SOURCE_DIR "${DUCKDB_SOURCE_DIR}"
    PREFIX "${CMAKE_BINARY_DIR}/third_party/duckdb"
    DOWNLOAD_COMMAND ""
    UPDATE_COMMAND ""
    BUILD_COMMAND ""
    INSTALL_COMMAND ""
)

ExternalProject_Get_Property(duckdb_ep SOURCE_DIR)
set(DUCKDB_INCLUDE_DIR "${SOURCE_DIR}/src/include")
set(DUCKDB_AMALGAMATION "${DUCKDB_SOURCE_DIR}/src/amalgamation/duckdb.cpp")

file(GLOB_RECURSE DUCKDB_SRC_FILES "${DUCKDB_SOURCE_DIR}/src" *.cpp)
string(REGEX REPLACE ".*amalgamation.*" "" DUCKDB_SRC_FILES "${DUCKDB_SRC_FILES}")

add_custom_command(OUTPUT ${DUCKDB_AMALGAMATION}
    COMMAND ${Python3_EXECUTABLE} "${DUCKDB_SOURCE_DIR}/scripts/amalgamation.py"
    WORKING_DIRECTORY "${DUCKDB_SOURCE_DIR}"
    DEPENDS ${DUCKDB_SRC_FILES}
)

add_library(duckdb INTERFACE)
set_property(TARGET duckdb APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${DUCKDB_INCLUDE_DIR})

add_dependencies(duckdb duckdb_ep)
