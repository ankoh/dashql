# ---------------------------------------------------------------------------
# Tigon
# (c) 2019 Andre Kohn
# ---------------------------------------------------------------------------

include(ExternalProject)

ExternalProject_Add(
    rapidjson_ep
    PREFIX "${CMAKE_BINARY_DIR}/third_party/rapidjson"
    SOURCE_DIR "${CMAKE_SOURCE_DIR}/third_party/rapidjson"
    BUILD_COMMAND ""
    DOWNLOAD_COMMAND ""
    UPDATE_COMMAND ""
    INSTALL_COMMAND ""
)

ExternalProject_Get_Property(rapidjson_ep source_dir)
set(RAPIDJSON_INCLUDE_DIR ${source_dir}/include)

add_library(rapidjson INTERFACE)
set_property(TARGET rapidjson APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${RAPIDJSON_INCLUDE_DIR})

add_dependencies(rapidjson rapidjson_ep)
