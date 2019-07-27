//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#include "arrow/api.h"
#include "arrow/buffer.h"
#include "arrow/io/api.h"
#include "arrow/io/memory.h"
#include "arrow/memory_pool.h"
#include "gtest/gtest.h"
#include "parquet/arrow/reader.h"
#include "parquet/arrow/writer.h"
#include "parquet/exception.h"

namespace {

std::shared_ptr<arrow::Table> generateTable() {
    arrow::Int64Builder i64builder;
    PARQUET_THROW_NOT_OK(i64builder.AppendValues({1, 2, 3, 4, 5}));
    std::shared_ptr<arrow::Array> i64array;
    PARQUET_THROW_NOT_OK(i64builder.Finish(&i64array));

    arrow::StringBuilder strbuilder;
    PARQUET_THROW_NOT_OK(strbuilder.Append("some"));
    PARQUET_THROW_NOT_OK(strbuilder.Append("string"));
    PARQUET_THROW_NOT_OK(strbuilder.Append("content"));
    PARQUET_THROW_NOT_OK(strbuilder.Append("in"));
    PARQUET_THROW_NOT_OK(strbuilder.Append("rows"));
    std::shared_ptr<arrow::Array> strarray;
    PARQUET_THROW_NOT_OK(strbuilder.Finish(&strarray));

    std::shared_ptr<arrow::Schema> schema = arrow::schema({
        arrow::field("int", arrow::int64()),
        arrow::field("str", arrow::utf8())
    });

    return arrow::Table::Make(schema, {i64array, strarray});
}

TEST(ParquetTest, WriteToBuffer) {
    auto table = generateTable();

    // Create the output stream
    auto memoryPool = arrow::MemoryPool::CreateDefault();
    std::shared_ptr<arrow::ResizableBuffer> buffer;
    PARQUET_THROW_NOT_OK(arrow::AllocateResizableBuffer(memoryPool.get(), 1024, &buffer));
    std::shared_ptr<arrow::io::OutputStream> outputStream = std::make_shared<arrow::io::BufferOutputStream>(buffer);

    // Write the table
    PARQUET_THROW_NOT_OK(parquet::arrow::WriteTable(*table, memoryPool.get(), outputStream, 3));
}

}

