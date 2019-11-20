# ---------------------------------------------------------------------------
# Tigon
# (c) 2019 Andre Kohn
# ---------------------------------------------------------------------------

include(ExternalProject)

# Protobuf library
ExternalProject_Add(
    protobuf_ep
    SOURCE_DIR "${CMAKE_SOURCE_DIR}/../submodules/protobuf"
    SOURCE_SUBDIR cmake
    PREFIX "${CMAKE_BINARY_DIR}/third_party/protobuf"
    INSTALL_DIR "${CMAKE_BINARY_DIR}/third_party/protobuf/install"
    CMAKE_ARGS
        -G${CMAKE_GENERATOR}
        -DCMAKE_CXX_STANDARD=17
        -DCMAKE_CXX_FLAGS=-std=c++17
        -DCMAKE_CXX_COMPILER=${CMAKE_CXX_COMPILER}
        -DCMAKE_C_COMPILER=${CMAKE_C_COMPILER}
        -DCMAKE_TOOLCHAIN_FILE=${CMAKE_TOOLCHAIN_FILE}
        -DCMAKE_MODULE_PATH=${CMAKE_MODULE_PATH}
        -DCMAKE_BUILD_TYPE=Release
        -DCMAKE_INSTALL_PREFIX=${CMAKE_BINARY_DIR}/third_party/protobuf/install
        -Dprotobuf_WITH_ZLIB=OFF
        -Dprotobuf_BUILD_TESTS=OFF
        -Dprotobuf_BUILD_CONFORMANCE=OFF
        -Dprotobuf_BUILD_EXAMPLES=OFF
        -Dprotobuf_BUILD_PROTOC_BINARIES=OFF
        -Dprotobuf_BUILD_SHARED_LIBS=OFF
    DOWNLOAD_COMMAND ""
    UPDATE_COMMAND ""
    BUILD_BYPRODUCTS
        <INSTALL_DIR>/lib/libprotobuf-lite.a
)

ExternalProject_Get_Property(protobuf_ep install_dir)
set(PROTOBUF_INCLUDE_DIR ${install_dir}/include)
set(PROTOBUF_LIBRARY_PATH ${install_dir}/lib/libprotobuf-lite.a)
file(MAKE_DIRECTORY ${PROTOBUF_INCLUDE_DIR})

add_library(protobuf STATIC IMPORTED)
set_property(TARGET protobuf PROPERTY IMPORTED_LOCATION ${PROTOBUF_LIBRARY_PATH})
set_property(TARGET protobuf APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${PROTOBUF_INCLUDE_DIR})

add_dependencies(protobuf protobuf_ep)

if(NOT EMSCRIPTEN)

# Protoc (bypass emscripten toolchain)
ExternalProject_Add(
    protoc_ep
    SOURCE_DIR "${CMAKE_SOURCE_DIR}/../submodules/protobuf"
    SOURCE_SUBDIR cmake
    PREFIX "${CMAKE_BINARY_DIR}/third_party/protoc"
    INSTALL_DIR "${CMAKE_BINARY_DIR}/third_party/protoc/install"
    CMAKE_ARGS
        -G${CMAKE_GENERATOR}
        -DCMAKE_CXX_STANDARD=17
        -DCMAKE_CXX_FLAGS=-std=c++17
        -DCMAKE_BUILD_TYPE=Release
        -DCMAKE_CXX_COMPILER=clang++
        -DCMAKE_C_COMPILER=clang
        -DCMAKE_INSTALL_PREFIX=${CMAKE_BINARY_DIR}/third_party/protoc/install
        -Dprotobuf_WITH_ZLIB=OFF
        -Dprotobuf_BUILD_TESTS=OFF
        -Dprotobuf_BUILD_CONFORMANCE=OFF
        -Dprotobuf_BUILD_EXAMPLES=OFF
        -Dprotobuf_BUILD_PROTOC_BINARIES=ON
        -Dprotobuf_BUILD_SHARED_LIBS=OFF
    DOWNLOAD_COMMAND ""
    UPDATE_COMMAND ""
    BUILD_BYPRODUCTS
        <INSTALL_DIR>/bin/protoc
)

ExternalProject_Get_Property(protoc_ep install_dir)
set(PROTOC ${install_dir}/bin/protoc)

endif()
