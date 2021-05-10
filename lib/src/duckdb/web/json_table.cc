// Copyright (c) 2020 The DashQL Authors

#include <arrow/result.h>
#include <arrow/status.h>
#include <rapidjson/istreamwrapper.h>

#include <memory>
#include <sstream>
#include <string>

#include "arrow/type.h"
#include "arrow/type_fwd.h"
#include "duckdb/web/json_analyzer.h"
#include "duckdb/web/json_reader.h"
#include "duckdb/web/json_typedef.h"
#include "rapidjson/document.h"
#include "rapidjson/error/en.h"

namespace duckdb {
namespace web {
namespace json {

namespace {

struct EventReader : public rapidjson::BaseReaderHandler<rapidjson::UTF8<>, EventReader> {
    ReaderEvent event = ReaderEvent::NONE;
    size_t depth = 0;

    bool SetEvent(ReaderEvent e) {
        event = e;
        return true;
    }
    bool Key(const char* txt, size_t length, bool copy) { return SetEvent(ReaderEvent::KEY); }
    bool Null() { return SetEvent(ReaderEvent::NULL_); }
    bool RawNumber(const Ch* str, size_t len, bool copy) { assert(false); }
    bool String(const char* txt, size_t length, bool copy) { return SetEvent(ReaderEvent::STRING); }
    bool Bool(bool v) { return SetEvent(ReaderEvent::BOOL); }
    bool Int(int32_t v) { return SetEvent(ReaderEvent::INT32); }
    bool Int64(int64_t v) { return SetEvent(ReaderEvent::INT64); }
    bool Uint(uint32_t v) { return SetEvent(ReaderEvent::UINT32); }
    bool Uint64(uint64_t v) { return SetEvent(ReaderEvent::UINT64); }
    bool Double(double v) { return SetEvent(ReaderEvent::DOUBLE); }
    bool StartObject() {
        ++depth;
        return SetEvent(ReaderEvent::START_OBJECT);
    }
    bool StartArray() {
        ++depth;
        return SetEvent(ReaderEvent::START_ARRAY);
    }
    bool EndObject(size_t count) {
        --depth;
        return SetEvent(ReaderEvent::END_OBJECT);
    }
    bool EndArray(size_t count) {
        --depth;
        return SetEvent(ReaderEvent::END_ARRAY);
    }
};

struct ArrayBuffer : public rapidjson::BaseReaderHandler<rapidjson::UTF8<>, ArrayBuffer> {
    rapidjson::Document doc = {};
    size_t depth = 1;
    size_t size = 0;
    bool done = false;

    ArrayBuffer() { doc.StartArray(); }

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
    ArrayBuffer array_buffer_;
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

}  // namespace

/// Find column boundaries
arrow::Status TableReader::FindColumnBoundaries(std::istream& in, TableType& type) {
    // Dont spend time on parsing numbers
    constexpr auto PARSE_FLAGS = rapidjson::kParseDefaultFlags | rapidjson::kParseNumbersAsStringsFlag;

    // Parse the SAX document
    rapidjson::IStreamWrapper in_wrapper{in};
    rapidjson::Reader reader;
    reader.IterativeParseInit();

    // Peek into the document
    EventReader event_reader;
    if (!reader.IterativeParseNext<PARSE_FLAGS>(in_wrapper, event_reader)) {
        auto error = rapidjson::GetParseError_En(reader.GetParseErrorCode());
        return arrow::Status::Invalid(error);
    }

    // Top level not an object?
    if (event_reader.event != ReaderEvent::START_OBJECT) {
        return arrow::Status::Invalid("Unexpected top-level JSON type");
    }

    // Scan all column arrays
    KeyReader key_reader;
    auto next_event = [&]() { return reader.IterativeParseNext<PARSE_FLAGS>(in_wrapper, event_reader); };
    auto next_key = [&]() { return reader.IterativeParseNext<PARSE_FLAGS>(in_wrapper, key_reader); };
    while (next_key() && key_reader.event == ReaderEvent::KEY) {
        auto column_name = key_reader.ReleaseKey();
        auto column_begin = in_wrapper.Tell();
        auto column_end = column_begin;

        // Get the column
        if (!next_event() || event_reader.event != ReaderEvent::START_ARRAY) {
            return arrow::Status::Invalid("Invalid type. Expected start of column array, received: ",
                                          GetReaderEventName(event_reader.event));
        }

        // Consume the entire column array.
        // XXX this is the hot loop since we're scanning the entire document for the column boundaries.
        // XXX parser errors.
        assert(event_reader.depth == 2);
        while (next_event() && event_reader.depth != 1)
            ;

        // The the position of the first token that is different
        column_end = in_wrapper.Tell();

        // Insert column boundaries
        type.column_boundaries.insert(
            {column_name, FileRange{.offset = column_begin, .size = column_end - column_begin}});
    }
    return arrow::Status::OK();
}

std::string_view GetReaderEventName(ReaderEvent event) {
    switch (event) {
        case ReaderEvent::NONE:
            return "NONE";
        case ReaderEvent::KEY:
            return "KEY";
        case ReaderEvent::NULL_:
            return "NULL_";
        case ReaderEvent::STRING:
            return "STRING";
        case ReaderEvent::BOOL:
            return "BOOL";
        case ReaderEvent::INT32:
            return "INT32";
        case ReaderEvent::INT64:
            return "INT64";
        case ReaderEvent::UINT32:
            return "UINT32";
        case ReaderEvent::UINT64:
            return "UINT64";
        case ReaderEvent::DOUBLE:
            return "DOUBLE";
        case ReaderEvent::START_OBJECT:
            return "START_OBJECT";
        case ReaderEvent::START_ARRAY:
            return "START_ARRAY";
        case ReaderEvent::END_OBJECT:
            return "END_OBJECT";
        case ReaderEvent::END_ARRAY:
            return "END_ARRAY";
        default:
            return "?";
    }
}

}  // namespace json
}  // namespace web
}  // namespace duckdb
