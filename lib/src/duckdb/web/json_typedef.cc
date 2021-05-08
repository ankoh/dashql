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

Result<std::vector<std::shared_ptr<arrow::Field>>> ReadFields(const RjArray& json_fields);

namespace {

constexpr char kData[] = "DATA";
constexpr char kDays[] = "days";
constexpr char kDayTime[] = "DAY_TIME";
constexpr char kDuration[] = "duration";
constexpr char kMilliseconds[] = "milliseconds";
constexpr char kYearMonth[] = "YEAR_MONTH";

/// Parse a time unit
Result<TimeUnit::type> GetUnitFromString(const std::string& unit_str) {
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
template <typename IntType = int> Result<IntType> GetMemberInt(const RjObject& obj, const std::string& key) {
    const auto& it = obj.FindMember(key);
    if (!it->value.IsInt()) return Status::Invalid("member is not an integer");
    return static_cast<IntType>(it->value.GetInt64());
}

/// Read an boolean member
Result<bool> GetMemberBool(const RjObject& obj, const std::string& key) {
    const auto& it = obj.FindMember(key);
    if (!it->value.IsBool()) return Status::Invalid("member is not a boolean");
    return it->value.GetBool();
}

/// Read an string member
Result<std::string> GetMemberString(const RjObject& obj, const std::string& key) {
    const auto& it = obj.FindMember(key);
    if (!it->value.IsString()) return Status::Invalid("member is not a string");
    return it->value.GetString();
}

/// Read an object member
Result<const RjObject> GetMemberObject(const RjObject& obj, const std::string& key) {
    const auto& it = obj.FindMember(key);
    if (!it->value.IsObject()) return Status::Invalid("member is not an object");
    return it->value.GetObject();
}

/// Read an array member
Result<const RjArray> GetMemberArray(const RjObject& obj, const std::string& key, bool allow_absent = false) {
    static const auto empty_array = rapidjson::Value(rapidjson::kArrayType);

    const auto& it = obj.FindMember(key);
    if (allow_absent && it == obj.MemberEnd()) {
        return empty_array.GetArray();
    }
    if (!it->value.IsArray()) return Status::Invalid("member is not an array");
    return it->value.GetArray();
}

/// Read a timeunit member
Result<TimeUnit::type> GetMemberTimeUnit(const RjObject& obj, const std::string& key) {
    ARROW_ASSIGN_OR_RAISE(const auto unit_str, GetMemberString(obj, key));
    return GetUnitFromString(unit_str);
}

/// Read an integer type
Result<std::shared_ptr<DataType>> ReadIntegerType(const rapidjson::Value::ConstObject& json_type) {
    ARROW_ASSIGN_OR_RAISE(const bool is_signed, GetMemberBool(json_type, "isSigned"));
    ARROW_ASSIGN_OR_RAISE(const int bit_width, GetMemberInt<int>(json_type, "bitWidth"));
    switch (bit_width) {
        case 8:
            return is_signed ? int8() : uint8();
        case 16:
            return is_signed ? int16() : uint16();
        case 32:
            return is_signed ? int32() : uint32();
        case 64:
            return is_signed ? int64() : uint64();
        default:
            return Status::Invalid("Invalid bit width: ", bit_width);
    }
}

/// Read a floating point type
Result<std::shared_ptr<DataType>> ReadFloatingPointType(const RjObject& json_type) {
    ARROW_ASSIGN_OR_RAISE(const auto precision, GetMemberString(json_type, "precision"));
    if (precision == "DOUBLE") {
        return float64();
    } else if (precision == "SINGLE") {
        return float32();
    } else if (precision == "HALF") {
        return float16();
    }
    return Status::Invalid("Invalid precision: ", precision);
}

/// Read a map type
Result<std::shared_ptr<DataType>> ReadMapType(const RjObject& json_type,
                                              const std::vector<std::shared_ptr<Field>>& children) {
    if (children.size() != 1) {
        return Status::Invalid("Map must have exactly one child");
    }
    ARROW_ASSIGN_OR_RAISE(const bool keys_sorted, GetMemberBool(json_type, "keysSorted"));
    return MapType::Make(children[0], keys_sorted);
}

/// Read a fixed size binary type
Result<std::shared_ptr<DataType>> ReadFixedSizeBinaryType(const RjObject& json_type) {
    ARROW_ASSIGN_OR_RAISE(const int32_t byte_width, GetMemberInt<int32_t>(json_type, "byteWidth"));
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

/// Read a decimal type
Result<std::shared_ptr<DataType>> ReadDecimalType(const RjObject& json_type) {
    ARROW_ASSIGN_OR_RAISE(const int32_t precision, GetMemberInt<int32_t>(json_type, "precision"));
    ARROW_ASSIGN_OR_RAISE(const int32_t scale, GetMemberInt<int32_t>(json_type, "scale"));
    int32_t bit_width = 128;
    Result<int32_t> maybe_bit_width = GetMemberInt<int32_t>(json_type, "bitWidth");
    if (maybe_bit_width.ok()) {
        bit_width = maybe_bit_width.ValueOrDie();
    }
    if (bit_width == 128) {
        return decimal128(precision, scale);
    } else if (bit_width == 256) {
        return decimal256(precision, scale);
    }
    return Status::Invalid("Only 128 bit and 256 Decimals are supported. Received", bit_width);
}

/// Read a date type
Result<std::shared_ptr<DataType>> GetDateType(const RjObject& json_type) {
    ARROW_ASSIGN_OR_RAISE(const auto unit_str, GetMemberString(json_type, "unit"));
    if (unit_str == "DAY") {
        return date32();
    } else if (unit_str == "MILLISECOND") {
        return date64();
    }
    return Status::Invalid("Invalid date unit: ", unit_str);
}

/// Read a time type
Result<std::shared_ptr<DataType>> ReadTimeType(const RjObject& json_type) {
    ARROW_ASSIGN_OR_RAISE(const auto unit_str, GetMemberString(json_type, "unit"));
    ARROW_ASSIGN_OR_RAISE(const int bit_width, GetMemberInt<int>(json_type, "bitWidth"));
    std::shared_ptr<DataType> type;
    if (unit_str == "SECOND") {
        type = time32(TimeUnit::SECOND);
    } else if (unit_str == "MILLISECOND") {
        type = time32(TimeUnit::MILLI);
    } else if (unit_str == "MICROSECOND") {
        type = time64(TimeUnit::MICRO);
    } else if (unit_str == "NANOSECOND") {
        type = time64(TimeUnit::NANO);
    } else {
        return Status::Invalid("Invalid time unit: ", unit_str);
    }
    const auto& fw_type = reinterpret_cast<const FixedWidthType&>(*type);
    if (bit_width != fw_type.bit_width()) {
        return Status::Invalid("Indicated bit width does not match unit");
    }
    return type;
}

/// Read a duration type
Result<std::shared_ptr<DataType>> ReadDurationType(const RjObject& json_type) {
    ARROW_ASSIGN_OR_RAISE(const TimeUnit::type unit, GetMemberTimeUnit(json_type, "unit"));
    return duration(unit);
}

/// Read a timestamp type
Result<std::shared_ptr<DataType>> ReadTimeTypestamp(const RjObject& json_type) {
    ARROW_ASSIGN_OR_RAISE(const TimeUnit::type unit, GetMemberTimeUnit(json_type, "unit"));
    const auto& it_tz = json_type.FindMember("timezone");
    if (it_tz == json_type.MemberEnd()) {
        return timestamp(unit);
    } else {
        if (!it_tz->value.IsString()) return Status::Invalid("timezone is not a string");
        return timestamp(unit, it_tz->value.GetString());
    }
}

/// Read an interval type
Result<std::shared_ptr<DataType>> ReadIntervalType(const RjObject& json_type) {
    ARROW_ASSIGN_OR_RAISE(const auto unit_str, GetMemberString(json_type, "unit"));
    if (unit_str == kDayTime) {
        return day_time_interval();
    } else if (unit_str == kYearMonth) {
        return month_interval();
    }
    return Status::Invalid("Invalid interval unit: " + unit_str);
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

/// Read a type
Result<std::shared_ptr<arrow::DataType>> ReadType(const RjObject& json_type,
                                                  const std::vector<std::shared_ptr<Field>>& children) {
    ARROW_ASSIGN_OR_RAISE(const auto type_name, GetMemberString(json_type, "name"));

    if (type_name == "int") {
        return ReadIntegerType(json_type);
    } else if (type_name == "floatingpoint") {
        return ReadFloatingPointType(json_type);
    } else if (type_name == "bool") {
        return boolean();
    } else if (type_name == "utf8") {
        return utf8();
    } else if (type_name == "binary") {
        return binary();
    } else if (type_name == "largeutf8") {
        return large_utf8();
    } else if (type_name == "largebinary") {
        return large_binary();
    } else if (type_name == "fixedsizebinary") {
        return ReadFixedSizeBinaryType(json_type);
    } else if (type_name == "decimal") {
        return ReadDecimalType(json_type);
    } else if (type_name == "null") {
        return null();
    } else if (type_name == "date") {
        return GetDateType(json_type);
    } else if (type_name == "time") {
        return ReadTimeType(json_type);
    } else if (type_name == "timestamp") {
        return ReadTimeTypestamp(json_type);
    } else if (type_name == "interval") {
        return ReadIntervalType(json_type);
    } else if (type_name == kDuration) {
        return ReadDurationType(json_type);
    } else if (type_name == "list") {
        if (children.size() != 1) {
            return Status::Invalid("List must have exactly one child");
        }
        return list(children[0]);
    } else if (type_name == "largelist") {
        if (children.size() != 1) {
            return Status::Invalid("Large list must have exactly one child");
        }
        return large_list(children[0]);
    } else if (type_name == "map") {
        return ReadMapType(json_type, children);
    } else if (type_name == "fixedsizelist") {
        return ReadFixedSizeListType(json_type, children);
    } else if (type_name == "struct") {
        return struct_(children);
    } else if (type_name == "union") {
        return ReadUnionType(json_type, children);
    } else {
        return Status::Invalid("Unrecognized type name: ", type_name);
    }
    return Status::OK();
}

/// Read a field
arrow::Result<std::shared_ptr<Field>> ReadField(const rapidjson::Value& obj) {
    if (!obj.IsObject()) {
        return Status::Invalid("Field was not a JSON object");
    }
    const auto& json_field = obj.GetObject();

    ARROW_ASSIGN_OR_RAISE(const auto name, GetMemberString(json_field, "name"));
    ARROW_ASSIGN_OR_RAISE(const bool nullable, GetMemberBool(json_field, "nullable"));

    ARROW_ASSIGN_OR_RAISE(const auto json_type, GetMemberObject(json_field, "type"));
    ARROW_ASSIGN_OR_RAISE(const auto json_children, GetMemberArray(json_field, "children"));

    ARROW_ASSIGN_OR_RAISE(auto children, ReadFields(json_children));
    ARROW_ASSIGN_OR_RAISE(auto type, ReadType(json_type, children));

    // Create field
    return arrow::field(name, type, nullable);
}

}  // namespace

/// Read fields from an array
Result<std::vector<std::shared_ptr<arrow::Field>>> ReadFields(const RjArray& json_fields) {
    std::vector<std::shared_ptr<arrow::Field>> fields;
    fields.resize(json_fields.Size());
    for (rapidjson::SizeType i = 0; i < json_fields.Size(); ++i) {
        ARROW_ASSIGN_OR_RAISE(fields[i], ReadField(json_fields[i]));
    }
    return std::move(fields);
}

}  // namespace json
}  // namespace web
}  // namespace duckdb
