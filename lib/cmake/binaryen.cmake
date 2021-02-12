# Copyright (c) 2020 The DashQL Authors

include(ExternalProject)

ExternalProject_Add(
    binaryen_ep
    SOURCE_DIR "${CMAKE_SOURCE_DIR}/../submodules/binaryen"
    PREFIX "${CMAKE_BINARY_DIR}/third_party/binaryen"
    CMAKE_ARGS
        -G${CMAKE_GENERATOR}
        -DCMAKE_CXX_STANDARD=17
        -DCMAKE_CXX_FLAGS=-std=c++17
        -DCMAKE_CXX_COMPILER=${CMAKE_CXX_COMPILER}
        -DCMAKE_CXX_COMPILER_LAUNCHER=${CMAKE_CXX_COMPILER_LAUNCHER}
        -DCMAKE_C_COMPILER=${CMAKE_C_COMPILER}
        -DCMAKE_C_COMPILER_LAUNCHER=${CMAKE_C_COMPILER_LAUNCHER}
        -DCMAKE_TOOLCHAIN_FILE=${CMAKE_TOOLCHAIN_FILE}
        -DCMAKE_MODULE_PATH=${CMAKE_MODULE_PATH}
        -DCMAKE_BUILD_TYPE=Release
        -DBUILD_STATIC_LIB=ON
    BUILD_COMMAND ${CMAKE_MAKE_PROGRAM} -j${CMAKE_BUILD_PARALLEL_LEVEL} binaryen
    DOWNLOAD_COMMAND ""
    UPDATE_COMMAND ""
    INSTALL_COMMAND ""
    BUILD_BYPRODUCTS
        <BINARY_DIR>/lib/libbinaryen.a
)

ExternalProject_Get_Property(binaryen_ep binary_dir)
ExternalProject_Get_Property(binaryen_ep source_dir)
set(BINARYEN_LIBRARY_PATH ${binary_dir}/lib/libbinaryen.a)
set(BINARYEN_INCLUDE_DIR ${source_dir}/src)

add_library(binaryen STATIC IMPORTED)
set_property(TARGET binaryen PROPERTY IMPORTED_LOCATION ${BINARYEN_LIBRARY_PATH})
set_property(TARGET binaryen APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${BINARYEN_INCLUDE_DIR})
add_dependencies(binaryen binaryen_ep)