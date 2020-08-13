# ---------------------------------------------------------------------------
# Tigon
# (c) 2019 Andre Kohn
# ---------------------------------------------------------------------------

include(ExternalProject)

ExternalProject_Add(
    duckdb_ep
    SOURCE_DIR "${CMAKE_SOURCE_DIR}/../submodules/duckdb"
    PREFIX "${CMAKE_BINARY_DIR}/third_party/duckdb"
    DOWNLOAD_COMMAND ""
    UPDATE_COMMAND ""
    BUILD_COMMAND ""
    INSTALL_COMMAND ""
)

ExternalProject_Get_Property(duckdb_ep SOURCE_DIR)
set(DUCKDB_INCLUDE_DIR "${SOURCE_DIR}/src/include")

add_library(duckdb INTERFACE)

set_property(TARGET duckdb APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${DUCKDB_INCLUDE_DIR})

add_dependencies(duckdb duckdb_ep)
