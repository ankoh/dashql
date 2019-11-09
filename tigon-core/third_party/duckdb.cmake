# ---------------------------------------------------------------------------
# Tigon
# (c) 2019 Andre Kohn
# ---------------------------------------------------------------------------

include(ExternalProject)

ExternalProject_Add(
    duckdb_ep
    PREFIX "${CMAKE_BINARY_DIR}/third_party/duckdb"
    SOURCE_DIR "${CMAKE_SOURCE_DIR}/third_party/duckdb"
    INSTALL_DIR "${CMAKE_BINARY_DIR}/third_party/duckdb/install"
    CMAKE_ARGS
        -G${CMAKE_GENERATOR}
        -DCMAKE_BUILD_PARALLEL_LEVEL=${CMAKE_BUILD_PARALLEL_LEVEL}
        -DCMAKE_BUILD_TYPE=${CMAKE_BUILD_TYPE}
        -DCMAKE_CXX_COMPILER=${CMAKE_CXX_COMPILER}
        -DCMAKE_CXX_FLAGS=-std=c++17
        -DCMAKE_CXX_STANDARD=17
        -DCMAKE_C_COMPILER=${CMAKE_C_COMPILER}
        -DCMAKE_INSTALL_PREFIX=${CMAKE_BINARY_DIR}/third_party/duckdb/install
        -DCMAKE_MODULE_PATH=${CMAKE_MODULE_PATH}
        -DCMAKE_TOOLCHAIN_FILE=${CMAKE_TOOLCHAIN_FILE}
        -DLEAN=ON
    DOWNLOAD_COMMAND ""
    UPDATE_COMMAND ""
    BUILD_COMMAND ${CMAKE_MAKE_PROGRAM} -j${CMAKE_BUILD_PARALLEL_LEVEL} duckdb_static miniz re2 hyperloglog pg_query
    BUILD_BYPRODUCTS
        <INSTALL_DIR>/lib/libduckdb_static.a
        <INSTALL_DIR>/lib/libhyperloglog.a
        <INSTALL_DIR>/lib/libminiz.a
        <INSTALL_DIR>/lib/libpg_query.a
        <INSTALL_DIR>/lib/libre2.a
)

ExternalProject_Get_Property(duckdb_ep INSTALL_DIR)
set(DUCKDB_LIBRARY_PATH "${INSTALL_DIR}/lib/libduckdb_static.a")
set(DUCKDB_INCLUDE_DIR "${INSTALL_DIR}/include")
file(MAKE_DIRECTORY ${DUCKDB_INCLUDE_DIR})

add_library(duckdb STATIC IMPORTED)
set_property(TARGET duckdb PROPERTY IMPORTED_LOCATION ${DUCKDB_LIBRARY_PATH})
set_property(TARGET duckdb APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${DUCKDB_INCLUDE_DIR})
target_link_libraries(duckdb
    INTERFACE "${INSTALL_DIR}/lib/libduckdb_static.a"
    INTERFACE "${INSTALL_DIR}/lib/libhyperloglog.a"
    INTERFACE "${INSTALL_DIR}/lib/libminiz.a"
    INTERFACE "${INSTALL_DIR}/lib/libpg_query.a"
    INTERFACE "${INSTALL_DIR}/lib/libre2.a"
)
add_dependencies(duckdb duckdb_ep)
