# ---------------------------------------------------------------------------
# Tigon
# (c) 2019 Andre Kohn
# ---------------------------------------------------------------------------

cmake_minimum_required(VERSION 3.10)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# if(NOT DEFINED ENV{EMSDK})
#     message(FATAL_ERROR "EMSDK environment variable not set")
# endif()

# set(EMSCRIPTEN_ROOT_DIR $ENV{EMSDK}/fastcomp/emscripten)
# set(CMAKE_CXX_COMPILER em++)
# set(CMAKE_C_COMPILER emcc)
# set(CMAKE_TOOLCHAIN_FILE ${EMSCRIPTEN_ROOT_DIR}/cmake/Modules/Platform/Emscripten.cmake)
# set(CMAKE_MODULE_PATH ${EMSCRIPTEN_ROOT_DIR}/cmake)

include("${CMAKE_SOURCE_DIR}/third_party/duckdb.cmake")

add_executable(tigon
    src/hello_world.cpp
)

target_link_libraries(tigon duckdb re2 miniz pg_query hyperloglog)

set_target_properties(tigon PROPERTIES LINK_FLAGS "-s EXPORTED_FUNCTIONS='[_main, _run_query]' -s EXTRA_EXPORTED_RUNTIME_METHODS='[\"ccall\", \"cwrap\"]'")
