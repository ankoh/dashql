# ---------------------------------------------------------------------------
# Tigon
# (c) 2019 Andre Kohn
# ---------------------------------------------------------------------------

include(ExternalProject)

ExternalProject_Add(
    brotli_build
    PREFIX "${CMAKE_BINARY_DIR}/third_party/brotli"
    SOURCE_DIR "${CMAKE_SOURCE_DIR}/third_party/brotli"
    INSTALL_DIR "${CMAKE_BINARY_DIR}/third_party/brotli/install"
    CMAKE_ARGS
        -G${CMAKE_GENERATOR}
        -DCMAKE_CXX_STANDARD=17
        -DCMAKE_CXX_FLAGS=-std=c++17
        -DCMAKE_CXX_COMPILER=${CMAKE_CXX_COMPILER}
        -DCMAKE_C_COMPILER=${CMAKE_C_COMPILER}
        -DCMAKE_TOOLCHAIN_FILE=${CMAKE_TOOLCHAIN_FILE}
        -DCMAKE_MODULE_PATH=${CMAKE_MODULE_PATH}
        -DCMAKE_BUILD_TYPE=Release
        -DCMAKE_INSTALL_PREFIX=${CMAKE_BINARY_DIR}/third_party/brotli/install
        -DBUILD_SHARED_LIBS=OFF
    DOWNLOAD_COMMAND ""
    UPDATE_COMMAND ""
    BUILD_BYPRODUCTS
        <INSTALL_DIR>/lib/libbrotli.a
)

ExternalProject_Get_Property(brotli_build install_dir)
set(BROTLI_INCLUDE_DIR ${install_dir}/include)
set(BROTLI_ENC_LIBRARY_PATH ${install_dir}/lib/libbrotlienc-static.a)
set(BROTLI_DEC_LIBRARY_PATH ${install_dir}/lib/libbrotlidec-static.a)
set(BROTLI_COMMON_LIBRARY_PATH ${install_dir}/lib/libbrotlicommon-static.a)
file(MAKE_DIRECTORY ${BROTLI_INCLUDE_DIR})

add_library(brotli_enc STATIC IMPORTED)
set_property(TARGET brotli_enc PROPERTY IMPORTED_LOCATION ${BROTLI_ENC_LIBRARY_PATH})
set_property(TARGET brotli_enc APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${BROTLI_INCLUDE_DIR})

add_library(brotli_dec STATIC IMPORTED)
set_property(TARGET brotli_dec PROPERTY IMPORTED_LOCATION ${BROTLI_DEC_LIBRARY_PATH})
set_property(TARGET brotli_dec APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${BROTLI_INCLUDE_DIR})

add_library(brotli_common STATIC IMPORTED)
set_property(TARGET brotli_common PROPERTY IMPORTED_LOCATION ${BROTLI_COMMON_LIBRARY_PATH})
set_property(TARGET brotli_common APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${BROTLI_INCLUDE_DIR})

add_dependencies(brotli_enc brotli_build)
add_dependencies(brotli_dec brotli_build)
add_dependencies(brotli_common brotli_build)
