# ---------------------------------------------------------------------------
# Tigon
# (c) 2019 Andre Kohn
# ---------------------------------------------------------------------------

project(tigon_proto)
cmake_minimum_required(VERSION 3.10)

# ---------------------------------------------------------------------------
# Library

add_library(tigon_proto STATIC
    ${CMAKE_CURRENT_SOURCE_DIR}/include/tigon/proto/duckdb.pb.cc
    ${CMAKE_CURRENT_SOURCE_DIR}/include/tigon/proto/rpath.pb.cc
    ${CMAKE_CURRENT_SOURCE_DIR}/include/tigon/proto/tql.pb.cc
    ${CMAKE_CURRENT_SOURCE_DIR}/include/tigon/proto/web_api.pb.cc
)
target_include_directories(tigon_proto INTERFACE ${CMAKE_CURRENT_SOURCE_DIR}/include)
target_link_libraries(tigon_proto protobuf)
