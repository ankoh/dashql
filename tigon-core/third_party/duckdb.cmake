# ---------------------------------------------------------------------------
# Tigon
# (c) 2019 Andre Kohn
# ---------------------------------------------------------------------------

include(ExternalProject)

ExternalProject_Add(
    duckdb_build
    PREFIX "${CMAKE_BINARY_DIR}/third_party/duckdb"
    SOURCE_DIR "${CMAKE_SOURCE_DIR}/third_party/duckdb"
    CMAKE_ARGS
        -G${CMAKE_GENERATOR}
        -DCMAKE_CXX_COMPILER=${CMAKE_CXX_COMPILER}
        -DCMAKE_C_COMPILER=${CMAKE_C_COMPILER}
        -DCMAKE_TOOLCHAIN_FILE=${CMAKE_TOOLCHAIN_FILE}
        -DCMAKE_MODULE_PATH=${CMAKE_MODULE_PATH}
        -DCMAKE_BUILD_TYPE=${CMAKE_BUILD_TYPE}
    DOWNLOAD_COMMAND ""
    UPDATE_COMMAND ""
    INSTALL_COMMAND ""
    BUILD_COMMAND ${CMAKE_MAKE_PROGRAM} duckdb_static miniz re2 hyperloglog pg_query
    BUILD_BYPRODUCTS
        <BINARY_DIR>/src/libduckdb_static.a
        <BINARY_DIR>/third_party/hyperloglog/libhyperloglog.a
        <BINARY_DIR>/third_party/miniz/libminiz.a
        <BINARY_DIR>/third_party/libpg_query/libpg_query.a
        <BINARY_DIR>/third_party/re2/libre2.a
)

ExternalProject_Get_Property(duckdb_build BINARY_DIR)

set(DUCKDB_INCLUDE_DIR "${CMAKE_SOURCE_DIR}/third_party/duckdb/src/include")
set(DUCKDB_LIBRARY_PATH "${BINARY_DIR}/src/libduckdb_static.a")
set(DUCKDB_THIRD_PARTY_DIR "${CMAKE_SOURCE_DIR}/third_party/duckdb/third_party")

set(HYPERLOGLOG_INCLUDE_DIR "${DUCKDB_THIRD_PARTY_DIR}/hyperloglog")
set(MINIZ_INCLUDE_DIR "${DUCKDB_THIRD_PARTY_DIR}/miniz")
set(PG_QUERY_INCLUDE_DIR "${DUCKDB_THIRD_PARTY_DIR}/libpg_query/include")
set(RE2_INCLUDE_DIR "${DUCKDB_THIRD_PARTY_DIR}/re2")

set(HYPERLOGLOG_LIBRARY_PATH "${BINARY_DIR}/third_party/hyperloglog/libhyperloglog.a")
set(MINIZ_LIBRARY_PATH "${BINARY_DIR}/third_party/miniz/libminiz.a")
set(PG_QUERY_LIBRARY_PATH "${BINARY_DIR}/third_party/libpg_query/libpg_query.a")
set(RE2_LIBRARY_PATH "${BINARY_DIR}/third_party/re2/libre2.a")

add_library(hyperloglog STATIC IMPORTED)
set_property(TARGET hyperloglog PROPERTY IMPORTED_LOCATION ${HYPERLOGLOG_LIBRARY_PATH})
set_property(TARGET hyperloglog APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${HYPERLOGLOG_INCLUDE_DIR})
add_dependencies(hyperloglog duckdb_build)

add_library(miniz STATIC IMPORTED)
set_property(TARGET miniz PROPERTY IMPORTED_LOCATION ${MINIZ_LIBRARY_PATH})
set_property(TARGET miniz APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${MINIZ_INCLUDE_DIR})
add_dependencies(miniz duckdb_build)

add_library(pg_query STATIC IMPORTED)
set_property(TARGET pg_query PROPERTY IMPORTED_LOCATION ${PG_QUERY_LIBRARY_PATH})
set_property(TARGET pg_query APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${PG_QUERY_INCLUDE_DIR})
add_dependencies(pg_query duckdb_build)

add_library(re2 STATIC IMPORTED)
set_property(TARGET re2 PROPERTY IMPORTED_LOCATION ${RE2_LIBRARY_PATH})
set_property(TARGET re2 APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${RE2_INCLUDE_DIR})
add_dependencies(re2 duckdb_build)

add_library(duckdb STATIC IMPORTED)
set_property(TARGET duckdb PROPERTY IMPORTED_LOCATION ${DUCKDB_LIBRARY_PATH})
set_property(TARGET duckdb APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${DUCKDB_INCLUDE_DIR})
add_dependencies(duckdb duckdb_build)
