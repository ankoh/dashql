// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEB_JSON_READER_H_
#define INCLUDE_DUCKDB_WEB_JSON_READER_H_

#define RAPIDJSON_HAS_STDSTRING 1
#define RAPIDJSON_HAS_CXX11_RVALUE_REFS 1
#define RAPIDJSON_HAS_CXX11_RANGE_FOR 1

#include <iostream>
#include <memory>
#include <string>

#include "arrow/type.h"
#include "arrow/type_fwd.h"
#include "duckdb/web/io/ifstream.h"
#include "duckdb/web/json_parser.h"
#include "rapidjson/document.h"
#include "rapidjson/istreamwrapper.h"

namespace duckdb {
namespace web {
namespace json {

/// Get the table shape
enum TableShape {
    // Unknown table shape
    UNRECOGNIZED,
    // Document is an array of rows.
    // E.g. [{"a":1,"b":2}, {"a":3,"b":4}]
    ROW_ARRAY,
    // Document is an object with column array fields.
    // E.g. {"a":[1,3],"b":[2,4]}
    COLUMN_OBJECT,
};

/// A JSON reader event
enum class JSONReaderEvent {
    NONE,
    KEY,
    NULL_,
    STRING,
    BOOL,
    INT32,
    INT64,
    UINT32,
    UINT64,
    DOUBLE,
    START_OBJECT,
    START_ARRAY,
    END_OBJECT,
    END_ARRAY,
};

/// Get the json reader event name
std::string_view GetJSONReaderEventName(JSONReaderEvent event);

/// A tiny helper to remember the last JSON reader event for iterative parsing
struct JSONReaderEventCache : public rapidjson::BaseReaderHandler<rapidjson::UTF8<>, JSONReaderEventCache> {
    JSONReaderEvent event = JSONReaderEvent::NONE;
    std::string key_buffer = "";
    std::string_view key = "";

    std::string ReleaseKey() {
        if (!key_buffer.empty()) {
            key = {};
            return std::move(key_buffer);
        } else {
            return std::string{std::move(key)};
        }
    }

    bool SetEvent(JSONReaderEvent e) {
        event = e;
        return true;
    }
    bool Key(const char* txt, size_t length, bool copy) {
        if (copy) {
            key_buffer = std::string{txt, length};
            key = key_buffer;
        } else {
            key_buffer.clear();
            key = std::string_view{txt, length};
        }
        return SetEvent(JSONReaderEvent::KEY);
    }
    bool Null() { return SetEvent(JSONReaderEvent::NULL_); }
    bool RawNumber(const Ch* str, size_t len, bool copy) { assert(false); }
    bool String(const char* txt, size_t length, bool copy) { return SetEvent(JSONReaderEvent::STRING); }
    bool Bool(bool v) { return SetEvent(JSONReaderEvent::BOOL); }
    bool Int(int32_t v) { return SetEvent(JSONReaderEvent::INT32); }
    bool Int64(int64_t v) { return SetEvent(JSONReaderEvent::INT64); }
    bool Uint(uint32_t v) { return SetEvent(JSONReaderEvent::UINT32); }
    bool Uint64(uint64_t v) { return SetEvent(JSONReaderEvent::UINT64); }
    bool Double(double v) { return SetEvent(JSONReaderEvent::DOUBLE); }
    bool StartObject() { return SetEvent(JSONReaderEvent::START_OBJECT); }
    bool StartArray() { return SetEvent(JSONReaderEvent::START_ARRAY); }
    bool EndObject(size_t count) { return SetEvent(JSONReaderEvent::END_OBJECT); }
    bool EndArray(size_t count) { return SetEvent(JSONReaderEvent::END_ARRAY); }
};

/// Get the JSON reader options
struct JSONReaderOptions {
    /// The table shape
    std::optional<TableShape> table_shape = std::nullopt;
    /// The fields (if any)
    std::vector<std::shared_ptr<arrow::Field>> fields = {};

    /// Read from input stream
    arrow::Status ReadFrom(const rapidjson::Document& doc);
};

/// An abstract JSON reader
class JSONReader {
   public:
    /// Read next chunk
    virtual arrow::Result<std::shared_ptr<arrow::Array>> ReadNextBatch() = 0;
};

}  // namespace json
}  // namespace web
}  // namespace duckdb

#endif
