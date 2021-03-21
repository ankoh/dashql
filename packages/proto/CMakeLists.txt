# Copyright (c) 2020 The DashQL Authors

set(PROTO_INCLUDE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/gen/include")
set(PROTO_FILE "${PROTO_INCLUDE_DIR}/dashql/proto_generated.h")

if (NOT EXISTS "${PROTO_FILE}")
    message (FATAL_ERROR "Proto header does not exist. Did you forget to compile the flatbuffer schema?")
endif ()

add_library(dashql_proto INTERFACE)
target_include_directories(dashql_proto INTERFACE ${PROTO_INCLUDE_DIR})
target_link_libraries(dashql_proto INTERFACE flatbuffers)
