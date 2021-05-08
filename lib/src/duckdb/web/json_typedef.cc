// The contents of this file were derived from the internal json tests of the arrow project.
// https://github.com/apache/arrow/blob/050f72c84f0ced88ad3a246162b76c4dbd8afcc4/cpp/src/arrow/testing/json_internal.cc
//
// Licensed to the Apache Software Foundation (ASF) under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  The ASF licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

#include "duckdb/web/json_typedef.h"

#include <arrow/util/string_view.h>

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
#include "rapidjson/istreamwrapper.h"
#include "rapidjson/rapidjson.h"
#include "rapidjson/writer.h"

using namespace arrow;

namespace duckdb {
namespace web {
namespace json {

using RjObject = rapidjson::Value::ConstObject;
using RjArray = rapidjson::Value::ConstArray;

Result<std::vector<std::shared_ptr<arrow::Field>>> ReadFields(const rapidjson::Value::ConstArray& fields);

namespace {

constexpr char kData[] = "DATA";
constexpr char kDays[] = "days";
constexpr char kDayTime[] = "DAY_TIME";
constexpr char kMilliseconds[] = "milliseconds";
constexpr char kYearMonth[] = "YEAR_MONTH";

/// Parse a time unit
Result<TimeUnit::type> GetUnitFromString(std::string_view unit_str) {
    if (unit_str == "SECOND") {
        return TimeUnit::SECOND;
    } else if (unit_str == "MILLISECOND") {
        return TimeUnit::MILLI;
    } else if (unit_str == "MICROSECOND") {
        return TimeUnit::MICRO;
    } else if (unit_str == "NANOSECOND") {
        return TimeUnit::NANO;
    } else {
        return Status::Invalid("Invalid time unit: ", unit_str);
    }
}

/// Read an integer member
template <typename IntType = int>
Result<IntType> GetMemberInt(const RjObject& obj, std::string_view key, int default_value = 0) {
    const auto& it = obj.FindMember(rapidjson::StringRef(key.data(), key.length()));
    if (it == obj.MemberEnd()) return default_value;
    if (!it->value.IsInt()) return Status::Invalid("member is not an integer: ", key);
    return static_cast<IntType>(it->value.GetInt64());
}

/// Read an boolean member
Result<bool> GetMemberBool(const RjObject& obj, std::string_view key, bool default_value = false) {
    const auto& it = obj.FindMember(rapidjson::StringRef(key.data(), key.length()));
    if (it == obj.MemberEnd()) return default_value;
    if (!it->value.IsBool()) return Status::Invalid("member is not a boolean: ", key);
    return it->value.GetBool();
}

/// Read an string member
Result<std::string_view> GetMemberString(const RjObject& obj, std::string_view key,
                                         std::string_view default_value = "") {
    const auto& it = obj.FindMember(rapidjson::StringRef(key.data(), key.length()));
    if (it == obj.MemberEnd()) return "";
    if (!it->value.IsString()) return Status::Invalid("member is not a string: ", key);
    return std::string_view{it->value.GetString(), it->value.GetStringLength()};
}

/// Read an array member
Result<const RjArray> GetMemberArray(const RjObject& obj, std::string_view key, bool allow_absent = false) {
    static const auto empty_array = rapidjson::Value(rapidjson::kArrayType);

    const auto& it = obj.FindMember(rapidjson::StringRef(key.data(), key.length()));
    if (allow_absent && it == obj.MemberEnd()) {
        return empty_array.GetArray();
    }
    if (!it->value.IsArray()) return Status::Invalid("member is not an array: ", key);
    return it->value.GetArray();
}

/// Read an object member
Result<const RjObject> GetMemberObject(const RjObject& obj, std::string_view key) {
    const auto& it = obj.FindMember(rapidjson::StringRef(key.data(), key.length()));
    if (!it->value.IsObject()) return Status::Invalid("member is not an object: ", key);
    return it->value.GetObject();
}

/// Read a timeunit member
Result<TimeUnit::type> GetMemberTimeUnit(const RjObject& obj, std::string_view key) {
    ARROW_ASSIGN_OR_RAISE(const auto unit_str, GetMemberString(obj, key));
    return GetUnitFromString(unit_str);
}

/// Read a map type
Result<std::shared_ptr<DataType>> ReadMapType(const RjObject& json_type,
                                              const std::vector<std::shared_ptr<Field>>& children) {
    if (children.size() != 1) {
        return Status::Invalid("Map must have exactly one child");
    }
    ARROW_ASSIGN_OR_RAISE(const bool keys_sorted, GetMemberBool(json_type, "keysSorted", false));
    return MapType::Make(children[0], keys_sorted);
}

/// Read a fixed size binary type
Result<std::shared_ptr<DataType>> ReadFixedSizeBinaryType(const RjObject& json_type) {
    ARROW_ASSIGN_OR_RAISE(const int32_t byte_width, GetMemberInt<int32_t>(json_type, "byteWidth", 100));
    return fixed_size_binary(byte_width);
}

/// Read a fixed size list type
Result<std::shared_ptr<DataType>> ReadFixedSizeListType(const RjObject& json_type,
                                                        const std::vector<std::shared_ptr<Field>>& children) {
    if (children.size() != 1) {
        return Status::Invalid("FixedSizeList must have exactly one child");
    }
    ARROW_ASSIGN_OR_RAISE(const int32_t list_size, GetMemberInt<int32_t>(json_type, "listSize"));
    return fixed_size_list(children[0], list_size);
}

/// Read a decimal 128 type
Result<std::shared_ptr<DataType>> ReadDecimal128Type(const RjObject& json_type) {
    ARROW_ASSIGN_OR_RAISE(const int32_t precision, GetMemberInt<int32_t>(json_type, "precision", 12));
    ARROW_ASSIGN_OR_RAISE(const int32_t scale, GetMemberInt<int32_t>(json_type, "scale", 2));
    return decimal128(precision, scale);
}

/// Read a decimal 256 type
Result<std::shared_ptr<DataType>> ReadDecimal256Type(const RjObject& json_type) {
    ARROW_ASSIGN_OR_RAISE(const int32_t precision, GetMemberInt<int32_t>(json_type, "precision", 12));
    ARROW_ASSIGN_OR_RAISE(const int32_t scale, GetMemberInt<int32_t>(json_type, "scale", 2));
    return decimal256(precision, scale);
}

/// Read a timestamp type
Result<std::shared_ptr<DataType>> ReadTimestampType(const RjObject& json_type) {
    ARROW_ASSIGN_OR_RAISE(const TimeUnit::type unit, GetMemberTimeUnit(json_type, "unit"));
    const auto& it_tz = json_type.FindMember("timezone");
    if (it_tz == json_type.MemberEnd()) {
        return timestamp(unit);
    } else {
        if (!it_tz->value.IsString()) return Status::Invalid("timezone is not a string");
        return timestamp(unit, it_tz->value.GetString());
    }
}

/// Read a union type
Result<std::shared_ptr<DataType>> ReadUnionType(const RjObject& json_type,
                                                const std::vector<std::shared_ptr<Field>>& children) {
    ARROW_ASSIGN_OR_RAISE(const auto mode_str, GetMemberString(json_type, "mode"));

    UnionMode::type mode;
    if (mode_str == "SPARSE") {
        mode = UnionMode::SPARSE;
    } else if (mode_str == "DENSE") {
        mode = UnionMode::DENSE;
    } else {
        return Status::Invalid("Invalid union mode: ", mode_str);
    }

    ARROW_ASSIGN_OR_RAISE(const auto json_type_codes, GetMemberArray(json_type, "typeIds"));

    std::vector<int8_t> type_codes;
    type_codes.reserve(json_type_codes.Size());
    for (const rapidjson::Value& val : json_type_codes) {
        if (!val.IsInt()) {
            return Status::Invalid("Union type codes must be integers");
        }
        type_codes.push_back(static_cast<int8_t>(val.GetInt()));
    }

    if (mode == UnionMode::SPARSE) {
        return sparse_union(std::move(children), std::move(type_codes));
    } else {
        return dense_union(std::move(children), std::move(type_codes));
    }
}

using TypeResolver = std::function<arrow::Result<std::shared_ptr<arrow::DataType>>(const RjObject&)>;
static std::unordered_map<std::string_view, TypeResolver> ARROW_TYPE_MAPPING{
    {"binary", [](auto&) { return arrow::binary(); }},
    {"bool", [](auto&) { return arrow::boolean(); }},
    {"boolean", [](auto&) { return arrow::boolean(); }},
    {"date", [](auto&) { return arrow::date64(); }},
    {"date32", [](auto&) { return arrow::date32(); }},
    {"date64", [](auto&) { return arrow::date64(); }},
    {"date[d]", [](auto&) { return arrow::date32(); }},
    {"date[ms]", [](auto&) { return arrow::date64(); }},
    {"decimal128", &ReadDecimal128Type},
    {"decimal256", &ReadDecimal256Type},
    {"double", [](auto&) { return arrow::float64(); }},
    {"duration", [](auto&) { return arrow::duration(TimeUnit::MILLI); }},
    {"duration[ms]", [](auto&) { return arrow::duration(TimeUnit::MILLI); }},
    {"duration[ns]", [](auto&) { return arrow::duration(TimeUnit::NANO); }},
    {"duration[s]", [](auto&) { return arrow::duration(TimeUnit::SECOND); }},
    {"duration[us]", [](auto&) { return arrow::duration(TimeUnit::MICRO); }},
    {"fixedsizebinary", &ReadFixedSizeBinaryType},
    {"float", [](auto&) { return arrow::float32(); }},
    {"float16", [](auto&) { return arrow::float16(); }},
    {"float32", [](auto&) { return arrow::float32(); }},
    {"float64", [](auto&) { return arrow::float64(); }},
    {"int16", [](auto&) { return arrow::int16(); }},
    {"int32", [](auto&) { return arrow::int32(); }},
    {"int64", [](auto&) { return arrow::int64(); }},
    {"int8", [](auto&) { return arrow::int8(); }},
    //    {"fixedsizelist", arrow::Type::FIXED_SIZE_LIST},
    //    {"interval[dt]", arrow::Type::INTERVAL_DAY_TIME},
    //    {"interval[m]", arrow::Type::INTERVAL_MONTHS},
    //    {"largebinary", arrow::Type::LARGE_BINARY},
    //    {"largelist", arrow::Type::LARGE_LIST},
    //    {"largeutf8", arrow::Type::LARGE_STRING},
    //    {"list", arrow::Type::LIST},
    //    {"map", arrow::Type::MAP},
    //    {"null", arrow::Type::NA},
    //    {"string", arrow::Type::STRING},
    //    {"struct", arrow::Type::STRUCT},
    //    {"time", arrow::Type::TIME64},
    //    {"time[s]", arrow::Type::TIME32},
    //    {"time[ms]", arrow::Type::TIME32},
    //    {"time[us]", arrow::Type::TIME64},
    //    {"time[ns]", arrow::Type::TIME64},
    //    {"timestamp", &ReadTimestampType},
    //    {"uint16", [](auto&) { return arrow::uint16(); }},
    //    {"uint32", [](auto&) { return arrow::uint32(); }},
    //    {"uint64", [](auto&) { return arrow::uint64(); }},
    //    {"uint8", [](auto&) { return arrow::uint8(); }},
    //    {"union", arrow::Type::DENSE_UNION},
    //    {"utf8", [](auto&) { return arrow::utf8(); }},
};

/// Read a type
Result<std::shared_ptr<arrow::DataType>> ReadType(const rapidjson::Value& value,
                                                  const std::vector<std::shared_ptr<Field>>& children) {
    if (value.IsString()) {
        auto iter = ARROW_TYPE_MAPPING.find(value.GetString());
        if (iter == ARROW_TYPE_MAPPING.end()) return Status::Invalid("Unrecognized type name: ", value.GetString());
    }
    return arrow::null();
}

}  // namespace

/// Read a field
arrow::Result<std::shared_ptr<Field>> ReadField(const rapidjson::Value& field) {
    if (!field.IsObject()) {
        return Status::Invalid("Field was not a JSON object");
    }
    const auto& json_field = field.GetObject();

    ARROW_ASSIGN_OR_RAISE(const auto name, GetMemberString(json_field, "name", ""));
    if (name == "") return Status::Invalid("invalid field name");
    ARROW_ASSIGN_OR_RAISE(const bool nullable, GetMemberBool(json_field, "nullable", true));

    ARROW_ASSIGN_OR_RAISE(const auto json_type, GetMemberString(json_field, "type", ""));
    auto iter = ARROW_TYPE_MAPPING.find(json_type);
    if (iter == ARROW_TYPE_MAPPING.end()) return Status::Invalid("Unrecognized type name: ", json_type);
    ARROW_ASSIGN_OR_RAISE(const auto type, iter->second(json_field));

    return arrow::field(std::string{name}, type, nullable);
}

/// Read fields from an array
Result<std::vector<std::shared_ptr<arrow::Field>>> ReadFields(const rapidjson::Value::ConstArray& fields) {
    std::vector<std::shared_ptr<arrow::Field>> out;
    out.resize(fields.Size());
    for (rapidjson::SizeType i = 0; i < fields.Size(); ++i) {
        ARROW_ASSIGN_OR_RAISE(out[i], ReadField(fields[i]));
    }
    return std::move(out);
}

}  // namespace json
}  // namespace web
}  // namespace duckdb
