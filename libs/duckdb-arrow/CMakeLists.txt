# Use project versions cmake --help-policy CMP0048
if(POLICY CMP0048)
  cmake_policy(SET CMP0048 NEW)
endif(POLICY CMP0048)

project(duckdb_arrow VERSION 0.1)
cmake_minimum_required(VERSION 3.10)

set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_FLAGS -std=c++17)
set(CMAKE_CXX_FLAGS_DEBUG
    "${CMAKE_CXX_FLAGS_DEBUG} -fno-omit-frame-pointer -fsanitize=address -fsanitize=undefined"
)

# ---------------------------------------------------------------------------
# Ccache

if(CCACHE_PROGRAM)
  set(CMAKE_C_COMPILER_LAUNCHER "${CCACHE_PROGRAM}")
  set(CMAKE_CXX_COMPILER_LAUNCHER "${CCACHE_PROGRAM}")
endif()

# ---------------------------------------------------------------------------
# Threads

set(CMAKE_THREAD_PREFER_PTHREAD TRUE)
set(THREADS_PREFER_PTHREAD_FLAG TRUE)
find_package(Threads REQUIRED)
set(THREAD_LIBS Threads::Threads)

# ---------------------------------------------------------------------------
# Parallelism

include(ProcessorCount)
ProcessorCount(NPROCS)
set(CMAKE_BUILD_PARALLEL_LEVEL ${NPROCS})

# ---------------------------------------------------------------------------
# CMake includes

set(CMAKE_MODULE_PATH ${CMAKE_SOURCE_DIR}/cmake/modules ${CMAKE_MODULE_PATH})
include("${CMAKE_SOURCE_DIR}/cmake/duckdb.cmake")
include("${CMAKE_SOURCE_DIR}/cmake/arrow.cmake")

# ---------------------------------------------------------------------------
# Headers

include_directories("${CMAKE_SOURCE_DIR}/include" "${CMAKE_BINARY_DIR}/include"
                    "${DUCKDB_INCLUDE_DIR}" "${DUCKDB_UTF8PROC_INCLUDE_DIR}")

# ---------------------------------------------------------------------------
# Libraries

add_library(duckdb_arrow ${CMAKE_SOURCE_DIR}/src/database.cc)
target_link_libraries(duckdb_arrow duckdb arrow ${THREAD_LIBS})
