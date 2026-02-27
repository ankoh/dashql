include(ExternalProject)

# DuckDB via ExternalProject. Only used for tests
ExternalProject_Add(
    duckdb_ep
    GIT_REPOSITORY "https://github.com/duckdb/duckdb.git"
    GIT_TAG 6ddac80
    TIMEOUT 60
    PREFIX "external_duckdb"
    INSTALL_DIR "external_duckdb/install"
    UPDATE_DISCONNECTED True
    CMAKE_ARGS
        -G${CMAKE_GENERATOR}
        -DCMAKE_INSTALL_PREFIX=${CMAKE_BINARY_DIR}/external_duckdb/install
        -DCMAKE_CXX_STANDARD=17
        -DCMAKE_CXX_COMPILER=${CMAKE_CXX_COMPILER}
        -DCMAKE_CXX_COMPILER_LAUNCHER=${CMAKE_CXX_COMPILER_LAUNCHER}
        -DCMAKE_C_COMPILER=${CMAKE_C_COMPILER}
        -DCMAKE_C_COMPILER_LAUNCHER=${CMAKE_C_COMPILER_LAUNCHER}
        -DCMAKE_TOOLCHAIN_FILE=${CMAKE_TOOLCHAIN_FILE}
        -DCMAKE_MODULE_PATH=${CMAKE_MODULE_PATH}
        -DCMAKE_BUILD_TYPE=Release
        -DBUILD_SHELL=FALSE
        -DBUILD_UNITTESTS=FALSE
        -DDISABLE_BUILTIN_EXTENSIONS=TRUE
    BUILD_BYPRODUCTS
        <INSTALL_DIR>/lib/libduckdb_static.a
        <INSTALL_DIR>/lib/libduckdb_re2.a
        <INSTALL_DIR>/lib/libduckdb_zstd.a
        <INSTALL_DIR>/lib/libduckdb_fmt.a
        <INSTALL_DIR>/lib/libduckdb_fsst.a
        <INSTALL_DIR>/lib/libduckdb_hyperloglog.a
        <INSTALL_DIR>/lib/libduckdb_miniz.a
        <INSTALL_DIR>/lib/libduckdb_mbedtls.a
        <INSTALL_DIR>/lib/libduckdb_yyjson.a
        <INSTALL_DIR>/lib/libduckdb_pg_query.a
        <INSTALL_DIR>/lib/libduckdb_utf8proc.a
        <INSTALL_DIR>/lib/libduckdb_fastpforlib.a
)

ExternalProject_Get_Property(duckdb_ep install_dir)
set(DUCKDB_SOURCE_DIR "${CMAKE_BINARY_DIR}/external_duckdb/src/duckdb_ep")
set(DUCKDB_INCLUDE_DIR "${install_dir}/include")

set(DUCKDB_UTF8PROC_INCLUDE_DIR "${DUCKDB_SOURCE_DIR}/third_party/utf8proc/include")
set(DUCKDB_RE2_INCLUDE_DIR "${DUCKDB_SOURCE_DIR}/third_party/re2")
set(DUCKDB_FMT_INCLUDE_DIR "${DUCKDB_SOURCE_DIR}/third_party/fmt/include")
set(DUCKDB_LIBRARY_PATH "${install_dir}/lib/libduckdb_static.a")

# Create include dirs so INTERFACE_INCLUDE_DIRECTORIES exist at configure time
# (CMake validates these paths; ExternalProject will populate them during build)
file(MAKE_DIRECTORY ${DUCKDB_INCLUDE_DIR})
file(MAKE_DIRECTORY ${DUCKDB_FMT_INCLUDE_DIR})
file(MAKE_DIRECTORY ${DUCKDB_UTF8PROC_INCLUDE_DIR})
file(MAKE_DIRECTORY ${DUCKDB_RE2_INCLUDE_DIR})
file(MAKE_DIRECTORY ${DUCKDB_SOURCE_DIR}/third_party/yyjson)
file(MAKE_DIRECTORY ${DUCKDB_SOURCE_DIR}/third_party/miniz)
file(MAKE_DIRECTORY ${DUCKDB_SOURCE_DIR}/third_party/zstd)

add_library(duckdb STATIC IMPORTED)
set_property(TARGET duckdb PROPERTY IMPORTED_LOCATION ${DUCKDB_LIBRARY_PATH})

target_link_libraries(
    duckdb
    INTERFACE
        ${install_dir}/lib/libduckdb_re2.a
        ${install_dir}/lib/libduckdb_zstd.a
        ${install_dir}/lib/libduckdb_fmt.a
        ${install_dir}/lib/libduckdb_fsst.a
        ${install_dir}/lib/libduckdb_hyperloglog.a
        ${install_dir}/lib/libduckdb_miniz.a
        ${install_dir}/lib/libduckdb_mbedtls.a
        ${install_dir}/lib/libduckdb_yyjson.a
        ${install_dir}/lib/libduckdb_pg_query.a
        ${install_dir}/lib/libduckdb_utf8proc.a
        ${install_dir}/lib/libduckdb_fastpforlib.a
        $<$<PLATFORM_ID:Unix>:dl>
)

target_include_directories(
    duckdb
    INTERFACE
        ${DUCKDB_INCLUDE_DIR}
        ${DUCKDB_FMT_INCLUDE_DIR}
        ${DUCKDB_UTF8PROC_INCLUDE_DIR}
        ${DUCKDB_RE2_INCLUDE_DIR}
        ${DUCKDB_SOURCE_DIR}/third_party/yyjson
        ${DUCKDB_SOURCE_DIR}/third_party/miniz
        ${DUCKDB_SOURCE_DIR}/third_party/zstd
)

add_dependencies(duckdb duckdb_ep)
