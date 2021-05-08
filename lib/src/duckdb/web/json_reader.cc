// Copyright (c) 2020 The DashQL Authors

#include "duckdb/web/json_reader.h"

#include <memory>
#include <sstream>
#include <string>

#include "arrow/type.h"
#include "arrow/type_fwd.h"
#include "duckdb/web/json_typedef.h"
#include "rapidjson/document.h"

namespace duckdb {
namespace web {
namespace json {

namespace {

std::string_view GetTypeName(rapidjson::Type type) {
    switch (type) {
        case rapidjson::Type::kArrayType:
            return "array";
        case rapidjson::Type::kTrueType:;
        case rapidjson::Type::kFalseType:
            return "boolean";
        case rapidjson::Type::kNumberType:
            return "number";
        case rapidjson::Type::kObjectType:
            return "object";
        case rapidjson::Type::kNullType:
            return "null";
        case rapidjson::Type::kStringType:
            return "string";
    }
    return "?";
}

arrow::Status RequireType(const rapidjson::Value& value, rapidjson::Type type, std::string_view field) {
    if (value.GetType() != type) {
        std::stringstream msg;
        msg << "type mismatch for field '" << field << "': expected " << GetTypeName(type) << ", received "
            << GetTypeName(value.GetType());
        return arrow::Status(arrow::StatusCode::Invalid, msg.str());
    }
    return arrow::Status::OK();
};

enum FieldTag {
    FORMAT,
};

static std::unordered_map<std::string_view, FieldTag> FIELD_TAGS{{"format", FieldTag::FORMAT}};

static std::unordered_map<std::string_view, TableShape> FORMATS{
    {"row-array", TableShape::ROW_ARRAY},
    {"column-object", TableShape::COLUMN_OBJECT},
};

}  // namespace

/// Read from document
arrow::Status JSONReaderOptions::ReadFrom(const rapidjson::Document& doc) {
    if (!doc.IsObject()) return arrow::Status::OK();
    for (auto iter = doc.MemberBegin(); iter != doc.MemberEnd(); ++iter) {
        std::string_view name{iter->name.GetString(), iter->name.GetStringLength()};

        auto tag_iter = FIELD_TAGS.find(name);
        if (tag_iter == FIELD_TAGS.end()) continue;

        switch (tag_iter->second) {
            case FieldTag::FORMAT: {
                ARROW_RETURN_NOT_OK(RequireType(iter->value, rapidjson::Type::kStringType, "format"));
                auto format_iter =
                    FORMATS.find(std::string_view{iter->value.GetString(), iter->value.GetStringLength()});
                if (format_iter == FORMATS.end()) {
                    return arrow::Status(arrow::StatusCode::Invalid, "unknown table format");
                }
                table_shape = format_iter->second;
                continue;
            }
        }
    }
    return arrow::Status::OK();
}

}  // namespace json
}  // namespace web
}  // namespace duckdb
