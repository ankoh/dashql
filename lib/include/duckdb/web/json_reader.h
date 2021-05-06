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

/// Infer a struct array parser for a json array
arrow::Result<std::shared_ptr<ArrayParser>> InferStructArrayParser(const std::vector<const rapidjson::Value*>& sample);
/// Infer an array parser for json array
arrow::Result<std::shared_ptr<ArrayParser>> InferArrayParser(const std::vector<const rapidjson::Value*>& sample);

/// The JSON sniffer tries to detect the arrow schema in-flight while parsing the JSON document
struct InferringJSONReader : public rapidjson::BaseReaderHandler<rapidjson::UTF8<>, InferringJSONReader> {
    static constexpr size_t SAMPLE_SIZE = 1024;

   protected:
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
    bool String(const char* txt, size_t length, bool copy) { return json_buffer_.String(txt, length, copy); }
    bool Bool(bool v) { return json_buffer_.Bool(v); }
    bool Int(int32_t v) { return json_buffer_.Int(v); }
    bool Int64(int64_t v) { return json_buffer_.Int64(v); }
    bool Uint(uint32_t v) { return json_buffer_.Uint(v); }
    bool Uint64(uint64_t v) { return json_buffer_.Uint64(v); }
    bool Double(double v) { return json_buffer_.Double(v); }
    bool StartObject() {
        // Root is object? Assume column-major format.
        // E.g. { "a": [...], "b": [...] }
        auto depth = depth_++;
        if (depth == 0) {
            format_ = JSONTableFormat::COLUMN_MAJOR;
            row_depth_ = 2;
        }
        return json_buffer_.StartObject();
    }
    bool StartArray() {
        // Root is array? Assume row-major format.
        // E.g. [ {"a": 1, "b": 2}, {"a": 4, "b": 3} ]
        auto depth = depth_++;
        if (depth == 0) {
            format_ = JSONTableFormat::ROW_MAJOR;
            row_depth_ = 1;
            return true;
        }

        // Start of a new column?
        if (format_ == JSONTableFormat::COLUMN_MAJOR && depth == 1) {
            json_buffer_ = {};
            return json_buffer_.StartArray();
        }
        return json_buffer_.StartArray();
    }
    bool EndObject(size_t count) {
        --depth_;
        return json_buffer_.EndObject(count);
    }
    bool EndArray(size_t count) {
        auto parse_array = [&]() {
            // Collect a sample of the array
            static constexpr size_t SAMPLE_SIZE = 1024;
            assert(json_buffer_.IsArray());
            auto json_array = json_buffer_.GetArray();
            auto step_size = std::max<size_t>(json_array.Size() / SAMPLE_SIZE, 1);
            std::vector<const rapidjson::Value*> sample;
            sample.reserve(std::min<size_t>(SAMPLE_SIZE, json_array.Size()));
            for (auto i = 0; i < sample.size(); i += step_size) {
                sample.push_back(&json_array[i]);
            }

            // Infer the array parser
            auto maybe_parser = InferArrayParser(sample);
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
        };
        auto depth = --depth_;
        if (!json_buffer_.EndArray(count)) return false;

        if (format_ == JSONTableFormat::ROW_MAJOR) {
            // Saw entire relation?
            if (depth == 0) parse_array();
        } else if (format_ == JSONTableFormat::COLUMN_MAJOR) {
            // Saw entire column?
            if (depth == 1) parse_array();
        }
        return true;
    }
};

}  // namespace json
}  // namespace web
}  // namespace duckdb

#endif
