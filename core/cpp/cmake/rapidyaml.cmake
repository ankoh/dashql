# Copyright (c) 2020 The DashQL Authors

include(ExternalProject)

# Get rapidyaml
ExternalProject_Add(
    rapidyaml_ep
    SOURCE_DIR "${CMAKE_SOURCE_DIR}/../../submodules/rapidyaml"
    PREFIX "third_party/rapidyaml"
    INSTALL_DIR "${CMAKE_BINARY_DIR}/third_party/rapidyaml/install"
    CMAKE_ARGS
        -G${CMAKE_GENERATOR}
        -DCMAKE_CXX_STANDARD=17
        -DCMAKE_CXX_FLAGS=-std=c++17
        -DCMAKE_CXX_COMPILER=${CMAKE_CXX_COMPILER}
        -DCMAKE_C_COMPILER=${CMAKE_C_COMPILER}
        -DCMAKE_TOOLCHAIN_FILE=${CMAKE_TOOLCHAIN_FILE}
        -DCMAKE_MODULE_PATH=${CMAKE_MODULE_PATH}
        -DCMAKE_BUILD_TYPE=Release
        -DCMAKE_INSTALL_PREFIX=${CMAKE_BINARY_DIR}/third_party/rapidyaml/install
        -DRYML_BUILD_BENCHMARKS=FALSE
        -DRYML_BUILD_TESTS=FALSE
        -DRYML_STANDALONE=OFF
    DOWNLOAD_COMMAND ""
    UPDATE_COMMAND ""
)

# Prepare json
ExternalProject_Get_Property(rapidyaml_ep install_dir)
set(RAPIDYAML_INCLUDE_DIR ${install_dir}/include)
set(RAPIDYAML_LIBRARY_PATH ${install_dir}/lib/libryml.a)
set(C4CORE_LIBRARY_PATH ${install_dir}/lib/libc4core.a)
file(MAKE_DIRECTORY ${RAPIDYAML_INCLUDE_DIR})

add_library(ryml_c4core STATIC IMPORTED)
set_property(TARGET ryml_c4core PROPERTY IMPORTED_LOCATION ${C4CORE_LIBRARY_PATH})
set_property(TARGET ryml_c4core APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${RAPIDYAML_INCLUDE_DIR})

add_library(ryml STATIC IMPORTED)
set_property(TARGET ryml PROPERTY IMPORTED_LOCATION ${RAPIDYAML_LIBRARY_PATH})
set_property(TARGET ryml APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${RAPIDYAML_INCLUDE_DIR})

# Dependencies
add_dependencies(ryml rapidyaml_ep)


