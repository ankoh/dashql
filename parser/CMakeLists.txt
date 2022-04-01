# Copyright (c) 2022 The DashQL Authors
# ---------------------------------------------------------------------------

if(POLICY CMP0048)
  cmake_policy(SET CMP0048 NEW)
endif(POLICY CMP0048)

project(dashql_parser VERSION 0.1)
cmake_minimum_required(VERSION 3.10)

set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_FLAGS -std=c++17)

# ---------------------------------------------------------------------------
# Parallelism

include(ProcessorCount)
ProcessorCount(NPROCS)
set(CMAKE_BUILD_PARALLEL_LEVEL ${NPROCS})

# ---------------------------------------------------------------------------
# WASM

if(WASM)
  if(CMAKE_BUILD_TYPE MATCHES Release)
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -Os")
  endif()
  set(CMAKE_EXECUTABLE_SUFFIX ".wasm")
  set(CMAKE_CXX_FLAGS
      "${CMAKE_CXX_FLAGS} \
        --target=wasm32-wasi \
        -fno-exceptions \
        ")
  set(CMAKE_EXE_LINKER_FLAGS
      "${CMAKE_EXE_LINKER_FLAGS} \
        -Wl,--export=parse \
    ")
endif()

# ---------------------------------------------------------------------------
# CMake includes

set(CMAKE_MODULE_PATH ${CMAKE_SOURCE_DIR}/cmake/modules ${CMAKE_MODULE_PATH})
include("${CMAKE_SOURCE_DIR}/cmake/flatbuffers.cmake")

add_subdirectory("${CMAKE_SOURCE_DIR}/../packages/proto"
                 "${CMAKE_BINARY_DIR}/proto/")

# ---------------------------------------------------------------------------
# Module

add_executable(dashql_parser ${CMAKE_SOURCE_DIR}/src/parser.cc)
target_link_libraries(dashql_parser flatbuffers)
