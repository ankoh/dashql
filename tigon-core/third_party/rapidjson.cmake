# ---------------------------------------------------------------------------
# Tigon
# (c) 2019 Andre Kohn
# ---------------------------------------------------------------------------

include(ExternalProject)

ExternalProject_Add(
    rapidjson_build
    PREFIX "${CMAKE_BINARY_DIR}/third_party/rapidjson"
    SOURCE_DIR "${CMAKE_SOURCE_DIR}/third_party/rapidjson"
    INSTALL_DIR "${CMAKE_BINARY_DIR}/third_party/rapidjson/install"
    CMAKE_ARGS
        -G${CMAKE_GENERATOR}
        -DCMAKE_CXX_STANDARD=17
        -DCMAKE_CXX_FLAGS=-std=c++17
        -DCMAKE_CXX_COMPILER=${CMAKE_CXX_COMPILER}
        -DCMAKE_C_COMPILER=${CMAKE_C_COMPILER}
        -DCMAKE_TOOLCHAIN_FILE=${CMAKE_TOOLCHAIN_FILE}
        -DCMAKE_MODULE_PATH=${CMAKE_MODULE_PATH}
        -DCMAKE_BUILD_TYPE=Release
        -DCMAKE_INSTALL_PREFIX=${CMAKE_BINARY_DIR}/third_party/rapidjson/install
    DOWNLOAD_COMMAND ""
    UPDATE_COMMAND ""
)

ExternalProject_Get_Property(rapidjson_build install_dir)
set(RAPIDJSON_INCLUDE_DIR ${install_dir}/include)
file(MAKE_DIRECTORY ${RAPIDJSON_INCLUDE_DIR})

add_library(rapidjson INTERFACE)
set_property(TARGET rapidjson APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${RAPIDJSON_INCLUDE_DIR})

add_dependencies(rapidjson rapidjson_build)
