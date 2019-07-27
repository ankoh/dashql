# ---------------------------------------------------------------------------
# Tigon
# (c) 2019 Andre Kohn
# ---------------------------------------------------------------------------

include(ExternalProject)

ExternalProject_Add(
    double_conversion_build
    SOURCE_DIR "${CMAKE_SOURCE_DIR}/third_party/double-conversion"
    PREFIX "${CMAKE_BINARY_DIR}/third_party/double-conversion"
    INSTALL_DIR "${CMAKE_BINARY_DIR}/third_party/double-conversion/install"
    CMAKE_ARGS
        -G${CMAKE_GENERATOR}
        -DCMAKE_CXX_STANDARD=17
        -DCMAKE_CXX_FLAGS=-std=c++17
        -DCMAKE_CXX_COMPILER=${CMAKE_CXX_COMPILER}
        -DCMAKE_C_COMPILER=${CMAKE_C_COMPILER}
        -DCMAKE_TOOLCHAIN_FILE=${CMAKE_TOOLCHAIN_FILE}
        -DCMAKE_MODULE_PATH=${CMAKE_MODULE_PATH}
        -DCMAKE_BUILD_TYPE=Release
        -DCMAKE_INSTALL_PREFIX=<INSTALL_DIR>
    DOWNLOAD_COMMAND ""
    UPDATE_COMMAND ""
    BUILD_BYPRODUCTS
        <INSTALL_DIR>/lib/libdouble-conversion.a
)

ExternalProject_Get_Property(double_conversion_build install_dir)
set(DOUBLE_CONVERSION_INCLUDE_DIR ${install_dir}/include)
set(DOUBLE_CONVERSION_LIBRARY_PATH ${install_dir}/lib/libdouble-conversion.a)
file(MAKE_DIRECTORY ${DOUBLE_CONVERSION_INCLUDE_DIR})

add_library(double_conversion STATIC IMPORTED)
set_property(TARGET double_conversion PROPERTY IMPORTED_LOCATION ${DOUBLE_CONVERSION_LIBRARY_PATH})
set_property(TARGET double_conversion APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${DOUBLE_CONVERSION_INCLUDE_DIR})

add_dependencies(double_conversion double_conversion_build)
