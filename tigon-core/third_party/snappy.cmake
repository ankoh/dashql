# ---------------------------------------------------------------------------
# Tigon
# (c) 2019 Andre Kohn
# ---------------------------------------------------------------------------

include(ExternalProject)

ExternalProject_Add(
    snappy_build
    PREFIX "${CMAKE_BINARY_DIR}/third_party/snappy"
    SOURCE_DIR "${CMAKE_SOURCE_DIR}/third_party/snappy"
    INSTALL_DIR "${CMAKE_BINARY_DIR}/third_party/snappy/install"
    CMAKE_ARGS
        -G${CMAKE_GENERATOR}
        -DCMAKE_CXX_STANDARD=17
        -DCMAKE_CXX_FLAGS=-std=c++17
        -DCMAKE_CXX_COMPILER=${CMAKE_CXX_COMPILER}
        -DCMAKE_C_COMPILER=${CMAKE_C_COMPILER}
        -DCMAKE_TOOLCHAIN_FILE=${CMAKE_TOOLCHAIN_FILE}
        -DCMAKE_MODULE_PATH=${CMAKE_MODULE_PATH}
        -DCMAKE_BUILD_TYPE=${CMAKE_BUILD_TYPE}
        -DCMAKE_INSTALL_PREFIX=${CMAKE_BINARY_DIR}/third_party/snappy/install
        -DBUILD_SHARED_LIBS=OFF
        -DSNAPPY_BUILD_TESTS=OFF
    DOWNLOAD_COMMAND ""
    UPDATE_COMMAND ""
    BUILD_BYPRODUCTS
        <INSTALL_DIR>/lib/libsnappy.a
)

ExternalProject_Get_Property(snappy_build install_dir)
set(SNAPPY_INCLUDE_DIR ${install_dir}/include)
set(SNAPPY_LIBRARY_PATH ${install_dir}/lib/libsnappy.a)
file(MAKE_DIRECTORY ${SNAPPY_INCLUDE_DIR})

add_library(snappy STATIC IMPORTED)
set_property(TARGET snappy PROPERTY IMPORTED_LOCATION ${SNAPPY_LIBRARY_PATH})
set_property(TARGET snappy APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${SNAPPY_INCLUDE_DIR})

add_dependencies(snappy snappy_build)
