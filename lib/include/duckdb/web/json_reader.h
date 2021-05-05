// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEB_JSON_READER_H_
#define INCLUDE_DUCKDB_WEB_JSON_READER_H_

#include <memory>

#include "arrow/type.h"
#include "arrow/type_fwd.h"
#include "duckdb/web/json_parser.h"

namespace duckdb {
namespace web {
namespace json {

/// A JSON Table format.
/// We support reading JSON documents in 2 formats:
/// Row-major:      [{"a": 1, "b": 3}, {"a": 2, "b": 4}]
/// Column-major:   {"a": [1, 2], "b": [3, 4]}
enum class JSONTableFormat : uint8_t {
    UNKNOWN = 0,
    ROW_MAJOR = 1,
    COLUMN_MAJOR = 2,
};

/// A JSON value type
enum class JSONValueType : uint8_t {
    BOOLEAN = 0,
    NUMBER = 1,
    OBJECT = 2,
    ARRAY = 3,
    STRING = 4,
};

/// A JSON number type
enum class JSONNumberType : uint8_t {
    INT32 = 0,
    INT64 = 1,
    UINT32 = 2,
    UINT64 = 3,
    DOUBLE = 4,
};

/// JSON document statistics
struct JSONDocumentStats {
    size_t counter_bool = 0;
    size_t counter_string = 0;
    size_t counter_int32 = 0;
    size_t counter_int64 = 0;
    size_t counter_uint32 = 0;
    size_t counter_uint32_max = 0;
    size_t counter_uint64 = 0;
    size_t counter_uint64_max = 0;
    size_t counter_double = 0;
    size_t counter_object = 0;
    size_t counter_array = 0;

    void ResetCounters() {
        counter_bool = 0;
        counter_string = 0;
        counter_int32 = 0;
        counter_int64 = 0;
        counter_uint32 = 0;
        counter_uint32_max = 0;
        counter_uint64 = 0;
        counter_uint64_max = 0;
        counter_double = 0;
        counter_object = 0;
        counter_array = 0;
    }
};

/// Infer an arrow schema for a json object
std::shared_ptr<arrow::Schema> InferArrowSchema(rapidjson::Value& value);
/// Infer an array parser for json document
arrow::Result<std::shared_ptr<ArrayParser>> InferArrayParser(const rapidjson::Document::Array& array,
                                                             const JSONDocumentStats& stats);

/// The JSON sniffer tries to detect the arrow schema in-flight while parsing the JSON document
struct InferringJSONReader : public rapidjson::BaseReaderHandler<rapidjson::UTF8<>, InferringJSONReader> {
    static constexpr size_t SAMPLE_SIZE = 1024;

   protected:
    /// The json statistics
    JSONDocumentStats stats_ = {};
    /// The table format
    JSONTableFormat format_ = JSONTableFormat::UNKNOWN;
    /// The current depth
    size_t depth_ = 0;
    /// The depth of rows.
    /// We only track statistics at that depth.
    /// In row-major format, the depth of rows is 1.
    /// E.g. [ {"a": 2} ]
    /// In column-major format, the depth of rows is 2.
    /// E.g. { "foo": [{"a": 2}] }
    size_t row_depth_ = -1;
    /// The current json buffer
    rapidjson::Document json_buffer_ = {};
    /// The current column name (if column major)
    std::vector<std::string> column_names_ = {};
    /// The arrays
    std::vector<std::shared_ptr<arrow::Array>> arrays = {};

   protected:
    /// Update counters
    inline void Bump(size_t& counter) { counter += depth_ == row_depth_; }

    /// ---------------------------------
    /// Rapidjson callbacks

    bool Key(const char* txt, size_t length, bool copy) {
        // Start of a new column?
        if (format_ == JSONTableFormat::COLUMN_MAJOR && depth_ == 1) {
            column_names_.push_back(std::string{txt, length});
        }
        return json_buffer_.Key(txt, length, copy);
    }
    bool Null() { return json_buffer_.Null(); }
    bool RawNumber(const Ch* str, size_t len, bool copy) {
        assert(false && "invalid parser flag");
        return false;
    }
    bool String(const char* txt, size_t length, bool copy) {
        Bump(stats_.counter_string);
        return json_buffer_.String(txt, length, copy);
    }
    bool Bool(bool v) {
        Bump(stats_.counter_bool);
        return json_buffer_.Bool(v);
    }
    bool Int(int32_t v) {
        Bump(stats_.counter_int32);
        return json_buffer_.Int(v);
    }
    bool Int64(int64_t v) {
        Bump(stats_.counter_int64);
        return json_buffer_.Int64(v);
    }
    bool Uint(uint32_t v) {
        Bump(stats_.counter_uint32);
        stats_.counter_uint32_max += (v > std::numeric_limits<int32_t>::max());
        return json_buffer_.Uint(v);
    }
    bool Uint64(uint64_t v) {
        Bump(stats_.counter_uint64);
        stats_.counter_uint64_max += (v > std::numeric_limits<int64_t>::max());
        return json_buffer_.Uint64(v);
    }
    bool Double(double v) {
        Bump(stats_.counter_double);
        return json_buffer_.Double(v);
    }
    bool StartObject() {
        Bump(stats_.counter_object);

        // Root is object? Assume column-major format.
        // E.g. { "a": [...], "b": [...] }
        auto depth = depth_++;
        if (depth == 0) {
            format_ = JSONTableFormat::COLUMN_MAJOR;
            row_depth_ = 2;
            stats_.ResetCounters();
        }
        return json_buffer_.StartObject();
    }
    bool StartArray() {
        Bump(stats_.counter_array);

        // Root is array? Assume row-major format.
        // E.g. [ {"a": 1, "b": 2}, {"a": 4, "b": 3} ]
        auto depth = depth_++;
        if (depth == 0) {
            format_ = JSONTableFormat::ROW_MAJOR;
            row_depth_ = 1;
            stats_.ResetCounters();
            return true;
        }

        // Start of a new column?
        if (format_ == JSONTableFormat::COLUMN_MAJOR && depth == 1) {
            json_buffer_ = {};
            stats_.ResetCounters();
            return json_buffer_.StartArray();
        }
        return json_buffer_.StartArray();
    }
    bool EndObject(size_t count) {
        auto depth = --depth_;
        return json_buffer_.EndObject(count);
    }
    bool EndArray(size_t count) {
        auto parse_array = [&]() {
            json_buffer_.EndArray(count);

            // Resolve array parser
            assert(json_buffer_.IsArray());
            auto maybe_parser = InferArrayParser(json_buffer_.GetArray(), stats_);
            if (!maybe_parser.ok()) {
                // XXX
            }

            // Append value
            auto maybe_array = maybe_parser.ValueUnsafe()->AppendValues(json_buffer_);
            if (!maybe_array.ok()) {
                // XXX
            }

            // Clear the json buffer
            json_buffer_.Clear();
            return true;
        };
        auto depth = --depth_;
        if (format_ == JSONTableFormat::ROW_MAJOR) {
            // Saw entire relation?
            if (depth == 0) return parse_array();
        } else if (format_ == JSONTableFormat::COLUMN_MAJOR) {
            // Saw entire column?
            if (depth == 1) return parse_array();
        }
        return json_buffer_.EndArray(count);
    }
};

}  // namespace json
}  // namespace web
}  // namespace duckdb

#endif
