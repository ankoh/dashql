# Copyright (c) 2020 The DashQL Authors

include(ExternalProject)

# Get pugixml
ExternalProject_Add(
    pugixml_ep
    SOURCE_DIR "${CMAKE_SOURCE_DIR}/../submodules/pugixml"
    PREFIX "third_party/pugixml"
    INSTALL_DIR "${CMAKE_BINARY_DIR}/third_party/pugixml/install"
    CMAKE_ARGS
        -G${CMAKE_GENERATOR}
        -DCMAKE_CXX_STANDARD=17
        -DCMAKE_CXX_FLAGS=-std=c++17
        -DCMAKE_CXX_COMPILER=${CMAKE_CXX_COMPILER}
        -DCMAKE_C_COMPILER=${CMAKE_C_COMPILER}
        -DCMAKE_TOOLCHAIN_FILE=${CMAKE_TOOLCHAIN_FILE}
        -DCMAKE_MODULE_PATH=${CMAKE_MODULE_PATH}
        -DCMAKE_BUILD_TYPE=Release
        -DCMAKE_INSTALL_PREFIX=${CMAKE_BINARY_DIR}/third_party/pugixml/install
    DOWNLOAD_COMMAND ""
    UPDATE_COMMAND ""
)

# Prepare json
ExternalProject_Get_Property(pugixml_ep install_dir)
set(PUGIXML_INCLUDE_DIR ${install_dir}/include)
set(PUGIXML_LIBRARY_PATH ${install_dir}/lib/libpugixml.a)
file(MAKE_DIRECTORY ${PUGIXML_INCLUDE_DIR})

add_library(pugixml STATIC IMPORTED)
set_property(TARGET pugixml PROPERTY IMPORTED_LOCATION ${PUGIXML_LIBRARY_PATH})
set_property(TARGET pugixml APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${PUGIXML_INCLUDE_DIR})

# Dependencies
add_dependencies(pugixml pugixml_ep)


