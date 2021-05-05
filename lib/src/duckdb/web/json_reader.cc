// Copyright (c) 2020 The DashQL Authors

#include "duckdb/web/json_reader.h"

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

/// Infer an arrow schema for a json object
std::shared_ptr<arrow::Schema> InferArrowSchema(rapidjson::Value& value) { return nullptr; }

/// Parse an array
arrow::Result<std::shared_ptr<ArrayParser>> InferArrayParser(const rapidjson::Document::Array& json_array,
                                                             const JSONDocumentStats& stats) {
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

    // Sample array
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

}  // namespace json

}  // namespace web
}  // namespace duckdb
