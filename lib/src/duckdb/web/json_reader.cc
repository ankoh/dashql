// Copyright (c) 2020 The DashQL Authors

#include <algorithm>
#include <iostream>
#include <memory>
#include <optional>
#include <unordered_map>
#include <variant>
#include <vector>

#include "rapidjson/document.h"
#include "rapidjson/writer.h"

namespace duckdb {
namespace web {
namespace json {

/// The JSON sniffer tries to detect the arrow schema in-flight while parsing the JSON document
struct JSONSniffer : public rapidjson::BaseReaderHandler<rapidjson::UTF8<>, JSONSniffer> {
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
    /// The current array
    rapidjson::Document buffer_ = {};
    /// The current column name
    std::string column_name_ = {};

   protected:
    bool Key(const char* txt, size_t length, bool copy) {
        // Start of a new column?
        if (format_ == TableFormat::COLUMN_MAJOR && stats_.depth == 1) {
            column_name_ = std::string{txt, length};
        }
        return buffer_.Key(txt, length, copy);
    }
    bool Null() {
        ++stats_.counter_null;
        return buffer_.Null();
    }
    bool RawNumber(const Ch* str, size_t len, bool copy) {
        ++stats_.counter_string;
        return buffer_.RawNumber(str, len, copy);
    }
    bool String(const char* txt, size_t length, bool copy) {
        ++stats_.counter_string;
        return buffer_.String(txt, length, copy);
    }
    bool Bool(bool v) {
        ++stats_.counter_bool;
        return buffer_.Bool(v);
    }
    bool Int(int32_t v) {
        ++stats_.counter_int32;
        return buffer_.Int(v);
    }
    bool Int64(int64_t v) {
        ++stats_.counter_int64;
        return buffer_.Int64(v);
    }
    bool Uint(uint32_t v) {
        ++stats_.counter_uint32;
        stats_.counter_uint32_max += (v > std::numeric_limits<int32_t>::max());
        return buffer_.Uint(v);
    }
    bool Uint64(uint64_t v) {
        ++stats_.counter_uint64;
        stats_.counter_uint64_max += (v > std::numeric_limits<int64_t>::max());
        return buffer_.Uint64(v);
    }
    bool Double(double v) {
        ++stats_.counter_double;
        return buffer_.Double(v);
    }
    bool StartObject() {
        // Root is object? Assume column-major format.
        // E.g. { "a": [...], "b": [...] }
        auto depth = stats_.depth++;
        if (depth == 0) {
            format_ = TableFormat::COLUMN_MAJOR;
            stats_.ResetCounters();
        } else {
            ++stats_.counter_object;
        }
        return buffer_.StartObject();
    }
    bool EndObject(size_t count) {
        auto depth = --stats_.depth;
        if (format_ == TableFormat::ROW_MAJOR && depth == 1) {
            // Can emit object?
        }
        return buffer_.EndObject(count);
    }
    bool StartArray() {
        // Root is array? Assume row-major format.
        // E.g. [ {"a": 1, "b": 2}, {"a": 4, "b": 3} ]
        auto depth = stats_.depth++;
        if (depth == 0) {
            format_ = TableFormat::ROW_MAJOR;
            stats_.ResetCounters();
            return true;
        }

        // Start of a new column?
        if (format_ == TableFormat::COLUMN_MAJOR && depth == 1) {
            buffer_ = {};
            stats_.ResetCounters();
            return buffer_.StartArray();
        }

        ++stats_.counter_array;
        return buffer_.StartArray();
    }
    bool EndArray(size_t count) {
        auto depth = --stats_.depth;
        if (format_ == TableFormat::ROW_MAJOR) {
            // Saw entire relation?
            if (depth == 0) {
                // XXX parse rows as arrow struct

                buffer_.EndArray(count);
                return true;
            }
        } else if (format_ == TableFormat::COLUMN_MAJOR) {
            // Saw entire column?
            if (depth == 1) {
                buffer_.EndArray(count);
                auto value_type = stats_.GetMostFrequentValueType();
                auto number_type = stats_.GetMostFrequentNumberType();

                // XXX parse buffer as arrow array

                return true;
            }
        }
        return buffer_.EndArray(count);
    }
};

// template <typename Encoding, typename Allocator> class JSONStructSchemaBuilder {
//     typedef typename Encoding::Ch Ch;
//
//    protected:
//     /// The enum
//     enum class NodeType { STRUCT, ARRAY };
//     /// The node
//     struct Node {
//         /// The node type
//         NodeType node_type = NodeType::STRUCT;
//         /// The parent
//         size_t parent = std::numeric_limits<size_t>::max();
//         /// The name
//         std::string name = "";
//         /// The fields
//         arrow::FieldVector children = {};
//     };
//     /// The build stack
//     std::vector<Node> stack_ = {};
//     /// The last key
//     std::string key_ = "";
//     /// The null count
//     size_t null_count_ = 0;
//
//     /// The last node
//     auto& last() { return stack_.back(); }
//
//    public:
//     /// Constructor
//     JSONStructSchemaBuilder() : stack_() {
//         stack_.push_back({
//             .parent = -1,
//             .name = "",
//             .children = {},
//         });
//     }
//
//     bool Key(const Ch* str, rapidjson::SizeType len, bool copy) {
//         key_ = {str, len};
//         return true;
//     }
//     bool Null() {
//         last().fields.push_back(arrow::field(std::move(key_), arrow::null()));
//         return true;
//     }
//     bool Bool(bool b) {
//         last().fields.push_back(arrow::field(std::move(key_), arrow::boolean()));
//         return true;
//     }
//     bool Int(int i) {
//         last().fields.push_back(arrow::field(std::move(key_), arrow::int32()));
//         return true;
//     }
//     bool Uint(unsigned u) {
//         last().fields.push_back(arrow::field(std::move(key_), arrow::uint32()));
//         return true;
//     }
//     bool Int64(int64_t i) {
//         last().fields.push_back(arrow::field(std::move(key_), arrow::int64()));
//         return true;
//     }
//     bool Uint64(uint64_t u) {
//         last().fields.push_back(arrow::field(std::move(key_), arrow::uint64()));
//         return true;
//     }
//     bool Double(double d) {
//         last().fields.push_back(arrow::field(std::move(key_), arrow::float64()));
//         return true;
//     }
//     bool RawNumber(const Ch* str, rapidjson::SizeType len, bool) {
//         last().fields.push_back(arrow::field(std::move(key_), arrow::utf8()));
//         return true;
//     }
//     bool String(const Ch* str, rapidjson::SizeType len, bool) {
//         last().fields.push_back(arrow::field(std::move(key_), arrow::utf8()));
//         return true;
//     }
//     bool StartObject() {
//         stack_.push_back({
//             .node_type = NodeType::OBJECT,
//             .parent = stack_.size(),
//             .name = std::move(key_),
//             .children = {},
//         });
//         return true;
//     }
//     bool EndObject(rapidjson::SizeType memberCount) {
//         if (last().parent != std::numeric_limits<size_t>::max()) {
//             auto& parent = stack_[last().parent];
//             parent.fields.push_back(arrow::field(last().name, arrow::struct_(last().fields)));
//         }
//         return true;
//     }
//     bool StartArray() {
//         stack_.push_back({
//             .node_type = NodeType::ARRAY,
//             .parent = stack_.size(),
//             .name = std::move(key_),
//             .children = {},
//         });
//         return true;
//     }
//     bool EndArray(rapidjson::SizeType elementCount) { return true; }
// };

}  // namespace json

}  // namespace web
}  // namespace duckdb
