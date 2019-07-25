# ---------------------------------------------------------------------------
# Tigon
# (c) 2019 Andre Kohn
# ---------------------------------------------------------------------------

include(ExternalProject)

ExternalProject_Add(
    arrow_build
    PREFIX "${CMAKE_BINARY_DIR}/third_party/arrow"
    SOURCE_DIR "${CMAKE_SOURCE_DIR}/third_party/arrow/cpp"
    INSTALL_DIR "${CMAKE_BINARY_DIR}/third_party/arrow/install"
    CMAKE_ARGS
        -G${CMAKE_GENERATOR}
        -DCMAKE_CXX_COMPILER=${CMAKE_CXX_COMPILER}
        -DCMAKE_C_COMPILER=${CMAKE_C_COMPILER}
        -DCMAKE_TOOLCHAIN_FILE=${CMAKE_TOOLCHAIN_FILE}
        -DCMAKE_MODULE_PATH=${CMAKE_MODULE_PATH}
        -DCMAKE_BUILD_TYPE=${CMAKE_BUILD_TYPE}
        -DCMAKE_INSTALL_PREFIX=${CMAKE_BINARY_DIR}/third_party/arrow/install
        -DARROW_PARQUET=ON
        -DARROW_BUILD_STATIC=ON
        -DARROW_BUILD_SHARED=OFF
        -DARROW_BUILD_UTILITIES=OFF
        -DARROW_COMPUTE=OFF
        -DARROW_DATASET=OFF
        -DARROW_JEMALLOC=OFF
        -DARROW_HDFS=OFF
        -DARROW_BOOST_USE_SHARED=OFF
        -DARROW_PROTOBUF_USE_SHARED=OFF
        -DARROW_GFLAGS_USE_SHARED=OFF
        -DARROW_USE_SIMD=OFF
        -DARROW_ALTIVEC=OFF
    DOWNLOAD_COMMAND ""
    UPDATE_COMMAND ""
    BUILD_BYPRODUCTS
        <INSTALL_DIR>/lib/libarrow.a
        <INSTALL_DIR>/lib/libparquet.a
)

ExternalProject_Get_Property(arrow_build install_dir)
set(ARROW_INCLUDE_DIR ${install_dir}/include)
set(ARROW_LIBRARY_PATH ${install_dir}/lib/libarrow.a)
set(PARQUET_INCLUDE_DIR ${install_dir}/include)
set(PARQUET_LIBRARY_PATH ${install_dir}/lib/libparquet.a)
file(MAKE_DIRECTORY ${ARROW_INCLUDE_DIR})
file(MAKE_DIRECTORY ${PARQUET_INCLUDE_DIR})

add_library(arrow STATIC IMPORTED)
set_property(TARGET arrow PROPERTY IMPORTED_LOCATION ${ARROW_LIBRARY_PATH})
set_property(TARGET arrow APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${ARROW_INCLUDE_DIR})

add_library(parquet STATIC IMPORTED)
set_property(TARGET parquet PROPERTY IMPORTED_LOCATION ${PARQUET_LIBRARY_PATH})
set_property(TARGET parquet APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${PARQUET_INCLUDE_DIR})

add_dependencies(arrow arrow_build)
add_dependencies(parquet arrow_build)
