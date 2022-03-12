// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_ANALYZER_SQL_TYPE_H_
#define INCLUDE_DASHQL_ANALYZER_SQL_TYPE_H_

#include "arrow/result.h"
#include "arrow/type.h"
#include "dashql/proto_generated.h"

namespace dashql {

class ProgramInstance;

struct SQLField;

struct SQLType {
    /// The sql type
    proto::sql::SQLTypeID sql_type;
    /// Is nullable?
    bool is_nullable;
    /// Decimal precision
    std::optional<int32_t> decimal_precision;
    /// Decimal scaling
    std::optional<int32_t> decimal_scale;
    /// Byte width
    std::optional<int32_t> byte_width;
    /// List size
    std::optional<int32_t> list_size;
    /// Value type
    std::unique_ptr<SQLType> value_type;
    /// Fields
    std::vector<SQLField> fields;

    /// Pack a sql type
    flatbuffers::Offset<proto::sql::SQLType> Pack(flatbuffers::FlatBufferBuilder& builder) const;

    /// Do the buffers equal?
    static bool TypesEqual(const std::unique_ptr<proto::sql::SQLTypeT>& l,
                           const std::unique_ptr<proto::sql::SQLTypeT>& r);
    /// Read a sql type
    static arrow::Result<std::unique_ptr<SQLType>> ReadFrom(ProgramInstance& instance, size_t node_id);

    /// Create a type from an arrow data type
    static std::unique_ptr<SQLType> FromArrow(const arrow::DataType& type);
    /// Create a BIGINT
    static std::unique_ptr<SQLType> BIGINT();
    /// Create a DOUBLE
    static std::unique_ptr<SQLType> DOUBLE();
    /// Create a VARCHAR
    static std::unique_ptr<SQLType> VARCHAR();
    /// Create a NULL
    static std::unique_ptr<SQLType> SQLNULL();
};

struct SQLField {
    /// The field type
    std::unique_ptr<SQLType> type;
    /// The name
    std::string name;
};

}  // namespace dashql

#endif
