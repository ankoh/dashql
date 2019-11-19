# ---------------------------------------------------------------------------
# Tigon
# (c) 2019 Andre Kohn
# ---------------------------------------------------------------------------

include(ExternalProject)

# Flatbuffers library
ExternalProject_Add(
    nanopb_ep
    SOURCE_DIR "${CMAKE_SOURCE_DIR}/third_party/nanopb"
    PREFIX "${CMAKE_BINARY_DIR}/third_party/nanopb"
    INSTALL_DIR "${CMAKE_BINARY_DIR}/third_party/nanopb/install"
    CMAKE_ARGS
        -G${CMAKE_GENERATOR}
        -DCMAKE_CXX_STANDARD=17
        -DCMAKE_TOOLCHAIN_FILE=${CMAKE_TOOLCHAIN_FILE}
        -DCMAKE_MODULE_PATH=${CMAKE_MODULE_PATH}
        -DCMAKE_BUILD_TYPE=Release
        -DCMAKE_INSTALL_PREFIX=${CMAKE_BINARY_DIR}/third_party/nanopb/install
        -Dnanopb_BUILD_RUNTIME=ON
        -Dnanopb_BUILD_GENERATOR=OFF
    DOWNLOAD_COMMAND ""
    UPDATE_COMMAND ""
    BUILD_BYPRODUCTS
        <INSTALL_DIR>/lib/libprotobuf-nanopb.a
)

ExternalProject_Get_Property(nanopb_ep install_dir)
set(NANOPB_INCLUDE_DIR ${install_dir}/include)
set(NANOPB_LIBRARY_PATH ${install_dir}/lib/libprotobuf-nanopb.a)
file(MAKE_DIRECTORY ${NANOPB_INCLUDE_DIR})

add_library(nanopb STATIC IMPORTED)
set_property(TARGET nanopb PROPERTY IMPORTED_LOCATION ${NANOPB_LIBRARY_PATH})
set_property(TARGET nanopb APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${NANOPB_INCLUDE_DIR})

add_dependencies(nanopb nanopb_ep)
