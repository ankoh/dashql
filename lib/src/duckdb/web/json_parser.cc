// The contents of this file were derived from the json reader of the arrow project.
// https://github.com/apache/arrow/blob/b3e43987c47b2f01b204a2d954f882f7161616ef/cpp/src/arrow/ipc/json_simple.cc
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

#include "duckdb/web/json_parser.h"

#include <arrow/type_fwd.h>

#include <algorithm>
#include <iostream>
#include <memory>
#include <optional>
#include <unordered_map>
#include <variant>
#include <vector>

#include "arrow/array/array_dict.h"
#include "arrow/array/builder_binary.h"
#include "arrow/array/builder_decimal.h"
#include "arrow/array/builder_dict.h"
#include "arrow/array/builder_nested.h"
#include "arrow/array/builder_primitive.h"
#include "arrow/array/builder_time.h"
#include "arrow/array/builder_union.h"
#include "arrow/type.h"
#include "arrow/type_traits.h"
#include "arrow/util/value_parsing.h"
#include "rapidjson/document.h"
#include "rapidjson/writer.h"

namespace duckdb {
namespace web {
namespace json {

arrow::Status JSONTypeError(const char* expected_type, rapidjson::Type json_type) {
    return arrow::Status::Invalid("Expected ", expected_type, " or null, got JSON type ", json_type);
}

/// Get an array parser
arrow::Status ResolveArrayParser(const std::shared_ptr<arrow::DataType>&, std::shared_ptr<ArrayParser>* out);

/// CRTP base class
template <class Derived> class BaseArrayParser : public ArrayParser {
   public:
    /// Get the value type
    const std::shared_ptr<arrow::DataType>& value_type() {
        if (type_->id() != arrow::Type::DICTIONARY) return type_;
        return arrow::internal::checked_cast<const arrow::DictionaryType&>(*type_).value_type();
    }
    /// Builder factory
    template <typename BuilderType> arrow::Status MakeConcreteBuilder(std::shared_ptr<BuilderType>* out) {
        std::unique_ptr<arrow::ArrayBuilder> builder;
        RETURN_NOT_OK(MakeBuilder(arrow::default_memory_pool(), this->type_, &builder));
        *out = arrow::internal::checked_pointer_cast<BuilderType>(std::move(builder));
        return arrow::Status::OK();
    }
    /// Append values
    arrow::Status AppendValues(const rapidjson::Value& json_array) override {
        auto self = static_cast<Derived*>(this);
        if (!json_array.IsArray()) {
            return JSONTypeError("array", json_array.GetType());
        }
        auto size = json_array.Size();
        for (uint32_t i = 0; i < size; ++i) {
            RETURN_NOT_OK(self->AppendValue(json_array[i]));
        }
        return arrow::Status::OK();
    }
};

/// Reader for null arrays
class NullArrayParser final : public BaseArrayParser<NullArrayParser> {
   protected:
    /// The builder
    std::shared_ptr<arrow::NullBuilder> builder_;

   public:
    /// Constructor
    explicit NullArrayParser(const std::shared_ptr<arrow::DataType>& type) {
        type_ = type;
        builder_ = std::make_shared<arrow::NullBuilder>();
    }
    /// Access the builder
    std::shared_ptr<arrow::ArrayBuilder> builder() override { return builder_; }
    /// Append a value
    arrow::Status AppendValue(const rapidjson::Value& json_obj) override {
        if (json_obj.IsNull()) return AppendNull();
        return JSONTypeError("null", json_obj.GetType());
    }
};

/// Reader for boolean arrays
class BooleanArrayParser final : public BaseArrayParser<BooleanArrayParser> {
   protected:
    /// The builder
    std::shared_ptr<arrow::BooleanBuilder> builder_;

   public:
    /// Constructor
    explicit BooleanArrayParser(const std::shared_ptr<arrow::DataType>& type) {
        type_ = type;
        builder_ = std::make_shared<arrow::BooleanBuilder>();
    }
    /// Get the builder
    std::shared_ptr<arrow::ArrayBuilder> builder() override { return builder_; }
    /// Append a value
    arrow::Status AppendValue(const rapidjson::Value& json_obj) override {
        if (json_obj.IsNull()) return AppendNull();
        if (json_obj.IsBool()) return builder_->Append(json_obj.GetBool());
        if (json_obj.IsInt()) return builder_->Append(json_obj.GetInt() != 0);
        return JSONTypeError("boolean", json_obj.GetType());
    }
};

// Cast single signed integer value (also {Date,Time}{32,64} and Timestamp)
template <typename T>
arrow::enable_if_physical_signed_integer<T, arrow::Status> CastNumber(const rapidjson::Value& json_obj,
                                                                      const arrow::DataType& type,
                                                                      typename T::c_type* out) {
    if (json_obj.IsInt64()) {
        int64_t v64 = json_obj.GetInt64();
        *out = static_cast<typename T::c_type>(v64);
        if (*out == v64) {
            return arrow::Status::OK();
        } else {
            return arrow::Status::Invalid("Value ", v64, " out of bounds for ", type);
        }
    } else {
        *out = static_cast<typename T::c_type>(0);
        return JSONTypeError("signed int", json_obj.GetType());
    }
}

// Cast single unsigned integer value
template <typename T>
arrow::enable_if_physical_unsigned_integer<T, arrow::Status> CastNumber(const rapidjson::Value& json_obj,
                                                                        const arrow::DataType& type,
                                                                        typename T::c_type* out) {
    if (json_obj.IsUint64()) {
        uint64_t v64 = json_obj.GetUint64();
        *out = static_cast<typename T::c_type>(v64);
        if (*out == v64) {
            return arrow::Status::OK();
        } else {
            return arrow::Status::Invalid("Value ", v64, " out of bounds for ", type);
        }
    } else {
        *out = static_cast<typename T::c_type>(0);
        return JSONTypeError("unsigned int", json_obj.GetType());
    }
}

// Cast a single single floating point value
template <typename T>
arrow::enable_if_physical_floating_point<T, arrow::Status> CastNumber(const rapidjson::Value& json_obj,
                                                                      const arrow::DataType& type,
                                                                      typename T::c_type* out) {
    if (json_obj.IsNumber()) {
        *out = static_cast<typename T::c_type>(json_obj.GetDouble());
        return arrow::Status::OK();
    } else {
        *out = static_cast<typename T::c_type>(0);
        return JSONTypeError("number", json_obj.GetType());
    }
}

/// Reader for integer array
template <typename Type, typename BuilderType = typename arrow::TypeTraits<Type>::BuilderType>
class IntegerArrayParser final : public BaseArrayParser<IntegerArrayParser<Type, BuilderType>> {
    using c_type = typename Type::c_type;
    static constexpr auto is_signed = std::is_signed<c_type>::value;

   protected:
    /// The builder
    std::shared_ptr<BuilderType> builder_;

   public:
    /// Constructor
    explicit IntegerArrayParser(const std::shared_ptr<arrow::DataType>& type) { this->type_ = type; }
    /// Initialize the builder
    arrow::Status Init() override { return this->MakeConcreteBuilder(&builder_); }
    /// Apppend a value
    arrow::Status AppendValue(const rapidjson::Value& json_obj) override {
        if (json_obj.IsNull()) return this->AppendNull();
        c_type value;
        RETURN_NOT_OK(CastNumber<Type>(json_obj, *this->type_, &value));
        return builder_->Append(value);
    }
    /// Get the array builder
    std::shared_ptr<arrow::ArrayBuilder> builder() override { return builder_; }
};

/// Reader for float array
template <typename Type, typename BuilderType = typename arrow::TypeTraits<Type>::BuilderType>
class FloatArrayParser final : public BaseArrayParser<FloatArrayParser<Type, BuilderType>> {
    using c_type = typename Type::c_type;

   protected:
    /// The builder
    std::shared_ptr<BuilderType> builder_;

   public:
    /// Constructor
    explicit FloatArrayParser(const std::shared_ptr<arrow::DataType>& type) { this->type_ = type; }
    /// Initialize the builder
    arrow::Status Init() override { return this->MakeConcreteBuilder(&builder_); }
    /// Append a value
    arrow::Status AppendValue(const rapidjson::Value& json_obj) override {
        if (json_obj.IsNull()) return this->AppendNull();
        c_type value;
        RETURN_NOT_OK(CastNumber<Type>(json_obj, *this->type_, &value));
        return builder_->Append(value);
    }
    /// Get the array builder
    std::shared_ptr<arrow::ArrayBuilder> builder() override { return builder_; }
};

/// Reader for decimal arrays
template <typename DecimalSubtype, typename DecimalValue, typename BuilderType>
class DecimalArrayParser final : public BaseArrayParser<DecimalArrayParser<DecimalSubtype, DecimalValue, BuilderType>> {
   protected:
    /// The builder
    std::shared_ptr<BuilderType> builder_;
    /// The decimal subtype
    const DecimalSubtype* decimal_type_;

   public:
    /// Constructor
    explicit DecimalArrayParser(const std::shared_ptr<arrow::DataType>& type) {
        this->type_ = type;
        decimal_type_ = &static_cast<const DecimalSubtype&>(*this->value_type());
    }
    /// Get the array builder
    std::shared_ptr<arrow::ArrayBuilder> builder() override { return builder_; }
    /// Initialize the array reader
    arrow::Status Init() override { return this->MakeConcreteBuilder(&builder_); }
    /// Append a value
    arrow::Status AppendValue(const rapidjson::Value& json_obj) override {
        if (json_obj.IsNull()) return this->AppendNull();
        if (json_obj.IsString()) {
            int32_t precision, scale;
            DecimalValue d;
            auto view = arrow::util::string_view(json_obj.GetString(), json_obj.GetStringLength());
            RETURN_NOT_OK(DecimalValue::FromString(view, &d, &precision, &scale));
            if (scale != decimal_type_->scale()) {
                return arrow::Status::Invalid("Invalid scale for decimal: expected ", decimal_type_->scale(), ", got ",
                                              scale);
            }
            return builder_->Append(d);
        }
        return JSONTypeError("decimal string", json_obj.GetType());
    }
};

template <typename BuilderType = typename arrow::TypeTraits<arrow::Decimal128Type>::BuilderType>
using Decimal128ArrayParser = DecimalArrayParser<arrow::Decimal128Type, arrow::Decimal128, BuilderType>;
template <typename BuilderType = typename arrow::TypeTraits<arrow::Decimal256Type>::BuilderType>
using Decimal256ArrayParser = DecimalArrayParser<arrow::Decimal256Type, arrow::Decimal256, BuilderType>;

class TimestampArrayParser final : public BaseArrayParser<TimestampArrayParser> {
   protected:
    /// The timestamp type
    const arrow::TimestampType* timestamp_type_;
    /// The timestamp builder
    std::shared_ptr<arrow::TimestampBuilder> builder_;

   public:
    /// Constructor
    explicit TimestampArrayParser(const std::shared_ptr<arrow::DataType>& type)
        : timestamp_type_{static_cast<const arrow::TimestampType*>(type.get())} {
        this->type_ = type;
        builder_ = std::make_shared<arrow::TimestampBuilder>(type, arrow::default_memory_pool());
    }
    /// Get the array builder
    std::shared_ptr<arrow::ArrayBuilder> builder() override { return builder_; }
    /// Append a value
    arrow::Status AppendValue(const rapidjson::Value& json_obj) override {
        if (json_obj.IsNull()) return this->AppendNull();
        int64_t value;
        if (json_obj.IsNumber()) {
            RETURN_NOT_OK(CastNumber<arrow::Int64Type>(json_obj, *this->type_, &value));
        } else if (json_obj.IsString()) {
            arrow::util::string_view view(json_obj.GetString(), json_obj.GetStringLength());
            if (!arrow::internal::ParseValue(*timestamp_type_, view.data(), view.size(), &value)) {
                return arrow::Status::Invalid("couldn't parse timestamp from ", view);
            }
        } else {
            return JSONTypeError("timestamp", json_obj.GetType());
        }
        return builder_->Append(value);
    }
};

class DayTimeIntervalArrayParser final : public BaseArrayParser<DayTimeIntervalArrayParser> {
   protected:
    /// The builder
    std::shared_ptr<arrow::DayTimeIntervalBuilder> builder_;

   public:
    /// Constructor
    explicit DayTimeIntervalArrayParser(const std::shared_ptr<arrow::DataType>& type) {
        this->type_ = type;
        builder_ = std::make_shared<arrow::DayTimeIntervalBuilder>(arrow::default_memory_pool());
    }
    /// Append a value
    arrow::Status AppendValue(const rapidjson::Value& json_obj) override {
        if (json_obj.IsNull()) return this->AppendNull();
        arrow::DayTimeIntervalType::DayMilliseconds value;
        if (!json_obj.IsArray()) return JSONTypeError("array", json_obj.GetType());
        if (json_obj.Size() != 2) {
            return arrow::Status::Invalid("day time interval pair must have exactly two elements, had ",
                                          json_obj.Size());
        }
        RETURN_NOT_OK(CastNumber<arrow::Int32Type>(json_obj[0], *this->type_, &value.days));
        RETURN_NOT_OK(CastNumber<arrow::Int32Type>(json_obj[1], *this->type_, &value.milliseconds));
        return builder_->Append(value);
    }

    std::shared_ptr<arrow::ArrayBuilder> builder() override { return builder_; }
};

template <typename Type, typename BuilderType = typename arrow::TypeTraits<Type>::BuilderType>
class StringArrayParser final : public BaseArrayParser<StringArrayParser<Type, BuilderType>> {
   protected:
    /// The builder
    std::shared_ptr<BuilderType> builder_;

   public:
    /// Constructor
    explicit StringArrayParser(const std::shared_ptr<arrow::DataType>& type) { this->type_ = type; }
    /// Get the builder
    std::shared_ptr<arrow::ArrayBuilder> builder() override { return builder_; }
    /// Initialize the reader
    arrow::Status Init() override { return this->MakeConcreteBuilder(&builder_); }
    /// Append a value
    arrow::Status AppendValue(const rapidjson::Value& json_obj) override {
        if (json_obj.IsNull()) return this->AppendNull();
        if (json_obj.IsString()) {
            auto view = arrow::util::string_view(json_obj.GetString(), json_obj.GetStringLength());
            return builder_->Append(view);
        } else {
            return JSONTypeError("string", json_obj.GetType());
        }
    }
};

template <typename BuilderType = typename arrow::TypeTraits<arrow::FixedSizeBinaryType>::BuilderType>
class FixedSizeBinaryArrayParser final : public BaseArrayParser<FixedSizeBinaryArrayParser<BuilderType>> {
   protected:
    /// Get the builder
    std::shared_ptr<BuilderType> builder_;

   public:
    /// Constructor
    explicit FixedSizeBinaryArrayParser(const std::shared_ptr<arrow::DataType>& type) { this->type_ = type; }
    /// Get a builder
    std::shared_ptr<arrow::ArrayBuilder> builder() override { return builder_; }
    /// Initialize the builder
    arrow::Status Init() override { return this->MakeConcreteBuilder(&builder_); }
    /// Append a value
    arrow::Status AppendValue(const rapidjson::Value& json_obj) override {
        if (json_obj.IsNull()) return this->AppendNull();
        if (json_obj.IsString()) {
            auto view = arrow::util::string_view(json_obj.GetString(), json_obj.GetStringLength());
            if (view.length() != static_cast<size_t>(builder_->byte_width())) {
                std::stringstream ss;
                ss << "Invalid string length " << view.length() << " in JSON input for " << this->type_->ToString();
                return arrow::Status::Invalid(ss.str());
            }
            return builder_->Append(view);
        } else {
            return JSONTypeError("string", json_obj.GetType());
        }
    }
};

template <typename TYPE> class ListArrayParser final : public BaseArrayParser<ListArrayParser<TYPE>> {
    using BuilderType = typename arrow::TypeTraits<TYPE>::BuilderType;

   protected:
    /// The builder type
    std::shared_ptr<BuilderType> builder_;
    /// The child converter
    std::shared_ptr<ArrayParser> child_converter_;

   public:
    /// Constructor
    explicit ListArrayParser(const std::shared_ptr<arrow::DataType>& type) { this->type_ = type; }
    /// Get the internal buidler
    std::shared_ptr<arrow::ArrayBuilder> builder() override { return builder_; }
    /// Initialize the array builder
    arrow::Status Init() override {
        const auto& list_type = static_cast<const TYPE&>(*this->type_);
        RETURN_NOT_OK(ResolveArrayParser(list_type.value_type(), &child_converter_));
        auto child_builder = child_converter_->builder();
        builder_ = std::make_shared<BuilderType>(arrow::default_memory_pool(), child_builder, this->type_);
        return arrow::Status::OK();
    }
    /// Append a value
    arrow::Status AppendValue(const rapidjson::Value& json_obj) override {
        if (json_obj.IsNull()) return this->AppendNull();
        RETURN_NOT_OK(builder_->Append());
        // Extend the child converter with this JSON array
        return child_converter_->AppendValues(json_obj);
    }
};

class MapArrayParser final : public BaseArrayParser<MapArrayParser> {
   protected:
    /// The builder
    std::shared_ptr<arrow::MapBuilder> builder_;
    /// The builder
    std::shared_ptr<ArrayParser> key_parser_, item_parser_;

   public:
    /// Constructor
    explicit MapArrayParser(const std::shared_ptr<arrow::DataType>& type) { type_ = type; }
    /// Get the builder
    std::shared_ptr<arrow::ArrayBuilder> builder() override { return builder_; }
    /// Initialize the parser
    arrow::Status Init() override {
        const auto& map_type = static_cast<const arrow::MapType&>(*type_);
        RETURN_NOT_OK(ResolveArrayParser(map_type.key_type(), &key_parser_));
        RETURN_NOT_OK(ResolveArrayParser(map_type.item_type(), &item_parser_));
        auto key_builder = key_parser_->builder();
        auto item_builder = item_parser_->builder();
        builder_ = std::make_shared<arrow::MapBuilder>(arrow::default_memory_pool(), key_builder, item_builder, type_);
        return arrow::Status::OK();
    }
    /// Append a value
    arrow::Status AppendValue(const rapidjson::Value& json_obj) override {
        if (json_obj.IsNull()) return this->AppendNull();
        RETURN_NOT_OK(builder_->Append());
        if (!json_obj.IsArray()) return JSONTypeError("array", json_obj.GetType());
        auto size = json_obj.Size();
        for (uint32_t i = 0; i < size; ++i) {
            const auto& json_pair = json_obj[i];
            if (!json_pair.IsArray()) return JSONTypeError("array", json_pair.GetType());
            if (json_pair.Size() != 2) {
                return arrow::Status::Invalid("key item pair must have exactly two elements, had ", json_pair.Size());
            }
            if (json_pair[0].IsNull()) return arrow::Status::Invalid("null key is invalid");
            RETURN_NOT_OK(key_parser_->AppendValue(json_pair[0]));
            RETURN_NOT_OK(item_parser_->AppendValue(json_pair[1]));
        }
        return arrow::Status::OK();
    }
};

class FixedSizeListArrayParser final : public BaseArrayParser<FixedSizeListArrayParser> {
   protected:
    /// The list size
    int32_t list_size_;
    /// The builder
    std::shared_ptr<arrow::FixedSizeListBuilder> builder_;
    /// The child converter
    std::shared_ptr<ArrayParser> child_converter_;

   public:
    /// Constructor
    explicit FixedSizeListArrayParser(const std::shared_ptr<arrow::DataType>& type) { type_ = type; }
    /// Get the builder
    std::shared_ptr<arrow::ArrayBuilder> builder() override { return builder_; }
    /// Initialize the parser
    arrow::Status Init() override {
        const auto& list_type = static_cast<const arrow::FixedSizeListType&>(*type_);
        list_size_ = list_type.list_size();
        RETURN_NOT_OK(ResolveArrayParser(list_type.value_type(), &child_converter_));
        auto child_builder = child_converter_->builder();
        builder_ = std::make_shared<arrow::FixedSizeListBuilder>(arrow::default_memory_pool(), child_builder, type_);
        return arrow::Status::OK();
    }
    /// Append a JSON value
    arrow::Status AppendValue(const rapidjson::Value& json_obj) override {
        if (json_obj.IsNull()) {
            return this->AppendNull();
        }
        RETURN_NOT_OK(builder_->Append());
        // Extend the child converter with this JSON array
        RETURN_NOT_OK(child_converter_->AppendValues(json_obj));
        if (json_obj.GetArray().Size() != static_cast<rapidjson::SizeType>(list_size_)) {
            return arrow::Status::Invalid("incorrect list size ", json_obj.GetArray().Size());
        }
        return arrow::Status::OK();
    }
};

class StructArrayParser final : public BaseArrayParser<StructArrayParser> {
   protected:
    /// The builder
    std::shared_ptr<arrow::StructBuilder> builder_;
    /// The child converted
    std::vector<std::shared_ptr<ArrayParser>> child_parsers_;

   public:
    /// Constructor
    explicit StructArrayParser(const std::shared_ptr<arrow::DataType>& type) { type_ = type; }
    /// Get the builder
    std::shared_ptr<arrow::ArrayBuilder> builder() override { return builder_; }
    /// Initialize the parser
    arrow::Status Init() override {
        std::vector<std::shared_ptr<arrow::ArrayBuilder>> child_builders;
        for (const auto& field : type_->fields()) {
            std::shared_ptr<ArrayParser> child_converter;
            RETURN_NOT_OK(ResolveArrayParser(field->type(), &child_converter));
            child_parsers_.push_back(child_converter);
            child_builders.push_back(child_converter->builder());
        }
        builder_ =
            std::make_shared<arrow::StructBuilder>(type_, arrow::default_memory_pool(), std::move(child_builders));
        return arrow::Status::OK();
    }

    // Append a JSON value that is either an array of N elements in order
    // or an object mapping struct names to values (omitted struct members
    // are mapped to null).
    arrow::Status AppendValue(const rapidjson::Value& json_obj) override {
        if (json_obj.IsNull()) return this->AppendNull();
        if (json_obj.IsArray()) {
            auto size = json_obj.Size();
            auto expected_size = static_cast<uint32_t>(type_->num_fields());
            if (size != expected_size) {
                return arrow::Status::Invalid("Expected array of size ", expected_size, ", got array of size ", size);
            }
            for (uint32_t i = 0; i < size; ++i) {
                RETURN_NOT_OK(child_parsers_[i]->AppendValue(json_obj[i]));
            }
            return builder_->Append();
        }
        if (json_obj.IsObject()) {
            auto remaining = json_obj.MemberCount();
            auto num_children = type_->num_fields();
            for (int32_t i = 0; i < num_children; ++i) {
                const auto& field = type_->field(i);
                auto it = json_obj.FindMember(field->name().c_str());
                if (it != json_obj.MemberEnd()) {
                    --remaining;
                    RETURN_NOT_OK(child_parsers_[i]->AppendValue(it->value));
                } else {
                    RETURN_NOT_OK(child_parsers_[i]->AppendNull());
                }
            }
            if (remaining > 0) {
                rapidjson::StringBuffer sb;
                rapidjson::Writer<rapidjson::StringBuffer> writer(sb);
                json_obj.Accept(writer);
                return arrow::Status::Invalid("Unexpected members in JSON object for type ", type_->ToString(),
                                              " Object: ", sb.GetString());
            }
            return builder_->Append();
        }
        return JSONTypeError("array or object", json_obj.GetType());
    }
};

class UnionArrayParser final : public BaseArrayParser<UnionArrayParser> {
   protected:
    /// The union mode
    arrow::UnionMode::type mode_;
    /// The builder
    std::shared_ptr<arrow::ArrayBuilder> builder_;
    /// The child parsers
    std::vector<std::shared_ptr<ArrayParser>> child_parsers_;
    /// The type identifier
    std::vector<int8_t> type_id_to_child_num_;

   public:
    /// Constructor
    explicit UnionArrayParser(const std::shared_ptr<arrow::DataType>& type) { type_ = type; }
    /// Get the builder
    std::shared_ptr<arrow::ArrayBuilder> builder() override { return builder_; }
    /// Initialize the array parser
    arrow::Status Init() override {
        auto union_type = static_cast<const arrow::UnionType*>(type_.get());
        mode_ = union_type->mode();
        type_id_to_child_num_.clear();
        type_id_to_child_num_.resize(union_type->max_type_code() + 1, -1);
        int child_i = 0;
        for (auto type_id : union_type->type_codes()) {
            type_id_to_child_num_[type_id] = child_i++;
        }
        std::vector<std::shared_ptr<arrow::ArrayBuilder>> child_builders;
        for (const auto& field : type_->fields()) {
            std::shared_ptr<ArrayParser> child_converter;
            RETURN_NOT_OK(ResolveArrayParser(field->type(), &child_converter));
            child_parsers_.push_back(child_converter);
            child_builders.push_back(child_converter->builder());
        }
        if (mode_ == arrow::UnionMode::DENSE) {
            builder_ = std::make_shared<arrow::DenseUnionBuilder>(arrow::default_memory_pool(),
                                                                  std::move(child_builders), type_);
        } else {
            builder_ = std::make_shared<arrow::SparseUnionBuilder>(arrow::default_memory_pool(),
                                                                   std::move(child_builders), type_);
        }
        return arrow::Status::OK();
    }

    /// Append a JSON value that must be a 2-long array, containing the type_id
    /// and value of the UnionArray's slot.
    arrow::Status AppendValue(const rapidjson::Value& json_obj) override {
        if (json_obj.IsNull()) return this->AppendNull();
        if (!json_obj.IsArray()) return JSONTypeError("array", json_obj.GetType());
        if (json_obj.Size() != 2) {
            return arrow::Status::Invalid("Expected [type_id, value] pair, got array of size ", json_obj.Size());
        }
        const auto& id_obj = json_obj[0];
        if (!id_obj.IsInt()) {
            return JSONTypeError("int", id_obj.GetType());
        }

        auto id = static_cast<int8_t>(id_obj.GetInt());
        auto child_num = type_id_to_child_num_[id];
        if (child_num == -1) {
            return arrow::Status::Invalid("type_id ", id, " not found in ", *type_);
        }

        auto child_converter = child_parsers_[child_num];
        if (mode_ == arrow::UnionMode::SPARSE) {
            RETURN_NOT_OK(static_cast<arrow::SparseUnionBuilder&>(*builder_).Append(id));
            for (auto&& other_converter : child_parsers_) {
                if (other_converter != child_converter) {
                    RETURN_NOT_OK(other_converter->AppendNull());
                }
            }
        } else {
            RETURN_NOT_OK(static_cast<arrow::DenseUnionBuilder&>(*builder_).Append(id));
        }
        return child_converter->AppendValue(json_obj[1]);
    }
};

arrow::Status JSONParsingNotImplemented(const std::shared_ptr<arrow::DataType>& type) {
    return arrow::Status::NotImplemented("JSON conversion to ", type->ToString(), " not implemented");
}

arrow::Status GetDictArrayParser(const std::shared_ptr<arrow::DataType>& type, std::shared_ptr<ArrayParser>* out) {
    std::shared_ptr<ArrayParser> res;
    const auto value_type = static_cast<const arrow::DictionaryType&>(*type).value_type();

#define SIMPLE_PARSER_CASE(ID, CLASS, TYPE)                                  \
    case ID:                                                                 \
        res = std::make_shared<CLASS<arrow::DictionaryBuilder<TYPE>>>(type); \
        break;

#define PARAM_PARSER_CASE(ID, CLASS, TYPE)                                         \
    case ID:                                                                       \
        res = std::make_shared<CLASS<TYPE, arrow::DictionaryBuilder<TYPE>>>(type); \
        break;

    switch (value_type->id()) {
        PARAM_PARSER_CASE(arrow::Type::INT8, IntegerArrayParser, arrow::Int8Type)
        PARAM_PARSER_CASE(arrow::Type::INT16, IntegerArrayParser, arrow::Int16Type)
        PARAM_PARSER_CASE(arrow::Type::INT32, IntegerArrayParser, arrow::Int32Type)
        PARAM_PARSER_CASE(arrow::Type::INT64, IntegerArrayParser, arrow::Int64Type)
        PARAM_PARSER_CASE(arrow::Type::UINT8, IntegerArrayParser, arrow::UInt8Type)
        PARAM_PARSER_CASE(arrow::Type::UINT16, IntegerArrayParser, arrow::UInt16Type)
        PARAM_PARSER_CASE(arrow::Type::UINT32, IntegerArrayParser, arrow::UInt32Type)
        PARAM_PARSER_CASE(arrow::Type::UINT64, IntegerArrayParser, arrow::UInt64Type)
        PARAM_PARSER_CASE(arrow::Type::STRING, StringArrayParser, arrow::StringType)
        PARAM_PARSER_CASE(arrow::Type::BINARY, StringArrayParser, arrow::BinaryType)
        PARAM_PARSER_CASE(arrow::Type::LARGE_STRING, StringArrayParser, arrow::LargeStringType)
        PARAM_PARSER_CASE(arrow::Type::LARGE_BINARY, StringArrayParser, arrow::LargeBinaryType)
        SIMPLE_PARSER_CASE(arrow::Type::FIXED_SIZE_BINARY, FixedSizeBinaryArrayParser, arrow::FixedSizeBinaryType)
        SIMPLE_PARSER_CASE(arrow::Type::DECIMAL128, Decimal128ArrayParser, arrow::Decimal128Type)
        SIMPLE_PARSER_CASE(arrow::Type::DECIMAL256, Decimal256ArrayParser, arrow::Decimal256Type)
        default:
            return JSONParsingNotImplemented(type);
    }

#undef SIMPLE_PARSER_CASE
#undef PARAM_PARSER_CASE

    RETURN_NOT_OK(res->Init());
    *out = res;
    return arrow::Status::OK();
}

arrow::Status ResolveArrayParser(const std::shared_ptr<arrow::DataType>& type, std::shared_ptr<ArrayParser>* out) {
    if (type->id() == arrow::Type::DICTIONARY) return GetDictArrayParser(type, out);
    std::shared_ptr<ArrayParser> res;

#define SIMPLE_PARSER_CASE(ID, CLASS)        \
    case ID:                                 \
        res = std::make_shared<CLASS>(type); \
        break;

    switch (type->id()) {
        SIMPLE_PARSER_CASE(arrow::Type::INT8, IntegerArrayParser<arrow::Int8Type>)
        SIMPLE_PARSER_CASE(arrow::Type::INT16, IntegerArrayParser<arrow::Int16Type>)
        SIMPLE_PARSER_CASE(arrow::Type::INT32, IntegerArrayParser<arrow::Int32Type>)
        SIMPLE_PARSER_CASE(arrow::Type::INT64, IntegerArrayParser<arrow::Int64Type>)
        SIMPLE_PARSER_CASE(arrow::Type::UINT8, IntegerArrayParser<arrow::UInt8Type>)
        SIMPLE_PARSER_CASE(arrow::Type::UINT16, IntegerArrayParser<arrow::UInt16Type>)
        SIMPLE_PARSER_CASE(arrow::Type::UINT32, IntegerArrayParser<arrow::UInt32Type>)
        SIMPLE_PARSER_CASE(arrow::Type::UINT64, IntegerArrayParser<arrow::UInt64Type>)
        SIMPLE_PARSER_CASE(arrow::Type::TIMESTAMP, TimestampArrayParser)
        SIMPLE_PARSER_CASE(arrow::Type::DATE32, IntegerArrayParser<arrow::Date32Type>)
        SIMPLE_PARSER_CASE(arrow::Type::DATE64, IntegerArrayParser<arrow::Date64Type>)
        SIMPLE_PARSER_CASE(arrow::Type::TIME32, IntegerArrayParser<arrow::Time32Type>)
        SIMPLE_PARSER_CASE(arrow::Type::TIME64, IntegerArrayParser<arrow::Time64Type>)
        SIMPLE_PARSER_CASE(arrow::Type::DURATION, IntegerArrayParser<arrow::DurationType>)
        SIMPLE_PARSER_CASE(arrow::Type::NA, NullArrayParser)
        SIMPLE_PARSER_CASE(arrow::Type::BOOL, BooleanArrayParser)
        SIMPLE_PARSER_CASE(arrow::Type::HALF_FLOAT, IntegerArrayParser<arrow::HalfFloatType>)
        SIMPLE_PARSER_CASE(arrow::Type::FLOAT, FloatArrayParser<arrow::FloatType>)
        SIMPLE_PARSER_CASE(arrow::Type::DOUBLE, FloatArrayParser<arrow::DoubleType>)
        SIMPLE_PARSER_CASE(arrow::Type::LIST, ListArrayParser<arrow::ListType>)
        SIMPLE_PARSER_CASE(arrow::Type::LARGE_LIST, ListArrayParser<arrow::LargeListType>)
        SIMPLE_PARSER_CASE(arrow::Type::MAP, MapArrayParser)
        SIMPLE_PARSER_CASE(arrow::Type::FIXED_SIZE_LIST, FixedSizeListArrayParser)
        SIMPLE_PARSER_CASE(arrow::Type::STRUCT, StructArrayParser)
        SIMPLE_PARSER_CASE(arrow::Type::STRING, StringArrayParser<arrow::StringType>)
        SIMPLE_PARSER_CASE(arrow::Type::BINARY, StringArrayParser<arrow::BinaryType>)
        SIMPLE_PARSER_CASE(arrow::Type::LARGE_STRING, StringArrayParser<arrow::LargeStringType>)
        SIMPLE_PARSER_CASE(arrow::Type::LARGE_BINARY, StringArrayParser<arrow::LargeBinaryType>)
        SIMPLE_PARSER_CASE(arrow::Type::FIXED_SIZE_BINARY, FixedSizeBinaryArrayParser<>)
        SIMPLE_PARSER_CASE(arrow::Type::DECIMAL128, Decimal128ArrayParser<>)
        SIMPLE_PARSER_CASE(arrow::Type::DECIMAL256, Decimal256ArrayParser<>)
        SIMPLE_PARSER_CASE(arrow::Type::SPARSE_UNION, UnionArrayParser)
        SIMPLE_PARSER_CASE(arrow::Type::DENSE_UNION, UnionArrayParser)
        SIMPLE_PARSER_CASE(arrow::Type::INTERVAL_MONTHS, IntegerArrayParser<arrow::MonthIntervalType>)
        SIMPLE_PARSER_CASE(arrow::Type::INTERVAL_DAY_TIME, DayTimeIntervalArrayParser)
        default:
            return JSONParsingNotImplemented(type);
    }
#undef SIMPLE_PARSER_CASE

    RETURN_NOT_OK(res->Init());
    *out = res;
    return arrow::Status::OK();
}

}  // namespace json
}  // namespace web
}  // namespace duckdb
