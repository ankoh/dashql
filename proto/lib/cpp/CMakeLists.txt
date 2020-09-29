project(duckdb_webapi_proto)
cmake_minimum_required(VERSION 3.10)

add_library(duckdb_webapi_proto INTERFACE)
target_include_directories(duckdb_webapi_proto INTERFACE ${CMAKE_CURRENT_SOURCE_DIR}/include)
target_link_libraries(duckdb_webapi_proto INTERFACE flatbuffers)

