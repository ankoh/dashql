# ---------------------------------------------------------------------------
# Tigon
# (c) 2019 Andre Kohn
# ---------------------------------------------------------------------------

cmake_minimum_required(VERSION 3.10)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include("${CMAKE_SOURCE_DIR}/cmake/clang-tidy.cmake")
include("${CMAKE_SOURCE_DIR}/third_party/duckdb.cmake")
include("${CMAKE_SOURCE_DIR}/third_party/flatbuffers.cmake")

include_directories(
    "${FLATBUFFERS_INCLUDE_DIR}"
    "${CMAKE_SOURCE_DIR}/include"
)

add_executable(tigon_web
    src/tools/web_api/web_api.cpp
)

target_link_libraries(tigon_web duckdb re2 miniz pg_query hyperloglog)


if(DEFINED ENV{EMSDK})
    set_target_properties(tigon_web PROPERTIES LINK_FLAGS "\
        -s MODULARIZE=1 \
        -s EXPORT_NAME=TigonCore \
        -s EXPORTED_FUNCTIONS='[_main, _run_query]' \
        -s EXTRA_EXPORTED_RUNTIME_METHODS='[\"ccall\", \"cwrap\"]' \
    ")
endif()
