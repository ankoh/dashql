#ifndef INCLUDE_DASHQL_ANALYZER_JSON_SAX_STATS_H_
#define INCLUDE_DASHQL_ANALYZER_JSON_SAX_STATS_H_

#include <unordered_map>
#include <variant>
#include <vector>

#include "dashql/common/json_sax.h"
#include "dashql/common/variant.h"
#include "dashql/proto_generated.h"
#include "rapidjson/document.h"
#include "rapidjson/writer.h"

namespace dashql {
namespace json {

enum class SAXValueType : uint8_t {
    BOOLEAN = 0,
    NUMBER = 1,
    OBJECT = 2,
    ARRAY = 3,
    STRING = 4,
};

enum class SAXNumberType : uint8_t {
    INT32 = 0,
    INT64 = 1,
    UINT32 = 2,
    UINT64 = 3,
    DOUBLE = 4,
};

struct SAXStats {
    std::string tmp = {};
    SAXOp last = {.tag = SAXOpTag::NULL_, .argument = std::nullopt};
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

    SAXValueType GetMostFrequentValueType() {
        std::array<std::pair<SAXValueType, size_t>, 5> counters{
            std::make_pair(SAXValueType::BOOLEAN, counter_bool),
            std::make_pair(SAXValueType::NUMBER,
                           counter_int32 + counter_int64 + counter_uint32 + counter_uint64 + counter_double),
            std::make_pair(SAXValueType::OBJECT, counter_object),
            std::make_pair(SAXValueType::ARRAY, counter_array),
            std::make_pair(SAXValueType::STRING, counter_string),
        };
        std::sort(counters.begin(), counters.end(), [](auto& l, auto& r) { return std::get<1>(l) < std::get<1>(r); });
        return counters.back().first;
    }

    SAXNumberType GetMostFrequentNumberType() {
        // Double always wins
        if (counter_double) return SAXNumberType::DOUBLE;
        // 64 bits signed?
        if (counter_int64) return counter_uint64_max ? SAXNumberType::DOUBLE : SAXNumberType::UINT64;
        // 64 bits unsigned?
        if (counter_uint64) return SAXNumberType::UINT64;
        // 32 bits signed?
        if (counter_int32) return counter_uint32_max ? SAXNumberType::INT64 : SAXNumberType::INT32;
        // Otherwise uint32
        return SAXNumberType::UINT32;
    }
};

struct SAXStatsWriter : public rapidjson::BaseReaderHandler<rapidjson::UTF8<>, SAXStats> {
    SAXStats stats;

    bool Key(std::string_view name, bool copy = false) {
        if (copy) {
            stats.tmp = name;
            name = std::string_view{stats.tmp};
        }
        stats.last = {.tag = SAXOpTag::KEY, .argument = SAXOpArg{name}};
        return true;
    }
    bool Key(const char* txt, size_t length, bool copy) { return Key(std::string_view{txt, length}, copy); }
    bool Null() {
        stats.last = {.tag = SAXOpTag::NULL_, .argument = std::nullopt};
        ++stats.counter_null;
        return true;
    }
    bool RawNumber(const Ch* str, size_t len, bool copy) {
        std::string_view txt{str, len};
        if (copy) {
            stats.tmp = {str, len};
            txt = std::string_view{stats.tmp};
        }
        stats.last = {.tag = SAXOpTag::STRING, .argument = SAXOpArg{txt}};
        ++stats.counter_string;
        return true;
    }
    bool String(std::string_view txt, bool copy = false) {
        if (copy) {
            stats.tmp = txt;
            txt = std::string_view{stats.tmp};
        }
        stats.last = {.tag = SAXOpTag::STRING, .argument = SAXOpArg{txt}};
        ++stats.counter_string;
        return true;
    }
    bool String(const char* txt, size_t length, bool copy) { return String(std::string_view{txt, length}, copy); }
    bool Bool(bool v) {
        stats.last = {.tag = SAXOpTag::BOOL, .argument = v};
        ++stats.counter_bool;
        return true;
    }
    bool Int(int32_t v) {
        stats.last = {.tag = SAXOpTag::INT32, .argument = v};
        ++stats.counter_int32;
        return true;
    }
    bool Int64(int64_t v) {
        stats.last = {.tag = SAXOpTag::INT64, .argument = v};
        ++stats.counter_int64;
        return true;
    }
    bool Uint(uint32_t v) {
        stats.last = {.tag = SAXOpTag::UINT32, .argument = v};
        ++stats.counter_uint32;
        stats.counter_uint32_max += (v > std::numeric_limits<int32_t>::max());
        return true;
    }
    bool Uint64(uint64_t v) {
        stats.last = {.tag = SAXOpTag::UINT64, .argument = v};
        ++stats.counter_uint64;
        stats.counter_uint64_max += (v > std::numeric_limits<int64_t>::max());
        return true;
    }
    bool Double(double v) {
        stats.last = {.tag = SAXOpTag::DOUBLE, .argument = v};
        ++stats.counter_double;
        return true;
    }
    bool StartObject() {
        stats.last = {.tag = SAXOpTag::OBJECT_START, .argument = std::nullopt};
        ++stats.depth;
        ++stats.counter_object;
        return true;
    }
    bool StartArray() {
        stats.last = {.tag = SAXOpTag::ARRAY_START, .argument = std::nullopt};
        ++stats.depth;
        ++stats.counter_array;
        return true;
    }
    bool EndObject(size_t count) {
        stats.last = {.tag = SAXOpTag::OBJECT_END, .argument = static_cast<int64_t>(count)};
        --stats.depth;
        return true;
    }
    bool EndArray(size_t count) {
        stats.last = {.tag = SAXOpTag::ARRAY_END, .argument = static_cast<int64_t>(count)};
        --stats.depth;
        return true;
    }
};

}  // namespace json
}  // namespace dashql

#endif
