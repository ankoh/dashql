# ---------------------------------------------------------------------------
# Tigon
# (c) 2019 Andre Kohn
# ---------------------------------------------------------------------------

include(ExternalProject)

# ---------------------------------------------------------------------------
# Thrift library

# 26.07.2019: Thrift must be built with C++11 since it uses std::auto_ptr

ExternalProject_Add(
    thrift_ep
    SOURCE_DIR "${CMAKE_SOURCE_DIR}/third_party/thrift/"
    PREFIX "${CMAKE_BINARY_DIR}/third_party/thrift"
    INSTALL_DIR "${CMAKE_BINARY_DIR}/third_party/thrift/install"
    CMAKE_ARGS
        -G${CMAKE_GENERATOR}
        -DCMAKE_CXX_STANDARD=11
        -DCMAKE_CXX_FLAGS=-std=c++11
        -DCMAKE_CXX_STANDARD=${CMAKE_CXX_STANDARD}
        -DCMAKE_CXX_COMPILER=${CMAKE_CXX_COMPILER}
        -DCMAKE_C_COMPILER=${CMAKE_C_COMPILER}
        -DCMAKE_PREFIX_PATH=${CMAKE_PREFIX_PATH}
        -DCMAKE_TOOLCHAIN_FILE=${CMAKE_TOOLCHAIN_FILE}
        -DCMAKE_MODULE_PATH=${CMAKE_MODULE_PATH}
        -DCMAKE_BUILD_TYPE=Release
        -DCMAKE_INSTALL_PREFIX=${CMAKE_BINARY_DIR}/third_party/thrift/install
        -DBUILD_SHARED_LIBS=OFF
        -DBUILD_COMPILER=OFF
        -DBUILD_TESTING=OFF
        -DBUILD_TUTORIALS=OFF
        -DWITH_QT4=OFF
        -DWITH_CPP=ON
        -DWITH_STATIC_LIB=ON
        -DWITH_C_GLIB=OFF
        -DWITH_PYTHON=OFF
        -DWITH_HASKELL=OFF
        -DWITH_JAVA=OFF
        -DWITH_LIBEVENT=OFF
        -DBUILD_CPP=ON
        -DBOOST_ROOT=${BOOST_ROOT}
        -DBOOST_INCLUDEDIR=${BOOST_INCLUDE_DIR}
        -DBOOST_LIBRARYDIR=${BOOST_LIBRARY_DIR}
        -DBoost_INCLUDE_DIR=${BOOST_INCLUDE_DIR}
    DOWNLOAD_COMMAND ""
    UPDATE_COMMAND ""
    BUILD_BYPRODUCTS
        <INSTALL_DIR>/lib/libthrift.a
)

ExternalProject_Get_Property(thrift_ep install_dir)
set(THRIFT_INCLUDE_DIR ${install_dir}/include)
set(THRIFT_LIBRARY_PATH ${install_dir}/lib/libthrift.a)
file(MAKE_DIRECTORY ${THRIFT_INCLUDE_DIR})

add_library(thrift STATIC IMPORTED)
set_property(TARGET thrift PROPERTY IMPORTED_LOCATION ${THRIFT_LIBRARY_PATH})
set_property(TARGET thrift APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${THRIFT_INCLUDE_DIR})

add_dependencies(thrift_ep boost_ep)
add_dependencies(thrift thrift_ep)
