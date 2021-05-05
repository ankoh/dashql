// Copyright (c) 2020 The DashQL Authors

#include "duckdb/web/json_reader.h"

#include <rapidjson/rapidjson.h>

#include <algorithm>
#include <iostream>
#include <memory>
#include <optional>
#include <unordered_map>
#include <unordered_set>
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

namespace {

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
        case rapidjson::Type::kNumberType:
            return arrow::float64();

        case rapidjson::Type::kObjectType:
            break;

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

struct ScalarTypeAnalyzer {
    // Collect scalar type candidates
    struct ScalarCandidate {
        std::shared_ptr<arrow::DataType> type;
        size_t hits;
    };

    // The candidates
    std::vector<ScalarCandidate> scalar_candidates = {};

    /// Constructor
    ScalarTypeAnalyzer(const JSONDocumentStats& stats) {
#define CANDIDATE(TYPE, CONDITION)                              \
    if (CONDITION) {                                            \
        scalar_candidates.push_back({.type = TYPE, .hits = 0}); \
    }
        auto any_string = stats.counter_string > 0;
        auto no_i64 = stats.counter_int64 == 0 && stats.counter_uint64 == 0;
        auto any_i64 = stats.counter_int64 > 0 || stats.counter_uint64 > 0;
        auto test_i32 = no_i64 && (stats.counter_int32 > 0 || stats.counter_uint32 > 0);
        auto test_u32 = no_i64 && stats.counter_uint32_max > 0;
        auto test_i64 = any_i64 || stats.counter_uint32_max > 0;
        auto test_u64 = stats.counter_uint64_max > 0;

        CANDIDATE(arrow::boolean(), stats.counter_bool > 0);
        CANDIDATE(arrow::float64(), stats.counter_double > 0);
        CANDIDATE(arrow::utf8(), any_string);
        CANDIDATE(arrow::int32(), test_i32 || any_string);
        CANDIDATE(arrow::int64(), test_i64 || any_string);
        CANDIDATE(arrow::uint32(), test_u32 || any_string);
        CANDIDATE(arrow::uint64(), test_u64 || any_string);
#undef CANDIDATE
    }

    /// Analyze a value
    inline void Analyze(const rapidjson::Value& value) {
        for (auto& candidate : scalar_candidates) {
            candidate.hits += TestScalarType(value, *candidate.type);
        }
    }

    /// Build the array parser
    arrow::Result<std::shared_ptr<ArrayParser>> Finish() { return nullptr; }
};

}  // namespace

/// Infer a row parser
arrow::Result<std::shared_ptr<ArrayParser>> InferStructArrayParser(const std::vector<const rapidjson::Value*>& sample) {
    std::vector<std::pair<std::string_view, std::shared_ptr<ArrayParser>>> fields;

    // Collect statistics on the sample
    std::unordered_map<std::string_view, JSONDocumentStats> stats_map;
    for (auto& row : sample) {
        if (row->IsNull() || !row->IsObject()) continue;
        for (auto iter = row->MemberBegin(); iter != row->MemberEnd(); ++iter) {
            std::string_view name{iter->name.GetString(), iter->name.GetStringLength()};
            auto& stats = stats_map[name];
            switch (row->GetType()) {
                case rapidjson::Type::kNumberType: {
                    stats.counter_double += row->IsDouble();
                    stats.counter_uint64 += row->IsUint64();
                    stats.counter_uint64_max +=
                        (row->IsUint64() && row->GetUint64() > std::numeric_limits<int64_t>::max());
                    stats.counter_uint32 += row->IsUint();
                    stats.counter_uint32_max += (row->IsUint() && row->GetUint() > std::numeric_limits<int32_t>::max());
                    stats.counter_int64 += row->IsInt64();
                    stats.counter_int32 += row->IsInt();
                    break;
                }
                case rapidjson::Type::kStringType:
                    stats.counter_string += row->IsString();
                    break;
                case rapidjson::Type::kFalseType:
                case rapidjson::Type::kTrueType:
                    stats.counter_bool += row->IsBool();
                    break;
                case rapidjson::Type::kNullType:
                    break;
                case rapidjson::Type::kArrayType:
                    stats.counter_array += row->IsBool();
                    break;
                case rapidjson::Type::kObjectType:
                    stats.counter_object += row->IsBool();
                    break;
            }
        }
    }

    // Create analyzer helpers
    std::unordered_map<std::string_view, ScalarTypeAnalyzer> scalars;
    std::unordered_map<std::string_view, std::vector<const rapidjson::Value*>> objects;
    std::unordered_map<std::string_view, std::vector<const rapidjson::Value*>> arrays;
    scalars.reserve(stats_map.size());
    for (auto& [name, stats] : stats_map) {
        // Nested struct field?
        if (stats.counter_object > 0) {
            objects.insert({name, std::vector<const rapidjson::Value*>{}});
            continue;
        }
        // Nested list type?
        if (stats.counter_array > 0) {
            arrays.insert({name, std::vector<const rapidjson::Value*>{}});
            continue;
        }
        // Otherwise create scalar analyzers
        scalars.insert({name, ScalarTypeAnalyzer{stats}});
    }

    // Analyze the sample
    for (auto& row : sample) {
        if (row->IsNull() || !row->IsObject()) continue;
        for (auto iter = row->MemberBegin(); iter != row->MemberEnd(); ++iter) {
            std::string_view name{iter->name.GetString(), iter->name.GetStringLength()};
            if (auto s = scalars.find(name); s != scalars.end()) {
                s->second.Analyze(iter->value);
            } else if (auto o = objects.find(name); o != objects.end()) {
                o->second.push_back(&iter->value);
            } else if (auto a = arrays.find(name); a != objects.end()) {
                a->second.push_back(&iter->value);
            }
        }
    }

    // Collect scalar parsers
    for (auto& [name, analyzer] : scalars) {
        if (auto parser = analyzer.Finish(); parser.ok()) {
            fields.push_back({name, std::move(parser.ValueUnsafe())});
        }
    }
    // Collect struct objects fields
    for (auto& [name, values] : objects) {
        if (auto parser = InferStructArrayParser(sample); parser.ok()) {
            fields.push_back({name, std::move(parser.ValueUnsafe())});
        }
    }
    // Collect array fields
    for (auto& [name, values] : arrays) {
        auto step = values.size() / 20;
        std::shared_ptr<arrow::DataType> type = nullptr;
        for (int i = 0; i < values.size(); ++i) {
            if (values[i]->IsNull()) continue;
            auto type = InferDataType(*values[i]);
            auto parser = ResolveArrayParser(arrow::list(std::move(type)));
            if (!parser.ok()) continue;
            return std::move(parser.ValueUnsafe());
        }
    }
    return nullptr;
}

/// Infer a column parser
arrow::Result<std::shared_ptr<ArrayParser>> InferArrayParser(const std::vector<const rapidjson::Value*>& sample) {
    // Collect stats
    JSONDocumentStats stats;
    for (auto& row : sample) {
        switch (row->GetType()) {
            case rapidjson::Type::kNumberType: {
                stats.counter_double += row->IsDouble();
                stats.counter_uint64 += row->IsUint64();
                stats.counter_uint64_max += (row->IsUint64() && row->GetUint64() > std::numeric_limits<int64_t>::max());
                stats.counter_uint32 += row->IsUint();
                stats.counter_uint32_max += (row->IsUint() && row->GetUint() > std::numeric_limits<int32_t>::max());
                stats.counter_int64 += row->IsInt64();
                stats.counter_int32 += row->IsInt();
                break;
            }
            case rapidjson::Type::kStringType:
                stats.counter_string += row->IsString();
                break;
            case rapidjson::Type::kFalseType:
            case rapidjson::Type::kTrueType:
                stats.counter_bool += row->IsBool();
                break;
            case rapidjson::Type::kNullType:
                break;
            case rapidjson::Type::kArrayType:
                stats.counter_array += row->IsBool();
                break;
            case rapidjson::Type::kObjectType:
                stats.counter_object += row->IsBool();
                break;
        }
    }

    // Parse as struct array?
    if (stats.counter_object > 0) return InferStructArrayParser(sample);
    // Nested lists?
    if (stats.counter_array > 0) {
        std::shared_ptr<arrow::DataType> type = nullptr;
        for (auto& row : sample) {
            if (row->IsNull()) continue;
            auto type = InferDataType(*row);
            auto parser = ResolveArrayParser(arrow::list(std::move(type)));
            if (!parser.ok()) continue;
            return std::move(parser.ValueUnsafe());
        }
    }

    // Analyze all values
    ScalarTypeAnalyzer analyzer{stats};
    for (auto* row : sample) {
        analyzer.Analyze(*row);
    }
    return analyzer.Finish();
}

}  // namespace json
}  // namespace web
}  // namespace duckdb
