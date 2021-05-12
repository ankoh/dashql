// Copyright (c) 2020 The DashQL Authors

#include <arrow/result.h>
#include <arrow/status.h>
#include <rapidjson/istreamwrapper.h>

#include <memory>
#include <sstream>
#include <string>

#include "arrow/record_batch.h"
#include "arrow/type.h"
#include "arrow/type_fwd.h"
#include "duckdb/web/json_analyzer.h"
#include "duckdb/web/json_parser.h"
#include "duckdb/web/json_typedef.h"
#include "rapidjson/document.h"
#include "rapidjson/error/en.h"

namespace duckdb {
namespace web {
namespace json {

namespace {

struct ArrayBuffer : public rapidjson::BaseReaderHandler<rapidjson::UTF8<>, ArrayBuffer> {
    rapidjson::Document doc = {};
    size_t depth = 0;
    size_t size = 0;
    bool done = false;

    ArrayBuffer() {}

    template <typename RET, typename FN> RET Flush(FN&& f) {
        // Not done yet?
        if (!done) {
            assert(depth == 1);
            doc.EndArray(size);
            size = 0;
        }
        auto gen = [](auto&) { return true; };
        doc.Populate(gen);
        auto result = f(doc);
        doc.Clear();
        doc.StartArray();
        return result;
    }

    bool Key(const char* txt, size_t length, bool copy) { return doc.Key(txt, length, copy); }
    bool Null() {
        size += depth == 1;
        return doc.Null();
    }
    bool RawNumber(const Ch* str, size_t len, bool copy) {
        size += depth == 1;
        return doc.RawNumber(str, len, copy);
    }
    bool String(const char* txt, size_t length, bool copy) {
        size += depth == 1;
        return doc.String(txt, length, copy);
    }
    bool Bool(bool v) {
        size += depth == 1;
        return doc.Bool(v);
    }
    bool Int(int32_t v) {
        size += depth == 1;
        return doc.Int(v);
    }
    bool Int64(int64_t v) {
        size += depth == 1;
        return doc.Int64(v);
    }
    bool Uint(uint32_t v) {
        size += depth == 1;
        return doc.Uint(v);
    }
    bool Uint64(uint64_t v) {
        size += depth == 1;
        return doc.Uint64(v);
    }
    bool Double(double v) {
        size += depth == 1;
        return doc.Double(v);
    }
    bool StartObject() {
        size += depth == 1;
        ++depth;
        return doc.StartObject();
    }
    bool StartArray() {
        size += depth == 1;
        ++depth;
        return doc.StartArray();
    }
    bool EndObject(size_t count) {
        --depth;
        return doc.EndObject(count);
    }
    bool EndArray(size_t count) {
        done = (--depth == 0);
        return doc.EndArray(count);
    }
};

/// Streaming json parser for an array
struct ArrayReader {
    /// The istream
    rapidjson::IStreamWrapper in_wrapper_;
    /// The reader
    rapidjson::Reader reader_;
    /// The array buffer
    ArrayBuffer array_buffer_;
    /// The array parser
    std::shared_ptr<ArrayParser> parser_;

    /// Constructor
    ArrayReader(std::istream& in, std::shared_ptr<ArrayParser> parser)
        : in_wrapper_(in), reader_(), array_buffer_(), parser_(std::move(parser)) {
        reader_.IterativeParseInit();
    }
    /// Read the next batch
    arrow::Result<ArrayParser*> ReadNextN(size_t n);
};

/// Read entire object
arrow::Result<ArrayParser*> ArrayReader::ReadNextN(size_t n) {
    while (!reader_.IterativeParseComplete()) {
        if (!reader_.IterativeParseNext<DEFAULT_PARSER_FLAGS>(in_wrapper_, array_buffer_)) {
            auto error = rapidjson::GetParseError_En(reader_.GetParseErrorCode());
            return arrow::Status(arrow::StatusCode::ExecutionError, error);
        }
        if (array_buffer_.size >= n || array_buffer_.done) {
            auto status =
                array_buffer_.Flush<arrow::Status>([&](auto& buffer) { return parser_->AppendValues(buffer); });
            ARROW_RETURN_NOT_OK(status);
            return parser_.get();
        }
    }
    return nullptr;
};

struct RowArrayTableReader : public TableReader {
    /// The struct reader
    std::optional<ArrayReader> struct_reader_ = std::nullopt;

    /// Constructor
    RowArrayTableReader(std::unique_ptr<io::InputFileStream> table, TableType type = {})
        : TableReader(std::move(table), std::move(type)) {}
    /// Prepare the table reader
    arrow::Status Prepare() override;
    /// Read the next batch
    arrow::Result<std::shared_ptr<arrow::RecordBatch>> ReadNextN(size_t n) override;
};

arrow::Status RowArrayTableReader::Prepare() {
    /// Shape must be a row array
    assert(table_type_.shape == TableShape::ROW_ARRAY);
    /// Resolve the struct parser
    ARROW_ASSIGN_OR_RAISE(auto struct_parser, ArrayParser::Resolve(table_type_.type));
    /// Create the struct reader
    struct_reader_.emplace(*table_file_, std::move(struct_parser));

    return arrow::Status::OK();
}

arrow::Result<std::shared_ptr<arrow::RecordBatch>> RowArrayTableReader::ReadNextN(size_t n) {
    ARROW_ASSIGN_OR_RAISE(auto parser, struct_reader_->ReadNextN(n));
    ARROW_ASSIGN_OR_RAISE(auto array, parser->Finish());
    return arrow::RecordBatch::FromStructArray(std::move(array));
}

struct ColumnObjectTableReader : public TableReader {
    /// A column parser
    struct ColumnReader {
        /// The column stream
        io::InputFileStream stream_;
        /// The column parser
        ArrayReader array_reader_;

        // Constructor
        ColumnReader(const io::InputFileStream& stream, std::shared_ptr<ArrayParser> parser)
            : stream_(stream), array_reader_(stream_, std::move(parser)) {}
    };

    /// The column readers
    std::unordered_map<std::string, std::unique_ptr<ColumnReader>> column_readers_ = {};
    /// The schema
    std::shared_ptr<arrow::Schema> schema_ = {};

    /// Constructor
    ColumnObjectTableReader(std::unique_ptr<io::InputFileStream> table, TableType type = {})
        : TableReader(std::move(table), std::move(type)) {}
    /// Prepare the table reader
    arrow::Status Prepare() override;
    /// Read next chunk
    arrow::Result<std::shared_ptr<arrow::RecordBatch>> ReadNextN(size_t n) override;
};

arrow::Status ColumnObjectTableReader::Prepare() {
    /// Shape must be a column object
    assert(table_type_.shape == TableShape::COLUMN_OBJECT);

    // Need to find the column boundaries?
    // User might have provided the types explicitly which forces us to find the column boundaries.
    if (table_type_.type->num_fields() > 0 && table_type_.column_boundaries.size() == 0) {
        io::InputFileStream stream{*table_file_};
        ARROW_RETURN_NOT_OK(FindColumnBoundaries(stream, table_type_));
    }

    // Create the schema
    arrow::FieldVector schema_fields;
    for (unsigned i = 0; i < table_type_.type->num_fields(); ++i) {
        auto& field = table_type_.type->field(i);
        schema_fields.push_back(field);
    }
    schema_ = std::make_shared<arrow::Schema>(std::move(schema_fields), arrow::Endianness::Native);

    // Create all column readers
    for (unsigned i = 0; i < table_type_.type->num_fields(); ++i) {
        auto& field = table_type_.type->field(i);
        auto& name = field->name();
        auto& type = field->type();
        auto bound_iter = table_type_.column_boundaries.find(name);
        if (bound_iter == table_type_.column_boundaries.end()) {
            // XXX warning
            continue;
        }
        table_file_->Slice(bound_iter->second.offset, bound_iter->second.size);
        ARROW_ASSIGN_OR_RAISE(auto parser, ArrayParser::Resolve(type));
        column_readers_.insert({name, std::make_unique<ColumnReader>(*table_file_, std::move(parser))});
    }
    return arrow::Status::OK();
}

arrow::Result<std::shared_ptr<arrow::RecordBatch>> ColumnObjectTableReader::ReadNextN(size_t n) {
    // Collect the next batch
    std::vector<ArrayParser*> column_parsers;
    size_t num_rows = 0;
    for (unsigned i = 0; i < table_type_.type->num_fields(); ++i) {
        auto& field = table_type_.type->field(i);
        auto& name = field->name();
        auto& type = field->type();
        assert(column_readers_.count(name));
        auto& reader = column_readers_.at(name);
        ARROW_ASSIGN_OR_RAISE(auto parser, reader->array_reader_.ReadNextN(n));
        num_rows = std::max<size_t>(num_rows, parser->GetLength());
        column_parsers.push_back(parser);
    }
    // Pad columns with nulls (if necessary)
    std::vector<std::shared_ptr<arrow::Array>> column_arrays;
    for (auto& col : column_parsers) {
        for (unsigned i = col->GetLength(); i < num_rows; ++i) {
            ARROW_RETURN_NOT_OK(col->AppendNull());
        }
        ARROW_ASSIGN_OR_RAISE(auto array, col->Finish());
        column_arrays.push_back(std::move(array));
    }
    return arrow::RecordBatch::Make(schema_, num_rows, std::move(column_arrays));
}

}  // namespace

/// Constructor
TableReader::TableReader(std::unique_ptr<io::InputFileStream> table, TableType type)
    : table_file_(std::move(table)), table_type_(std::move(type)) {}

/// Resolve a table reader
arrow::Result<std::unique_ptr<TableReader>> TableReader::Resolve(std::unique_ptr<io::InputFileStream> table,
                                                                 TableType type) {
    switch (type.shape) {
        case TableShape::COLUMN_OBJECT:
            return std::make_unique<ColumnObjectTableReader>(std::move(table), std::move(type));
        case TableShape::ROW_ARRAY:
            return std::make_unique<RowArrayTableReader>(std::move(table), std::move(type));
        default:
            return arrow::Status::Invalid("Table type not specified");
    }
}

}  // namespace json
}  // namespace web
}  // namespace duckdb
