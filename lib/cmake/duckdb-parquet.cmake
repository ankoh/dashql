cmake_minimum_required(VERSION 2.8.12)

project(ParquetExtension)

set(DUCKDB_BASE_DIR ${CMAKE_CURRENT_LIST_DIR}/../../submodules/duckdb/extension/parquet)

include_directories(
  ${DUCKDB_BASE_DIR}/include
  ${DUCKDB_BASE_DIR}/../../third_party/parquet
  ${DUCKDB_BASE_DIR}/../../third_party/snappy
  ${DUCKDB_BASE_DIR}/../../third_party/miniz
  ${DUCKDB_BASE_DIR}/../../third_party/thrift
  ${DUCKDB_BASE_DIR}/../../third_party/zstd)

set(PARQUET_EXTENSION_FILES
  ${DUCKDB_BASE_DIR}/parquet-extension.cpp
  ${DUCKDB_BASE_DIR}/parquet_reader.cpp
  ${DUCKDB_BASE_DIR}/parquet_timestamp.cpp
  ${DUCKDB_BASE_DIR}/parquet_writer.cpp
  ${DUCKDB_BASE_DIR}/parquet_statistics.cpp
  ${DUCKDB_BASE_DIR}/column_reader.cpp)

if(NOT CLANG_TIDY)
  set(PARQUET_EXTENSION_FILES
      ${PARQUET_EXTENSION_FILES}
      ${DUCKDB_BASE_DIR}/../../third_party/parquet/parquet_constants.cpp
      ${DUCKDB_BASE_DIR}/../../third_party/parquet/parquet_types.cpp
      ${DUCKDB_BASE_DIR}/../../third_party/thrift/thrift/protocol/TProtocol.cpp
      ${DUCKDB_BASE_DIR}/../../third_party/thrift/thrift/transport/TTransportException.cpp
      ${DUCKDB_BASE_DIR}/../../third_party/thrift/thrift/transport/TBufferTransports.cpp
      ${DUCKDB_BASE_DIR}/../../third_party/snappy/snappy.cc
      ${DUCKDB_BASE_DIR}/../../third_party/snappy/snappy-sinksource.cc
      ${DUCKDB_BASE_DIR}/../../third_party/zstd/decompress/zstd_ddict.cpp
      ${DUCKDB_BASE_DIR}/../../third_party/zstd/decompress/huf_decompress.cpp
      ${DUCKDB_BASE_DIR}/../../third_party/zstd/decompress/zstd_decompress.cpp
      ${DUCKDB_BASE_DIR}/../../third_party/zstd/decompress/zstd_decompress_block.cpp
      ${DUCKDB_BASE_DIR}/../../third_party/zstd/common/entropy_common.cpp
      ${DUCKDB_BASE_DIR}/../../third_party/zstd/common/fse_decompress.cpp
      ${DUCKDB_BASE_DIR}/../../third_party/zstd/common/zstd_common.cpp
      ${DUCKDB_BASE_DIR}/../../third_party/zstd/common/error_private.cpp
      ${DUCKDB_BASE_DIR}/../../third_party/zstd/common/xxhash.cpp
      ${DUCKDB_BASE_DIR}/../../third_party/zstd/compress/fse_compress.cpp
      ${DUCKDB_BASE_DIR}/../../third_party/zstd/compress/hist.cpp
      ${DUCKDB_BASE_DIR}/../../third_party/zstd/compress/huf_compress.cpp
      ${DUCKDB_BASE_DIR}/../../third_party/zstd/compress/zstd_compress.cpp
      ${DUCKDB_BASE_DIR}/../../third_party/zstd/compress/zstd_compress_literals.cpp
      ${DUCKDB_BASE_DIR}/../../third_party/zstd/compress/zstd_compress_sequences.cpp
      ${DUCKDB_BASE_DIR}/../../third_party/zstd/compress/zstd_compress_superblock.cpp
      ${DUCKDB_BASE_DIR}/../../third_party/zstd/compress/zstd_double_fast.cpp
      ${DUCKDB_BASE_DIR}/../../third_party/zstd/compress/zstd_fast.cpp
      ${DUCKDB_BASE_DIR}/../../third_party/zstd/compress/zstd_lazy.cpp
      ${DUCKDB_BASE_DIR}/../../third_party/zstd/compress/zstd_ldm.cpp
      ${DUCKDB_BASE_DIR}/../../third_party/zstd/compress/zstd_opt.cpp)
endif()

add_library(parquet_extension STATIC ${PARQUET_EXTENSION_FILES})
