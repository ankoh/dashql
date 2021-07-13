# Copyright (c) 2020 The DashQL Authors

include(ExternalProject)

# Get fmt
ExternalProject_Add(
  fmt_ep
  SOURCE_DIR "${CMAKE_SOURCE_DIR}/../submodules/fmt"
  PREFIX "third_party/fmt"
  INSTALL_DIR "${CMAKE_BINARY_DIR}/third_party/fmt/install"
  CMAKE_ARGS -G${CMAKE_GENERATOR}
             -DCMAKE_CXX_STANDARD=17
             -DCMAKE_CXX_FLAGS=-std=c++17
             -DCMAKE_CXX_COMPILER=${CMAKE_CXX_COMPILER}
             -DCMAKE_CXX_COMPILER_LAUNCHER=${CMAKE_CXX_COMPILER_LAUNCHER}
             -DCMAKE_C_COMPILER=${CMAKE_C_COMPILER}
             -DCMAKE_C_COMPILER_LAUNCHER=${CMAKE_C_COMPILER_LAUNCHER}
             -DCMAKE_TOOLCHAIN_FILE=${CMAKE_TOOLCHAIN_FILE}
             -DCMAKE_MODULE_PATH=${CMAKE_MODULE_PATH}
             -DCMAKE_BUILD_TYPE=Release
             -DCMAKE_INSTALL_PREFIX=${CMAKE_BINARY_DIR}/third_party/fmt/install
  DOWNLOAD_COMMAND ""
  UPDATE_COMMAND ""
  BUILD_BYPRODUCTS <INSTALL_DIR>/lib/libfmt.a)

# Prepare json
ExternalProject_Get_Property(fmt_ep install_dir)
set(FMT_INCLUDE_DIR ${install_dir}/include)
set(FMT_LIBRARY_PATH ${install_dir}/lib/libfmt.a)
file(MAKE_DIRECTORY ${FMT_INCLUDE_DIR})

add_library(fmt STATIC IMPORTED)
set_property(TARGET fmt PROPERTY IMPORTED_LOCATION ${FMT_LIBRARY_PATH})
set_property(
  TARGET fmt
  APPEND
  PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${FMT_INCLUDE_DIR})

# Dependencies
add_dependencies(fmt fmt_ep)
