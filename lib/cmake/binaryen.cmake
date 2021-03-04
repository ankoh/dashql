# Copyright (c) 2020 The DashQL Authors

include(ExternalProject)

ExternalProject_Add(
    binaryen_ep
    SOURCE_DIR "${CMAKE_SOURCE_DIR}/../submodules/binaryen"
    PREFIX "${CMAKE_BINARY_DIR}/third_party/binaryen"
    INSTALL_DIR "${CMAKE_BINARY_DIR}/third_party/binaryen/install"
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
    INSTALL_COMMAND
        COMMAND ${CMAKE_COMMAND} -E make_directory <INSTALL_DIR>/include/ <INSTALL_DIR>/lib/
        COMMAND ${CMAKE_COMMAND} -E copy <BINARY_DIR>/lib/libbinaryen.a <INSTALL_DIR>/lib/
        COMMAND ${CMAKE_COMMAND} -E copy <SOURCE_DIR>/src/binaryen-c.h <SOURCE_DIR>/src/wasm-delegations.h <INSTALL_DIR>/include/
    BUILD_BYPRODUCTS
        <INSTALL_DIR>/lib/libbinaryen.a
)


ExternalProject_Get_Property(binaryen_ep install_dir)
set(BINARYEN_LIBRARY_PATH ${install_dir}/lib/libbinaryen.a)
set(BINARYEN_INCLUDE_DIR ${install_dir}/include)
file(MAKE_DIRECTORY ${BINARYEN_INCLUDE_DIR})

add_library(binaryen STATIC IMPORTED)
set_property(TARGET binaryen PROPERTY IMPORTED_LOCATION ${BINARYEN_LIBRARY_PATH})
set_property(TARGET binaryen APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${BINARYEN_INCLUDE_DIR})
add_dependencies(binaryen binaryen_ep)