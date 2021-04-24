# Copyright (c) 2020 The DashQL Authors

include(ExternalProject)

set(JMESPATH_CMAKE_PREFIX_PATH ${CMAKE_PREFIX_PATH})
list(APPEND JMESPATH_CMAKE_PREFIX_PATH ${NLOHMANN_JSON_INSTALL_DIR})

# Get jmespath
ExternalProject_Add(
    jmespath_ep
    SOURCE_DIR "${CMAKE_SOURCE_DIR}/../submodules/jmespath"
    PREFIX "third_party/jmespath"
    INSTALL_DIR "${CMAKE_BINARY_DIR}/third_party/jmespath/install"
    CMAKE_ARGS
        -G${CMAKE_GENERATOR}
        -DCMAKE_CXX_STANDARD=17
        -DCMAKE_CXX_FLAGS=-std=c++17
        -DCMAKE_CXX_COMPILER=${CMAKE_CXX_COMPILER}
        -DCMAKE_CXX_COMPILER_LAUNCHER=${CMAKE_CXX_COMPILER_LAUNCHER}
        -DCMAKE_C_COMPILER=${CMAKE_C_COMPILER}
        -DCMAKE_C_COMPILER_LAUNCHER=${CMAKE_C_COMPILER_LAUNCHER}
        -DCMAKE_TOOLCHAIN_FILE=${CMAKE_TOOLCHAIN_FILE}
        -DCMAKE_MODULE_PATH=${CMAKE_MODULE_PATH}
        -DCMAKE_BUILD_TYPE=Release
        -DCMAKE_INSTALL_PREFIX=${CMAKE_BINARY_DIR}/third_party/jmespath/install
        -DJMESPATH_BUILD_TESTS=OFF
        -DJMESPATH_COVERAGE_INFO=OFF
        -DBOOST_ROOT=${BOOST_ROOT}
        -DBOOST_INCLUDEDIR=${BOOST_INCLUDE_DIR}
        -DBOOST_LIBRARYDIR=${BOOST_LIBRARY_DIR}
        -DBoost_INCLUDE_DIR=${BOOST_INCLUDE_DIR}
        -DCMAKE_PREFIX_PATH=${JMESPATH_CMAKE_PREFIX_PATH}
        -Dnlohmann_json_DIR=${JMESPATH_CMAKE_PREFIX_PATH}/lib/cmake/nlohmann_json/
    DOWNLOAD_COMMAND ""
    UPDATE_COMMAND ""
)

# Prepare json
ExternalProject_Get_Property(jmespath_ep install_dir)
set(JMESPATH_INCLUDE_DIR ${install_dir}/include)
file(MAKE_DIRECTORY ${JMESPATH_INCLUDE_DIR})
add_library(jmespath INTERFACE)
target_include_directories(jmespath SYSTEM INTERFACE ${JMESPATH_INCLUDE_DIR})

# Dependencies
add_dependencies(jmespath_ep nlohmann_json_ep)
add_dependencies(jmespath jmespath_ep nlohmann_json_ep)

