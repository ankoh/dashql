# Copyright (c) 2020 The DashQL Authors

include(ExternalProject)

set(XLNT_CMAKE_PREFIX_PATH ${CMAKE_PREFIX_PATH})
list(APPEND XLNT_CMAKE_PREFIX_PATH ${NLOHMANN_JSON_INSTALL_DIR})

# Get xlnt
ExternalProject_Add(
    xlnt_ep
    SOURCE_DIR "${CMAKE_SOURCE_DIR}/../submodules/xlnt"
    PREFIX "third_party/xlnt"
    INSTALL_DIR "${CMAKE_BINARY_DIR}/third_party/xlnt/install"
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
        -DCMAKE_INSTALL_PREFIX=${CMAKE_BINARY_DIR}/third_party/xlnt/install
        -DTESTS=OFF
        -DSAMPLES=OFF
        -DBENCHMARKS=OFF
        -DPYTHONE=OFF
    DOWNLOAD_COMMAND ""
    UPDATE_COMMAND ""
)

# Prepare json
ExternalProject_Get_Property(xlnt_ep install_dir)
set(XLNT_INCLUDE_DIR ${install_dir}/include)
file(MAKE_DIRECTORY ${XLNT_INCLUDE_DIR})
add_library(xlnt INTERFACE)
target_include_directories(xlnt SYSTEM INTERFACE ${XLNT_INCLUDE_DIR})

# Dependencies
add_dependencies(xlnt xlnt_ep)
