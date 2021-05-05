// Copyright (c) 2020 The DashQL Authors

#include <algorithm>
#include <iostream>
#include <memory>
#include <optional>
#include <unordered_map>
#include <variant>
#include <vector>

#include "arrow/status.h"
#include "arrow/type.h"
#include "arrow/type_fwd.h"
#include "arrow/type_traits.h"
#include "arrow/util/value_parsing.h"
#include "duckdb/web/json_parser.h"
#include "rapidjson/document.h"
#include "rapidjson/writer.h"

namespace duckdb {
namespace web {
namespace json {

/// The JSON sniffer tries to detect the arrow schema in-flight while parsing the JSON document
struct JSONSniffer : public rapidjson::BaseReaderHandler<rapidjson::UTF8<>, JSONSniffer> {
    static constexpr size_t SAMPLE_SIZE = 1024;

   public:
    enum class TableFormat : uint8_t {
        UNKNOWN = 0,
        ROW_MAJOR = 1,
        COLUMN_MAJOR = 2,
    };

    enum class ValueType : uint8_t {
        BOOLEAN = 0,
        NUMBER = 1,
        OBJECT = 2,
        ARRAY = 3,
        STRING = 4,
    };

    enum class NumberType : uint8_t {
        INT32 = 0,
        INT64 = 1,
        UINT32 = 2,
        UINT64 = 3,
        DOUBLE = 4,
    };

    /// JSON document statistics
    struct Stats {
        size_t depth = 0;
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
        size_t counter_null = 0;

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
            counter_null = 0;
        }

        /// Get the most frequent value type
        ValueType GetMostFrequentValueType() const {
            std::array<std::pair<ValueType, size_t>, 5> counters{
                std::make_pair(ValueType::BOOLEAN, counter_bool),
                std::make_pair(ValueType::NUMBER,
                               counter_int32 + counter_int64 + counter_uint32 + counter_uint64 + counter_double),
                std::make_pair(ValueType::OBJECT, counter_object),
                std::make_pair(ValueType::ARRAY, counter_array),
                std::make_pair(ValueType::STRING, counter_string),
            };
            std::sort(counters.begin(), counters.end(),
                      [](auto& l, auto& r) { return std::get<1>(l) < std::get<1>(r); });
            return counters.back().first;
        }

        /// Get the most frequent number type
        NumberType GetMostFrequentNumberType() const {
            // Double always wins
            if (counter_double) return NumberType::DOUBLE;
            // 64 bits signed?
            if (counter_int64) return counter_uint64_max ? NumberType::DOUBLE : NumberType::UINT64;
            // 64 bits unsigned?
            if (counter_uint64) return NumberType::UINT64;
            // 32 bits signed?
            if (counter_int32) return counter_uint32_max ? NumberType::INT64 : NumberType::INT32;
            // Otherwise uint32
            return NumberType::UINT32;
        }
    };

   protected:
    /// The json statistics
    Stats stats_ = {};
    /// The table format
    TableFormat format_ = TableFormat::UNKNOWN;
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

    /// Update counters
    inline void Bump(size_t& counter) { counter += stats_.depth == row_depth_; }

   protected:
    bool Key(const char* txt, size_t length, bool copy) {
        // Start of a new column?
        if (format_ == TableFormat::COLUMN_MAJOR && stats_.depth == 1) {
            column_names_.push_back(std::string{txt, length});
        }
        return json_buffer_.Key(txt, length, copy);
    }
    bool Null() {
        Bump(stats_.counter_null);
        return json_buffer_.Null();
    }
    bool RawNumber(const Ch* str, size_t len, bool copy) {
        Bump(stats_.counter_string);
        return json_buffer_.RawNumber(str, len, copy);
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
        auto depth = stats_.depth++;
        if (depth == 0) {
            format_ = TableFormat::COLUMN_MAJOR;
            row_depth_ = 2;
            stats_.ResetCounters();
        }
        return json_buffer_.StartObject();
    }
    bool StartArray() {
        Bump(stats_.counter_array);

        // Root is array? Assume row-major format.
        // E.g. [ {"a": 1, "b": 2}, {"a": 4, "b": 3} ]
        auto depth = stats_.depth++;
        if (depth == 0) {
            format_ = TableFormat::ROW_MAJOR;
            row_depth_ = 1;
            stats_.ResetCounters();
            return true;
        }

        // Start of a new column?
        if (format_ == TableFormat::COLUMN_MAJOR && depth == 1) {
            json_buffer_ = {};
            stats_.ResetCounters();
            return json_buffer_.StartArray();
        }
        return json_buffer_.StartArray();
    }
    bool EndObject(size_t count) {
        auto depth = --stats_.depth;
        return json_buffer_.EndObject(count);
    }
    bool EndArray(size_t count) {
        auto parse_array = [&]() {
            json_buffer_.EndArray(count);

            // Resolve array parser
            auto maybe_parser = ResolveArrayParser(json_buffer_, stats_);
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
        auto depth = --stats_.depth;
        if (format_ == TableFormat::ROW_MAJOR) {
            // Saw entire relation?
            if (depth == 0) return parse_array();
        } else if (format_ == TableFormat::COLUMN_MAJOR) {
            // Saw entire column?
            if (depth == 1) return parse_array();
        }
        return json_buffer_.EndArray(count);
    }

   protected:
    /// Parse an array
    arrow::Result<std::shared_ptr<ArrayParser>> ResolveArrayParser(const rapidjson::Document& doc, const Stats& stats) {
        if (!doc.IsArray()) return arrow::Status{arrow::StatusCode::Invalid, "Expected array"};

        // Saw non-scalar values?
        if (stats.counter_object > 0 || stats.counter_array > 0) {
            // XXX
        }

        // Collect scalar type candidates
        struct Candidate {
            std::shared_ptr<arrow::DataType> type;
            size_t hits;
        };
        std::vector<Candidate> candidates;
#define CANDIDATE(TYPE, CONDITION)                       \
    if (CONDITION) {                                     \
        candidates.push_back({.type = TYPE, .hits = 0}); \
    }
        auto test_i32 = stats_.counter_int32 > 0 || stats_.counter_uint32 > 0;
        auto test_u32 = stats_.counter_uint32_max > 0;
        auto test_i64 = stats_.counter_int64 > 0 || stats_.counter_uint64 > 0 || stats_.counter_uint32_max > 0;
        auto test_u64 = stats_.counter_uint64_max > 0;

        CANDIDATE(arrow::boolean(), stats_.counter_bool > 0);
        CANDIDATE(arrow::float64(), stats_.counter_double > 0);
        CANDIDATE(arrow::utf8(), stats_.counter_string > 0);
        CANDIDATE(arrow::int32(), test_i32);
        CANDIDATE(arrow::int64(), test_i64);
        CANDIDATE(arrow::uint32(), test_u32);
        CANDIDATE(arrow::uint64(), test_u64);
#undef CANDIDATE

        // Sample array
        auto json_array = doc.GetArray();
        auto step_size = std::max<size_t>(json_array.Size() / 1024, 1);
        auto step_count = json_array.Size() / step_size;
        for (auto i = 0; i < step_count; ++i) {
            for (auto j = 0; j < candidates.size(); ++j) {
                candidates[j].hits += TestScalarType(json_array[i * step_size], *candidates[j].type);
            }
        }

        /// xxx
        return nullptr;
    }
};

}  // namespace json

}  // namespace web
}  // namespace duckdb
