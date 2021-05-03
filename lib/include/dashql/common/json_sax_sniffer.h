#ifndef INCLUDE_DASHQL_ANALYZER_JSON_SAX_SNIFFER_H_
#define INCLUDE_DASHQL_ANALYZER_JSON_SAX_SNIFFER_H_

#include <arrow/type_fwd.h>

#include <optional>
#include <unordered_map>
#include <variant>
#include <vector>

#include "arrow/type.h"
#include "arrow/type_traits.h"
#include "dashql/common/json_sax.h"
#include "dashql/common/variant.h"
#include "dashql/proto_generated.h"
#include "rapidjson/document.h"
#include "rapidjson/writer.h"

namespace dashql {
namespace json {

struct JSONSummary {
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

    ValueType GetMostFrequentValueType() {
        std::array<std::pair<ValueType, size_t>, 5> counters{
            std::make_pair(ValueType::BOOLEAN, counter_bool),
            std::make_pair(ValueType::NUMBER,
                           counter_int32 + counter_int64 + counter_uint32 + counter_uint64 + counter_double),
            std::make_pair(ValueType::OBJECT, counter_object),
            std::make_pair(ValueType::ARRAY, counter_array),
            std::make_pair(ValueType::STRING, counter_string),
        };
        std::sort(counters.begin(), counters.end(), [](auto& l, auto& r) { return std::get<1>(l) < std::get<1>(r); });
        return counters.back().first;
    }

    NumberType GetMostFrequentNumberType() {
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

struct JSONSniffer : public rapidjson::BaseReaderHandler<rapidjson::UTF8<>, JSONSummary> {
    JSONSummary stats;

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

template <typename Encoding, typename Allocator> class JSONKeyHasher {
   protected:
    static const size_t kDefaultSize = 256;
    struct Number {
        union U {
            uint64_t u;
            int64_t i;
        } u;
        double d;
    };

    rapidjson::internal::Stack<Allocator> stack_;

    bool WriteBuffer(rapidjson::Type type, const void* data, size_t len) {
        // FNV-1a from http://isthe.com/chongo/tech/comp/fnv/
        uint64_t h = Hash(RAPIDJSON_UINT64_C2(0x84222325, 0xcbf29ce4), type);
        const unsigned char* d = static_cast<const unsigned char*>(data);
        for (size_t i = 0; i < len; i++) h = Hash(h, d[i]);
        *stack_.template Push<uint64_t>() = h;
        return true;
    }

    static uint64_t Hash(uint64_t h, uint64_t d) {
        static const uint64_t kPrime = RAPIDJSON_UINT64_C2(0x00000100, 0x000001b3);
        h ^= d;
        h *= kPrime;
        return h;
    }

   public:
    typedef typename Encoding::Ch Ch;

    JSONKeyHasher(Allocator* allocator = 0, size_t stackCapacity = kDefaultSize) : stack_(allocator, stackCapacity) {}

    bool Null() { return true; }
    bool Bool(bool b) { return true; }
    bool Int(int i) { return true; }
    bool Uint(unsigned u) { return true; }
    bool Int64(int64_t i) { return true; }
    bool Uint64(uint64_t u) { return true; }
    bool Double(double d) { return true; }
    bool RawNumber(const Ch* str, rapidjson::SizeType len, bool) { return true; }
    bool String(const Ch* str, rapidjson::SizeType len, bool) { return true; }

    bool StartObject() { return true; }
    bool Key(const Ch* str, rapidjson::SizeType len, bool copy) {
        WriteBuffer(rapidjson::kStringType, str, len * sizeof(Ch));
        return true;
    }
    bool EndObject(rapidjson::SizeType memberCount) {
        uint64_t h = Hash(0, rapidjson::kObjectType);
        uint64_t* kv = stack_.template Pop<uint64_t>(memberCount * 2);
        for (rapidjson::SizeType i = 0; i < memberCount; i++)
            h ^= Hash(kv[i * 2], kv[i * 2 + 1]);  // Use xor to achieve member order insensitive
        *stack_.template Push<uint64_t>() = h;
        return true;
    }

    bool StartArray() { return true; }
    bool EndArray(rapidjson::SizeType elementCount) {
        uint64_t h = Hash(0, rapidjson::kArrayType);
        uint64_t* e = stack_.template Pop<uint64_t>(elementCount);
        for (rapidjson::SizeType i = 0; i < elementCount; i++)
            h = Hash(h, e[i]);  // Use hash to achieve element order sensitive
        *stack_.template Push<uint64_t>() = h;
        return true;
    }

    bool IsValid() const { return stack_.GetSize() == sizeof(uint64_t); }

    uint64_t GetHashCode() const {
        RAPIDJSON_ASSERT(IsValid());
        return *stack_.template Top<uint64_t>();
    }

    void Clear() const { return *stack_.Clear(); }
};

template <typename Encoding, typename Allocator> class JSONSchemaBuilder {
    typedef typename Encoding::Ch Ch;

   protected:
    /// The enum
    enum class NodeType { STRUCT, ARRAY };
    /// The node
    struct Node {
        /// The node type
        NodeType node_type = NodeType::STRUCT;
        /// The parent
        size_t parent = std::numeric_limits<size_t>::max();
        /// The name
        std::string name = "";
        /// The fields
        arrow::FieldVector children = {};
    };
    /// The build stack
    std::vector<Node> stack_ = {};
    /// The last key
    std::string key_ = "";
    /// The null count
    size_t null_count_ = 0;

    /// The last node
    auto& last() { return stack_.back(); }

   public:
    /// Constructor
    JSONSchemaBuilder() : stack_() {
        stack_.push_back({
            .parent = -1,
            .name = "",
            .children = {},
        });
    }

    bool Key(const Ch* str, rapidjson::SizeType len, bool copy) {
        key_ = {str, len};
        return true;
    }
    bool Null() {
        last().fields.push_back(arrow::field(std::move(key_), arrow::null()));
        return true;
    }
    bool Bool(bool b) {
        last().fields.push_back(arrow::field(std::move(key_), arrow::boolean()));
        return true;
    }
    bool Int(int i) {
        last().fields.push_back(arrow::field(std::move(key_), arrow::int32()));
        return true;
    }
    bool Uint(unsigned u) {
        last().fields.push_back(arrow::field(std::move(key_), arrow::uint32()));
        return true;
    }
    bool Int64(int64_t i) {
        last().fields.push_back(arrow::field(std::move(key_), arrow::int64()));
        return true;
    }
    bool Uint64(uint64_t u) {
        last().fields.push_back(arrow::field(std::move(key_), arrow::uint64()));
        return true;
    }
    bool Double(double d) {
        last().fields.push_back(arrow::field(std::move(key_), arrow::float64()));
        return true;
    }
    bool RawNumber(const Ch* str, rapidjson::SizeType len, bool) {
        last().fields.push_back(arrow::field(std::move(key_), arrow::utf8()));
        return true;
    }
    bool String(const Ch* str, rapidjson::SizeType len, bool) {
        last().fields.push_back(arrow::field(std::move(key_), arrow::utf8()));
        return true;
    }
    bool StartObject() {
        stack_.push_back({
            .node_type = NodeType::OBJECT,
            .parent = stack_.size(),
            .name = std::move(key_),
            .children = {},
        });
        return true;
    }
    bool EndObject(rapidjson::SizeType memberCount) {
        if (last().parent != std::numeric_limits<size_t>::max()) {
            auto& parent = stack_[last().parent];
            parent.fields.push_back(arrow::field(last().name, arrow::struct_(last().fields)));
        }
        return true;
    }
    bool StartArray() {
        stack_.push_back({
            .node_type = NodeType::ARRAY,
            .parent = stack_.size(),
            .name = std::move(key_),
            .children = {},
        });
        return true;
    }
    bool EndArray(rapidjson::SizeType elementCount) { return true; }
};

}  // namespace json
}  // namespace dashql

#endif
