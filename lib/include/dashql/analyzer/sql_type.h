// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_ANALYZER_SQL_TYPE_H_
#define INCLUDE_DASHQL_ANALYZER_SQL_TYPE_H_

#include "dashql/proto_generated.h"

namespace dashql {

struct SQLField;

struct SQLType {
    /// The sql type
    proto::sql::SQLTypeID sql_type;
    /// Is nullable?
    bool is_nullable;
    /// Is array?
    bool is_array;
    /// Decimal precision
    std::optional<size_t> decimal_precision;
    /// Decimal scaling
    std::optional<size_t> decimal_scale;
    /// Timezone
    std::optional<std::string> timezone;
    /// Byte width
    std::optional<size_t> byte_width;
    /// Array size
    std::optional<size_t> array_size;
    /// Key type
    std::unique_ptr<SQLType> key_type;
    /// Value type
    std::unique_ptr<SQLType> value_type;
    /// Fields
    std::vector<SQLField> fields;
};

struct SQLField {
    /// The field type
    std::unique_ptr<SQLType> type;
    /// The name
    std::string name;
};

}  // namespace dashql

#endif
