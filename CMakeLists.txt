# ---------------------------------------------------------------------------
# Tigon
# (c) 2019 Andre Kohn
# ---------------------------------------------------------------------------

cmake_minimum_required(VERSION 3.10)

if(NOT DEFINED ENV{EMSDK})
    message(FATAL_ERROR "EMSDK environment variable not set")
endif()

set(EMSCRIPTEN_ROOT_DIR $ENV{EMSDK}/fastcomp/emscripten)
set(CMAKE_CXX_COMPILER em++)
set(CMAKE_C_COMPILER emcc)
set(CMAKE_TOOLCHAIN_FILE ${EMSCRIPTEN_ROOT_DIR}/cmake/Modules/Platform/Emscripten.cmake)
set(CMAKE_MODULE_PATH ${EMSCRIPTEN_ROOT_DIR}/cmake)

include("${CMAKE_SOURCE_DIR}/third_party/duckdb.cmake")

add_library(tigon_backend STATIC
    src/frontend/hello_world.cpp
)

target_link_libraries(tigon_backend duckdb)
