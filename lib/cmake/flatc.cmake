# Copyright (c) 2020 The DashQL Authors

include(ExternalProject)

# Flatc (bypass emscripten toolchain)
ExternalProject_Add(
    flatc_ep
    SOURCE_DIR "${CMAKE_SOURCE_DIR}/../submodules/flatbuffers"
    PREFIX "${CMAKE_BINARY_DIR}/third_party/flatc"
    INSTALL_DIR "${CMAKE_BINARY_DIR}/third_party/flatc/install"
    CMAKE_ARGS
        -G${CMAKE_GENERATOR}
        -DCMAKE_CXX_STANDARD=17
        -DCMAKE_CXX_FLAGS=-std=c++17
        -DCMAKE_BUILD_TYPE=Release
        -DCMAKE_CXX_COMPILER=clang++
        -DCMAKE_CXX_COMPILER_LAUNCHER=${CMAKE_CXX_COMPILER_LAUNCHER}
        -DCMAKE_C_COMPILER=clang
        -DCMAKE_C_COMPILER_LAUNCHER=${CMAKE_C_COMPILER_LAUNCHER}
        -DCMAKE_INSTALL_PREFIX=${CMAKE_BINARY_DIR}/third_party/flatc/install
        -DFLATBUFFERS_BUILD_TESTS=OFF
        -DFLATBUFFERS_BUILD_FLATLIB=OFF
        -DFLATBUFFERS_BUILD_FLATC=ON
        -DFLATBUFFERS_BUILD_FLATHASH=OFF
        -DFLATBUFFERS_BUILD_SHAREDLIB=OFF
        -DFLATBUFFERS_INSTALL=ON
    BUILD_COMMAND ${CMAKE_MAKE_PROGRAM} flatc
    DOWNLOAD_COMMAND ""
    UPDATE_COMMAND ""
    BUILD_BYPRODUCTS
        <INSTALL_DIR>/bin/flatc
)

ExternalProject_Get_Property(flatc_ep install_dir)
set(FLATC ${install_dir}/bin/flatc)
