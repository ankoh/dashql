# Copyright (c) 2020 The DashQL Authors

include(ExternalProject)

set(ARROW_FLAGS
    -G${CMAKE_GENERATOR}
    -DCMAKE_BUILD_TYPE=Release
    -DCMAKE_CXX_COMPILER=${CMAKE_CXX_COMPILER}
    -DCMAKE_CXX_COMPILER_LAUNCHER=${CMAKE_CXX_COMPILER_LAUNCHER}
    -DCMAKE_CXX_FLAGS=-std=c++17
    -DCMAKE_CXX_STANDARD=17
    -DCMAKE_C_COMPILER=${CMAKE_C_COMPILER}
    -DCMAKE_C_COMPILER_LAUNCHER=${CMAKE_C_COMPILER_LAUNCHER}
    -DCMAKE_INSTALL_PREFIX=${CMAKE_BINARY_DIR}/third_party/arrow/install
    -DCMAKE_MODULE_PATH=${CMAKE_MODULE_PATH}
    -DCMAKE_TOOLCHAIN_FILE=${CMAKE_TOOLCHAIN_FILE}
    -DARROW_ALTIVEC=OFF
    -DARROW_USE_CCACHE=ON
    -DARROW_BOOST_USE_SHARED=OFF
    -DARROW_BUILD_SHARED=OFF
    -DARROW_BUILD_STATIC=ON
    -DARROW_BUILD_UTILITIES=OFF
    -DARROW_COMPUTE=OFF
    -DARROW_DATASET=OFF
    -DARROW_FLIGHT=OFF
    -DARROW_GFLAGS_USE_SHARED=OFF
    -DARROW_HDFS=OFF
    -DARROW_IPC=ON
    -DARROW_JSON=ON
    -DARROW_CSV=OFF
    -DARROW_JEMALLOC=OFF
    -DARROW_ORC=OFF
    -DARROW_PARQUET=OFF
    -DARROW_PROTOBUF_USE_SHARED=OFF
    -DARROW_USE_GLOG=OFF
    -DARROW_SIMD_LEVEL=NONE
    -DARROW_RUNTIME_SIMD_LEVEL=NONE
    -DARROW_WITH_BROTLI=OFF
    -DARROW_WITH_LZ4=OFF
    -DARROW_WITH_PROTOBUF=OFF
    -DARROW_WITH_RAPIDJSON=OFF
    -DARROW_WITH_SNAPPY=OFF
    -DARROW_WITH_ZLIB=OFF
    -DARROW_WITH_ZSTD=OFF
    -DBOOST_SOURCE=BUNDLED
)

if(EMSCRIPTEN)

    ExternalProject_Add(
        arrow_ep
        PREFIX "${CMAKE_BINARY_DIR}/third_party/arrow"
        SOURCE_DIR "${CMAKE_SOURCE_DIR}/../submodules/arrow/cpp"
        INSTALL_DIR "${CMAKE_BINARY_DIR}/third_party/arrow/install"
        CMAKE_ARGS ${ARROW_FLAGS}
        DOWNLOAD_COMMAND ""
        UPDATE_COMMAND ""
        BUILD_BYPRODUCTS
            <INSTALL_DIR>/lib/libarrow.a
    )

else()

    ExternalProject_Add(
        arrow_ep
        PREFIX "${CMAKE_BINARY_DIR}/third_party/arrow"
        SOURCE_DIR "${CMAKE_SOURCE_DIR}/../submodules/arrow/cpp"
        INSTALL_DIR "${CMAKE_BINARY_DIR}/third_party/arrow/install"
        CMAKE_ARGS ${ARROW_FLAGS}
        DOWNLOAD_COMMAND ""
        UPDATE_COMMAND ""
        BUILD_BYPRODUCTS
            <INSTALL_DIR>/lib/libarrow.a
    )

endif()

ExternalProject_Get_Property(arrow_ep install_dir)
set(ARROW_INCLUDE_DIR ${install_dir}/include)
set(ARROW_LIBRARY_PATH ${install_dir}/lib/libarrow.a)
file(MAKE_DIRECTORY ${ARROW_INCLUDE_DIR})

add_library(arrow STATIC IMPORTED)
set_property(TARGET arrow PROPERTY IMPORTED_LOCATION ${ARROW_LIBRARY_PATH})
set_property(TARGET arrow APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${ARROW_INCLUDE_DIR})

add_dependencies(arrow arrow_ep)