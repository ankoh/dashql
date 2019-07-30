# ---------------------------------------------------------------------------
# Tigon
# (c) 2019 Andre Kohn
# ---------------------------------------------------------------------------

include(ExternalProject)

ExternalProject_Add(
    arrow_ep
    PREFIX "${CMAKE_BINARY_DIR}/third_party/arrow"
    SOURCE_DIR "${CMAKE_SOURCE_DIR}/third_party/arrow/cpp"
    INSTALL_DIR "${CMAKE_BINARY_DIR}/third_party/arrow/install"
    CMAKE_ARGS
        -G${CMAKE_GENERATOR}
        -DCMAKE_BUILD_TYPE=Release
        -DCMAKE_CXX_COMPILER=${CMAKE_CXX_COMPILER}
        -DCMAKE_CXX_FLAGS=-std=c++17
        -DCMAKE_CXX_STANDARD=17
        -DCMAKE_C_COMPILER=${CMAKE_C_COMPILER}
        -DCMAKE_INSTALL_PREFIX=${CMAKE_BINARY_DIR}/third_party/arrow/install
        -DCMAKE_MODULE_PATH=${CMAKE_MODULE_PATH}
        -DCMAKE_TOOLCHAIN_FILE=${CMAKE_TOOLCHAIN_FILE}
        -DARROW_ALTIVEC=OFF
        -DARROW_BOOST_USE_SHARED=OFF
        -DARROW_BUILD_SHARED=OFF
        -DARROW_BUILD_STATIC=ON
        -DARROW_BUILD_UTILITIES=OFF
        -DARROW_COMPUTE=ON
        -DARROW_DATASET=OFF
        -DARROW_FLIGHT=OFF
        -DARROW_GFLAGS_USE_SHARED=OFF
        -DARROW_HDFS=OFF
        -DARROW_IPC=OFF
        -DARROW_JEMALLOC=OFF
        -DARROW_ORC=OFF
        -DARROW_PARQUET=ON
        -DARROW_PROTOBUF_USE_SHARED=OFF
        -DARROW_USE_GLOG=OFF
        -DARROW_USE_SIMD=OFF
        -DARROW_WITH_BROTLI=ON
        -DARROW_WITH_LZ4=OFF
        -DARROW_WITH_PROTOBUF=OFF
        -DARROW_WITH_RAPIDJSON=ON
        -DARROW_WITH_SNAPPY=ON
        -DARROW_WITH_ZLIB=OFF
        -DARROW_WITH_ZSTD=OFF
        -DBOOST_ROOT=${BOOST_ROOT}
        -DBOOST_SOURCE=SYSTEM
        -DBOOST_INCLUDEDIR=${BOOST_INCLUDE_DIR}
        -DBOOST_LIBRARYDIR=${BOOST_LIBRARY_DIR}
        -DBoost_filesystem_LIBRARY_RELEASE=${BOOST_FILESYSTEM_LIBRARY}
        -DBoost_regex_LIBRARY_RELEASE=${BOOST_REGEX_LIBRARY}
        -DBoost_system_LIBRARY_RELEASE=${BOOST_SYSTEM_LIBRARY}
        -DBROTLI_COMMON_LIBRARY=${BROTLI_COMMON_LIBRARY_PATH}
        -DBROTLI_DEC_LIBRARY=${BROTLI_DEC_LIBRARY_PATH}
        -DBROTLI_ENC_LIBRARY=${BROTLI_ENC_LIBRARY_PATH}
        -DBROTLI_INCLUDE_DIR=${BROTLI_INCLUDE_DIR}
        -DDoubleConversion_INCLUDE_DIR=${DOUBLE_CONVERSION_INCLUDE_DIR}
        -DDoubleConversion_LIB=${DOUBLE_CONVERSION_LIBRARY_PATH}
        -DFLATBUFFERS_INCLUDE_DIR=${FLATBUFFERS_INCLUDE_DIR}
        -DFLATBUFFERS_LIB=${FLATBUFFERS_LIBRARY_PATH}
        -DFLATC=${FLATC}
        -DRAPIDJSON_INCLUDE_DIR=${RAPIDJSON_INCLUDE_DIR}
        -DSnappy_INCLUDE_DIR=${SNAPPY_INCLUDE_DIR}
        -DSnappy_LIB=${SNAPPY_LIBRARY_PATH}
        -DTHRIFT_INCLUDE_DIR=${THRIFT_INCLUDE_DIR}
        -DTHRIFT_STATIC_LIB=${THRIFT_LIBRARY_PATH}
    DOWNLOAD_COMMAND ""
    UPDATE_COMMAND ""
    BUILD_BYPRODUCTS
        <INSTALL_DIR>/lib/libarrow.a
        <INSTALL_DIR>/lib/libparquet.a
)

ExternalProject_Get_Property(arrow_ep install_dir)
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

add_dependencies(arrow_ep snappy_ep brotli_ep flatbuffers_ep flatc_ep thrift_ep boost_ep)
add_dependencies(arrow arrow_ep)
add_dependencies(parquet arrow_ep)

target_link_libraries(parquet INTERFACE
    arrow
    thrift
    double_conversion
    brotli_enc brotli_dec brotli_common snappy 
    boost_filesystem boost_regex boost_system
)

target_link_libraries(arrow INTERFACE
    thrift
    double_conversion
    brotli_enc brotli_dec brotli_common snappy 
    boost_filesystem boost_regex boost_system
)
