# Copyright (c) 2020 The DashQL Authors

include(ExternalProject)

# Get nlohmann_json
ExternalProject_Add(
    nlohmann_json_ep
    SOURCE_DIR "${CMAKE_SOURCE_DIR}/../submodules/nljson"
    PREFIX "third_party/nlohmann_json"
    INSTALL_DIR "${CMAKE_BINARY_DIR}/third_party/nlohmann_json/install"
    CMAKE_ARGS
        -G${CMAKE_GENERATOR}
        -DCMAKE_CXX_STANDARD=17
        -DCMAKE_CXX_FLAGS=-std=c++17
        -DCMAKE_CXX_COMPILER=${CMAKE_CXX_COMPILER}
        -DCMAKE_CXX_COMPILER_LAUNCHER=${CMAKE_CXX_COMPILER_LAUNCHER}
        -DCMAKE_C_COMPILER_LAUNCHER=${CMAKE_C_COMPILER_LAUNCHER}
        -DCMAKE_TOOLCHAIN_FILE=${CMAKE_TOOLCHAIN_FILE}
        -DCMAKE_MODULE_PATH=${CMAKE_MODULE_PATH}
        -DCMAKE_BUILD_TYPE=Release
        -DCMAKE_INSTALL_PREFIX=${CMAKE_BINARY_DIR}/third_party/nlohmann_json/install
        -DJSON_BuildTests=OFF
        -DJSON_Install=ON
        -DJSON_MultipleHeaders=ON
        -DJSON_ImplicitConversions=ON
        -DJSON_Diagnostics=OFF
        -DJSON_CI=OFF
    DOWNLOAD_COMMAND ""
    UPDATE_COMMAND ""
)

# Prepare json
ExternalProject_Get_Property(nlohmann_json_ep install_dir)
set(NLOHMANN_JSON_INSTALL_DIR ${install_dir})
set(NLOHMANN_JSON_INCLUDE_DIR ${install_dir}/include)
file(MAKE_DIRECTORY ${NLOHMANN_JSON_INCLUDE_DIR})
add_library(nlohmann_json INTERFACE)
target_include_directories(nlohmann_json SYSTEM INTERFACE ${NLOHMANN_JSON_INCLUDE_DIR})

# Dependencies
add_dependencies(nlohmann_json nlohmann_json_ep)

