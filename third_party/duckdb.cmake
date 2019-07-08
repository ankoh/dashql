# ---------------------------------------------------------------------------
# Tigon
# (c) 2019 Andre Kohn
# ---------------------------------------------------------------------------

include(ExternalProject)

ExternalProject_Add(
    duckdb_build
    SOURCE_DIR "${CMAKE_SOURCE_DIR}/third_party/duckdb"
    CMAKE_ARGS
        -GNinja
        -DCMAKE_CXX_COMPILER=${CMAKE_CXX_COMPILER}
        -DCMAKE_C_COMPILER=${CMAKE_C_COMPILER}
        -DCMAKE_TOOLCHAIN_FILE=${CMAKE_TOOLCHAIN_FILE}
        -DCMAKE_MODULE_PATH=${CMAKE_MODULE_PATH}
        -DCMAKE_BUILD_TYPE=${CMAKE_BUILD_TYPE}
    DOWNLOAD_COMMAND ""
    UPDATE_COMMAND ""
    INSTALL_COMMAND ""
    BUILD_COMMAND ninja duckdb_static
    BUILD_BYPRODUCTS src/libduckdb_static.a
)

ExternalProject_Get_Property(duckdb_build BINARY_DIR)
set(DUCKDB_INCLUDE_DIR "${CMAKE_SOURCE_DIR}/third_party/duckdb/src/include")
set(DUCKDB_LIBRARY_PATH ${BINARY_DIR}/src/libduckdb_static.a)

add_library(duckdb STATIC IMPORTED)
set_property(TARGET duckdb PROPERTY IMPORTED_LOCATION ${DUCKDB_LIBRARY_PATH})
set_property(TARGET duckdb APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${DUCKDB_INCLUDE_DIR})
add_dependencies(duckdb duckdb_build)
