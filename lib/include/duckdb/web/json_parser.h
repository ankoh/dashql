// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEB_JSON_PARSER_H_
#define INCLUDE_DUCKDB_WEB_JSON_PARSER_H_

#include <memory>

#include "arrow/array/builder_nested.h"
#include "arrow/type.h"
#include "arrow/type_traits.h"
#include "rapidjson/document.h"

namespace duckdb {
namespace web {
namespace json {

/// A type analyzer
class TypeAnalyzer {
   protected:
    /// The exact data type
    std::shared_ptr<arrow::DataType> type_;

    /// Constructor
    TypeAnalyzer(std::shared_ptr<arrow::DataType> type);

   public:
    /// Check if a value is of the type
    virtual bool TestValue(const rapidjson::Value& json_value) = 0;
    /// Check if multiple values are of the type
    virtual size_t TestValues(const std::vector<rapidjson::Value>& json_values) = 0;

    /// Resolve a type analyzer
    static std::unique_ptr<TypeAnalyzer> ResolveScalar(std::shared_ptr<arrow::DataType> type);
};

/// An array reader
class ArrayParser {
   protected:
    /// The data type
    std::shared_ptr<arrow::DataType> type_;

   public:
    virtual ~ArrayParser() = default;
    /// Get the array builder
    virtual std::shared_ptr<arrow::ArrayBuilder> builder() = 0;
    /// Initialize the converter
    virtual arrow::Status Init() { return arrow::Status::OK(); }
    /// Append a value
    virtual arrow::Status AppendValue(const rapidjson::Value& json_obj) = 0;
    /// Append multiple values
    virtual arrow::Status AppendValues(const rapidjson::Value& json_array) = 0;
    /// Append a null value
    arrow::Status AppendNull() { return builder()->AppendNull(); }
    /// Finish the conversion
    virtual arrow::Status Finish(std::shared_ptr<arrow::Array>* out) {
        auto builder = this->builder();
        if (builder->length() == 0) {
            // Make sure the builder was initialized
            RETURN_NOT_OK(builder->Resize(1));
        }
        return builder->Finish(out);
    }

    /// Resolve an array parser
    static arrow::Result<std::shared_ptr<ArrayParser>> Resolve(const std::shared_ptr<arrow::DataType>& type);
};

// using ParseValue = ()

}  // namespace json
}  // namespace web
}  // namespace duckdb

#endif
