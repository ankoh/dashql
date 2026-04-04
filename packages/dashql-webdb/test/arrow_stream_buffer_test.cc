#include "duckdb/web/arrow_bridge.h"
#include "duckdb/web/arrow_stream_buffer.h"

#include "arrow/array/builder_primitive.h"
#include "arrow/ipc/writer.h"
#include "arrow/io/memory.h"
#include "arrow/record_batch.h"
#include "duckdb/common/arrow/arrow_wrapper.hpp"
#include "duckdb/function/table/arrow.hpp"
#include "gtest/gtest.h"

namespace {

using duckdb::web::ArrowIPCStreamBuffer;
using duckdb::web::ArrowIPCStreamBufferReader;
using duckdb::web::BufferingArrowIPCStreamDecoder;

arrow::Result<std::shared_ptr<arrow::Buffer>> BuildStreamBuffer() {
    auto schema = arrow::schema({arrow::field("value", arrow::int64())});
    arrow::Int64Builder builder;
    ARROW_RETURN_NOT_OK(builder.AppendValues({1, 2, 3}));
    ARROW_ASSIGN_OR_RAISE(auto array, builder.Finish());
    auto batch = arrow::RecordBatch::Make(schema, 3, {array});
    ARROW_ASSIGN_OR_RAISE(auto sink, arrow::io::BufferOutputStream::Create());
    ARROW_ASSIGN_OR_RAISE(auto writer, arrow::ipc::MakeStreamWriter(sink, schema));
    ARROW_RETURN_NOT_OK(writer->WriteRecordBatch(*batch));
    ARROW_RETURN_NOT_OK(writer->Close());
    return sink->Finish();
}

TEST(ArrowStreamBuffer, DecoderBuffersSchemaAndBatches) {
    auto buffer = std::make_shared<ArrowIPCStreamBuffer>();
    BufferingArrowIPCStreamDecoder decoder{buffer};
    auto encoded = BuildStreamBuffer();
    ASSERT_TRUE(encoded.ok()) << encoded.status().message();

    auto raw = *encoded;
    ASSERT_TRUE(decoder.Consume(raw->data(), 5).ok());
    EXPECT_FALSE(buffer->is_eos());
    EXPECT_EQ(buffer->schema(), nullptr);
    EXPECT_TRUE(buffer->batches().empty());

    ASSERT_TRUE(decoder.Consume(raw->data() + 5, raw->size() - 5).ok());
    ASSERT_TRUE(buffer->is_eos());
    ASSERT_NE(buffer->schema(), nullptr);
    ASSERT_EQ(buffer->schema()->num_fields(), 1);
    ASSERT_EQ(buffer->schema()->field(0)->name(), "value");
    ASSERT_EQ(buffer->batches().size(), 1);
    ASSERT_EQ(buffer->batches()[0]->num_rows(), 3);

    auto values = std::static_pointer_cast<arrow::Int64Array>(buffer->batches()[0]->column(0));
    EXPECT_EQ(values->Value(0), 1);
    EXPECT_EQ(values->Value(1), 2);
    EXPECT_EQ(values->Value(2), 3);
}

TEST(ArrowStreamBuffer, ReaderReturnsBatchesSequentially) {
    auto buffer = std::make_shared<ArrowIPCStreamBuffer>();
    BufferingArrowIPCStreamDecoder decoder{buffer};
    auto encoded = BuildStreamBuffer();
    ASSERT_TRUE(encoded.ok()) << encoded.status().message();
    ASSERT_TRUE(decoder.Consume((*encoded)->data(), (*encoded)->size()).ok());

    ArrowIPCStreamBufferReader reader{buffer};
    ASSERT_NE(reader.schema(), nullptr);
    EXPECT_EQ(reader.schema()->field(0)->name(), "value");

    std::shared_ptr<arrow::RecordBatch> batch;
    ASSERT_TRUE(reader.ReadNext(&batch).ok());
    ASSERT_NE(batch, nullptr);
    EXPECT_EQ(batch->num_rows(), 3);

    ASSERT_TRUE(reader.ReadNext(&batch).ok());
    EXPECT_EQ(batch, nullptr);
}

TEST(ArrowStreamBuffer, CreateStreamExportsBatches) {
    auto buffer = std::make_shared<ArrowIPCStreamBuffer>();
    BufferingArrowIPCStreamDecoder decoder{buffer};
    auto encoded = BuildStreamBuffer();
    ASSERT_TRUE(encoded.ok()) << encoded.status().message();
    ASSERT_TRUE(decoder.Consume((*encoded)->data(), (*encoded)->size()).ok());

    auto holder = buffer;
    duckdb::ArrowStreamParameters parameters{};
    auto wrapper = ArrowIPCStreamBufferReader::CreateStream(reinterpret_cast<uintptr_t>(&holder), parameters);
    ASSERT_NE(wrapper, nullptr);

    auto chunk = wrapper->GetNextChunk();
    ASSERT_NE(chunk, nullptr);
    EXPECT_EQ(chunk->arrow_array.length, 3);

    auto next_chunk = wrapper->GetNextChunk();
    ASSERT_NE(next_chunk, nullptr);
    EXPECT_EQ(next_chunk->arrow_array.release, nullptr);
}

TEST(ArrowStreamBuffer, GetSchemaExportsSchema) {
    auto buffer = std::make_shared<ArrowIPCStreamBuffer>();
    BufferingArrowIPCStreamDecoder decoder{buffer};
    auto encoded = BuildStreamBuffer();
    ASSERT_TRUE(encoded.ok()) << encoded.status().message();
    ASSERT_TRUE(decoder.Consume((*encoded)->data(), (*encoded)->size()).ok());

    auto holder = buffer;
    duckdb::ArrowSchemaWrapper schema;
    ArrowIPCStreamBufferReader::GetSchema(reinterpret_cast<uintptr_t>(&holder), schema);
    ASSERT_NE(schema.arrow_schema.release, nullptr);
    ASSERT_EQ(schema.arrow_schema.n_children, 1);
    ASSERT_NE(schema.arrow_schema.children, nullptr);
    ASSERT_NE(schema.arrow_schema.children[0], nullptr);
    ASSERT_NE(schema.arrow_schema.children[0]->name, nullptr);
    EXPECT_EQ(std::string{schema.arrow_schema.children[0]->name}, "value");
}

}  // namespace
