// Copyright (c) 2020 The DashQL Authors

#include "duckdb/web/json_analyzer.h"

#include <arrow/result.h>
#include <arrow/status.h>

#include <iostream>

#include "rapidjson/error/en.h"
#include "rapidjson/istreamwrapper.h"

namespace duckdb {
namespace web {
namespace json {

namespace {

/// Infer a data type from a json value
std::shared_ptr<arrow::DataType> InferDataType(const rapidjson::Value& value) {
    switch (value.GetType()) {
        case rapidjson::Type::kArrayType: {
            auto array = value.GetArray();
            auto step = array.Size() / 20;
            std::shared_ptr<arrow::DataType> type = nullptr;
            for (int i = 0; i < array.Size(); ++i) {
                if (array[i].IsNull()) continue;
                return arrow::list(InferDataType(array[i]));
            }
            return arrow::utf8();
        }
        case rapidjson::Type::kObjectType: {
            std::vector<std::shared_ptr<arrow::Field>> fields;
            for (auto iter = value.MemberBegin(); iter != value.MemberEnd(); ++iter) {
                auto type = InferDataType(iter->value);
                fields.push_back(arrow::field(iter->name.GetString(), std::move(type)));
            }
            return arrow::struct_(std::move(fields));
        }
        case rapidjson::Type::kNumberType:
            /// Note that this is the reason why we cast nested integers as doubles without further narrowing.
            return arrow::float64();
        case rapidjson::Type::kStringType:
            return arrow::utf8();
        case rapidjson::Type::kNullType:
            return arrow::null();
        case rapidjson::Type::kFalseType:
        case rapidjson::Type::kTrueType:
            return arrow::boolean();
    }
    return nullptr;
}

/// Statistics about a JSON array.
/// We use this to detect number and boolean types without a sample.
struct JSONArrayStats {
    size_t counter_bool = 0;
    size_t counter_string = 0;
    size_t counter_int32 = 0;
    size_t counter_int64 = 0;
    size_t counter_uint32 = 0;
    size_t counter_uint32_max = 0;
    size_t counter_uint64 = 0;
    size_t counter_uint64_max = 0;
    size_t counter_double = 0;
    size_t counter_raw_number = 0;
    size_t counter_object = 0;
    size_t counter_array = 0;
};

/// Type detection helper for flat json arrays.
/// E.g. [1,2,3] => list(int32())
/// Nested types are only inferred based on a reservoir sample.
///
/// Assumes to see 1 additional unmatched array event after which Done() will return true.
class JSONFlatArrayAnalyzer : public rapidjson::BaseReaderHandler<rapidjson::UTF8<>, JSONFlatArrayAnalyzer> {
   protected:
    /// The data depth
    static constexpr size_t data_depth_ = 1;
    /// The sample depth
    static constexpr size_t sample_depth_ = 1;
    /// The current depth
    size_t current_depth_ = 1;
    /// The top-level stats
    JSONArrayStats stats_ = {};
    /// The sample buffer
    rapidjson::Document sample_buffer_ = {};
    /// The rapidjson array
    std::vector<rapidjson::Value> sample_ = {};
    /// Skip the current array entry?
    std::optional<size_t> sample_idx_ = false;
    /// The reservoir counter
    ReservoirSampleCounter sample_counter_ = {};

    // Bump a counter
#define BUMP(COUNTER) \
    if (current_depth_ == data_depth_) ++stats_.COUNTER;
#define BUMP_IF(COUNTER, COND) \
    if (current_depth_ == data_depth_ && COND) ++stats_.COUNTER;

    /// Add an element to the sample
    inline bool Emit(bool ok) {
        if (current_depth_ > sample_depth_ || !ok) return ok;
        auto gen = [](auto&) { return true; };
        if (*sample_idx_ == sample_.size()) {
            sample_.push_back(std::move(sample_buffer_.Populate(gen).Move()));
        } else {
            assert(*sample_idx_ < sample_.size());
            sample_[*sample_idx_] = std::move(sample_buffer_.Populate(gen).Move());
        }
        sample_buffer_.SetNull();
        sample_idx_.reset();
        return ok;
    }

   public:
    /// Constructor
    JSONFlatArrayAnalyzer(size_t capacity = 1024) { sample_.reserve(capacity); }

    /// Saw the closing array event?
    bool Done() { return current_depth_ == 0; }

    bool Key(const char* txt, size_t length, bool copy) {
        return sample_idx_ ? sample_buffer_.Key(txt, length, copy) : true;
    }
    bool Null() { return sample_idx_ ? Emit(sample_buffer_.Null()) : true; }
    bool RawNumber(const Ch* str, size_t len, bool copy) {
        BUMP(counter_raw_number);
        if (current_depth_ == sample_depth_) sample_idx_ = sample_counter_.Insert();
        return sample_idx_ ? Emit(sample_buffer_.RawNumber(str, len, copy)) : true;
    }
    bool String(const char* txt, size_t length, bool copy) {
        BUMP(counter_string);
        if (current_depth_ == sample_depth_) sample_idx_ = sample_counter_.Insert();
        return sample_idx_ ? Emit(sample_buffer_.String(txt, length, copy)) : true;
    }
    bool Bool(bool v) {
        BUMP(counter_bool);
        return sample_idx_ ? Emit(sample_buffer_.Bool(v)) : true;
    }
    bool Int(int32_t v) {
        BUMP(counter_int32);
        return sample_idx_ ? Emit(sample_buffer_.Int(v)) : true;
    }
    bool Int64(int64_t v) {
        BUMP(counter_int64);
        return sample_idx_ ? Emit(sample_buffer_.Int64(v)) : true;
    }
    bool Uint(uint32_t v) {
        BUMP(counter_uint32);
        BUMP_IF(counter_uint32_max, v >= std::numeric_limits<int32_t>::max());
        return sample_idx_ ? Emit(sample_buffer_.Uint(v)) : true;
    }
    bool Uint64(uint64_t v) {
        BUMP(counter_uint64);
        BUMP_IF(counter_uint64_max, v >= std::numeric_limits<int64_t>::max());
        return sample_idx_ ? Emit(sample_buffer_.Uint64(v)) : true;
    }
    bool Double(double v) {
        BUMP(counter_double);
        return sample_idx_ ? Emit(sample_buffer_.Double(v)) : true;
    }
    bool StartObject() {
        BUMP(counter_object);
        if (current_depth_++ == sample_depth_) sample_idx_ = sample_counter_.Insert();
        if (sample_idx_) return sample_buffer_.StartObject();
        return true;
    }
    bool StartArray() {
        BUMP(counter_array);
        if (current_depth_++ == sample_depth_) sample_idx_ = sample_counter_.Insert();
        if (sample_idx_) return sample_buffer_.StartObject();
        return true;
    }
    bool EndObject(size_t count) {
        assert(current_depth_ > 0);
        assert(!sample_idx_.has_value() || current_depth_ > sample_depth_);
        --current_depth_;
        return sample_idx_ ? Emit(sample_buffer_.EndObject(count)) : true;
    }
    bool EndArray(size_t count) {
        assert(current_depth_ > 0);
        assert(!sample_idx_.has_value() || current_depth_ > sample_depth_);
        --current_depth_;
        return sample_idx_ ? Emit(sample_buffer_.EndArray(count)) : true;
    }

    /// Infer the array type
    arrow::Result<std::shared_ptr<arrow::DataType>> InferDataType() { return nullptr; }

#undef BUMP
#undef BUMP_IF
};

/// Type detection helper for json struct arrays.
/// E.g. [{"a": 1},{"b": 2},{"a": 3}] => list(struct_(field("a", int32()), field("b", int32())))
/// Collects statistics about the first nesting level rather then the root.
/// Deeper nesting levels are again inferred from a sample.
///
/// Assumes to see 1 additional unmatched array event after which Done() will return true.
class JSONStructArrayAnalyzer : public rapidjson::BaseReaderHandler<rapidjson::UTF8<>, JSONStructArrayAnalyzer> {
   protected:
    /// The data depth
    static constexpr size_t sample_depth_ = 1;
    /// The data depth
    static constexpr size_t data_depth_ = 2;
    /// The current depth
    size_t current_depth_ = 1;
    /// The current field statistics
    JSONArrayStats* field_stats_ = nullptr;
    /// The first-level field limit
    size_t field_limit = 100;
    /// The first-level fields
    std::vector<std::unique_ptr<char[]>> field_names_ = {};
    /// The first-level stats
    std::unordered_map<std::string_view, JSONArrayStats> field_stats_map_ = {};
    /// The sample buffer
    rapidjson::Document sample_buffer_ = {};
    /// The rapidjson array
    std::vector<rapidjson::Value> sample_ = {};
    /// Skip the current array entry?
    std::optional<size_t> sample_idx_ = false;
    /// The reservoir counter
    ReservoirSampleCounter sample_counter_ = {};

    // Bump a counter
#define BUMP(COUNTER) \
    if (current_depth_ == data_depth_) ++field_stats_->COUNTER;
#define BUMP_IF(COUNTER, COND) \
    if (current_depth_ == data_depth_ && COND) ++field_stats_->COUNTER;

    /// Add an element to the sample
    inline bool Emit(bool ok) {
        if (current_depth_ > sample_depth_ || !ok) return ok;
        auto gen = [](auto&) { return true; };
        if (*sample_idx_ == sample_.size()) {
            sample_.push_back(std::move(sample_buffer_.Populate(gen).Move()));
        } else {
            assert(*sample_idx_ < sample_.size());
            sample_[*sample_idx_] = std::move(sample_buffer_.Populate(gen).Move());
        }
        sample_buffer_.SetNull();
        sample_idx_.reset();
        return ok;
    }

   public:
    /// Constructor
    JSONStructArrayAnalyzer(size_t capacity = 1024) { sample_.reserve(capacity); }

    /// Saw the closing array event?
    bool Done() { return current_depth_ == 0; }

    bool Key(const char* txt, size_t length, bool copy) {
        // When encountering a key at level 1, we resolve the corresponding array statistics.
        // E.g. [{"a": 1, "b": 2}, {"a": 3, "b": 4}]
        //      => tracks array statistics for [], "a" and "b"
        if (current_depth_ == data_depth_) {
            if (auto iter = field_stats_map_.find(std::string_view{txt, length}); iter != field_stats_map_.end()) {
                field_stats_ = &iter->second;
            } else if (field_names_.size() < field_limit) {
                // Allocate name buffer
                std::unique_ptr<char[]> buffer(new char[length + 1]);
                std::memcpy(buffer.get(), txt, length);
                *(buffer.get() + length) = 0;
                auto name = std::string_view{buffer.get(), length};

                // Create array stats
                auto [iter, ok] = field_stats_map_.insert({name, JSONArrayStats{}});
                assert(ok);
                field_stats_ = &iter->second;
                field_names_.push_back(std::move(buffer));
            }
        }
        return sample_idx_ ? sample_buffer_.Key(txt, length, copy) : true;
    }
    bool Null() { return sample_idx_ ? Emit(sample_buffer_.Null()) : true; }
    bool RawNumber(const Ch* str, size_t len, bool copy) {
        BUMP(counter_raw_number);
        if (current_depth_ == sample_depth_) sample_idx_ = sample_counter_.Insert();
        return sample_idx_ ? Emit(sample_buffer_.RawNumber(str, len, copy)) : true;
    }
    bool String(const char* txt, size_t length, bool copy) {
        BUMP(counter_string);
        if (current_depth_ == sample_depth_) sample_idx_ = sample_counter_.Insert();
        return sample_idx_ ? Emit(sample_buffer_.String(txt, length, copy)) : true;
    }
    bool Bool(bool v) {
        BUMP(counter_bool);
        return sample_idx_ ? Emit(sample_buffer_.Bool(v)) : true;
    }
    bool Int(int32_t v) {
        BUMP(counter_int32);
        return sample_idx_ ? Emit(sample_buffer_.Int(v)) : true;
    }
    bool Int64(int64_t v) {
        BUMP(counter_int64);
        return sample_idx_ ? Emit(sample_buffer_.Int64(v)) : true;
    }
    bool Uint(uint32_t v) {
        BUMP(counter_uint32);
        BUMP_IF(counter_uint32_max, v >= std::numeric_limits<int32_t>::max());
        return sample_idx_ ? Emit(sample_buffer_.Uint(v)) : true;
    }
    bool Uint64(uint64_t v) {
        BUMP(counter_uint64);
        BUMP_IF(counter_uint64_max, v >= std::numeric_limits<int64_t>::max());
        return sample_idx_ ? Emit(sample_buffer_.Uint64(v)) : true;
    }
    bool Double(double v) {
        BUMP(counter_double);
        return sample_idx_ ? Emit(sample_buffer_.Double(v)) : true;
    }
    bool StartObject() {
        BUMP(counter_object);
        field_stats_ = nullptr;
        if (current_depth_++ == sample_depth_) sample_idx_ = sample_counter_.Insert();
        if (sample_idx_) return sample_buffer_.StartObject();
        return true;
    }
    bool StartArray() {
        BUMP(counter_array);
        field_stats_ = nullptr;
        if (current_depth_++ == sample_depth_) sample_idx_ = sample_counter_.Insert();
        if (sample_idx_) return sample_buffer_.StartObject();
        return true;
    }
    bool EndObject(size_t count) {
        assert(current_depth_ > 0);
        assert(!sample_idx_.has_value() || current_depth_ > sample_depth_);
        --current_depth_;
        field_stats_ = nullptr;
        return sample_idx_ ? Emit(sample_buffer_.EndObject(count)) : true;
    }
    bool EndArray(size_t count) {
        assert(current_depth_ > 0);
        assert(!sample_idx_.has_value() || current_depth_ > sample_depth_);
        --current_depth_;
        field_stats_ = nullptr;
        return sample_idx_ ? Emit(sample_buffer_.EndArray(count)) : true;
    }

    /// Infer the array type
    arrow::Result<std::shared_ptr<arrow::DataType>> InferDataType() { return nullptr; }

#undef BUMP
#undef BUMP_IF
};

enum SAXEvent {
    NONE,
    KEY,
    NULL_,
    RAW_NUMBER,
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

struct SingleEventCache : public rapidjson::BaseReaderHandler<rapidjson::UTF8<>, JSONStructArrayAnalyzer> {
    SAXEvent event = SAXEvent::NONE;
    std::string txt_buffer = "";
    std::string_view key = "";

    bool SetEvent(SAXEvent e) {
        event = e;
        return true;
    }
    bool Key(const char* txt, size_t length, bool copy) {
        txt_buffer = std::string{txt, length};
        key = txt_buffer;
        return true;
    }
    bool Null() { return SetEvent(SAXEvent::NULL_); }
    bool RawNumber(const Ch* str, size_t len, bool copy) { return SetEvent(SAXEvent::RAW_NUMBER); }
    bool String(const char* txt, size_t length, bool copy) { return SetEvent(SAXEvent::STRING); }
    bool Bool(bool v) { return SetEvent(SAXEvent::BOOL); }
    bool Int(int32_t v) { return SetEvent(SAXEvent::INT32); }
    bool Int64(int64_t v) { return SetEvent(SAXEvent::INT64); }
    bool Uint(uint32_t v) { return SetEvent(SAXEvent::UINT32); }
    bool Uint64(uint64_t v) { return SetEvent(SAXEvent::UINT64); }
    bool Double(double v) { return SetEvent(SAXEvent::DOUBLE); }
    bool StartObject() { return SetEvent(SAXEvent::START_OBJECT); }
    bool StartArray() { return SetEvent(SAXEvent::START_ARRAY); }
    bool EndObject(size_t count) { return SetEvent(SAXEvent::END_OBJECT); }
    bool EndArray(size_t count) { return SetEvent(SAXEvent::END_ARRAY); }
};

}  // namespace

arrow::Result<std::pair<TableShape, std::shared_ptr<arrow::DataType>>> InferTableType(std::istream& raw_in) {
    rapidjson::IStreamWrapper in{raw_in};

    // Parse the SAX document
    rapidjson::Reader reader;
    reader.IterativeParseInit();

    // Peek into the document
    SingleEventCache cache;
    if (!reader.IterativeParseNext<rapidjson::kParseDefaultFlags>(in, cache)) {
        auto error = rapidjson::GetParseError_En(reader.GetParseErrorCode());
        return arrow::Status(arrow::StatusCode::ExecutionError, error);
    }

    // Assume row-major layout.
    // E.g. [{"a":1,"b":2}, {"a":3,"b":4}]
    if (cache.event == START_ARRAY) {
        JSONStructArrayAnalyzer analyzer;
        while (!reader.IterativeParseComplete()) {
            if (!reader.IterativeParseNext<rapidjson::kParseDefaultFlags>(in, analyzer)) {
                auto error = rapidjson::GetParseError_En(reader.GetParseErrorCode());
                return arrow::Status(arrow::StatusCode::ExecutionError, error);
            }
        }
        assert(analyzer.Done());
        ARROW_ASSIGN_OR_RAISE(auto type, analyzer.InferDataType());
        return std::make_pair(TableShape::ROW_ARRAY, std::move(type));
    }

    // Assume column-major layout.
    // E.g. {"a":[1,3],"b":[2,4]}
    if (cache.event == START_OBJECT) {
        auto next = [&]() { return reader.IterativeParseNext<rapidjson::kParseDefaultFlags>(in, cache); };
        std::vector<std::shared_ptr<arrow::Field>> fields;

        // Parse columns individually
        for (auto ok = next(); ok && cache.event == KEY; ok = next()) {
            auto column_name = cache.key;
            ok = next();
            if (!ok || cache.event != START_ARRAY) {
                // couldn't get array
            }
            JSONFlatArrayAnalyzer analyzer;
            while (!reader.IterativeParseComplete() && !analyzer.Done()) {
                if (!reader.IterativeParseNext<rapidjson::kParseDefaultFlags>(in, analyzer)) {
                    auto error = rapidjson::GetParseError_En(reader.GetParseErrorCode());
                    return arrow::Status(arrow::StatusCode::ExecutionError, error);
                }
            }
            assert(analyzer.Done());
            ARROW_ASSIGN_OR_RAISE(auto column_type, analyzer.InferDataType());
            fields.push_back(arrow::field(std::move(cache.txt_buffer), column_type));
        }
        return std::make_pair(TableShape::COLUMN_ARRAYS, arrow::struct_(std::move(fields)));
    }

    // Unknown structure
    return std::make_pair(TableShape::UNRECOGNIZED, nullptr);
}

}  // namespace json
}  // namespace web
}  // namespace duckdb
