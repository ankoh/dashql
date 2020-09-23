# ---------------------------------------------------------------------------
# DashQL
# (c) 2019 Andre Kohn
# ---------------------------------------------------------------------------

project(dashql_proto)
cmake_minimum_required(VERSION 3.10)

# ---------------------------------------------------------------------------
# Library

add_library(dashql_proto STATIC
    ${CMAKE_CURRENT_SOURCE_DIR}/include/dashql/proto/engine.pb.cc
    ${CMAKE_CURRENT_SOURCE_DIR}/include/dashql/proto/rpath.pb.cc
    ${CMAKE_CURRENT_SOURCE_DIR}/include/dashql/proto/tql.pb.cc
    ${CMAKE_CURRENT_SOURCE_DIR}/include/dashql/proto/web_api.pb.cc
)
target_include_directories(dashql_proto INTERFACE ${CMAKE_CURRENT_SOURCE_DIR}/include)
target_link_libraries(dashql_proto protobuf)
