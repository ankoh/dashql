// Copyright (c) 2020 The DashQL Authors

#include "duckdb/web/json_reader.h"

#include <arrow/result.h>
#include <arrow/status.h>
#include <rapidjson/istreamwrapper.h>

#include <memory>
#include <sstream>
#include <string>

#include "arrow/type.h"
#include "arrow/type_fwd.h"
#include "duckdb/web/json_analyzer.h"
#include "duckdb/web/json_typedef.h"
#include "rapidjson/document.h"
#include "rapidjson/error/en.h"

namespace duckdb {
namespace web {
namespace json {

namespace {

struct JSONArrayBuffer : public rapidjson::BaseReaderHandler<rapidjson::UTF8<>, JSONReaderEventCache> {
    rapidjson::Document doc = {};
    size_t depth = 1;
    size_t size = 0;
    bool done = false;

    JSONArrayBuffer() { doc.StartArray(); }

    auto& Emit() {
        // Not done yet?
        if (!done) {
            assert(depth == 1);
            doc.EndArray(size);
            size = 0;
        }
        auto gen = [](auto&) { return true; };
        doc.Populate(gen);
        return doc;
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
    /// The input stream
    std::unique_ptr<std::istream> in_;
    /// The istream
    rapidjson::IStreamWrapper in_wrapper_;
    /// The reader
    rapidjson::Reader reader_;
    /// The array buffer
    JSONArrayBuffer array_buffer_;
    /// The array parser
    std::shared_ptr<ArrayParser> parser_;

    /// Read the next batch
    arrow::Result<std::shared_ptr<arrow::Array>> ReadNextBatch();
};

/// Read entire object
arrow::Result<std::shared_ptr<arrow::Array>> ArrayReader::ReadNextBatch() {
    while (!reader_.IterativeParseComplete()) {
        if (!reader_.IterativeParseNext<rapidjson::kParseDefaultFlags>(in_wrapper_, array_buffer_)) {
            auto error = rapidjson::GetParseError_En(reader_.GetParseErrorCode());
            return arrow::Status(arrow::StatusCode::ExecutionError, error);
        }
        if (array_buffer_.size >= 1024 || array_buffer_.done) {
            auto& buffer = array_buffer_.Emit();
            auto status = parser_->AppendValues(buffer);
            buffer.Clear();
            ARROW_RETURN_NOT_OK(status);
            ARROW_ASSIGN_OR_RAISE(auto array, parser_->Finish());
            return array;
        }
    }
    return nullptr;
};

//    // Parse the SAX document
//    rapidjson::Reader reader;
//    reader.IterativeParseInit();
//
//    // Peek into the document
//    JSONReaderEventCache cache;
//    if (!reader.IterativeParseNext<rapidjson::kParseDefaultFlags>(in_, cache)) {
//        auto error = rapidjson::GetParseError_En(reader.GetParseErrorCode());
//        return arrow::Status::Invalid(error);
//    }
//
//    // Top level not an object?
//    if (cache.event != JSONReaderEvent::START_OBJECT) {
//        return arrow::Status::Invalid("Unexpected top-level JSON type");
//    }
//
//    // Read all columns
//    auto next = [&]() { return reader.IterativeParseNext<rapidjson::kParseDefaultFlags>(in_, cache); };
//    while (next() && cache.event == JSONReaderEvent::KEY) {
//        auto column_name = cache.ReleaseKey();
//        auto parser_iter = parsers_.find(column_name);
//
//        // Unknown column? - Just ignore it, might be intentional
//        if (parser_iter == parsers_.end()) continue;
//        auto& parser = parser_iter->second;
//
//        // Get the column
//        if (!next() || cache.event != JSONReaderEvent::START_ARRAY) {
//            return arrow::Status::Invalid("Invalid type. Expected start of column array, received: ",
//                                          GetJSONReaderEventName(cache.event));
//        }

}  // namespace

std::string_view GetJSONReaderEventName(JSONReaderEvent event) {
    switch (event) {
        case JSONReaderEvent::NONE:
            return "NONE";
        case JSONReaderEvent::KEY:
            return "KEY";
        case JSONReaderEvent::NULL_:
            return "NULL_";
        case JSONReaderEvent::STRING:
            return "STRING";
        case JSONReaderEvent::BOOL:
            return "BOOL";
        case JSONReaderEvent::INT32:
            return "INT32";
        case JSONReaderEvent::INT64:
            return "INT64";
        case JSONReaderEvent::UINT32:
            return "UINT32";
        case JSONReaderEvent::UINT64:
            return "UINT64";
        case JSONReaderEvent::DOUBLE:
            return "DOUBLE";
        case JSONReaderEvent::START_OBJECT:
            return "START_OBJECT";
        case JSONReaderEvent::START_ARRAY:
            return "START_ARRAY";
        case JSONReaderEvent::END_OBJECT:
            return "END_OBJECT";
        case JSONReaderEvent::END_ARRAY:
            return "END_ARRAY";
        default:
            return "?";
    }
}

}  // namespace json
}  // namespace web
}  // namespace duckdb
